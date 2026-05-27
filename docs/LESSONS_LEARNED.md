# Lessons Learned

Friction points encountered during the Prompt 1–6 build sequence, captured as a topical reference. Each entry stands on its own — search for the symptom, read the fix, move on. Where the fix has been folded into a canonical doc (`AWS_SETUP.md`, `CLAUDE.md`, `DESIGN_DECISIONS.md`), the entry points to that location rather than restating it.

This isn't a tutorial and isn't exhaustive. It covers issues that required diagnosis, not the obvious stuff.

---

## 1. IAM and least-privilege gotchas

Most of the early-build friction was IAM. The `claims-agent-dev` user starts empty; each capability is one more statement in the policy. The traps below took more than one attempt to get right, and several of them have action names that don't match what they actually gate on.

### `dynamodb:ListTables` / `DescribeTable` not in policy

**Category:** IAM

**What happened:** Verifying tables exist with `aws dynamodb list-tables` returned `AccessDeniedException`. So did `describe-table`.

**Root cause:** The policy scopes DynamoDB actions to specific table ARNs and grants only application-level read/write. Account-level enumeration actions are deliberately not granted to a runtime user.

**Fix applied:** Used `aws dynamodb scan --table-name claims-agent-Members --max-items 1` to confirm each table exists and is readable. Works against the existing `Scan` permission scoped to the specific ARN.

**Prevention:** The application-level resource ARNs are in [AWS_SETUP.md Section 3.1](AWS_SETUP.md#31-create-the-iam-user). For sanity checks, prefer `scan --max-items 1` over `list-tables`.

### `iam:SimulatePrincipalPolicy` not in policy

**Category:** IAM

**What happened:** While debugging an `AccessDenied`, running `aws iam simulate-principal-policy` itself returned `AccessDenied`. The dev user can't simulate its own policy.

**Root cause:** `SimulatePrincipalPolicy` is an IAM management action. The dev user's policy intentionally excludes all `iam:*` actions.

**Fix applied:** Skipped the simulator. The SDK's denial message ("User X is not authorized to perform: Y on resource: Z") is already a precise diagnosis — usually more direct than reading the simulator's verdict.

**Prevention:** Don't reach for the simulator from the application user. If you need it, call from an admin profile.

### `bedrock:AssociateThirdPartyKnowledgeBase` required for Pinecone-backed KBs

**Category:** IAM

**What happened:** `pnpm ingest-kb` failed with `not authorized to perform: bedrock:AssociateThirdPartyKnowledgeBase on resource: arn:aws:bedrock:us-east-1:...:knowledge-base/...`. The action name doesn't match what was being attempted (a routine ingest, no association in sight).

**Root cause:** Bedrock validates this action on every `StartIngestionJob` against a KB whose vector store is a third-party service. It's a gate on KBs that write to non-AWS stores. OpenSearch Serverless–backed KBs don't trigger the check.

**Fix applied:** Added a `BedrockKBIngestion` statement allowing `StartIngestionJob`, `GetIngestionJob`, `ListIngestionJobs`, and `AssociateThirdPartyKnowledgeBase` scoped to the KB's ARN.

**Prevention:** The statement is in [AWS_SETUP.md Section 3.1](AWS_SETUP.md#31-create-the-iam-user) with `AssociateThirdPartyKnowledgeBase` already listed.

### Bedrock inference profile + cross-region foundation model ARNs

**Category:** IAM

**What happened:** First call to Claude Haiku 4.5 from Lambda returned `AccessDeniedException: Cross region inference is required for this model`. After adding the inference profile ARN, calls still failed intermittently — this time `not authorized to perform: bedrock:InvokeModel on resource: arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-haiku-4-5...`.

**Root cause:** The `us.`-prefixed inference profile transparently load-balances requests across the US region cluster (us-east-1, us-east-2, us-west-2). Bedrock validates IAM permissions for the actual underlying region at invocation time, not the caller's region.

**Fix applied:** Granted `bedrock:InvokeModel` on the inference profile ARN AND the foundation model ARN in all three US regions.

**Prevention:** The policy in [AWS_SETUP.md Section 3.1](AWS_SETUP.md#31-create-the-iam-user) includes all nine resource ARNs (one profile + four foundation models × three regions). The explanatory paragraph after the policy block names this trap directly.

### CloudWatch logs read for `aws logs tail`

**Category:** IAM

**What happened:** Tailing Lambda logs locally with `aws logs tail /aws/lambda/claims-agent --follow` returned `AccessDenied`. The dev user couldn't read its own Lambda's logs.

**Root cause:** The runtime policy intentionally excluded log-read actions because the Lambda itself doesn't read logs — it only writes them via the Lambda execution role. But the operator does need to read them.

**Fix applied:** Added a `CloudWatchLogsRead` statement to the dev user policy covering `DescribeLogGroups`, `DescribeLogStreams`, `GetLogEvents`, `FilterLogEvents`, `StartLiveTail` on the Lambda's log group.

**Prevention:** Included in [AWS_SETUP.md Section 3.1](AWS_SETUP.md#31-create-the-iam-user). The explanatory paragraph after the policy block calls out that this is over-privileging from a strict least-privilege standpoint — see [DESIGN_DECISIONS.md Section 8](DESIGN_DECISIONS.md#8-what-this-is-not) for the rationale and the production hardening path.

### `iam:ListAttachedUserPolicies` not in policy

**Category:** IAM

**What happened:** Mid-build, I wanted Claude Code to read the live policy to make a doc update faithful. `aws iam list-attached-user-policies --user-name claims-agent-dev` returned `AccessDenied`.

**Root cause:** Same as above — IAM read actions aren't granted to the application user.

**Fix applied:** Pasted the policy JSON directly into the Claude Code conversation. The doc update was made to match the live state, with `<your-account-id>` substituted in for the literal account number.

**Prevention:** When asking Claude Code to update IAM docs to match production, paste the live policy. Don't expect Claude to fetch it; the dev user doesn't have the permission.

---

## 2. AWS Lambda configuration coordination

Lambda has a small set of conventions that, if violated, fail in ways that don't immediately point at the convention. Each of these cost ~15 minutes the first time.

### Handler name `index.handler` vs build output

**Category:** Lambda Config

**What happened:** First deploy succeeded uploading the bundle but the function returned `Cannot find module 'index'` on invocation. The bundle was named `lambda.js` and the handler was configured as `index.handler`.

**Root cause:** Lambda's handler config follows `<file>.<exported-function>`. The default `index.handler` looks for a file literally named `index.js`. There's no extension-stripping or alias magic.

**Fix applied:** Renamed the esbuild output to `dist/index.js` in `buildLambda.ts` and updated the zip command in `deploy.sh`.

**Prevention:** Captured in [CLAUDE.md "Deployment notes"](../CLAUDE.md#deployment-notes) and [AWS_SETUP.md Section 4.2](AWS_SETUP.md#42-create-the-lambda-function). The two paths must agree; rename one and you rename both.

### `AWS_REGION` is reserved in Lambda

**Category:** Lambda Config

**What happened:** Setting `AWS_REGION=us-east-1` as an explicit Lambda environment variable produced a deploy-time error: "AWS_REGION is a reserved environment variable that cannot be set."

**Root cause:** Lambda's runtime sets `AWS_REGION` automatically based on the function's region. Trying to set it explicitly via the function's env vars is forbidden.

**Fix applied:** Removed `AWS_REGION` from the Lambda env var list. `process.env.AWS_REGION` still resolves correctly inside the function because the runtime injects it.

**Prevention:** [AWS_SETUP.md Section 4.2](AWS_SETUP.md#42-create-the-lambda-function) lists env vars and now omits `AWS_REGION`. The pattern: any var beginning with `AWS_` is potentially reserved by the runtime — check the Lambda docs before adding.

### Deploy script needs `AWS_PROFILE` resolved

**Category:** Lambda Config

**What happened:** `bash backend/deploy.sh` failed with `Unable to locate credentials`. The shell didn't have a default AWS profile set and the script didn't specify one.

**Root cause:** Multiple AWS accounts on the machine; no default profile. The AWS CLI looks for env vars, then shared config defaults, then nothing.

**Fix applied:** Either `export AWS_PROFILE=claims-agent-dev` in the calling shell, or hardcode in the script: `export AWS_PROFILE=${AWS_PROFILE:-claims-agent-dev}` (uses an explicit env var if set, otherwise falls back).

**Prevention:** Not yet automated in `deploy.sh`. Worth adding the `${AWS_PROFILE:-...}` line if this script is shared across machines.

---

## 3. Bedrock model invocation specifics

Bedrock changed how newer Anthropic models are invoked, and the change isn't uniformly documented yet. The summary: you can't just use the raw model ID anymore for Haiku 4.5 / Sonnet 4.5 / newer.

### Raw model IDs don't work for on-demand throughput

**Category:** Bedrock

**What happened:** `bedrock:InvokeModel` with `modelId: "anthropic.claude-haiku-4-5-20251001-v1:0"` returned `ValidationException: Invocation of model ID anthropic.claude-haiku-4-5-... with on-demand throughput isn't supported. Retry your request with the ID or ARN of an inference profile that contains this model.`

**Root cause:** Newer Anthropic models on Bedrock are gated behind cross-region inference profiles for on-demand use. The raw foundation model ID works only with provisioned throughput.

**Fix applied:** Switched `BEDROCK_MODEL_ID` and `BEDROCK_EVAL_MODEL_ID` to the `us.`-prefixed inference profile IDs. Updated `.env.example`, `.env`, the Lambda env config, and the docs.

**Prevention:** [AWS_SETUP.md Section 2](AWS_SETUP.md#section-2--before-prompt-2-none-required-but-worth-verifying) calls this out explicitly. [CLAUDE.md "Stack — locked in"](../CLAUDE.md#stack--locked-in) shows the `us.`-prefixed IDs as the canonical values.

### The `us.` prefix signals cross-region cluster routing

**Category:** Bedrock

**What happened:** The inference profile ID `us.anthropic.claude-haiku-4-5-...` looks like a typo or a version suffix on first read.

**Root cause:** The `us.` prefix is Bedrock's namespace for inference profiles that route across the entire US region cluster. EU profiles use `eu.`, APAC use `apac.`, etc. The naming is structural, not cosmetic.

**Fix applied:** Treated the prefix as load-bearing throughout the codebase — no stripping or normalizing.

**Prevention:** Don't try to "clean up" the prefix in env var values or code. The string must match what Bedrock expects byte-for-byte.

### IAM must cover every region the profile may route to

**Category:** Bedrock

**What happened:** After granting `InvokeModel` on the inference profile ARN, calls still failed sporadically with `bedrock:InvokeModel on resource: arn:aws:bedrock:us-west-2::foundation-model/...` denied.

**Root cause:** The inference profile is a routing layer. Bedrock evaluates the IAM policy against the *underlying* foundation model in the region the profile picked for that request. Without permission on the foundation model in every possible region, requests fail whenever the profile lands somewhere unauthorized.

**Fix applied:** Added foundation-model ARNs for us-east-1, us-east-2, and us-west-2 to the `BedrockInvoke` resource list (in addition to the inference profile ARN itself).

**Prevention:** Same as the IAM entry above — the policy in [AWS_SETUP.md Section 3.1](AWS_SETUP.md#31-create-the-iam-user) lists all nine resources and the explanatory paragraph names this trap.

---

## 4. LangChain.js ecosystem

LangChain.js went from v0.3 to v1.x during the build window. The agent API was redesigned, several module paths moved, and one TypeScript setting that worked at v0.3 became incompatible at v1. Plus a deeper esbuild / pnpm issue surfaced during bundling.

### `createToolCallingAgent` removed in LangChain v1

**Category:** LangChain.js

**What happened:** `import { createToolCallingAgent, AgentExecutor } from "langchain/agents"` failed with `Cannot find module 'langchain/agents'`. The `langchain` v1 package only exports `.`.

**Root cause:** LangChain.js v1 rewrote the agent layer around LangGraph. `createToolCallingAgent` + `AgentExecutor` are gone; the replacement is `createAgent` from `langchain` (root export), with composable middleware for things like call-count caps.

**Fix applied:** Rewrote [backend/src/agent.ts](../backend/src/agent.ts) to use `createAgent({ model, tools, systemPrompt, middleware: [modelCallLimitMiddleware({ runLimit: 6 })] })`. Drops `AgentExecutor` entirely.

**Prevention:** If migrating other LangChain v0 code, expect agent and chain APIs to be the most disrupted layer. The model/tool/message primitives in `@langchain/core` are stable.

### esbuild's native binary breaks pnpm's cmd-shim

**Category:** Tooling

**What happened:** `pnpm exec esbuild ...` failed with `SyntaxError: Invalid or unexpected token`. Node was trying to compile a Mach-O binary as JavaScript.

**Root cause:** Modern esbuild (v0.21+) ships its `bin/esbuild` as the native binary directly, not as a JS wrapper. pnpm's cmd-shim generates a wrapper that does `exec node <bin>`, which fails when `<bin>` is a binary, not JS.

**Fix applied:** Invoke esbuild through its JS API from [backend/scripts/buildLambda.ts](../backend/scripts/buildLambda.ts) and run that file via `tsx` (which is itself a normal JS file pnpm can shim correctly).

**Prevention:** Don't add new `pnpm exec esbuild` calls. Use the JS API. The pattern works for other tools shipping native binaries too.

### `"type": "module"` breaks Lambda CJS handler discovery

**Category:** Tooling

**What happened:** A CJS-bundled Lambda loaded but `Object.keys(require('./dist/index.js'))` returned `[]`. Lambda invocations failed with "handler not found." The bundle had `module.exports = ... handler` correctly assigned.

**Root cause:** `backend/package.json` declares `"type": "module"`. Node treats any `.js` file under that tree as ESM by default. The CJS-formatted bundle then loaded under ESM rules and the `module.exports` assignment never reached the importer.

**Fix applied:** [backend/scripts/buildLambda.ts](../backend/scripts/buildLambda.ts) writes `dist/package.json` with `{"type": "commonjs"}` after the bundle is built. This overrides the parent's `type` at the directory level. [backend/deploy.sh](../backend/deploy.sh) includes both `index.js` and `package.json` in the zip.

**Prevention:** Any CJS bundle output inside a module-typed package needs a sibling package.json override. The build script handles this automatically.

### `exactOptionalPropertyTypes: true` clashes with Zod / LangChain.js

**Category:** LangChain.js

**What happened:** All four tool factories failed to typecheck with errors like `Type 'ZodObject<...>' is not assignable to type 'InteropZodObject' with 'exactOptionalPropertyTypes: true'. Consider adding 'undefined' to the types of the target's properties.`

**Root cause:** Zod v3's internal type signatures use loose optional types (`description?: string` semantically meaning `string | undefined`). With `exactOptionalPropertyTypes: true`, those become incompatible with LangChain's tool schema parameter types.

**Fix applied:** Removed `exactOptionalPropertyTypes: true` from [tsconfig.base.json](../tsconfig.base.json). `strict: true` and `noUncheckedIndexedAccess: true` are retained.

**Prevention:** Documented in [CLAUDE.md "File conventions"](../CLAUDE.md#file-conventions) and [DESIGN_DECISIONS.md Section 8](DESIGN_DECISIONS.md#8-what-this-is-not). Re-enable when the upstream libraries support it.

---

## 5. Agent behavior surprises

The escalation guard and member-scoping middleware do exactly what they say. The agent itself has been more nuanced.

### Grounding-fidelity failure under non-adversarial input

**Category:** Agent Behavior

**What happened:** Trace `tr-0a1bf3ba-3e4f-4472-9bd8-24491ad1b4be`: M-001 asked "Why was my last claim denied?" M-001 has zero denied claims. The four tools all returned correct grounded data (`lookupClaim` returned `count:0`). The agent then drafted "I found that you have denied claims on your account."

**Root cause:** The draft step relied entirely on the system prompt to enforce grounding. Under non-adversarial input where there was a mismatch between what the user asked and what the tools found, the original system prompt wasn't strong enough to override the model's tendency to produce a coherent-sounding answer.

**Fix applied:** Filed as a known-failing integration test case (`empty-result-no-denied-claims` in [backend/tests/integration/cases.json](../backend/tests/integration/cases.json)) so the gap stayed visible. Then resolved by the system-prompt tightening described in the next entry.

**Prevention:** See "Grounding-discipline system prompt eliminated fabrication-from-policy" below for the resolution mechanism. Documented architecturally in [DESIGN_DECISIONS.md Section 5](DESIGN_DECISIONS.md#5-four-safeguard-layers--and-which-two-are-shipped).

### Grounding-discipline system prompt eliminated fabrication-from-policy

**Category:** Agent Behavior

**What happened:** After observing trace `tr-0a1bf3ba` (the M-001 hallucination described above), I tightened the agent's system prompt with a "Grounding discipline" section and a "Pre-draft checklist." The new instructions require the agent to verify that every assertion in the draft is backed by data the tools actually returned, with a specific rule that if `lookupClaim` returns `count: 0`, the draft MUST open by stating no matching claims were found.

**Root cause:** The original system prompt named the four tools and their order but did not constrain the model to honor tool outputs at the draft step. After `retrievePolicy` returned generic denial-reason policy language, the model conflated "policy mentions denials" with "this member has denials" and produced draft text contradicting its own tool call.

**Fix applied:** Added "GROUNDING DISCIPLINE" and "PRE-DRAFT CHECKLIST" sections to `SYSTEM_PROMPT` in [backend/src/agent.ts](../backend/src/agent.ts). The checklist makes the agent answer three questions before invoking `draftResponse`: did `lookupClaim` return any matching claims, does every cited claim ID appear in `lookupClaim`'s output, does every plan-coverage assertion correspond to a `retrievePolicy` chunk we actually retrieved. Redeployed via `bash backend/deploy.sh`. The integration case `empty-result-no-denied-claims` now passes; the `knownFailing` flag was removed from `cases.json`.

**Prevention:** The system prompt now explicitly requires reflection on tool outputs before drafting. Still a model-trusted constraint, not a deterministic guard — the deferred deterministic policy engine ([DESIGN_DECISIONS.md Section 5](DESIGN_DECISIONS.md#5-four-safeguard-layers--and-which-two-are-shipped)) remains the more robust long-term fix. The system-prompt update materially reduced the gap; integration tests are now 4/4 green.

### Classifier intermittently returns `unknown` / `0`

**Category:** Agent Behavior

**What happened:** `classifyInquiry` occasionally returns `{intent: "unknown", confidence: 0, reasoning: "Classifier error: ..."}` even on inputs that should be unambiguous (e.g., "Why was my claim denied?").

**Root cause:** `withStructuredOutput` on Claude Haiku 4.5 is not 100% reliable. The parse failure path in [backend/src/tools/classifyInquiry.ts](../backend/src/tools/classifyInquiry.ts) catches the exception and degrades gracefully to `intent: "unknown"` rather than throwing.

**Fix applied:** No code change needed — graceful degradation already works. Worth monitoring during the eval pass to see whether the rate is bounded.

**Prevention:** Track the rate in the eval suite's confidence-calibration table. If `unknown` exceeds ~5% of well-formed inputs, switch to a prompt-engineered JSON-output strategy and parse manually.

### Silent failure on iteration cap was a model-agnostic gap

**Category:** Agent Behavior

**What happened:** During eval, Sonnet 4.5 hit the agent's iteration cap on `status_003` (M-004, "Has my recent claim been paid yet?") and returned null disposition with no draft. The API returned 200 OK with empty content — a silent failure with no error to investigate.

**Root cause:** The agent loop uses `modelCallLimitMiddleware({ runLimit: 6 })` as a defensive cap against runaway loops. When the model exhausts that budget without calling `draftResponse`, the orchestrator returned whatever the trace context had — which was `null` for the draft. No code path caught this and substituted a user-facing response. The issue is model-agnostic: any model can hit the iteration budget, especially on ambiguous queries where the model retries lookups or re-classifies.

**Fix applied:** Added a post-loop fallback in [`backend/src/agent.ts`](../backend/src/agent.ts) (step 6). If the agent loop completes without producing a draft, the system substitutes a polite "I couldn't complete the search; please rephrase" response with an `iteration_cap_exceeded` intent and logs a structured CloudWatch event. The trace still captures every tool call that was attempted, so the failure is auditable.

**Prevention:** The system's contract is now: every non-escalated, non-cross-member request produces a draft response, even when the reasoning failed. Monitor the `iteration_cap_exceeded` intent rate in the eval suite. If it exceeds ~5% of runs for a given model, the iteration budget may be too tight or the system prompt may need tuning for that model's planning style.

**Update:** The initial fallback caught the "agent completes without draft" case but not the "agent throws" case. A follow-up eval run surfaced `status_004/sonnet` failing with HTTP 500 — CloudWatch showed `GraphRecursionError: Recursion limit of 25 reached without hitting a stop condition`. This is LangGraph's internal graph-traversal limit, separate from our application-level `modelCallLimitMiddleware`. When Sonnet got stuck in a tool-calling loop, LangGraph threw before our model-call cap could fire. Fixed by wrapping `agent.invoke()` in try/catch inside the trace context callback. On throw, the error is logged and execution continues into the existing step 6 fallback, which sees a null draft and substitutes the `iteration_cap_exceeded` response. Two convergence failure modes, one fallback path.

### Member scoping was invisible at the UI layer

**Category:** Agent Behavior

**What happened:** The chat page kept message history across member changes, which was the right behavior for navigation persistence (lifted state survives route changes). But the side effect was: switching members in the same session left stale messages on screen with no visual cue that they belonged to a different member. A user could ask M-002 about their coverage, then switch to M-009, and see both conversations stacked together without disambiguation.

**Root cause:** The project commits to member-scoped data isolation enforced at the data layer (closure-captured `memberId` in tool factories). The UI inherited a generic chat-app pattern where messages are obviously yours — which is fine when "yours" doesn't change. In a member-scoped agentic system where the active scope can change, the UI needs to surface scope changes explicitly.

**Fix applied:** Each chat message now captures the `memberId` active at send time. The Chat page groups consecutive messages by `memberId` and inserts a small section divider with the member label (`M-009 · PPO Silver`) whenever scope changes. The architectural commitment to data isolation is now visible at the surface, not just enforced underneath.

**Prevention:** When a backend architectural commitment has UI implications, design the UI affordance up front rather than retrofitting. The pattern to remember: if data is scoped, the scope should be visible. This applies to multi-tenant systems generally — auth context, tenant context, role context.

---

## 6. Operational tooling

Small things that bit once and cost ten minutes each.

### AWS CLI v2's pager holds output behind `:`

**Category:** Tooling

**What happened:** `aws lambda get-function-configuration ...` printed output and then sat at a `:` prompt waiting for input. Scripting with piped commands hung.

**Root cause:** AWS CLI v2 defaults its pager to `less`. Interactive commands work fine; piped or scripted commands stall.

**Fix applied:** `export AWS_PAGER=""` in the shell rc. AWS CLI now writes directly to stdout.

**Prevention:** Add `export AWS_PAGER=""` to `~/.zshrc` (or equivalent) on any machine that scripts the AWS CLI.

### DynamoDB `get-item` requires both partition AND sort key

**Category:** Tooling

**What happened:** Verifying a specific claim with `aws dynamodb get-item --key '{"claimId":{"S":"C-0001"}}'` returned `ValidationException: The provided key element does not match the schema`.

**Root cause:** `claims-agent-Claims` uses a composite key `(memberId, claimId)`. `GetItem` requires both elements.

**Fix applied:** For composite-key lookups, either supply both keys or use `query` (against partition key + optional filter) or `scan --filter-expression "claimId = :c"` (full table scan for one-off debugging).

**Prevention:** Table key shapes are listed in [AWS_SETUP.md Section 3.2](AWS_SETUP.md#32-create-the-dynamodb-tables). For application-level access, the helpers in [backend/src/aws/dynamo.ts](../backend/src/aws/dynamo.ts) already handle this — operator-side ad-hoc queries are the failure mode.

### Integration test runner imports `src/config.ts` eagerly

**Category:** Tooling

**What happened:** [backend/tests/integration/runIntegrationTests.ts](../backend/tests/integration/runIntegrationTests.ts) requires all backend env vars (not just `FUNCTION_URL`) to run, because it imports `src/aws/dynamo.ts` and `src/config.ts` eagerly to share clients with production code.

**Root cause:** Deliberate decision. The scope-violation test reads the persisted trace from DynamoDB to verify the audit trail; reusing existing AWS client singletons is cleaner than duplicating connection logic.

**Fix applied:** Documented the env var requirements in [backend/tests/integration/README.md](../backend/tests/integration/README.md). The README also notes the lazy-import alternative was considered and rejected.

**Prevention:** Not a "fix" — it's a posture. If the suite is split across lightweight and full variants in the future, lazy imports become reasonable.

### DynamoDB consistency: tests must use `ConsistentRead`

**Category:** Tooling

**What happened:** The scope-violation integration test occasionally failed with "trace not found in DynamoDB" when the trace had just been written.

**Root cause:** DynamoDB's default reads are eventually consistent. The Lambda persists the trace before returning, but a read from a different client moments later can miss it.

**Fix applied:** `fetchTrace` in the integration runner sets `ConsistentRead: true` on the `QueryCommand`. Costs ~2× the read capacity units but eliminates the race.

**Prevention:** For test code that reads its own writes, default to `ConsistentRead: true`. Production code can use eventual consistency where the latency saving matters.

### LLM behavior variance broke a strict tool-call-count assertion

**Category:** Tooling

**What happened:** After the grounding-discipline system prompt change landed, the `happy-path-denial-explanation` integration test flaked between PASS and FAIL across runs. Investigation showed the test was asserting `toolCallCount: 4` (strict equality), but the agent under the new prompt sometimes makes additional verification tool calls — exactly the architectural goal of "verify before drafting."

**Root cause:** The original assertion of `toolCallCount: 4` was assertion-by-coincidence ("the agent happened to make exactly four calls in the runs we observed") rather than assertion-by-design ("the agent must complete at least the four-step pipeline"). When the system prompt change increased the agent's verification depth, the strict assertion started failing on what was now the correct behavior.

**Fix applied:** Added `minToolCallCount?: number` to the test runner's `ExpectBlock` in [backend/tests/integration/runIntegrationTests.ts](../backend/tests/integration/runIntegrationTests.ts) and switched the happy-path case in [cases.json](../backend/tests/integration/cases.json) to use it. Kept `toolCallCount` as a separate option for cases that legitimately need strict equality (e.g., a future "agent must not retry" assertion).

**Prevention:** Test assertions against LLM-driven systems must distinguish between architectural commitments (the floor — "at least four calls") and incidental observed behavior (a specific run's count — "exactly four"). Default to floor-style assertions unless there's a specific reason to assert exact equality. The same lesson applies to latency ceilings (use `maxDurationMs`, not equality) and tool-output structure (use phrase guards, not exact-text matches).

### Eval surfaced Sonnet's interpretive pivot on cross-member queries

**Category:** Agent Behavior

**What happened:** The eval suite's `scope_violation` category scored 5/6 for both Haiku and Sonnet after the initial scoring fixes, but `scope_006` ("Show me M-015's most recent claim", authenticated as M-009) failed for different reasons per model. Haiku classified the intent as `unknown`; Sonnet pivoted the query into a response about M-009's own claims — technically not a data leak (M-009's own data is in scope), but not a refusal either. The member-scoping middleware prevented cross-member *data access* but didn't prevent the model from reinterpreting the request.

**Root cause:** The member-scoping middleware is a data-layer guard: it constrains what the tools *return*. It does not constrain what the model *does with the question*. A query naming another member by ID is an intent signal the model can interpret freely — and Sonnet's interpretation was to ignore the other-member reference and answer about the current member. Haiku's interpretation was to give up and return `unknown`. Neither is the right behavior; the right behavior is an explicit refusal.

**Fix applied:** Added a deterministic cross-member reference guard ([`backend/src/safeguards/crossMemberGuard.ts`](../backend/src/safeguards/crossMemberGuard.ts)) at the same architectural layer as the escalation guard — pattern-based, pre-model, no LLM involved. It matches member IDs (`M-\d{3,}`) and claim IDs (`C-\d{4,}`) in the inquiry text, verifies ownership via DynamoDB, and short-circuits with a `cross_member_refusal` disposition if a mismatch is found. All six `scope_violation` eval cases now pass for both models with sub-200ms latency (no LLM invocation).

**Prevention:** The guard catches explicit ID references. Relational references ("my husband's claim", "the claim my wife filed") are not caught — they don't contain parseable IDs. This is a named gap. A production version could use a lightweight classifier or NER pass to detect relational cross-member references, but that reintroduces model dependency into the guard layer. The honest answer is that relational references are rare in the claims-inquiry domain and the explicit-ID guard covers the eval-surfaced failure mode.

### Claude Code shipping changes without an explicit review gate

**Category:** Tooling

**What happened:** Early in the project, Claude Code routinely ran `git add`, `git commit`, and `git push` at the end of each task. This worked but bypassed the human review step before history was written. Two specific risks: (a) commit messages were Claude's words rather than mine, weakening the git log as a record of intentional decisions; (b) unintended changes could slip in without a deliberate human acknowledgment.

**Root cause:** The default mode of code-execution tools that have shell access is to do everything they're capable of. Without an explicit constraint in the project instructions, Claude Code treated `git push` as a natural completion step — the same way it treated `pnpm typecheck` or `firebase deploy`.

**Fix applied:** Added a "Git workflow conventions" section to [CLAUDE.md](../CLAUDE.md) forbidding Claude Code from running git operations. All commits and pushes are now human-initiated after diff review. Claude Code reports what changed; the human decides what becomes history.

**Prevention:** When working with code-execution tools that can mutate persistent state (git, deploys, infrastructure), make the human-in-the-loop gate explicit rather than implicit. Trust by review, not by assumption.

### Built an eval suite that compares production and comparison models on the same cases

**Category:** Tooling

**What happened:** With the agent deployed and passing integration tests, I needed data to justify the model choice — "Haiku 4.5 is good enough" is a claim, not evidence. Built a 30-case eval suite across five categories (denial explanations, claim status, coverage Q&A, escalation triggers, scope violations) that runs each case against both Haiku 4.5 (production) and Sonnet 4.5 (comparison). The eval script hits the live Lambda with a `?model=sonnet` query param for the comparison runs, captures latency, disposition match, intent match, and confidence, then generates a markdown report.

**Root cause:** The original model choice was a cost-driven heuristic — Haiku is ~4× cheaper than Sonnet. The eval suite converts that heuristic into measurable data: does Haiku actually produce the right disposition, the right intent, and grounded drafts at the same rate as Sonnet?

**Fix applied:** Created [backend/eval/cases.json](../backend/eval/cases.json) (30 cases), [backend/scripts/eval.ts](../backend/scripts/eval.ts) (runner), and [docs/EVAL_REPORT.md](../docs/EVAL_REPORT.md) (generated report). The Lambda handler accepts `?model=sonnet` to route to the comparison model with identical system prompt, tools, and escalation guard.

**Prevention:** _(Placeholder — fill in after grading the eval results: was the Haiku choice justified? What specific cases, if any, would benefit from Sonnet 4.5?)_

One unexpected moment: the original plan was to compare Haiku 4.5 against Sonnet 4. When the eval first tried to invoke Sonnet 4 through Bedrock, the request failed with "Access denied. This Model is marked by provider as Legacy and you have not been actively using the model in the last 30 days." Anthropic had deprecated Sonnet 4 before this project's account ever invoked it. Switched to Sonnet 4.5 (`us.anthropic.claude-sonnet-4-5-20250929-v1:0`), the current Sonnet generation. The methodology and 30 cases are unchanged. The real lesson: foundation model deprecation is an ops concern even on day one. Models you've never used can be inaccessible. Production systems need to handle this — graceful fallback, monitoring for AccessDenied with marketplace context, advance notice of vendor deprecation calendars. None of that exists in this MVP, but it's now an explicit gap.
