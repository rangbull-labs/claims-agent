import type { AgentResult, AgentTrace, Member } from "../types";

const rawUrl = import.meta.env.VITE_LAMBDA_URL;
if (!rawUrl) {
  throw new Error(
    "VITE_LAMBDA_URL is not set. Create frontend/.env.local from .env.local.example and set it to the deployed Lambda Function URL.",
  );
}

// Normalize: ensure trailing slash so we can join paths uniformly.
export const LAMBDA_URL: string = rawUrl.endsWith("/") ? rawUrl : `${rawUrl}/`;

async function readJson<T>(res: Response): Promise<T> {
  const text = await res.text();
  if (!res.ok) {
    let message = `${res.status} ${res.statusText}`;
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) message = `${message} — ${parsed.error}`;
    } catch {
      if (text) message = `${message} — ${text}`;
    }
    throw new Error(message);
  }
  return JSON.parse(text) as T;
}

export async function listMembers(): Promise<Member[]> {
  const res = await fetch(`${LAMBDA_URL}members`, { method: "GET" });
  return readJson<Member[]>(res);
}

export async function listTraces(): Promise<AgentTrace[]> {
  const res = await fetch(`${LAMBDA_URL}traces`, { method: "GET" });
  return readJson<AgentTrace[]>(res);
}

export async function sendInquiry(memberId: string, inquiry: string): Promise<AgentResult> {
  const res = await fetch(LAMBDA_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ memberId, inquiry }),
  });
  return readJson<AgentResult>(res);
}
