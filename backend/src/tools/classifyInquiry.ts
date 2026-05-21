import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

import { createChatModel } from "../aws/bedrock.js";
import { BEDROCK_MODEL_ID } from "../config.js";
import { appendToolCall } from "../tracing/traceContext.js";
import type { InquiryClassification } from "../types.js";

const inputSchema = z.object({
  inquiry: z.string().min(1, "inquiry must not be empty"),
});

const classificationSchema = z.object({
  intent: z.enum([
    "denial_explanation",
    "eob_question",
    "coverage_lookup",
    "claim_status",
    "unknown",
  ]),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

const SYSTEM_PROMPT = `You are an inquiry classifier for a health-insurance claims assistant.

Classify the member's inquiry into exactly one of these intents:
- "denial_explanation": questions about why a claim was denied
- "eob_question": questions about explanation of benefits, payment amounts, coinsurance
- "coverage_lookup": questions about whether a service is covered, plan benefits, exclusions
- "claim_status": questions about the status of a specific claim (paid, pending, denied)
- "unknown": anything else, or genuinely ambiguous inquiries

Return your classification with a calibrated confidence score (0-1) and one or two sentences of reasoning. Reserve confidence >= 0.85 for unambiguous cases.`;

/**
 * Factory that produces the `classifyInquiry` tool, pre-bound to a
 * specific `memberId` for trace-log consistency. The tool does not
 * consult the `memberId` at runtime — classification is member-agnostic —
 * but the factory signature is uniform with the other three tool
 * factories so that the agent's tool-binding contract is identical
 * across the four tools.
 *
 * The tool invokes Claude Haiku 4.5 via Bedrock with `withStructuredOutput`,
 * which constrains the model to return a value matching the
 * `classificationSchema` exactly. A parsing failure returns an
 * `"unknown"` intent with confidence 0 rather than throwing, so the
 * agent loop can continue gracefully.
 */
export function createClassifyInquiryTool(memberId: string) {
  // `memberId` is bound for architectural consistency; classification is
  // member-agnostic, so the value is recorded in the trace via the
  // ambient context rather than consulted directly here.
  void memberId;

  return tool(
    async (input): Promise<InquiryClassification> => {
      const startedAt = Date.now();
      const timestamp = new Date(startedAt).toISOString();

      let result: InquiryClassification;
      try {
        const model = createChatModel(BEDROCK_MODEL_ID);
        const structured = model.withStructuredOutput(classificationSchema, {
          name: "classification",
        });
        result = await structured.invoke([
          new SystemMessage(SYSTEM_PROMPT),
          new HumanMessage(input.inquiry),
        ]);
      } catch (err) {
        result = {
          intent: "unknown",
          confidence: 0,
          reasoning: `Classifier error: ${err instanceof Error ? err.message : String(err)}`,
        };
      }

      appendToolCall({
        toolName: "classifyInquiry",
        input,
        output: result,
        durationMs: Date.now() - startedAt,
        timestamp,
      });

      return result;
    },
    {
      name: "classifyInquiry",
      description:
        "Classify the member's inquiry into one of: denial_explanation, eob_question, coverage_lookup, claim_status, unknown. Returns intent, confidence (0-1), and a short reasoning string.",
      schema: inputSchema,
    },
  );
}
