import { z } from "zod";

import { runAgent } from "./agent.js";
import { listAllMembers, listRecentTraces } from "./aws/dynamo.js";

const bodySchema = z.object({
  memberId: z.string().min(1, "memberId is required"),
  inquiry: z.string().min(1, "inquiry is required"),
});

interface LambdaFunctionURLEvent {
  body?: string;
  rawPath?: string;
  isBase64Encoded?: boolean;
  requestContext?: {
    http?: {
      method?: string;
    };
  };
}

interface LambdaResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

function jsonResponse(statusCode: number, payload: unknown): LambdaResult {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
}

/**
 * Lambda Function URL handler. Routes by `event.requestContext.http.method`
 * and `event.rawPath`:
 *
 *   POST   /        → run the agent (body: { memberId, inquiry })
 *   GET    /members → list every member (for the chat dropdown)
 *   GET    /traces  → list the 50 most recent agent traces (newest first)
 *
 * Anything else → 404.
 *
 * CORS is configured exclusively at the Function URL layer (explicit
 * allowed origins: `https://claims-agent.rangbull-labs.com` and
 * `http://localhost:5173`). The handler does NOT set
 * `Access-Control-Allow-*` or `Vary: Origin` — doing so would produce
 * duplicate headers that Chrome rejects as invalid. The OPTIONS
 * preflight is likewise answered by AWS at the Function URL layer and
 * never reaches this code.
 *
 * Error model:
 *   - Bad input on POST / (zod failure or non-JSON body) → 400 with
 *     `{ error, details }`. The details only describe the shape of the
 *     request, not internal state.
 *   - Anything thrown by a route handler → 500 with a generic
 *     `{ error }` body. Full error is logged to CloudWatch as structured
 *     JSON for the operator to correlate via the trace store.
 */
export async function handler(event: LambdaFunctionURLEvent): Promise<LambdaResult> {
  const method = event.requestContext?.http?.method ?? "GET";
  const path = event.rawPath ?? "/";

  try {
    if (method === "POST" && path === "/") {
      return await handlePostAgent(event);
    }
    if (method === "GET" && path === "/members") {
      const members = await listAllMembers();
      return jsonResponse(200, members);
    }
    if (method === "GET" && path === "/traces") {
      const traces = await listRecentTraces(50);
      return jsonResponse(200, traces);
    }
    return jsonResponse(404, { error: `Route not found: ${method} ${path}` });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(
      JSON.stringify({
        level: "error",
        message: "Request handler failed",
        error: message,
        stack,
        method,
        path,
      }),
    );
    return jsonResponse(500, { error: "Internal server error" });
  }
}

async function handlePostAgent(event: LambdaFunctionURLEvent): Promise<LambdaResult> {
  let rawBody = event.body ?? "{}";
  if (event.isBase64Encoded) {
    rawBody = Buffer.from(rawBody, "base64").toString("utf-8");
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawBody);
  } catch {
    return jsonResponse(400, { error: "Request body must be valid JSON" });
  }

  const validated = bodySchema.safeParse(parsedJson);
  if (!validated.success) {
    return jsonResponse(400, {
      error: "Invalid request body",
      details: validated.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const result = await runAgent(validated.data.memberId, validated.data.inquiry);
  return jsonResponse(200, result);
}
