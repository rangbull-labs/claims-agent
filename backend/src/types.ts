export interface Member {
  memberId: string;
  planType: string;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  planEffectiveDate: string;
}

export type ClaimStatus = "paid" | "denied" | "pending";

export interface Claim {
  claimId: string;
  memberId: string;
  dateOfService: string;
  providerName: string;
  billedAmount: number;
  allowedAmount: number;
  memberResponsibility: number;
  status: ClaimStatus;
  denialCode?: string;
  denialReason?: string;
}

export interface DenialCode {
  code: string;
  category: string;
  description: string;
  appealable: boolean;
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
  /** Populated when `disposition === "escalated"`; identifies which escalation rule fired. */
  escalationReason?: string;
}
