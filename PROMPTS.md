# Claude Code Prompt Sequence

Feed these to Claude Code in order, one at a time. Wait for each to finish and verify before moving on.

**Before you start any prompt:**
- `CLAUDE.md` must exist at the repo root.
- `docs/DESIGN_DECISIONS.md` must exist.
- You must have completed the AWS console steps listed in `docs/AWS_SETUP.md` *up to the point* required by the prompt. Each prompt notes which AWS resources it assumes exist.

**How to use this file:**
- Open Claude Code in Cursor with the repo as the workspace.
- Copy the prompt body (everything inside the code fence) and paste it.
- Run it. Verify with the "Done when" check.
- Tick the box. Move to the next.

---

## Day 0 (Wednesday evening) — Repo skeleton

### ☐ Prompt 1 — Workspace and toolchain

**AWS prerequisites:** None.

**Estimated time:** 15 minutes of Claude Code work + 5 minutes of `pnpm install`.

```
Read CLAUDE.md and docs/DESIGN_DECISIONS.md first. Confirm in one sentence that you've read both before doing any work.

Set up a pnpm monorepo at the repo root with two workspaces: `backend/` and `frontend/`.

Create these root-level files:
- `pnpm-workspace.yaml` declaring both workspaces
- `package.json` with name "claims-agent", private: true, no dependencies, with scripts to run common commands across workspaces (`dev:backend`, `dev:frontend`, `build`, `typecheck`)
- `tsconfig.base.json` with strict mode, target ES2022, module NodeNext, moduleResolution NodeNext, strict: true, noUncheckedIndexedAccess: true, exactOptionalPropertyTypes: true
- `.gitignore` covering node_modules, dist, .env, .env.local, .DS_Store, backend/eval/results/, *.log, .firebase, Lambda bundle artifacts
- `.env.example` with placeholders for: AWS_REGION, BEDROCK_MODEL_ID, BEDROCK_EVAL_MODEL_ID, BEDROCK_EMBEDDING_MODEL_ID, KNOWLEDGE_BASE_ID, PINECONE_API_KEY (not used directly but documented), DYNAMODB_MEMBERS_TABLE, DYNAMODB_CLAIMS_TABLE, DYNAMODB_TRACES_TABLE, POLICY_DOCS_BUCKET, FRONTEND_ORIGIN

Initialize `backend/` workspace:
- `package.json` with name "@claims-agent/backend", type: "module"
- `tsconfig.json` extending base, outDir dist, rootDir src
- Empty `src/` directory with a placeholder `src/index.ts` that exports nothing
- Dependencies to add: `@aws-sdk/client-bedrock-runtime`, `@aws-sdk/client-bedrock-agent-runtime`, `@aws-sdk/client-bedrock-agent`, `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-s3`, `@aws-sdk/client-lambda`, `langchain`, `@langchain/core`, `@langchain/aws`, `zod`
- Dev dependencies: `typescript`, `tsx`, `esbuild`, `@types/node`, `dotenv`

Initialize `frontend/` workspace:
- `package.json` with name "@claims-agent/frontend"
- Use `pnpm create vite frontend --template react-ts` semantics — but write the files directly rather than running the command, since we want full control. Include vite.config.ts with React plugin.
- Tailwind v3 setup: `tailwind.config.ts`, `postcss.config.js`, `src/index.css` with the three Tailwind directives
- Dependencies: `react`, `react-dom`
- Dev dependencies: `@types/react`, `@types/react-dom`, `@vitejs/plugin-react`, `vite`, `typescript`, `tailwindcss`, `postcss`, `autoprefixer`

Do NOT install dependencies; just write the files. I'll run `pnpm install` myself.

Done when:
- `pnpm install` from the repo root completes without errors
- `pnpm -r typecheck` passes (tsconfig is valid, even if there's no real code yet)
- The repo tree matches what's expected
```

**Done when:** `pnpm install` runs clean from the repo root. `pnpm -r typecheck` returns 0.

---

### ☐ Prompt 2 — Config, types, and AWS clients

**AWS prerequisites:** None yet — this is still code-only.

```
Read CLAUDE.md. Working in the backend/ workspace only.

Create `backend/src/config.ts`:
- Reads all environment variables from `.env.example` once at module load via process.env
- Validates with zod that every required env var is present, throws a clear error if not
- Exports typed constants for each (not the raw process.env values)
- Use dotenv/config import at the top, gated on NODE_ENV !== 'production' (so Lambda environment vars are used in prod, .env is used locally)

Create `backend/src/types.ts` with shared types:
- `Member` (memberId, planType, firstName, lastName, dateOfBirth, planEffectiveDate)
- `Claim` (claimId, memberId, dateOfService, providerName, billedAmount, allowedAmount, memberResponsibility, status: 'paid' | 'denied' | 'pending', denialCode?: string, denialReason?: string)
- `DenialCode` (code, category, description, appealable: boolean)
- `InquiryClassification` (intent: 'denial_explanation' | 'eob_question' | 'coverage_lookup' | 'claim_status' | 'unknown', confidence: number, reasoning: string)
- `AgentTrace` (traceId, timestamp, memberId, userInquiry, classification: InquiryClassification | null, toolCalls: ToolCallLog[], draftResponse: string | null, disposition: 'draft' | 'escalated' | 'approved' | 'rejected', model: string)
- `ToolCallLog` (toolName, input, output, durationMs, timestamp)

Create `backend/src/aws/bedrock.ts`:
- Singleton BedrockRuntimeClient
- Helper to construct a LangChain ChatBedrockConverse instance given a model ID
- Export both

Create `backend/src/aws/dynamo.ts`:
- Singleton DynamoDBClient and DynamoDBDocumentClient
- Typed helper functions: `getMember(memberId)`, `getClaim(claimId, memberId)`, `listClaimsForMember(memberId)`, `listAllMembers()`, `putTrace(trace)`, `listRecentTraces(limit)`
- All functions throw on AWS errors (do not swallow)

Create `backend/src/aws/knowledgeBase.ts`:
- Singleton BedrockAgentRuntimeClient
- Function `retrievePolicy(query: string, numberOfResults: number = 5, metadataFilter?: object)` that calls the Knowledge Base `retrieve` API and returns chunks with their source attribution
- Returns typed result objects, not raw SDK output

Do NOT call any AWS APIs at module load. Clients are constructed lazily on first call, or in module init that doesn't make network requests.

Done when:
- `pnpm --filter @claims-agent/backend typecheck` passes
- Every function has a JSDoc comment
- No `any` types used
```

**Done when:** Backend typechecks. No `any`. All AWS clients are singleton.

---

## Day 1 (Thursday) — Agent loop end-to-end

### ☐ Prompt 3 — Synthetic data generation

**AWS prerequisites:** None.

```
Read CLAUDE.md.

Create `backend/scripts/generateData.ts`:
- Generates 20 synthetic members with names "Member Alpha" through "Member Tango" (NATO phonetic), each with a memberId like "M-001" through "M-020"
- Assigns plan types: 7 PPO Gold, 7 PPO Silver, 6 HMO Bronze
- Generates 50 synthetic claims across these members (uneven distribution: some members have 5 claims, some have 0)
- Claim statuses: roughly 60% paid, 25% denied, 15% pending
- Generates 10 denial codes with categories: "Coverage", "Documentation", "Network", "Authorization", "Coordination of Benefits". Each denial code is obviously fake (e.g., "SYN-DENY-001") and does not match any real payer schedule.
- Generates 3 synthetic plan summary documents in markdown: `gold-ppo-plan-summary.md`, `silver-ppo-plan-summary.md`, `bronze-hmo-plan-summary.md`. Each ~2 pages with benefits, exclusions, appeals procedures, contact info. Use obviously-fake plan names and obviously-fake company name like "Synthetic Health Plan Co."

Write all output to:
- `backend/data/members.json`
- `backend/data/claims.json`
- `backend/data/denialCodes.json`
- `backend/data/policyDocs/*.md`

Add a `pnpm --filter @claims-agent/backend generate-data` script that runs this.

The script must be deterministic — running it twice produces identical output. Use a fixed seed for any randomness.

After generation, print a one-line summary: "Generated N members, M claims, K denial codes, J policy docs."

Done when:
- The script runs and writes all files
- Re-running produces byte-identical output
- The policy docs are coherent and reference the denial codes by their fake codes (cross-references work)
- No real-sounding insurance company names appear anywhere
```

**Done when:** All four data outputs exist and are committed. Re-running the script is a no-op for git.

---

### ☐ Prompt 4 — DynamoDB seeding and KB ingest scripts

**AWS prerequisites:**
- DynamoDB tables `claims-agent-Members`, `claims-agent-Claims`, `claims-agent-AgentTraces` created per AWS_SETUP.md
- S3 bucket `claims-agent-policy-docs-rb2026-464817648943-us-east-1-an` created
- Bedrock KB created and pointed at the S3 bucket
- IAM user `claims-agent-dev` has read/write on these
- `.env` populated with all values

```
Read CLAUDE.md.

Create `backend/scripts/seedData.ts`:
- Reads `backend/data/members.json` and `backend/data/claims.json`
- Batch-writes to DynamoDB tables named via env vars (DYNAMODB_MEMBERS_TABLE, DYNAMODB_CLAIMS_TABLE)
- Uses `BatchWriteCommand` in chunks of 25 (DynamoDB batch limit)
- Idempotent: re-running is safe (uses PutItem semantics)
- Prints progress: "Seeded N/M items..."

Create `backend/scripts/ingestKb.ts`:
- Uploads files from `backend/data/policyDocs/` to the S3 bucket specified in env var POLICY_DOCS_BUCKET
- After upload, triggers a Bedrock KB ingestion job via the `StartIngestionJob` API
- Polls the ingestion job status until COMPLETE or FAILED
- Prints status updates every 10 seconds
- Exits non-zero on FAILED

Add scripts:
- `pnpm --filter @claims-agent/backend seed-data`
- `pnpm --filter @claims-agent/backend ingest-kb`

Done when:
- Running seed-data loads the synthetic data into DynamoDB (verify in console)
- Running ingest-kb uploads docs and the KB ingestion job completes
- The Bedrock console shows the chunks in the KB
- Both scripts handle missing env vars with clear error messages
```

**Done when:** DynamoDB tables have the synthetic data. Bedrock KB shows chunks. You can query the KB from the AWS console and get plausible results.

---

### ☐ Prompt 5 — Member scope middleware and the four tools

**AWS prerequisites:** All of Prompt 4's prerequisites.

```
Read CLAUDE.md and docs/DESIGN_DECISIONS.md, especially Sections 2 (Building Blocks) and 5 (Safeguard Layers).

The architectural commitment: the agent never receives memberId as a tool argument. memberId is captured in the closure of each tool's factory function.

Create `backend/src/tracing/traceContext.ts`:
- A per-request trace context using AsyncLocalStorage from node:async_hooks
- Exports `withTraceContext(traceId, memberId, fn)` and `appendToolCall(toolCallLog)` and `getCurrentTrace()`
- Tool calls accumulated in the current context can be retrieved at request end for persistence

Create `backend/src/middleware/memberScope.ts`:
- Exports `resolveMemberScope(rawMemberId: string): Promise<MemberScope>`
- MemberScope is a struct containing the validated memberId and a `tools` object with all four tools, each pre-bound to that memberId
- Validates that the member exists in DynamoDB; throws if not
- The tool functions inside MemberScope cannot accept a different memberId

Create `backend/src/tools/classifyInquiry.ts`:
- Factory: `createClassifyInquiryTool(memberId: string)`
- Returns a LangChain `DynamicStructuredTool`
- Input schema (zod): { inquiry: string }
- Calls Bedrock with Claude Haiku 4.5 using a structured-output prompt to classify into one of: 'denial_explanation', 'eob_question', 'coverage_lookup', 'claim_status', 'unknown'
- Returns: { intent, confidence (0-1), reasoning }
- Logs the call via appendToolCall

Create `backend/src/tools/lookupClaim.ts`:
- Factory: `createLookupClaimTool(memberId: string)`
- Input schema: { claimId?: string, dateOfServiceFrom?: string, dateOfServiceTo?: string, status?: 'paid' | 'denied' | 'pending' }
- If claimId is provided, fetches that specific claim — but ONLY if its memberId matches the bound memberId. If mismatch, returns empty (do not throw — the mismatch is logged as an attempted scope violation in the tool call log).
- If no claimId, lists claims for the bound memberId with optional filters
- Returns array of claims with denial code details joined

Create `backend/src/tools/retrievePolicy.ts`:
- Factory: `createRetrievePolicyTool(memberId: string)`
- Input schema: { query: string, planType?: 'gold-ppo' | 'silver-ppo' | 'bronze-hmo' }
- If planType is not provided, looks up the member's plan type and uses that
- Calls Bedrock KB retrieve with metadata filter on planType
- Returns retrieved chunks with source filenames

Create `backend/src/tools/draftResponse.ts`:
- Factory: `createDraftResponseTool(memberId: string)`
- Input schema: { responseText: string, citedClaimIds: string[], citedPolicyChunks: string[], confidence: number }
- Returns: { traceId, status: 'drafted' }
- Note: actual persistence to DynamoDB happens at the end of the agent run, not inside this tool. This tool just signals the intent to draft.

Done when:
- All four tools typecheck
- `lookupClaim` with a mismatched memberId returns empty and logs a scope violation (write a quick unit test for this)
- `retrievePolicy` works against the live KB and returns chunks (test by calling it directly via tsx)
- No tool function accepts memberId as a parameter from the model
```

**Done when:** Each tool callable in isolation. The scope-mismatch test passes. Manual end-to-end run of `retrievePolicy` returns real KB chunks.

---

### ☐ Prompt 6 — Agent loop, Lambda handler, escalation guard

**AWS prerequisites:**
- Lambda function `claims-agent` created in us-east-1 with the IAM role from AWS_SETUP.md
- Lambda Function URL enabled with CORS allowing your dev origin (use `*` for MVP, document this as a known gap)
- Lambda environment variables set per `.env.example`

```
Read CLAUDE.md and docs/DESIGN_DECISIONS.md Section 5 (the escalation guard runs BEFORE the agent).

Create `backend/src/safeguards/escalationGuard.ts`:
- Function `shouldEscalate(inquiry: string): { escalate: boolean, reason: string | null }`
- Deterministic string matching only (no model calls)
- Escalation triggers: medical advice requests, legal language, mentions of self-harm/suicide, complaints about specific employees, requests to file a lawsuit, mentions of dying or being seriously ill
- Use a curated list of trigger phrases; case-insensitive; whole-word matches where appropriate
- Returns the matched reason for logging
- Write basic unit tests covering at least 6 cases (3 escalation, 3 non-escalation) in `escalationGuard.test.ts` colocated with the source

Create `backend/src/agent.ts`:
- Function `runAgent(memberId: string, inquiry: string): Promise<AgentResult>`
- Steps:
  1. Call shouldEscalate. If true, write an escalated trace to DynamoDB and return early with disposition: 'escalated'.
  2. Call resolveMemberScope to get the bound tools
  3. Build a LangChain agent (use createToolCallingAgent with Claude Haiku 4.5 via ChatBedrockConverse) with the four tools
  4. System prompt: explicit instructions about the four-step process (classify → lookup → retrieve → draft), the requirement to cite policy chunks by ID in draft responses, the requirement to never make claims beyond what the policy chunks say, the prohibition on medical advice or coverage determinations
  5. Wrap the invocation in withTraceContext so tool calls are captured
  6. Invoke the agent with the user's inquiry
  7. After completion, write the full trace to DynamoDB
  8. Return AgentResult: { traceId, disposition, draftResponse, classification, toolCallCount, durationMs }
- Maximum iterations: 6 (defensive cap to prevent runaway loops)

Create `backend/src/index.ts` (Lambda handler):
- Export `handler(event: LambdaFunctionURLEvent)`
- Parse JSON body: { memberId: string, inquiry: string }
- Validate with zod; return 400 on validation failure
- Call runAgent
- Return JSON response with appropriate CORS headers
- Catch errors, log to CloudWatch with structured JSON, return 500 with a generic error message
- Set CORS headers from FRONTEND_ORIGIN env var

Create `backend/deploy.sh`:
- Use esbuild to bundle src/index.ts into a single file (`dist/lambda.js`), targeting node20, bundle: true, platform: node, format: cjs (Lambda Node.js handler signature works with cjs more reliably than esm), externals: none (bundle everything)
- Zip the dist/ directory
- Run `aws lambda update-function-code --function-name claims-agent --zip-file fileb://function.zip --region us-east-1`
- Print the new function ARN/version
- chmod +x the script

Done when:
- `bash backend/deploy.sh` succeeds
- A curl to the Lambda Function URL with a valid body returns a draft response
- The trace appears in DynamoDB with all tool calls
- An escalation test (e.g., "I want to sue") returns escalated without invoking the model
```

**Done when:** End-to-end works via `curl`. You see the trace in DynamoDB. Escalation guard is verified.

---

## Day 2 (Friday) — Trace API + first frontend

### ☐ Prompt 7 — Traces endpoint + minimum viable frontend

**AWS prerequisites:** Lambda from Prompt 6 deployed.

```
Read CLAUDE.md.

Add routes to the Lambda handler:
- Modify `backend/src/index.ts` to inspect event.requestContext.http.method and event.rawPath
- POST / → existing agent endpoint
- GET /traces → list recent traces from DynamoDB (last 50, sorted by timestamp desc)
- GET /members → list all members from DynamoDB (for the dropdown)
- Handle OPTIONS for CORS preflight on all routes

Redeploy with deploy.sh and verify the new routes work via curl.

Now in `frontend/`:

Add to `frontend/`:
- React Router: `pnpm add react-router-dom` (do not install yourself; Claude Code adds the dependency to package.json and notes that the user should run pnpm install)

Create `frontend/.env.local.example` with:
```
VITE_LAMBDA_URL=
```
Add `.env.local` to the root `.gitignore` if not already covered.

Create `frontend/src/lib/api.ts`:
- Exports `LAMBDA_URL` from `import.meta.env.VITE_LAMBDA_URL` with a runtime check that throws a clear error if missing
- Functions: `listMembers()`, `sendInquiry(memberId, inquiry)`, `listTraces()`
- Typed responses; duplicate the shared types in `frontend/src/types.ts` (we don't have a shared package — keep it simple)

Note on `VITE_LAMBDA_URL`: Vite resolves `import.meta.env.*` at build time, not runtime. The same `frontend/.env.local` value is used for both `pnpm dev` and `pnpm build` — and the bundle produced by `pnpm build` carries the resolved URL baked in. When Prompt 8 deploys to Firebase Hosting, the build is uploaded as-is; there is no Firebase-side env var to configure. The implication: changing `VITE_LAMBDA_URL` requires a rebuild + redeploy, not a hosting-side variable update.

Create `frontend/src/components/SyntheticDataBanner.tsx`:
- A small, persistent banner at the top of every page
- Amber background, dark text
- Says: "Demo with synthetic data. No real PHI, no real claims, no affiliation with any health plan or insurer. All data is generated by scripts in this repository."
- Not dismissible

Create `frontend/src/components/MemberPicker.tsx`:
- Fetches members on mount
- Dropdown with member name + memberId + plan type
- Calls onChange when selection changes

Create `frontend/src/pages/Chat.tsx`:
- MemberPicker at top
- Below: a chat-like UI with an input box and a list of message bubbles
- On submit: calls sendInquiry, displays the user's inquiry, then displays the response
- Response display includes: classification with confidence, the drafted response text, list of tools called, disposition badge (draft/escalated)
- Loading state during the request (5-15 seconds is realistic)

Create `frontend/src/pages/Traces.tsx`:
- Fetches traces on mount and on a manual refresh button
- Table view: timestamp, memberId, inquiry (truncated to 80 chars), classification intent, confidence, tool count, disposition badge
- Click a row → expands to show full inquiry, full draft response, and the full tool call sequence

Create `frontend/src/App.tsx`:
- Router setup
- SyntheticDataBanner above the routes
- A simple nav bar with two links: "Chat" and "Traces"
- Use Tailwind for all styling; restrained zinc + indigo palette

Done when:
- `pnpm --filter @claims-agent/frontend dev` starts a dev server (after pnpm install for the new dep)
- Selecting a member, asking "why was my last claim denied?", and submitting shows a real drafted response
- The Traces page lists recent runs
- The SyntheticDataBanner is visible on both pages
- No console errors
```

**Done when:** Local frontend talks to deployed Lambda. End-to-end demo works in a browser. This is your minimum viable shipped state — everything from here is polish.

---

## Day 3 (Saturday) — Deploy frontend + polish

### ☐ Prompt 8 — Firebase Hosting deploy + frontend polish

**AWS prerequisites:** None new.

**Firebase prerequisites (one-time, already completed manually outside this prompt):**
- A second Hosting site `claims-agent-demo` exists under the `rangbull-labs-portfolio` Firebase project.
- Custom domain `claims-agent.rangbull-labs.com` is attached to that Hosting site and the CNAME is live at the DNS provider.

```
Read CLAUDE.md.

Deploy the frontend to Firebase Hosting:
- Create `frontend/firebase.json` configuring it as a Vite SPA. Required fields:
  - `"hosting"` block with `"target": "claims-agent-demo"`, `"public": "dist"`, an `"ignore"` list for the usual dotfiles, and a SPA rewrite mapping `**` → `/index.html`.
- The `VITE_LAMBDA_URL` value is baked into the build at build time (Vite resolves `import.meta.env` during `vite build`, not at runtime). The same `frontend/.env.local` that local dev uses is what produces the production bundle — there is no Firebase-side env var to configure.
- One-time setup from `frontend/`: `firebase init hosting` (selecting the existing `rangbull-labs-portfolio` project — do NOT create a new project, do NOT overwrite `firebase.json` if it already exists), then `firebase target:apply hosting claims-agent-demo claims-agent-demo`.
- Deploy command (documented in `frontend/README.md`): `pnpm build && firebase deploy --only hosting:claims-agent-demo`. The `--only hosting:claims-agent-demo` target flag is load-bearing — without it, a `firebase deploy` would walk the project's hosting sites and could overwrite the portfolio site.

Update the Lambda CORS configuration:
- The deploy.sh script currently uses `*` for CORS. Now set it more tightly: read FRONTEND_ORIGIN from Lambda env vars (`https://claims-agent.rangbull-labs.com`), and also accept `http://localhost:5173` so local dev can hit the prod Lambda.
- Update the Lambda env var `FRONTEND_ORIGIN=https://claims-agent.rangbull-labs.com` (the custom subdomain, NOT the default `.web.app` URL — the custom domain is the canonical public URL).
- The dev-vs-prod dual-origin pattern is documented in CLAUDE.md "Deployment notes".

Frontend polish:
- Add a loading skeleton to the Chat page during the agent request
- Show a "thinking..." indicator with the elapsed time
- Add a "Try one of these" section below the input on the Chat page with 5 example prompts, including one escalation example so the demo shows that path
- On the Traces page, add a small chart at the top: confidence-band histogram of the last 50 runs (use Recharts; add to frontend deps)
- Add a footer with: link to the GitHub repo (placeholder URL for now), link to docs/DESIGN_DECISIONS.md (will be a GitHub blob URL once published)

Done when:
- `firebase deploy --only hosting:claims-agent-demo` succeeds
- `https://claims-agent.rangbull-labs.com` loads and works end-to-end against the prod Lambda
- The default `claims-agent-demo.web.app` URL is reachable as a fallback
- The confidence-band histogram renders
- Example prompts are clickable and pre-fill the input
- Loading states feel responsive
```

**Done when:** Frontend is live at `https://claims-agent.rangbull-labs.com`. Demo is shareable.

---

## Day 4 (Monday) — Eval + architecture artifacts

### ☐ Prompt 9 — Eval suite + architecture diagram

**AWS prerequisites:** Lambda + Bedrock Sonnet 4 access.

```
Read CLAUDE.md and docs/DESIGN_DECISIONS.md Section 6 (AgentOps).

Create `backend/eval/cases.json` with ~30 test cases across five categories (6 each):
- Denial explanation: clear questions about specific denial reasons
- EOB question: questions about what specific charges mean
- Coverage lookup: questions about whether something is covered
- Explicit escalation: legal language, medical advice requests, self-harm signals
- Ambiguous / low-confidence: vague questions, multi-intent questions, off-topic questions

Each case has: { caseId, category, memberId, inquiry, expected: { shouldEscalate?: boolean, expectedIntent?: string, minConfidence?: number } }

Update the Lambda handler to accept a `?model=sonnet` query param. When present, the agent uses BEDROCK_EVAL_MODEL_ID instead of BEDROCK_MODEL_ID. Redeploy.

Create `backend/scripts/eval.ts`:
- Loads cases.json
- For each case, calls the deployed Lambda (use LAMBDA_URL from env or CLI arg)
- Records: actual disposition, actual classification + confidence, actual tool calls, response, latency
- Optional --compare flag: runs the same cases with `?model=sonnet`
- Ensures `backend/eval/results/` exists (fs.mkdir recursive: true) before writing
- Writes results to `backend/eval/results/eval-<timestamp>.json`
- Produces a summary markdown file `backend/eval/results/eval-<timestamp>.md` with:
  - Per-category accuracy (manual grade column to fill in later)
  - Confidence-band distribution (how many cases fell in each band)
  - Escalation precision/recall (did escalation triggers fire correctly?)
  - If --compare: Haiku vs Sonnet side-by-side on accuracy, avg confidence, avg latency, cost per run (estimate using current Bedrock pricing)
  - Latency p50/p95

Create `docs/ARCHITECTURE.md`:
- High-level diagram (ASCII or describe in prose; I'll make it visual in Prompt 10)
- Component descriptions: client → Lambda URL → escalation guard → member scope → agent loop (4 tools) → DynamoDB
- Sequence diagram of one inquiry from request to drafted response
- Where each safeguard layer sits in the flow

Run the eval suite. Spend ~45 minutes manually grading the response correctness column. Update the summary markdown with grades.

Done when:
- eval/cases.json has 30 cases
- Eval results are written
- Haiku vs Sonnet comparison runs and shows real numbers
- ARCHITECTURE.md exists and reads coherently
```

**Done when:** You have real eval data with manual grades. The Haiku/Sonnet comparison table has numbers in it. Architecture doc is written.

---

## Day 5 (Tuesday) — Portfolio integration + Loom

### ☐ Prompt 10 — Portfolio site entry + README + architecture diagram component

**AWS prerequisites:** None.

```
Read CLAUDE.md.

This prompt produces the assets needed to integrate the project into the rangbull-labs.com portfolio site. The portfolio repo is separate; this prompt just generates the content.

Create `docs/PORTFOLIO_ENTRY.md` containing the exact TypeScript object to paste into `src/data/projects.ts` in the rangbull-labs-website repo. The object should match the Project type from that repo and follow the same pattern as the existing mortgage-prequal entry.

Use:
- slug: 'claims-inquiry-agent'
- title: 'HIPAA-Shaped Claims Inquiry Agent'
- tagline: a one-liner under 100 chars
- status: 'live'
- category: 'agentic_ai'
- date: '2026-05'
- cover_image: '/covers/claims-agent.png' (will be created separately)
- architecture_diagram: 'claims_agent' (new registry key)
- tech_stack: include all real components used (Node.js 20, TypeScript, AWS Lambda, Bedrock, Claude Haiku 4.5, LangChain.js, Pinecone, DynamoDB, React, Vite, Tailwind, Firebase Hosting)
- links array including:
  - Live demo: `https://claims-agent.rangbull-labs.com`
  - GitHub repo (placeholder)
  - Design Decisions (link to docs/DESIGN_DECISIONS.md on GitHub) — label "Design decisions"
  - Loom walkthrough (placeholder URL — will be filled after recording)
- sections (four, matching the existing project's pattern):
  - "What it is" — what the system does, including the synthetic-data disclaimer
  - "The architecture" — agent loop, four tools, member scoping, draft-only output, escalation guard
  - "Why this is production-shaped" — name the safeguard layers, the eval discipline, the audit trail, the model choice rationale
  - "Known gaps" — synthetic data only, no deterministic policy engine, no external audit monitor, no multi-turn memory, CORS is permissive

Create `docs/ArchitectureDiagram.tsx` containing a React component (SVG inside) that visualizes:
- Client browser → Lambda Function URL → Escalation Guard → Member Scope Middleware → Agent Loop → (the four tools in a sub-cluster) → DynamoDB Traces
- Mark the model boundary (the LLM appears only inside the Agent Loop box)
- Show the draft-only output going to a "Review Queue" terminus (no outbound arrow)
- Use currentColor for stroke; this lets the portfolio site theme it
- Annotate the "Member ID bound in tool closures" callout
- Mark the deferred safeguard layers as dashed/grayed boxes so they're visible but visually distinct

This component will be registered under the 'claims_agent' key in the portfolio site's ArchitectureDiagram.tsx component registry.

Create the project README at `README.md` (repo root):
- Title and one-paragraph description with the synthetic-data disclaimer
- Architecture diagram (link to docs/ARCHITECTURE.md)
- A prominent "📋 Design Decisions" section: one paragraph that links to docs/DESIGN_DECISIONS.md and explains why this document exists (the framework, what it documents)
- "How to run locally" section
- "How to deploy" section
- Eval results summary (link to the most recent eval markdown)
- "Known gaps" section matching the portfolio entry's section
- License (MIT)

Done when:
- PORTFOLIO_ENTRY.md is a valid TypeScript object that would compile in the portfolio site repo
- ArchitectureDiagram.tsx renders standalone in a sandbox (test it in a quick scratch React app or just by typechecking the SVG)
- README.md is complete and renders well on GitHub
- All cross-links between docs resolve correctly
```

**Done when:** All portfolio artifacts exist. You can paste them into rangbull-labs-website tomorrow.

---

## After Prompt 10

You now have:
- A deployed, working agent
- Eval data
- Architecture artifacts
- Portfolio-ready content

**Record the Loom walkthrough (~90 seconds):**
1. Open `https://claims-agent.rangbull-labs.com` with the Traces page visible in a second tab
2. Pick a member from the dropdown
3. Ask "Why was my last claim denied?"
4. Wait for the response, walk through the classification, draft, tool calls
5. Switch to Traces tab, show the new entry with full detail expanded
6. Show one escalation case: ask "I want to sue you" and show it gets routed to escalation without the model running
7. End on the GitHub repo's docs/DESIGN_DECISIONS.md page

**Then paste `docs/PORTFOLIO_ENTRY.md` into the rangbull-labs-website repo** following the steps in that repo's `docs/ADDING_A_PROJECT.md`. Register the architecture diagram component. Deploy the portfolio site.

---

## Stretch goals if time remains

In rough priority order:

- **CDK conversion.** Convert manual AWS setup to a CDK stack. Strong signal but takes a half-day.
- **Streaming responses.** Add streaming via Lambda response streaming. Better UX, mentioned in the JD.
- **Scheduled eval.** EventBridge rule that runs the eval nightly. Removes the "eval runs on-demand" caveat from the design doc.
- **Bedrock Guardrails.** Add a Bedrock Guardrail for PII redaction and content filtering. Mentioned in the Principal Architect JD.
- **Multi-turn memory.** Allow follow-up questions in the same session. The hardest stretch; punt unless ahead of schedule.

Pick at most one. Don't sacrifice the polish of what's already there for an unfinished stretch goal.
