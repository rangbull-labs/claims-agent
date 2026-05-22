import { randomUUID } from "node:crypto";

import { HumanMessage } from "@langchain/core/messages";
import { createAgent, modelCallLimitMiddleware } from "langchain";

import { createChatModel } from "./aws/bedrock.js";
import { putTrace } from "./aws/dynamo.js";
import { BEDROCK_MODEL_ID } from "./config.js";
import { resolveMemberScope } from "./middleware/memberScope.js";
import { shouldEscalate } from "./safeguards/escalationGuard.js";
import { getCurrentTrace, withTraceContext } from "./tracing/traceContext.js";
import type { AgentTrace, InquiryClassification } from "./types.js";

// Each "model call" is one turn of the ReAct loop (model proposes tool
// calls, tools run, results return). Four-tool sequence + a small
// buffer for retries gives 6 as a defensive cap.
const MAX_MODEL_CALLS = 6;

export interface AgentResult {
  traceId: string;
  disposition: "draft" | "escalated";
  draftResponse: string | null;
  classification: InquiryClassification | null;
  toolCallCount: number;
  /** Tool names in invocation order — included so the frontend can render the sequence without an extra trace fetch. */
  toolNames: string[];
  durationMs: number;
  escalationReason?: string;
}

const SYSTEM_PROMPT = `You are a health-insurance claims assistant operating under strict safeguards.

You have exactly four tools, in this order:
1. classifyInquiry — classify the member's question into one of (denial_explanation, eob_question, coverage_lookup, claim_status, unknown). Always call this first.
2. lookupClaim — look up the member's claims. You are scoped to the current member; the tool does not accept a memberId argument and will return only this member's data.
3. retrievePolicy — retrieve policy chunks relevant to the inquiry, filtered to the member's plan.
4. draftResponse — record the final response for human review. Call this exactly once, at the end.

For every inquiry, follow this sequence:
1. Call classifyInquiry once. Note the returned intent and confidence.
2. If a specific claim is referenced, call lookupClaim with that claimId. If the inquiry is about claim history, call lookupClaim with date or status filters as appropriate. Note the returned count and the actual claim IDs (if any).
3. Call retrievePolicy with a precise query derived from the classification and the inquiry. Note the chunk count and the source URIs.
4. Call draftResponse with your final response text, the claimIds you cited, the policy chunk source URIs you cited, and your confidence (0-1).

After each tool call, before deciding the next action, restate to yourself what the tool actually returned (the intent, the claim count and IDs, the chunk count and sources). Your next decision must be informed by those concrete values, not by what you assumed the tool would return.

RULES:
- Every factual claim in your draft MUST be grounded in a retrieved policy chunk or a looked-up claim. Cite policy chunks by their source URI and claims by their claimId in the citedPolicyChunks and citedClaimIds arrays.
- Never offer medical advice or make any coverage determination beyond what the retrieved policy explicitly states.
- Never invent claim IDs, dates, dollar amounts, or denial codes. If you don't have evidence, lower your confidence and say so in the draft text.
- Your output is a draft for human review, not a final message to the member. Write in clear plain English at a sixth-grade reading level.
- When you have called draftResponse, the task is complete.

GROUNDING DISCIPLINE:
- Your drafts must reflect what your tools returned, not what they could have returned in a different situation.
- If lookupClaim returned zero matching claims, your draft MUST open with a statement that no matching claims were found in the member's account. Do not refer to denials, denial codes, denial reasons, or specific claim outcomes in that case.
- Policy chunks describe the plan in general. They are not evidence that any specific event has occurred on this member's account. Do not pivot from "the policy says X" to "your claim was X" without a lookupClaim result that backs the second statement.
- If you find yourself drafting an assertion you cannot trace to a specific tool output, stop and revise. Plausibility is not grounding.

PRE-DRAFT CHECKLIST (walk through before calling draftResponse):
- Did lookupClaim return any matching claims? If no → the draft must say so plainly, and must NOT reference denials, denial reasons, or specific claim outcomes.
- Does every claim ID I cite appear in lookupClaim's output? If no → remove the citation.
- Does every plan-coverage assertion I make correspond to a retrievePolicy chunk I actually retrieved? If no → soften the language or remove the assertion.
- When the user's question cannot be answered with confidence from the retrieved data, say so plainly rather than producing plausible-sounding filler.`;

/**
 * Top-level orchestrator for a single agent run. Sequences:
 *
 * 1. Pre-model escalation guard (`shouldEscalate`). On match, persists
 *    an `escalated` trace and returns without invoking any model. The
 *    LLM never sees the inquiry.
 * 2. Member resolution (`resolveMemberScope`) — fetches the member
 *    from DynamoDB and constructs the four tools with `memberId`
 *    captured in each closure. A request for an unknown member throws,
 *    which the Lambda handler surfaces as a 500.
 * 3. LangChain v1 `createAgent` (LangGraph-backed ReAct), wired to
 *    Claude Haiku 4.5 with `modelCallLimitMiddleware({ runLimit: 6 })`
 *    as a defensive cap against runaway loops.
 * 4. The agent is invoked inside `withTraceContext` so every tool
 *    call accumulates on the trace context for persistence.
 * 5. After completion (success or not), the full trace is written to
 *    `claims-agent-AgentTraces` with `disposition: "draft"`.
 *
 * If the agent never calls `draftResponse` (gave up, hit
 * `MAX_MODEL_CALLS`, encountered an error mid-loop), `draftResponse`
 * is returned as `null` but the trace is still persisted so the
 * failure is auditable.
 */
export async function runAgent(
  memberId: string,
  inquiry: string,
): Promise<AgentResult> {
  const startedAt = Date.now();
  const traceId = `tr-${randomUUID()}`;
  const timestamp = new Date(startedAt).toISOString();

  // 1. Deterministic pre-model escalation
  const escalation = shouldEscalate(inquiry);
  if (escalation.escalate && escalation.reason !== null) {
    const reason = escalation.reason;
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "Inquiry escalated by pre-model guard",
        traceId,
        memberId,
        reason,
      }),
    );
    const trace: AgentTrace = {
      traceId,
      timestamp,
      memberId,
      userInquiry: inquiry,
      classification: null,
      toolCalls: [],
      draftResponse: null,
      disposition: "escalated",
      model: BEDROCK_MODEL_ID,
      escalationReason: reason,
    };
    await putTrace(trace);
    return {
      traceId,
      disposition: "escalated",
      draftResponse: null,
      classification: null,
      toolCallCount: 0,
      toolNames: [],
      durationMs: Date.now() - startedAt,
      escalationReason: reason,
    };
  }

  // 2. Resolve member scope (binds memberId into the four tool closures)
  const scope = await resolveMemberScope(memberId);

  // 3. Build the tool-calling agent (LangChain v1)
  const model = createChatModel(BEDROCK_MODEL_ID);
  const tools = [
    scope.tools.classifyInquiry,
    scope.tools.lookupClaim,
    scope.tools.retrievePolicy,
    scope.tools.draftResponse,
  ];

  const agent = createAgent({
    model,
    tools,
    systemPrompt: SYSTEM_PROMPT,
    middleware: [modelCallLimitMiddleware({ runLimit: MAX_MODEL_CALLS })],
  });

  // 4. Invoke inside the trace context
  const execution = await withTraceContext(traceId, scope.memberId, async () => {
    await agent.invoke({ messages: [new HumanMessage(inquiry)] });
    const ctx = getCurrentTrace();
    if (!ctx) {
      throw new Error("Trace context missing after agent invocation");
    }

    const classifyLog = ctx.toolCalls.find((c) => c.toolName === "classifyInquiry");
    const classification =
      (classifyLog?.output as InquiryClassification | undefined) ?? null;

    const draftLog = ctx.toolCalls.find((c) => c.toolName === "draftResponse");
    const draftInput = draftLog?.input as { responseText?: string } | undefined;
    const draftResponse = draftInput?.responseText ?? null;

    return {
      toolCalls: ctx.toolCalls,
      classification,
      draftResponse,
    };
  });

  // 5. Persist the trace
  const trace: AgentTrace = {
    traceId,
    timestamp,
    memberId: scope.memberId,
    userInquiry: inquiry,
    classification: execution.classification,
    toolCalls: execution.toolCalls,
    draftResponse: execution.draftResponse,
    disposition: "draft",
    model: BEDROCK_MODEL_ID,
  };
  await putTrace(trace);

  return {
    traceId,
    disposition: "draft",
    draftResponse: execution.draftResponse,
    classification: execution.classification,
    toolCallCount: execution.toolCalls.length,
    toolNames: execution.toolCalls.map((c) => c.toolName),
    durationMs: Date.now() - startedAt,
  };
}
