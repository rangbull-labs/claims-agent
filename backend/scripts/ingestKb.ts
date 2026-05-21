import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GetIngestionJobCommand,
  StartIngestionJobCommand,
} from "@aws-sdk/client-bedrock-agent";
import { PutObjectCommand } from "@aws-sdk/client-s3";

import { getBedrockAgentClient } from "../src/aws/bedrockAgent.js";
import { getS3Client } from "../src/aws/s3.js";
import {
  KB_DATA_SOURCE_ID,
  KNOWLEDGE_BASE_ID,
  POLICY_DOCS_BUCKET,
} from "../src/config.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const POLICY_DOCS_DIR = join(SCRIPT_DIR, "..", "data", "policyDocs");
const S3_PREFIX = "policyDocs/";
const POLL_INTERVAL_MS = 10_000;

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Maps a policy-doc filename to the `planType` metadata value used by the
 * `retrievePolicy` tool's KB filter. Throws on unknown filenames so a
 * mistyped or rogue doc never reaches the KB without a planType tag.
 */
function planTypeForFile(filename: string): "gold-ppo" | "silver-ppo" | "bronze-hmo" {
  if (filename.startsWith("gold-ppo")) return "gold-ppo";
  if (filename.startsWith("silver-ppo")) return "silver-ppo";
  if (filename.startsWith("bronze-hmo")) return "bronze-hmo";
  throw new Error(`Unknown planType for policy doc filename: ${filename}`);
}

/**
 * Uploads every `.md` file under `backend/data/policyDocs/` to the
 * configured S3 bucket under the `policyDocs/` prefix. Alongside each
 * document, uploads a `<doc>.metadata.json` sidecar carrying the
 * `planType` metadata attribute — this is what the agent's
 * `retrievePolicy` tool filters on when it scopes retrieval to a
 * member's plan. ContentType on the doc itself is set explicitly to
 * `text/markdown`. Returns the number of `.md` files uploaded (sidecars
 * are not counted).
 */
async function uploadDocs(): Promise<number> {
  const client = getS3Client();
  const files = readdirSync(POLICY_DOCS_DIR).filter((f) => f.endsWith(".md"));

  for (const file of files) {
    const body = readFileSync(join(POLICY_DOCS_DIR, file));
    const key = `${S3_PREFIX}${file}`;
    console.log(`Uploading ${file} → s3://${POLICY_DOCS_BUCKET}/${key}`);
    await client.send(
      new PutObjectCommand({
        Bucket: POLICY_DOCS_BUCKET,
        Key: key,
        Body: body,
        ContentType: "text/markdown",
      }),
    );

    const planType = planTypeForFile(file);
    const metadataKey = `${key}.metadata.json`;
    const metadataBody = JSON.stringify({
      metadataAttributes: { planType },
    });
    console.log(`Uploading metadata → s3://${POLICY_DOCS_BUCKET}/${metadataKey}`);
    await client.send(
      new PutObjectCommand({
        Bucket: POLICY_DOCS_BUCKET,
        Key: metadataKey,
        Body: metadataBody,
        ContentType: "application/json",
      }),
    );
  }

  return files.length;
}

/**
 * Kicks off a Bedrock KB ingestion job for the configured knowledge base
 * and data source. Returns the new `ingestionJobId`. Throws if the API
 * response does not include an ID, which would indicate a malformed KB
 * configuration rather than a recoverable error.
 */
async function startIngestion(): Promise<string> {
  const client = getBedrockAgentClient();
  const result = await client.send(
    new StartIngestionJobCommand({
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
      dataSourceId: KB_DATA_SOURCE_ID,
    }),
  );
  const id = result.ingestionJob?.ingestionJobId;
  if (!id) {
    throw new Error("StartIngestionJob did not return an ingestionJobId");
  }
  return id;
}

/**
 * Polls `GetIngestionJob` every 10 seconds until the job reaches a
 * terminal state. `COMPLETE` resolves; `FAILED` and `STOPPED` throw with
 * any failure reasons attached.
 */
async function pollIngestion(jobId: string): Promise<void> {
  const client = getBedrockAgentClient();
  const start = Date.now();

  while (true) {
    const result = await client.send(
      new GetIngestionJobCommand({
        knowledgeBaseId: KNOWLEDGE_BASE_ID,
        dataSourceId: KB_DATA_SOURCE_ID,
        ingestionJobId: jobId,
      }),
    );
    const status = result.ingestionJob?.status ?? "UNKNOWN";
    const elapsed = Math.round((Date.now() - start) / 1000);
    console.log(`[${elapsed}s] Status: ${status}`);

    if (status === "COMPLETE") {
      return;
    }
    if (status === "FAILED" || status === "STOPPED") {
      const reasons = result.ingestionJob?.failureReasons ?? [];
      const detail = reasons.length > 0 ? `: ${reasons.join("; ")}` : "";
      throw new Error(`Ingestion job ${jobId} ended with status ${status}${detail}`);
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

async function main(): Promise<void> {
  const uploaded = await uploadDocs();
  console.log(`Uploaded ${uploaded} files to s3://${POLICY_DOCS_BUCKET}/${S3_PREFIX}`);

  console.log(
    `Starting ingestion job (KB=${KNOWLEDGE_BASE_ID}, DS=${KB_DATA_SOURCE_ID})`,
  );
  const jobId = await startIngestion();
  console.log(`Ingestion job started: ${jobId}`);

  await pollIngestion(jobId);
  console.log("Ingestion COMPLETE.");
}

try {
  await main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`Ingestion failed: ${message}`);
  process.exit(1);
}
