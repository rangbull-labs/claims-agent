import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  BatchWriteCommand,
  type BatchWriteCommandInput,
} from "@aws-sdk/lib-dynamodb";

import { getDocClient } from "../src/aws/dynamo.js";
import {
  DYNAMODB_CLAIMS_TABLE,
  DYNAMODB_MEMBERS_TABLE,
} from "../src/config.js";
import type { Claim, Member } from "../src/types.js";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(SCRIPT_DIR, "..", "data");

const BATCH_SIZE = 25;
const MAX_RETRIES = 5;

type RequestItems = NonNullable<BatchWriteCommandInput["RequestItems"]>;
type WriteRequest = RequestItems[string][number];
type DynamoItem = NonNullable<WriteRequest["PutRequest"]>["Item"];

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Batches `items` into BatchWriteCommand requests of at most 25 (the
 * DynamoDB hard limit) and writes them to `tableName`. `PutRequest`
 * semantics are upsert-by-primary-key, so re-running the seed is safe.
 *
 * `UnprocessedItems` returned by DynamoDB (typically due to throttling)
 * are retried with capped exponential backoff. Throws on exhaustion of
 * the retry budget so the script exits non-zero.
 */
async function batchPut(
  tableName: string,
  items: readonly object[],
  label: string,
): Promise<void> {
  const client = getDocClient();
  let written = 0;

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const chunk = items.slice(i, i + BATCH_SIZE);
    let pending: WriteRequest[] = chunk.map((item): WriteRequest => ({
      PutRequest: { Item: item as DynamoItem },
    }));

    let attempt = 0;
    while (pending.length > 0) {
      const result = await client.send(
        new BatchWriteCommand({
          RequestItems: { [tableName]: pending },
        }),
      );

      const unprocessed = result.UnprocessedItems?.[tableName] ?? [];
      const justProcessed = pending.length - unprocessed.length;
      written += justProcessed;
      console.log(`Seeded ${written}/${items.length} ${label}...`);

      if (unprocessed.length === 0) break;

      attempt++;
      if (attempt >= MAX_RETRIES) {
        throw new Error(
          `Gave up after ${MAX_RETRIES} retries with ${unprocessed.length} unprocessed items remaining for table ${tableName}`,
        );
      }
      await sleep(Math.min(2 ** attempt * 100, 5000));
      pending = unprocessed;
    }
  }
}

async function main(): Promise<void> {
  const membersRaw = readFileSync(join(DATA_DIR, "members.json"), "utf-8");
  const claimsRaw = readFileSync(join(DATA_DIR, "claims.json"), "utf-8");
  const members = JSON.parse(membersRaw) as Member[];
  const claims = JSON.parse(claimsRaw) as Claim[];

  console.log(`Seeding ${members.length} members → ${DYNAMODB_MEMBERS_TABLE}`);
  await batchPut(DYNAMODB_MEMBERS_TABLE, members, "members");

  console.log(`Seeding ${claims.length} claims → ${DYNAMODB_CLAIMS_TABLE}`);
  await batchPut(DYNAMODB_CLAIMS_TABLE, claims, "claims");

  console.log("Done.");
}

await main();
