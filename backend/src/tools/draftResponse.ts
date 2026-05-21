import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { appendToolCall, getCurrentTrace } from "../tracing/traceContext.js";

const inputSchema = z.object({
  responseText: z.string().min(1, "responseText must not be empty"),
  citedClaimIds: z.array(z.string()),
  citedPolicyChunks: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export interface DraftResponseResult {
  traceId: string;
  status: "drafted";
}

/**
 * Factory that produces the `draftResponse` tool bound to a specific
 * `memberId`. Per Section 5 of the design doc, this tool **does not
 * persist** the draft — it signals intent only. The actual write to
 * `claims-agent-AgentTraces` happens at the end of the agent run, when
 * the surrounding handler reads the accumulated trace context and
 * persists a single record with `disposition: "draft"`.
 *
 * Why split the persistence out of the tool: the agent may call
 * `draftResponse` once and then reflect on it, or the surrounding loop
 * may add metadata (the final classification, the full tool-call
 * sequence) that the tool itself cannot see. Centralizing persistence
 * at the loop boundary keeps the trace atomic and the disposition
 * decision in one place.
 *
 * Returns the active `traceId` so the agent (and the caller) can
 * correlate this draft to the persisted record once the loop closes.
 */
export function createDraftResponseTool(memberId: string) {
  // `memberId` is bound for architectural consistency — the trace
  // context already carries the same value, so the closure binding
  // here is symbolic rather than functional.
  void memberId;

  return tool(
    async (input): Promise<DraftResponseResult> => {
      const startedAt = Date.now();
      const timestamp = new Date(startedAt).toISOString();

      const trace = getCurrentTrace();
      const traceId = trace?.traceId ?? "no-trace";
      const result: DraftResponseResult = { traceId, status: "drafted" };

      appendToolCall({
        toolName: "draftResponse",
        input,
        output: result,
        durationMs: Date.now() - startedAt,
        timestamp,
      });

      return result;
    },
    {
      name: "draftResponse",
      description:
        "Signal that you are ready to draft a final response. Provide the response text, the claim IDs you cite, the policy chunk source identifiers you cite, and your confidence (0-1). The draft is persisted by the surrounding agent loop, not by this tool.",
      schema: inputSchema,
    },
  );
}
