import { AsyncLocalStorage } from "node:async_hooks";

import type { ToolCallLog } from "../types.js";

export interface TraceContext {
  traceId: string;
  memberId: string;
  toolCalls: ToolCallLog[];
}

const storage = new AsyncLocalStorage<TraceContext>();

/**
 * Runs `fn` inside a fresh trace context bound to `traceId` and `memberId`.
 * Tool calls appended via `appendToolCall` during `fn`'s execution are
 * accumulated on the returned context and can be retrieved at request
 * end (e.g., for persistence to the `claims-agent-AgentTraces` table).
 */
export async function withTraceContext<T>(
  traceId: string,
  memberId: string,
  fn: () => Promise<T>,
): Promise<T> {
  const ctx: TraceContext = { traceId, memberId, toolCalls: [] };
  return storage.run(ctx, fn);
}

/**
 * Appends a tool-call log entry to the current trace context. If invoked
 * outside `withTraceContext` (e.g., a direct tool call without the
 * surrounding agent loop), the entry is dropped and a warning is logged
 * rather than thrown — tools should remain callable in test harnesses
 * without forcing every caller to set up tracing.
 */
export function appendToolCall(log: ToolCallLog): void {
  const ctx = storage.getStore();
  if (!ctx) {
    console.warn(
      `[traceContext] appendToolCall called outside withTraceContext: ${log.toolName}`,
    );
    return;
  }
  ctx.toolCalls.push(log);
}

/**
 * Returns the current trace context, or `undefined` if called outside
 * `withTraceContext`. Used by the agent loop to read accumulated tool
 * calls at request end and by `draftResponse` to obtain the active
 * trace ID.
 */
export function getCurrentTrace(): TraceContext | undefined {
  return storage.getStore();
}
