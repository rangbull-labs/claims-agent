import { tool } from "@langchain/core/tools";
import { z } from "zod";

import denialCodesData from "../../data/denialCodes.json" with { type: "json" };
import {
  findClaimByIdUnscoped,
  getClaim,
  listClaimsForMember,
} from "../aws/dynamo.js";
import { appendToolCall } from "../tracing/traceContext.js";
import type { Claim, DenialCode } from "../types.js";

const denialCodeIndex = new Map<string, DenialCode>(
  (denialCodesData as DenialCode[]).map((d) => [d.code, d]),
);

const inputSchema = z.object({
  claimId: z.string().optional(),
  dateOfServiceFrom: z.string().optional(),
  dateOfServiceTo: z.string().optional(),
  status: z.enum(["paid", "denied", "pending"]).optional(),
});

/**
 * A claim with its denial code joined to the corresponding `DenialCode`
 * record. The `denialCodeDetails` field is present only when the claim
 * has a denial code that resolves in the index — paid and pending claims
 * omit the field entirely (per `exactOptionalPropertyTypes`).
 */
export interface EnrichedClaim extends Claim {
  denialCodeDetails?: DenialCode;
}

function enrich(claim: Claim): EnrichedClaim {
  if (!claim.denialCode) return claim;
  const details = denialCodeIndex.get(claim.denialCode);
  if (!details) return claim;
  return { ...claim, denialCodeDetails: details };
}

/**
 * Factory that produces the `lookupClaim` tool bound to a specific
 * `memberId`. The `memberId` is captured in the closure and is the
 * **only** source of authority for which claims this tool returns —
 * the input schema deliberately omits any member parameter so a
 * prompt-injection payload cannot redirect the lookup.
 *
 * Two paths:
 *
 * - **By `claimId`.** An unscoped lookup verifies the claim exists,
 *   then compares its `memberId` to the bound member. A mismatch
 *   returns an empty array *and* flags the trace log with
 *   `scopeViolation: true` so the audit trail captures the attempt.
 * - **By filters.** Lists claims for the bound member, then narrows
 *   client-side by optional `dateOfServiceFrom`, `dateOfServiceTo`,
 *   and `status`.
 *
 * Every returned claim has its denial code joined to the corresponding
 * `DenialCode` record so the agent can cite category, description, and
 * appealability without an extra round-trip.
 */
export function createLookupClaimTool(memberId: string) {
  return tool(
    async (input): Promise<EnrichedClaim[]> => {
      const startedAt = Date.now();
      const timestamp = new Date(startedAt).toISOString();

      let result: EnrichedClaim[] = [];
      let scopeViolation = false;
      let attemptedMemberId: string | null = null;

      if (input.claimId) {
        const claim = await getClaim(input.claimId, memberId);
        if (claim) {
          result = [enrich(claim)];
        } else {
          // Either the claim does not exist OR it belongs to a different
          // member. Disambiguate via an unscoped lookup so we can log
          // the latter as a scope violation.
          const unscoped = await findClaimByIdUnscoped(input.claimId);
          if (unscoped) {
            scopeViolation = true;
            attemptedMemberId = unscoped.memberId;
            console.warn(
              `[scope-violation] lookupClaim bound to ${memberId} attempted claimId=${input.claimId} owned by ${unscoped.memberId}`,
            );
          }
          result = [];
        }
      } else {
        let claims = await listClaimsForMember(memberId);
        if (input.dateOfServiceFrom !== undefined) {
          const from = input.dateOfServiceFrom;
          claims = claims.filter((c) => c.dateOfService >= from);
        }
        if (input.dateOfServiceTo !== undefined) {
          const to = input.dateOfServiceTo;
          claims = claims.filter((c) => c.dateOfService <= to);
        }
        if (input.status !== undefined) {
          const status = input.status;
          claims = claims.filter((c) => c.status === status);
        }
        result = claims.map(enrich);
      }

      appendToolCall({
        toolName: "lookupClaim",
        input,
        output: {
          count: result.length,
          claimIds: result.map((c) => c.claimId),
          scopeViolation,
          ...(attemptedMemberId !== null ? { attemptedMemberId } : {}),
        },
        durationMs: Date.now() - startedAt,
        timestamp,
      });

      return result;
    },
    {
      name: "lookupClaim",
      description:
        "Look up claims for the current member. Pass `claimId` to fetch a single claim, or use `dateOfServiceFrom`/`dateOfServiceTo`/`status` to list filtered claims. Returns claims with denial-code details joined.",
      schema: inputSchema,
    },
  );
}
