import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { getMember } from "../aws/dynamo.js";
import {
  retrievePolicy as kbRetrievePolicy,
  type PolicyChunk,
} from "../aws/knowledgeBase.js";
import { appendToolCall } from "../tracing/traceContext.js";

type PlanFilterValue = "gold-ppo" | "silver-ppo" | "bronze-hmo";

const inputSchema = z.object({
  query: z.string().min(1, "query must not be empty"),
  planType: z.enum(["gold-ppo", "silver-ppo", "bronze-hmo"]).optional(),
});

/**
 * Maps the `Member.planType` prose form ("PPO Gold") to the slug form
 * ("gold-ppo") used as the Bedrock KB metadata filter value. Returns
 * `null` if the member's plan does not correspond to a documented plan
 * — in which case the tool falls back to unfiltered retrieval.
 */
function planTypeToFilterValue(planType: string): PlanFilterValue | null {
  switch (planType) {
    case "PPO Gold":
      return "gold-ppo";
    case "PPO Silver":
      return "silver-ppo";
    case "HMO Bronze":
      return "bronze-hmo";
    default:
      return null;
  }
}

/**
 * Factory that produces the `retrievePolicy` tool bound to a specific
 * `memberId`. The `memberId` is the closure-bound source of authority
 * for which plan's policy chunks are surfaced.
 *
 * If `planType` is supplied in the input, it is used directly. Otherwise
 * the bound member's plan is resolved from DynamoDB and converted to the
 * slug form used as the KB metadata filter (`planType=gold-ppo`, etc.).
 *
 * The KB is expected to have a `planType` metadata attribute attached to
 * each chunk (uploaded as a `<doc>.metadata.json` sidecar during
 * ingestion). If the metadata is not present in the KB, the filter
 * matches nothing and the tool returns an empty list — re-run
 * `ingest-kb` to populate metadata.
 */
export function createRetrievePolicyTool(memberId: string) {
  return tool(
    async (input): Promise<{
      chunks: PolicyChunk[];
      filterApplied: PlanFilterValue | null;
    }> => {
      const startedAt = Date.now();
      const timestamp = new Date(startedAt).toISOString();

      let planFilter: PlanFilterValue | null = input.planType ?? null;
      if (!planFilter) {
        const member = await getMember(memberId);
        if (member) {
          planFilter = planTypeToFilterValue(member.planType);
        }
      }

      const filter = planFilter
        ? { equals: { key: "planType", value: planFilter } }
        : undefined;

      const chunks = await kbRetrievePolicy(input.query, 5, filter);

      appendToolCall({
        toolName: "retrievePolicy",
        input,
        output: {
          chunkCount: chunks.length,
          filterApplied: planFilter,
          sources: chunks.map((c) => c.sourceUri),
        },
        durationMs: Date.now() - startedAt,
        timestamp,
      });

      return { chunks, filterApplied: planFilter };
    },
    {
      name: "retrievePolicy",
      description:
        "Retrieve up to 5 policy chunks relevant to the query. If `planType` is omitted, the filter is derived from the current member's plan. Returns chunks with source filenames so the draft response can cite them.",
      schema: inputSchema,
    },
  );
}
