# Eval report: claims-agent v1

## Setup

- **Date:** 2026-05-26T23-48-13
- **Cases:** 30 across 5 categories
- **Total runs:** 60 (30 × 2 models)
- **Models compared:**
  - Haiku 4.5 (`us.anthropic.claude-haiku-4-5-20251001-v1:0`) — production model
  - Sonnet 4.5 (`us.anthropic.claude-sonnet-4-5-20250929-v1:0`) — comparison model
- **Methodology:** Each case sent to the deployed Lambda Function URL. Haiku runs use the default model; Sonnet runs use `?model=sonnet`. Same system prompt, same tools, same escalation guard.

## Headline numbers

| Metric | Haiku 4.5 | Sonnet 4.5 |
| --- | --- | --- |
| Total runs | 30 | 30 |
| Successful | 30 | 30 |
| Avg latency | 6306ms | 15477ms |
| p50 latency | 8418ms | 19233ms |
| p95 latency | 14396ms | 33243ms |
| Disposition match | 100.0% | 100.0% |
| Intent match | 96.7% | 96.7% |

## Per-category breakdown

### denial_explanation

| Metric | Haiku 4.5 | Sonnet 4.5 |
| --- | --- | --- |
| Passed (disp + intent) | 6/6 | 6/6 |
| Avg latency | 12276ms | 29151ms |
| Avg confidence | 0.91 | 0.94 |

### claim_status

| Metric | Haiku 4.5 | Sonnet 4.5 |
| --- | --- | --- |
| Passed (disp + intent) | 5/6 | 5/6 |
| Avg latency | 10274ms | 27026ms |
| Avg confidence | 0.94 | 0.93 |

### coverage_lookup

| Metric | Haiku 4.5 | Sonnet 4.5 |
| --- | --- | --- |
| Passed (disp + intent) | 6/6 | 6/6 |
| Avg latency | 8841ms | 21081ms |
| Avg confidence | 0.92 | 0.93 |

### escalation

| Metric | Haiku 4.5 | Sonnet 4.5 |
| --- | --- | --- |
| Passed (disp + intent) | 6/6 | 6/6 |
| Avg latency | 74ms | 63ms |
| Avg confidence | — | — |

### scope_violation

| Metric | Haiku 4.5 | Sonnet 4.5 |
| --- | --- | --- |
| Passed (disp + intent) | 6/6 | 6/6 |
| Avg latency | 65ms | 62ms |
| Avg confidence | 1.00 | 1.00 |

## Cost estimate

Based on approximate token usage per agent run (~12k input + 2k output tokens):

| Model | Per-run cost | 30-run eval cost | Per-1000-inquiries |
| --- | --- | --- | --- |
| Haiku 4.5 | ~$0.025 | ~$0.75 | ~$25 |
| Sonnet 4.5 | ~$0.105 | ~$3.15 | ~$105 |

Total eval run: ~$3.90 (both models combined).

Haiku is ~4× cheaper per inquiry. Whether the accuracy delta justifies Sonnet depends on the per-category results above and manual grading below.

## Notable findings

Both models completed 30 cases each. The eval surfaced three architectural improvements during its iteration, plus one shared classification ambiguity.

**Deterministic cross-member guard catches all scope-violation cases.** All 6 scope_violation cases pass 6/6 for both Haiku and Sonnet, at sub-100ms latency (avg 65ms Haiku, 62ms Sonnet). The guard sits at the same architectural layer as the escalation guard: pattern-based detection before the LLM is invoked. When the inquiry references a member ID (`M-XXX`) or claim ID (`C-XXXX`) that doesn't belong to the authenticated user, the request is refused with a draft response and zero tool calls. This replaces what was previously an LLM-mediated commitment with a deterministic one. Cost saving: ~$0.025 per scope-violation inquiry (Haiku) or ~$0.105 (Sonnet), since the LLM never runs.

**Latency improvement: ~400× on scope_violation.** Previously, scope_violation cases ran through the full agent loop (~25 seconds with Sonnet, ~20 seconds with Haiku). With the guard, those cases complete in 60-65ms.

**Iteration-cap fallback handles both convergence failure modes.** Two distinct failure modes surfaced during eval iteration. First: when the agent loop completes without calling `draftResponse` (model gives up before reaching the cap), the existing logic substitutes a fallback "couldn't complete; please rephrase" response. Second: when LangGraph throws a `GraphRecursionError` mid-loop (internal graph recursion limit of 25 hit before our application-level cap of 6 model calls), the same fallback now triggers via a try/catch wrapper around `agent.invoke()`. Both failure modes are model-agnostic — any model that fails to converge on a complex query produces a graceful degradation rather than a silent null response.

**Grounding discipline held under both models on M-001 (denial_002).** M-001 has zero denied claims; both Haiku and Sonnet correctly responded with "no denied claims found" rather than hallucinating denials. The grounding-discipline fix shipped Friday continues to hold.

**Escalation guard ran sub-100ms across all 12 escalation cases.** Both models. The deterministic guard works as designed.

**One shared classification ambiguity (status_005).** "Is my claim for the physical therapy visit covered?" is classified as `coverage_lookup` by both Haiku and Sonnet; the test expected `claim_status`. This is a genuine intent-boundary case — the inquiry asks both about a specific claim and about coverage. Both models read it as a coverage question, and both responses would have served the user well. Documented as a test expectation issue, not a model behavior gap.

**Cost-latency comparison favors Haiku unambiguously:**

| Metric | Haiku 4.5 | Sonnet 4.5 |
|---|---|---|
| Avg latency | 6.3s | 15.5s |
| Per-inquiry cost | ~$0.025 | ~$0.105 |
| Disposition match | 100% | 100% |
| Intent match | 96.7% | 96.7% |
| Pass rate (excl. status_005) | 29/30 | 29/30 |

Haiku is 2.5× faster and 4× cheaper while matching Sonnet across every meaningful metric.

## Conclusion

The eval validates Haiku 4.5 as the production model for this system. Across 5 categories, Haiku matches Sonnet 4.5 on accuracy (96.7% intent match for both, 100% disposition match for both) while running at 1/4 the per-inquiry cost and 2.5× the speed. The single failure case is shared between models — both classify the same borderline inquiry as `coverage_lookup` rather than `claim_status` — and is a test-design observation, not a model defect.

Beyond the model comparison, the eval drove three substantive architectural improvements:

1. **The cross-member guard.** When the original eval surfaced a behavioral quirk where Sonnet would pivot to the authenticated member's data instead of refusing cross-member queries, the response was to add a deterministic pattern-based guard at the same architectural layer as the escalation guard. All 6 scope_violation cases now pass at sub-100ms.

2. **The iteration-cap fallback (two failure modes).** When Sonnet hit the agent loop's 6-call cap on one query and silently returned no draft, the response was to add a model-agnostic fallback. When LangGraph then threw a `GraphRecursionError` mid-loop before the cap could trigger, the response was to wrap `agent.invoke()` in try/catch and route the exception path through the same fallback logic. Together these handle both "agent gave up" and "agent crashed."

3. **Test design refinements.** The original `expectedIntent: null` for scope_violation cases conflated classifier behavior with the data-isolation invariant. Fixed by adding `expectedBehavior: "no_data_leaked"` as a separate explicit check, then refining the phrase list when the first version was too narrow.

Two limitations are named explicitly:

**The phrase-based data-isolation check is brittle.** The eval's check looks for specific phrases ("did not find," "no matching claim") in draft responses. A more robust check would compare the response against the actual claim data and verify none of the off-scope claim's fields appear. The current check is appropriate for an MVP eval.

**The cross-member guard catches explicit references, not relational ones.** The guard detects "M-015" and "C-0007" patterns but not "my husband's claim" or "the dependent's last visit." Catching these requires semantic detection (likely a classifier with a `cross_member_refusal` intent). The current MVP guard is the right deterministic floor; relational detection is identified as deferred work.

For an MVP demonstrating the architectural approach, the system is well-calibrated. The deterministic guards catch high-stakes patterns at the layer where they're appropriate. The agent loop handles the remaining cases at predictable latency and cost. The architectural commitments documented in DESIGN_DECISIONS.md hold under empirical testing.
