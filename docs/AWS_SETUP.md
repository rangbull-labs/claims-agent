# AWS Setup Checklist

This is the manual AWS console work that must be done **by you, not by Claude Code**. Each section maps to the Claude Code prompts that depend on it.

**Region throughout:** `us-east-1`.

**Account state assumed:** You have an existing AWS account from your prior Bedrock work. Bedrock model access for Claude Haiku 4.5 is already granted (or will be requested below). Pinecone account exists with API key available.

---

## Section 1 — Before Prompt 1 (none)

No AWS work yet. Prompt 1 is pure code scaffolding.

---

## Section 2 — Before Prompt 2 (none required, but worth verifying)

Still no AWS work needed for Prompt 2 — it sets up clients but doesn't call them. However, before Prompt 3 you'll need everything below, and some items take a few minutes (or longer) to complete, so start now.

**Verify Bedrock model access in us-east-1:**

1. AWS Console → Amazon Bedrock → Model access
2. Confirm "Access granted" for:
   - **Claude Haiku 4.5** (`anthropic.claude-haiku-4-5-20251001-v1:0`)
   - **Claude Sonnet 4** (`anthropic.claude-sonnet-4-20250514-v1:0`)
   - **Titan Text Embeddings V2** (`amazon.titan-embed-text-v2:0`)
3. If any are missing, click "Manage model access" → check the box → submit. Approval is usually instant for Anthropic models but can take up to a few hours.

**Important: Claude Haiku 4.5 and Sonnet 4 require inference profile invocation for on-demand throughput.** In application code and environment variables, use the `us.`-prefixed inference profile IDs (`us.anthropic.claude-haiku-4-5-20251001-v1:0` and `us.anthropic.claude-sonnet-4-20250514-v1:0`) rather than the raw model IDs. The raw model IDs only work with provisioned throughput. This is a recent Bedrock change for newer Anthropic models.

If Haiku 4.5 is not yet generally available in your region, fall back to Claude 3.5 Haiku (`anthropic.claude-3-5-haiku-20241022-v1:0`) and update `BEDROCK_MODEL_ID` accordingly.

---

## Section 3 — Before Prompt 4 (the main setup batch)

This is the biggest setup step. Budget 60–90 minutes. Do this Wednesday evening if possible.

### 3.1 Create the IAM user

1. **IAM → Users → Create user**
   - Username: `claims-agent-dev`
   - Access type: Programmatic access (no console access needed)
2. **Attach permissions.** The cleanest approach is to model this policy on whatever you used for your prior Bedrock work (it should already cover Bedrock, Bedrock KB, DynamoDB, S3, and Lambda for similar resource patterns). If you need to write a fresh inline policy, use this (least-privilege; replace `<your-account-id>`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "BedrockInvoke",
      "Effect": "Allow",
      "Action": [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream"
      ],
      "Resource": [
        "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
        "arn:aws:bedrock:us-east-1::foundation-model/anthropic.claude-sonnet-4-20250514-v1:0",
        "arn:aws:bedrock:us-east-1::foundation-model/amazon.titan-embed-text-v2:0",
        "arn:aws:bedrock:us-east-1:<your-account-id>:inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0",
        "arn:aws:bedrock:us-east-1:<your-account-id>:inference-profile/us.anthropic.claude-sonnet-4-20250514-v1:0",
        "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
        "arn:aws:bedrock:us-west-2::foundation-model/anthropic.claude-sonnet-4-20250514-v1:0",
        "arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0",
        "arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-sonnet-4-20250514-v1:0"
      ]
    },
    {
      "Sid": "BedrockKB",
      "Effect": "Allow",
      "Action": [
        "bedrock:Retrieve",
        "bedrock:RetrieveAndGenerate",
        "bedrock:StartIngestionJob",
        "bedrock:GetIngestionJob",
        "bedrock:ListKnowledgeBases"
      ],
      "Resource": "*"
    },
    {
      "Sid": "DynamoDBTables",
      "Effect": "Allow",
      "Action": [
        "dynamodb:GetItem",
        "dynamodb:PutItem",
        "dynamodb:Query",
        "dynamodb:Scan",
        "dynamodb:BatchWriteItem",
        "dynamodb:BatchGetItem"
      ],
      "Resource": [
        "arn:aws:dynamodb:us-east-1:<your-account-id>:table/claims-agent-Members",
        "arn:aws:dynamodb:us-east-1:<your-account-id>:table/claims-agent-Claims",
        "arn:aws:dynamodb:us-east-1:<your-account-id>:table/claims-agent-AgentTraces",
        "arn:aws:dynamodb:us-east-1:<your-account-id>:table/claims-agent-AgentTraces/index/*"
      ]
    },
    {
      "Sid": "S3PolicyDocs",
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::claims-agent-policy-docs-*",
        "arn:aws:s3:::claims-agent-policy-docs-*/*"
      ]
    },
    {
      "Sid": "LambdaDeploy",
      "Effect": "Allow",
      "Action": [
        "lambda:UpdateFunctionCode",
        "lambda:GetFunction"
      ],
      "Resource": "arn:aws:lambda:us-east-1:<your-account-id>:function:claims-agent"
    },
    {
      "Sid": "BedrockKBIngestion",
      "Effect": "Allow",
      "Action": [
        "bedrock:StartIngestionJob",
        "bedrock:GetIngestionJob",
        "bedrock:ListIngestionJobs",
        "bedrock:AssociateThirdPartyKnowledgeBase"
      ],
      "Resource": "arn:aws:bedrock:us-east-1:<your-account-id>:knowledge-base/<your-kb-id>"
    },
    {
      "Sid": "CloudWatchLogsRead",
      "Effect": "Allow",
      "Action": [
        "logs:DescribeLogGroups",
        "logs:DescribeLogStreams",
        "logs:GetLogEvents",
        "logs:FilterLogEvents",
        "logs:StartLiveTail"
      ],
      "Resource": [
        "arn:aws:logs:us-east-1:<your-account-id>:log-group:/aws/lambda/claims-agent",
        "arn:aws:logs:us-east-1:<your-account-id>:log-group:/aws/lambda/claims-agent:*"
      ]
    }
  ]
}
```

The inference profile ARNs are required because Claude Haiku 4.5 and Sonnet 4 must be invoked via inference profiles. The cross-region foundation model ARNs (us-west-2 and us-east-2) are required because inference profiles transparently load-balance requests across the US region cluster, and Bedrock validates IAM permissions for the actual underlying region at invocation time.

The CloudWatchLogsRead statement is for operator convenience (`aws logs tail`) and is NOT used by the Lambda runtime. It is over-privileging in the strictest least-privilege sense. A production hardening pass would split this into a separate `claims-agent-observer-access` policy attached to a separate operator role, rather than to the runtime user.

3. **Create access key.** Save the key ID and secret somewhere safe (password manager). You will not be able to view the secret again.
4. **Configure locally:** `aws configure --profile claims-agent-dev` and paste the credentials. Set default region to `us-east-1`.
5. **Verify:** `aws sts get-caller-identity --profile claims-agent-dev` returns the claims-agent-dev user.

### 3.2 Create the DynamoDB tables

For each of the three tables: **DynamoDB → Create table.**

**claims-agent-Members:**
- Partition key: `memberId` (String)
- No sort key
- Billing mode: On-demand
- Everything else default

**claims-agent-Claims:**
- Partition key: `memberId` (String)
- Sort key: `claimId` (String)
- Billing mode: On-demand

**claims-agent-AgentTraces:**
- Partition key: `traceId` (String)
- Sort key: `timestamp` (String) — ISO 8601 strings sort correctly
- Billing mode: On-demand
- After creation: add a Global Secondary Index `byMemberId` with partition key `memberId` (String) and sort key `timestamp` (String), projection: All. This is needed for the Traces page to filter by member efficiently.

### 3.3 Create the S3 bucket for policy docs

1. **S3 → Create bucket**
   - Name: `claims-agent-policy-docs-<your-suffix>` (e.g., `claims-agent-policy-docs-rb2026`) — bucket names are global
   - Region: us-east-1
   - Block all public access: keep enabled (yes, block everything)
   - Versioning: disabled (synthetic data, not needed)
   - Encryption: SSE-S3 (default)
2. Note the bucket name. Add it to `.env` as `POLICY_DOCS_BUCKET`.

### 3.4 Create the Pinecone index

In your existing Pinecone account:
1. **Indexes → Create index**
   - Name: `claims-agent-policy-kb`
   - Dimensions: **1024** (Titan v2 embedding dimension)
   - Metric: cosine
   - Pod type / serverless: serverless (free tier eligible)
   - Region: us-east-1 (must match Bedrock region)
2. Save the API key and the index host URL.

### 3.5 Create the Bedrock Knowledge Base

1. **Amazon Bedrock → Knowledge bases → Create knowledge base**
2. **Step 1 — Provide KB details:**
   - Name: `claims-agent-policy-kb`
   - IAM role: Create a new service role (Bedrock will create one with the right permissions)
3. **Step 2 — Configure data source:**
   - Data source name: `policy-docs`
   - S3 URI: `s3://claims-agent-policy-docs-<your-suffix>/`
   - Chunking strategy: Default (300 tokens, 20% overlap) — adjust later if needed
4. **Step 3 — Select embeddings model:**
   - Amazon Titan Text Embeddings V2
   - Dimensions: 1024
5. **Step 4 — Configure vector store:**
   - **Choose "Use an existing vector store" → Pinecone**
   - Connection string: your Pinecone index host URL from 3.4
   - Credentials: store the Pinecone API key in AWS Secrets Manager when prompted (Bedrock will guide you)
   - Text field name: `text`
   - Bedrock managed metadata field: `metadata`
6. **Step 5 — Review and create.** Creation takes a few minutes.
7. After creation, **note the Knowledge Base ID** (looks like `XXXXXXXXXX`). Add to `.env` as `KNOWLEDGE_BASE_ID`.

You will NOT run an ingestion job yet — Prompt 4 does that programmatically after the policy docs are generated.

### 3.6 Populate `.env`

Copy `.env.example` to `.env` and fill in:

```
AWS_REGION=us-east-1
AWS_PROFILE=claims-agent-dev
BEDROCK_MODEL_ID=us.anthropic.claude-haiku-4-5-20251001-v1:0
BEDROCK_EVAL_MODEL_ID=us.anthropic.claude-sonnet-4-20250514-v1:0
BEDROCK_EMBEDDING_MODEL_ID=amazon.titan-embed-text-v2:0
KNOWLEDGE_BASE_ID=<from 3.5>
PINECONE_API_KEY=<from 3.4>
DYNAMODB_MEMBERS_TABLE=claims-agent-Members
DYNAMODB_CLAIMS_TABLE=claims-agent-Claims
DYNAMODB_TRACES_TABLE=claims-agent-AgentTraces
POLICY_DOCS_BUCKET=claims-agent-policy-docs-<your-suffix>
FRONTEND_ORIGIN=http://localhost:5173
```

### 3.7 Set a billing alert

1. **CloudWatch → Billing → Create alarm**
2. Threshold: $20
3. Email yourself when crossed
4. The most expensive resources in this project are Pinecone (free tier should cover it) and Bedrock inference (cheap on Haiku). You should be fine but the alarm is cheap insurance.

---

## Section 4 — Before Prompt 6 (Lambda function)

The Lambda code is built by Claude Code, but the function itself must exist in AWS first so the deploy script has something to update.

### 4.1 Create the Lambda execution role

1. **IAM → Roles → Create role**
   - Trusted entity: AWS service → Lambda
   - Role name: `claims-agent-lambda-execution-role`
2. Attach policies:
   - `AWSLambdaBasicExecutionRole` (managed) — for CloudWatch logs
3. Add an inline policy with the same Bedrock/DynamoDB/KB permissions as the `claims-agent-dev` user policy in 3.1 (the role needs to do the same things, just from inside Lambda). You can copy the JSON from 3.1 minus the `LambdaDeploy` statement (Lambda doesn't deploy itself).

### 4.2 Create the Lambda function

1. **Lambda → Create function → Author from scratch**
   - Function name: `claims-agent`
   - Runtime: Node.js 20.x
   - Architecture: x86_64 (default; arm64 also fine, slightly cheaper, but you'll need to ensure esbuild outputs the right arch)
   - Execution role: Use existing role → `claims-agent-lambda-execution-role`
2. **Configuration → General configuration → Edit:**
   - Memory: 512 MB (Bedrock calls don't need much memory but want low latency)
   - Timeout: 60 seconds (agent loops can take 15-30s)
   - **Handler: leave as `index.handler` (the default).** The build script outputs `dist/index.js` to match this. If you ever change the handler name in the console, you must also update `backend/scripts/buildLambda.ts`. This is a coordination point between AWS console config and build output; the two must agree.
3. **Configuration → Environment variables:** copy from `.env`, but omit AWS_PROFILE (Lambda uses its execution role). Required vars:
   - `AWS_REGION=us-east-1`
   - `BEDROCK_MODEL_ID`
   - `BEDROCK_EVAL_MODEL_ID`
   - `BEDROCK_EMBEDDING_MODEL_ID`
   - `KNOWLEDGE_BASE_ID`
   - `DYNAMODB_MEMBERS_TABLE`
   - `DYNAMODB_CLAIMS_TABLE`
   - `DYNAMODB_TRACES_TABLE`
   - `FRONTEND_ORIGIN=*` for now; tighten in Prompt 8
4. **Configuration → Function URL → Create function URL:**
   - Auth type: NONE (this is a public demo; we control access via the synthetic-data limitation, not auth)
   - CORS: Configure
     - Allow origin: `*` (tighten in Prompt 8)
     - Allow methods: GET, POST, OPTIONS
     - Allow headers: `content-type`
     - Max age: 86400
   - Save and copy the URL — you'll need it for the frontend `.env.local`

---

## Section 5 — Before Prompt 8 (Firebase Hosting setup)

The frontend deploys to **Firebase Hosting**, in the same `rangbull-labs-portfolio` Firebase project as the portfolio site, with a separate Hosting site `claims-agent-demo`. Two sites under one project keeps billing and project administration in one place while isolating the two apps' deploy targets.

Public URL: `https://claims-agent.rangbull-labs.com` (custom subdomain). The default `https://claims-agent-demo.web.app` URL works as a fallback if DNS misbehaves.

### 5.1 One-time setup (already completed manually)

These steps are done once outside any prompt. Listed here for reproducibility:

1. **Firebase Console → Hosting** in the `rangbull-labs-portfolio` project → "Add another site" → site name `claims-agent-demo`.
2. **Custom domain:** in the new site's Hosting page → "Add custom domain" → `claims-agent.rangbull-labs.com`. Firebase generates a CNAME target.
3. **DNS:** at the DNS provider managing `rangbull-labs.com`, add a CNAME record `claims-agent` → the Firebase-provided target. Wait for SSL provisioning (usually under an hour).
4. **Install the Firebase CLI** locally: `npm i -g firebase-tools`, then `firebase login`.

### 5.2 First deploy from the repo

From the `frontend/` directory:

```bash
firebase init hosting        # select the existing rangbull-labs-portfolio project — do NOT create a new one
firebase target:apply hosting claims-agent-demo claims-agent-demo
pnpm build
firebase deploy --only hosting:claims-agent-demo
```

The `target:apply` command binds the local name `claims-agent-demo` (used in `firebase.json`'s `"target"` field) to the actual Hosting site of the same name. Without this, `firebase.json`'s target reference is unresolved and the deploy fails. With it, `--only hosting:claims-agent-demo` constrains the deploy to that site so the portfolio site can never be overwritten by accident.

### 5.3 Tighten Lambda CORS

1. Lambda → Configuration → Environment variables → Edit
2. Set `FRONTEND_ORIGIN=https://claims-agent.rangbull-labs.com` (the custom subdomain, NOT the `.web.app` default — the custom domain is the canonical public URL)
3. Lambda → Configuration → Function URL → Edit CORS
4. Allow origin: change `*` to `https://claims-agent.rangbull-labs.com`. Add `http://localhost:5173` as a second allowed origin so local dev can hit the prod Lambda. The dual-origin pattern is documented in CLAUDE.md "Deployment notes".

---

## Section 6 — Teardown (after recording the Loom)

Cost control after you're done with the demo:

- DynamoDB on-demand: zero cost when not queried. Leave it.
- Lambda: zero cost when not invoked. Leave it.
- Bedrock KB: there's no ongoing cost from the KB itself; cost is only on `retrieve` calls.
- Pinecone serverless: minimal idle cost. Leave it for the duration of your job search.
- S3: a few cents/month for policy docs. Leave it.

If you want to fully tear down:
- Delete the Bedrock KB
- Delete the Pinecone index
- Delete the DynamoDB tables
- Delete the Lambda function
- Delete the S3 bucket (empty it first)
- The IAM user/role can stay; zero cost when idle

For the portfolio, **leave everything running.** A recruiter who clicks the live demo button gets a real working agent; that's the entire point.

---

## Troubleshooting

**"AccessDeniedException" on Bedrock invoke:** Model access not granted in this region. Re-check Section 2.

**"ValidationException: model identifier is invalid":** Model ID typo. Bedrock model IDs are case-sensitive and version-specific. Copy from `.env.example`.

**KB ingestion job FAILED:** Check S3 bucket has the policy docs uploaded. Check the KB's service role can read the bucket (it should, if you used the auto-created role). Check policy doc files are valid markdown or PDF, not zero bytes.

**DynamoDB "ResourceNotFoundException":** Table name typo or wrong region in env var.

**Lambda Function URL returns 502:** Check CloudWatch logs for the function. Usually a missing environment variable or an uncaught exception in the handler.

**CORS errors in browser:** Lambda Function URL CORS config doesn't match the frontend origin. Recheck Section 5.2.
