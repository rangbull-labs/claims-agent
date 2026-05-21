import { z } from "zod";

import { runAgent } from "./agent.js";
import { FRONTEND_ORIGIN } from "./config.js";

const bodySchema = z.object({
  memberId: z.string().min(1, "memberId is required"),
  inquiry: z.string().min(1, "inquiry is required"),
});

interface LambdaFunctionURLEvent {
  body?: string;
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

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": FRONTEND_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
}

function jsonResponse(statusCode: number, payload: unknown): LambdaResult {
  return {
    statusCode,
    headers: corsHeaders(),
    body: JSON.stringify(payload),
  };
}

/**
 * Lambda Function URL handler. Accepts a JSON body
 * `{ memberId: string, inquiry: string }` and returns the result of
 * `runAgent`. CORS headers are derived from the `FRONTEND_ORIGIN` env
 * var so the frontend deployed to Vercel can call this endpoint.
 *
 * Error model:
 *   - Bad input (zod failure or non-JSON body) → 400 with `{ error,
 *     details }`. The details are safe to surface because they only
 *     describe the shape of the request, not internal state.
 *   - Anything thrown by `runAgent` (member not found, AWS errors,
 *     persistence failures) → 500 with a generic `{ error }` message.
 *     The full error is logged to CloudWatch as structured JSON so the
 *     `/traces` page and ops can correlate.
 *   - OPTIONS preflight → 204 with CORS headers only.
 */
export async function handler(event: LambdaFunctionURLEvent): Promise<LambdaResult> {
  const method = event.requestContext?.http?.method;
  if (method === "OPTIONS") {
    return { statusCode: 204, headers: corsHeaders(), body: "" };
  }

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

  try {
    const result = await runAgent(validated.data.memberId, validated.data.inquiry);
    return jsonResponse(200, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    console.error(
      JSON.stringify({
        level: "error",
        message: "Agent invocation failed",
        error: message,
        stack,
        memberId: validated.data.memberId,
      }),
    );
    return jsonResponse(500, { error: "Internal server error" });
  }
}
