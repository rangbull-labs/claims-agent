import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { QueryCommand } from "@aws-sdk/lib-dynamodb";

import { getDocClient } from "../../src/aws/dynamo.js";
import { DYNAMODB_TRACES_TABLE } from "../../src/config.js";
import type { AgentTrace } from "../../src/types.js";

interface ExpectBlock {
  httpStatus?: number;
  disposition?: "draft" | "escalated";
  /** Strict equality on the agent's total tool-call count. Use sparingly — see `minToolCallCount`. */
  toolCallCount?: number;
  /**
   * Minimum tool-call count. Prefer this over `toolCallCount` for happy-path
   * cases: the agent is allowed to make extra verification calls beyond the
   * four-step minimum (e.g., a second lookupClaim to confirm before drafting),
   * which is desirable behavior but defeats strict equality.
   */
  minToolCallCount?: number;
  minConfidence?: number;
  draftResponseNotNull?: boolean;
  draftResponseMustNotContain?: string[];
  draftResponseShouldContain?: string[];
  toolCallsContainScopeViolation?: boolean;
  maxDurationMs?: number;
  /**
   * Marks a case as a known, documented gap (e.g., a grounding-fidelity
   * failure tracked in DESIGN_DECISIONS.md). When set:
   *   - if assertions fail, the case is rendered as "KNOWN FAIL" in yellow
   *     and does NOT count toward the suite's exit-code failure total.
   *   - if assertions pass (i.e., the gap was fixed), the case is rendered
   *     as "PASS (was known-failing)" in green and counts as a normal pass.
   */
  knownFailing?: boolean;
}

interface IntegrationCase {
  id: string;
  description: string;
  memberId: string;
  inquiry: string;
  expect: ExpectBlock;
}

interface AgentResponseShape {
  traceId?: string;
  disposition?: string;
  draftResponse?: string | null;
  classification?: {
    intent?: string;
    confidence?: number;
    reasoning?: string;
  } | null;
  toolCallCount?: number;
  durationMs?: number;
  escalationReason?: string;
  error?: string;
}

interface CaseResult {
  caseId: string;
  pass: boolean;
  knownFailing: boolean;
  durationMs: number;
  failures: string[];
}

const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";

/**
 * Renders the (pass, knownFailing) combination into a colored status
 * label and a matching color for the failure-detail bullets. Four cases:
 *
 *   pass=true,  known=false → green "PASS"
 *   pass=true,  known=true  → green "PASS (was known-failing)"  (gap fixed)
 *   pass=false, known=true  → yellow "KNOWN FAIL"               (expected gap)
 *   pass=false, known=false → red "FAIL"                        (real regression)
 */
function renderStatus(pass: boolean, knownFailing: boolean): {
  label: string;
  bulletColor: string;
} {
  if (pass && !knownFailing) return { label: `${GREEN}PASS${RESET}`, bulletColor: GREEN };
  if (pass && knownFailing) {
    return { label: `${GREEN}PASS (was known-failing)${RESET}`, bulletColor: GREEN };
  }
  if (!pass && knownFailing) return { label: `${YELLOW}KNOWN FAIL${RESET}`, bulletColor: YELLOW };
  return { label: `${RED}FAIL${RESET}`, bulletColor: RED };
}

function shortStatus(pass: boolean, knownFailing: boolean): string {
  if (pass && !knownFailing) return `${GREEN}PASS${RESET}`;
  if (pass && knownFailing) return `${GREEN}PASS*${RESET}`;
  if (!pass && knownFailing) return `${YELLOW}KNOWN FAIL${RESET}`;
  return `${RED}FAIL${RESET}`;
}

function resolveUrl(): string {
  const flag = process.argv.find((a) => a.startsWith("--url="));
  if (flag) return flag.slice("--url=".length);
  const env = process.env.FUNCTION_URL;
  if (env && env.length > 0) return env;
  console.error(
    `${RED}Missing FUNCTION_URL.${RESET} Pass it via env var (FUNCTION_URL=https://... pnpm test:integration) or CLI flag (--url=https://...).`,
  );
  process.exit(2);
}

function visibleLength(s: string): number {
  return s.replace(/\x1b\[[0-9;]*m/g, "").length;
}

function padVisible(s: string, len: number): string {
  const visible = visibleLength(s);
  return visible >= len ? s : s + " ".repeat(len - visible);
}

/**
 * Fetches a persisted trace from DynamoDB by `traceId`. The Traces table
 * uses a composite key `(traceId, timestamp)` but each agent run writes a
 * single item, so a `Query` keyed on `traceId` with `Limit: 1` is enough.
 * `ConsistentRead: true` defends against the (rare) case where the trace
 * was just written and eventual-consistency hasn't caught up.
 */
async function fetchTrace(traceId: string): Promise<AgentTrace | null> {
  const result = await getDocClient().send(
    new QueryCommand({
      TableName: DYNAMODB_TRACES_TABLE,
      KeyConditionExpression: "traceId = :t",
      ExpressionAttributeValues: { ":t": traceId },
      Limit: 1,
      ConsistentRead: true,
    }),
  );
  const items = (result.Items ?? []) as AgentTrace[];
  return items[0] ?? null;
}

function toolCallHasScopeViolation(trace: AgentTrace): boolean {
  return trace.toolCalls.some((tc) => {
    const out = tc.output;
    return (
      typeof out === "object" &&
      out !== null &&
      (out as { scopeViolation?: unknown }).scopeViolation === true
    );
  });
}

async function runCase(url: string, c: IntegrationCase): Promise<CaseResult> {
  const start = Date.now();
  const failures: string[] = [];
  const knownFailing = c.expect.knownFailing === true;

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberId: c.memberId, inquiry: c.inquiry }),
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      caseId: c.id,
      pass: false,
      knownFailing,
      durationMs: Date.now() - start,
      failures: [`fetch failed: ${msg}`],
    };
  }

  const durationMs = Date.now() - start;
  let body: AgentResponseShape;
  try {
    body = (await res.json()) as AgentResponseShape;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      caseId: c.id,
      pass: false,
      knownFailing,
      durationMs,
      failures: [`response body was not valid JSON: ${msg}`],
    };
  }

  const e = c.expect;

  if (e.httpStatus !== undefined && res.status !== e.httpStatus) {
    failures.push(`httpStatus: expected ${e.httpStatus}, got ${res.status}`);
  }
  if (e.disposition !== undefined && body.disposition !== e.disposition) {
    failures.push(`disposition: expected "${e.disposition}", got "${body.disposition}"`);
  }
  if (e.toolCallCount !== undefined && body.toolCallCount !== e.toolCallCount) {
    failures.push(`toolCallCount: expected ${e.toolCallCount}, got ${body.toolCallCount}`);
  }
  if (e.minToolCallCount !== undefined) {
    const actual = body.toolCallCount;
    if (actual === undefined || actual < e.minToolCallCount) {
      failures.push(
        `minToolCallCount: expected >= ${e.minToolCallCount}, got ${actual ?? "<undefined>"}`,
      );
    }
  }
  if (e.minConfidence !== undefined) {
    const conf = body.classification?.confidence;
    if (conf === undefined || conf < e.minConfidence) {
      failures.push(
        `classification.confidence: expected >= ${e.minConfidence}, got ${conf ?? "<undefined>"}`,
      );
    }
  }
  if (e.draftResponseNotNull !== undefined) {
    const isNotNull = body.draftResponse !== null && body.draftResponse !== undefined;
    if (isNotNull !== e.draftResponseNotNull) {
      failures.push(
        `draftResponseNotNull: expected ${e.draftResponseNotNull}, got ${isNotNull}`,
      );
    }
  }
  if (e.draftResponseMustNotContain && e.draftResponseMustNotContain.length > 0) {
    const text = (body.draftResponse ?? "").toLowerCase();
    for (const forbidden of e.draftResponseMustNotContain) {
      if (text.includes(forbidden.toLowerCase())) {
        failures.push(`draftResponseMustNotContain: forbidden phrase appeared: "${forbidden}"`);
      }
    }
  }
  if (e.draftResponseShouldContain && e.draftResponseShouldContain.length > 0) {
    const text = (body.draftResponse ?? "").toLowerCase();
    const found = e.draftResponseShouldContain.some((s) => text.includes(s.toLowerCase()));
    if (!found) {
      failures.push(
        `draftResponseShouldContain: none of [${e.draftResponseShouldContain
          .map((s) => `"${s}"`)
          .join(", ")}] appeared in draft`,
      );
    }
  }
  if (e.toolCallsContainScopeViolation !== undefined) {
    if (!body.traceId) {
      failures.push("toolCallsContainScopeViolation: response had no traceId to look up");
    } else {
      try {
        const trace = await fetchTrace(body.traceId);
        if (!trace) {
          failures.push(
            `toolCallsContainScopeViolation: trace ${body.traceId} not found in DynamoDB`,
          );
        } else {
          const has = toolCallHasScopeViolation(trace);
          if (has !== e.toolCallsContainScopeViolation) {
            failures.push(
              `toolCallsContainScopeViolation: expected ${e.toolCallsContainScopeViolation}, got ${has}`,
            );
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        failures.push(`toolCallsContainScopeViolation: trace lookup failed: ${msg}`);
      }
    }
  }
  if (e.maxDurationMs !== undefined && durationMs > e.maxDurationMs) {
    failures.push(`durationMs: expected <= ${e.maxDurationMs}, got ${durationMs}`);
  }

  return { caseId: c.id, pass: failures.length === 0, knownFailing, durationMs, failures };
}

async function main(): Promise<void> {
  const url = resolveUrl();
  const here = dirname(fileURLToPath(import.meta.url));
  const cases = JSON.parse(
    readFileSync(join(here, "cases.json"), "utf-8"),
  ) as IntegrationCase[];

  console.log(`Running ${cases.length} integration cases against ${url}\n`);

  const results: CaseResult[] = [];
  for (const c of cases) {
    process.stdout.write(`  ${c.id} ... `);
    const r = await runCase(url, c);
    results.push(r);
    const { label, bulletColor } = renderStatus(r.pass, r.knownFailing);
    console.log(`${label} ${DIM}(${r.durationMs}ms)${RESET}`);
    for (const f of r.failures) {
      console.log(`    ${bulletColor}✗${RESET} ${f}`);
    }
  }

  console.log("");
  console.log(`${BOLD}Summary${RESET}`);
  const idCol = Math.max(...results.map((r) => r.caseId.length), "case id".length);
  const statusCol = "KNOWN FAIL".length;
  const durationCol = "duration".length;
  console.log(
    `${padVisible("case id", idCol)}  ${padVisible("status", statusCol)}  ${padVisible("duration", durationCol)}  notes`,
  );
  console.log("-".repeat(idCol + 2 + statusCol + 2 + durationCol + 2 + "known-failing gap".length));
  for (const r of results) {
    const note = r.knownFailing ? "known-failing gap" : "";
    console.log(
      `${padVisible(r.caseId, idCol)}  ${padVisible(shortStatus(r.pass, r.knownFailing), statusCol)}  ${padVisible(`${r.durationMs}ms`, durationCol)}  ${note}`,
    );
  }

  const unexpectedFailures = results.filter((r) => !r.pass && !r.knownFailing).length;
  const knownFailures = results.filter((r) => !r.pass && r.knownFailing).length;
  const passed = results.filter((r) => r.pass).length;

  console.log("");
  if (unexpectedFailures === 0 && knownFailures === 0) {
    console.log(`${GREEN}${BOLD}All ${results.length} cases passed.${RESET}`);
  } else if (unexpectedFailures === 0) {
    console.log(
      `${YELLOW}${BOLD}${passed} passed, ${knownFailures} known-failing (no unexpected regressions).${RESET}`,
    );
  } else {
    const parts = [`${unexpectedFailures} unexpected failure${unexpectedFailures === 1 ? "" : "s"}`];
    if (knownFailures > 0) parts.push(`${knownFailures} known-failing`);
    parts.push(`${passed} passed`);
    console.log(`${RED}${BOLD}${parts.join(", ")} (of ${results.length}).${RESET}`);
    process.exit(1);
  }
}

await main();
