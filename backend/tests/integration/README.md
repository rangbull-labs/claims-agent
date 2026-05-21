# Integration tests

End-to-end tests that exercise the **deployed** `claims-agent` Lambda Function URL with real DynamoDB, real Bedrock, and real KB retrieval. These are distinct from the unit tests under `backend/src/**/*.test.ts`, which run against the local code in process.

This suite captures the four manual curl tests run at the end of Prompt 6 deployment, turned into something you can re-run any time the Lambda changes.

## How to run

The Lambda must already be deployed and the synthetic data must already be seeded (members `M-001` and `M-009` are referenced by the cases). Then:

```bash
FUNCTION_URL=https://<your-lambda>.lambda-url.us-east-1.on.aws/ \
  pnpm --filter @claims-agent/backend test:integration

# Or via CLI flag:
pnpm --filter @claims-agent/backend test:integration -- --url=https://<your-lambda>.lambda-url.us-east-1.on.aws/
```

Exit code is `0` if all cases pass *or* only known-failing cases fail; `1` if any unexpected case fails; `2` if `FUNCTION_URL` is missing.

These tests cost real Bedrock tokens on each run — the happy-path case alone is ~4 model calls. Don't loop it.

## Known-failing cases

A case may be marked `"knownFailing": true` in its `expect` block to declare an architectural gap that the suite tracks but does not gate on. Behavior:

- **Failing while marked known-failing** → rendered as `KNOWN FAIL` in yellow, listed as `known-failing gap` in the summary's notes column, and **does not contribute to the unexpected-failures count or the non-zero exit code**.
- **Passing while marked known-failing** → rendered as `PASS (was known-failing)` in green. The gap was fixed; the marker should be removed from `cases.json` in the same change that fixes it.
- **Other cases** behave as before.

This is a deliberate compromise. The case stays in the suite so the gap is visible in every run; it doesn't break CI for a known issue we're already tracking elsewhere (typically in [DESIGN_DECISIONS.md](../../../docs/DESIGN_DECISIONS.md) Section 8). When a case has a `KNOWN-FAILING:` prefix in its description, the description itself explains what the gap is and where it's tracked.

### What the runner needs from the environment

In addition to `FUNCTION_URL`, the scope-violation case reads the persisted trace from DynamoDB to verify the audit trail. That means the runner loads the same `.env` as the backend and needs:

- AWS credentials with read access to the traces table (the `claims-agent-dev` profile is sufficient).
- The standard backend env vars validated by `src/config.ts` (`AWS_REGION`, `DYNAMODB_TRACES_TABLE`, etc.). Missing vars fail fast with the same error you'd see running any other backend script.

If you only want to smoke-test the HTTP surface without reading DynamoDB, drop the `toolCallsContainScopeViolation` field from the scope-violation case — the rest of the suite is pure HTTP.

## Why these aren't in `pnpm test`

`pnpm --filter @claims-agent/backend test` runs the unit suite (`src/**/*.test.ts`) which is fast, hermetic, and runnable in CI. The integration suite needs the Lambda deployed, costs money, and runs in real time against live AWS — it's a manual-trigger thing, not a CI gate.

## What each case validates

| Case | What it proves |
| --- | --- |
| `happy-path-denial-explanation` | The full pipeline runs: classify → lookup → retrieve → draft. Confidence is calibrated. Latency is reasonable. |
| `empty-result-no-denied-claims` | **Known-failing.** The agent should accurately reflect that M-001 has no denied claims rather than drafting around them. The system-prompt-based safeguard is insufficient under non-adversarial input; the deferred deterministic policy engine (DESIGN_DECISIONS.md Section 5) is the durable fix. Kept in the suite so the gap stays visible. |
| `escalation-legal-language` | The deterministic escalation guard fires **before** the model is invoked. Sub-500ms latency is the only way this can pass — anything slower means the model was consulted, which would violate the design doc's "first line of defense is not the model" commitment. |
| `scope-violation-cross-member-claim` | Member-scoping holds under adversarial input. M-009 asks about `C-0007` (owned by another member). The agent must not draft anything (`draftResponse: null`), and the persisted trace must show a `lookupClaim` entry with `scopeViolation: true`. This case is the only one that **reads from DynamoDB** in addition to the HTTP response, because the audit trail — not just the user-visible output — is part of the architectural commitment in Section 5 of the design doc. |

## Files

- `cases.json` — declarative test fixtures. Add a new test by appending an object with `id`, `description`, `memberId`, `inquiry`, and an `expect` block. The runner picks them up automatically.
- `runIntegrationTests.ts` — runner. Parses `cases.json`, POSTs each case to the Function URL, validates the response, optionally reads the persisted trace from DynamoDB (for cases using `toolCallsContainScopeViolation`), and prints a colorized table.
