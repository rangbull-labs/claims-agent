// Mirror of the relevant parts of backend/src/types.ts and the
// AgentResult shape from backend/src/agent.ts. Kept as a hand-maintained
// duplicate rather than a shared workspace package — the surface is
// small and the duplication has a low rate of change.

export interface Member {
  memberId: string;
  planType: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  planEffectiveDate: string;
}

export type InquiryIntent =
  | "denial_explanation"
  | "eob_question"
  | "coverage_lookup"
  | "claim_status"
  | "unknown";

export interface InquiryClassification {
  intent: InquiryIntent;
  confidence: number;
  reasoning: string;
}

export interface ToolCallLog {
  toolName: string;
  input: unknown;
  output: unknown;
  durationMs: number;
  timestamp: string;
}

export type TraceDisposition = "draft" | "escalated" | "approved" | "rejected";

export interface AgentTrace {
  traceId: string;
  timestamp: string;
  memberId: string;
  userInquiry: string;
  classification: InquiryClassification | null;
  toolCalls: ToolCallLog[];
  draftResponse: string | null;
  disposition: TraceDisposition;
  model: string;
  escalationReason?: string;
}

export interface AgentResult {
  traceId: string;
  disposition: "draft" | "escalated";
  draftResponse: string | null;
  classification: InquiryClassification | null;
  toolCallCount: number;
  toolNames: string[];
  durationMs: number;
  escalationReason?: string;
}
