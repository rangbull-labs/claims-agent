import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  ScanCommand,
} from "@aws-sdk/lib-dynamodb";

import {
  AWS_REGION,
  DYNAMODB_CLAIMS_TABLE,
  DYNAMODB_MEMBERS_TABLE,
  DYNAMODB_TRACES_TABLE,
} from "../config.js";
import type { AgentTrace, Claim, Member } from "../types.js";

let baseClient: DynamoDBClient | null = null;
let docClient: DynamoDBDocumentClient | null = null;

/**
 * Returns the process-wide singleton `DynamoDBDocumentClient`. Construction
 * is deferred to first use so module load does not perform AWS work.
 */
export function getDocClient(): DynamoDBDocumentClient {
  if (!docClient) {
    baseClient = new DynamoDBClient({ region: AWS_REGION });
    docClient = DynamoDBDocumentClient.from(baseClient, {
      marshallOptions: {
        removeUndefinedValues: true,
      },
    });
  }
  return docClient;
}

/**
 * Fetches a single member by primary key. Returns `null` when the member is
 * not found. Throws on any AWS SDK error so callers can decide how to
 * surface infrastructure failures.
 */
export async function getMember(memberId: string): Promise<Member | null> {
  const result = await getDocClient().send(
    new GetCommand({
      TableName: DYNAMODB_MEMBERS_TABLE,
      Key: { memberId },
    }),
  );
  if (!result.Item) return null;
  return result.Item as Member;
}

/**
 * Fetches a single claim scoped to a member. The composite key
 * `(memberId, claimId)` is the enforcement point for member-scoping at the
 * data layer: a request for a claim owned by another member returns `null`.
 */
export async function getClaim(claimId: string, memberId: string): Promise<Claim | null> {
  const result = await getDocClient().send(
    new GetCommand({
      TableName: DYNAMODB_CLAIMS_TABLE,
      Key: { memberId, claimId },
    }),
  );
  if (!result.Item) return null;
  return result.Item as Claim;
}

/**
 * Looks up a claim by `claimId` alone, without scoping to a member. This
 * is **only** used by the member-scoping middleware to detect attempted
 * cross-member access: if the returned claim's `memberId` does not match
 * the agent's bound member, the request is logged as a scope violation
 * and an empty result is returned to the caller.
 *
 * Implemented as a full table `Scan` with a filter expression. Acceptable
 * for the MVP's ~50 synthetic claims; a production version would back
 * this with a GSI on `claimId`.
 */
export async function findClaimByIdUnscoped(claimId: string): Promise<Claim | null> {
  const result = await getDocClient().send(
    new ScanCommand({
      TableName: DYNAMODB_CLAIMS_TABLE,
      FilterExpression: "claimId = :c",
      ExpressionAttributeValues: { ":c": claimId },
    }),
  );
  const items = (result.Items ?? []) as Claim[];
  return items[0] ?? null;
}

/**
 * Lists every claim belonging to a single member. Uses a `Query` against the
 * `memberId` partition key — no cross-member access is possible.
 */
export async function listClaimsForMember(memberId: string): Promise<Claim[]> {
  const result = await getDocClient().send(
    new QueryCommand({
      TableName: DYNAMODB_CLAIMS_TABLE,
      KeyConditionExpression: "memberId = :m",
      ExpressionAttributeValues: { ":m": memberId },
    }),
  );
  return (result.Items ?? []) as Claim[];
}

/**
 * Lists every member in the members table. Used by the frontend's member
 * picker dropdown. Acceptable for the MVP's ~20 synthetic members; would
 * need pagination at real scale.
 */
export async function listAllMembers(): Promise<Member[]> {
  const result = await getDocClient().send(
    new ScanCommand({
      TableName: DYNAMODB_MEMBERS_TABLE,
    }),
  );
  return (result.Items ?? []) as Member[];
}

/**
 * Persists an agent trace. Traces are append-only: every classification,
 * retrieval, and draft writes a new item rather than mutating an existing
 * one. This is the audit trail the design doc commits to.
 */
export async function putTrace(trace: AgentTrace): Promise<void> {
  await getDocClient().send(
    new PutCommand({
      TableName: DYNAMODB_TRACES_TABLE,
      Item: trace,
    }),
  );
}

/**
 * Returns the most recent `limit` traces sorted by ISO timestamp descending.
 * Implemented as a full `Scan` + client-side sort for MVP simplicity; a
 * production version would add a GSI keyed on a constant partition with
 * timestamp as the sort key.
 */
export async function listRecentTraces(limit: number): Promise<AgentTrace[]> {
  const result = await getDocClient().send(
    new ScanCommand({
      TableName: DYNAMODB_TRACES_TABLE,
    }),
  );
  const items = (result.Items ?? []) as AgentTrace[];
  return items
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
    .slice(0, limit);
}
