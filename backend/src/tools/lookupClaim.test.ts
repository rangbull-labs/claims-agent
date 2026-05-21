import { strict as assert } from "node:assert";
import { test } from "node:test";

import { getCurrentTrace, withTraceContext } from "../tracing/traceContext.js";
import type { ToolCallLog } from "../types.js";
import { createLookupClaimTool, type EnrichedClaim } from "./lookupClaim.js";

interface LookupClaimOutput {
  count: number;
  claimIds: string[];
  scopeViolation: boolean;
  attemptedMemberId?: string;
}

function findLookupLog(toolCalls: readonly ToolCallLog[]): ToolCallLog {
  const log = toolCalls.find((c) => c.toolName === "lookupClaim");
  if (!log) {
    throw new Error("No lookupClaim entry in trace context");
  }
  return log;
}

// These tests hit the live `claims-agent-Claims` table via the seeded
// synthetic data. The fixture assumes:
//   M-001 owns C-0001 .. C-0005
//   M-002 owns C-0006 .. C-0009
// which is the deterministic output of `pnpm generate-data`.

test("lookupClaim returns the matching claim when claimId belongs to the bound member", async () => {
  const { claims, trace } = await withTraceContext(
    "test-trace-positive",
    "M-001",
    async () => {
      const lookupTool = createLookupClaimTool("M-001");
      const r = (await lookupTool.invoke({ claimId: "C-0001" })) as EnrichedClaim[];
      const ctx = getCurrentTrace();
      assert(ctx, "Expected trace context to be present");
      return { claims: r, trace: ctx };
    },
  );

  assert.equal(claims.length, 1, "Expected exactly one claim");
  assert.equal(claims[0]?.claimId, "C-0001");
  assert.equal(claims[0]?.memberId, "M-001");

  const log = findLookupLog(trace.toolCalls);
  const output = log.output as LookupClaimOutput;
  assert.equal(output.scopeViolation, false, "No scope violation expected");
  assert.equal(output.count, 1);
});

test("lookupClaim returns empty AND flags scope violation when claimId belongs to another member", async () => {
  const { claims, trace } = await withTraceContext(
    "test-trace-scope",
    "M-001",
    async () => {
      const lookupTool = createLookupClaimTool("M-001");
      // C-0006 belongs to M-002 per the deterministic fixture.
      const r = (await lookupTool.invoke({ claimId: "C-0006" })) as EnrichedClaim[];
      const ctx = getCurrentTrace();
      assert(ctx, "Expected trace context to be present");
      return { claims: r, trace: ctx };
    },
  );

  assert.equal(claims.length, 0, "Expected empty result for cross-member claim");

  const log = findLookupLog(trace.toolCalls);
  const output = log.output as LookupClaimOutput;
  assert.equal(output.scopeViolation, true, "Expected scopeViolation=true");
  assert.equal(output.attemptedMemberId, "M-002", "Expected attemptedMemberId=M-002");
  assert.equal(output.count, 0);
});

test("lookupClaim listing path returns all bound member's claims", async () => {
  const claims = await withTraceContext(
    "test-trace-list",
    "M-001",
    async () => {
      const lookupTool = createLookupClaimTool("M-001");
      return (await lookupTool.invoke({})) as EnrichedClaim[];
    },
  );

  assert.equal(claims.length, 5, "M-001 should have 5 claims per fixture");
  for (const c of claims) {
    assert.equal(c.memberId, "M-001", "Every returned claim must belong to bound member");
  }
});
