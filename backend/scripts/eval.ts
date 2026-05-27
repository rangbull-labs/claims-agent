import { config} from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
config({ path: join(SCRIPT_DIR, "..", "..", ".env") });

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const EVAL_DIR = join(SCRIPT_DIR, "..", "eval");
const RESULTS_DIR = join(EVAL_DIR, "results");
const DOCS_DIR = join(SCRIPT_DIR, "..", "..", "docs");
const DELAY_BETWEEN_RUNS_MS = 2000;
const RETRY_DELAY_MS = 30_000;

interface EvalCase {
  id: string;
  category: string;
  memberId: string;
  inquiry: string;
  expectedDisposition: "draft" | "escalated";
  expectedIntent: string | null;
  expectedToolCallMin: number;
  expectedBehavior?: "no_data_leaked";
  notes: string;
}

interface EvalRunResult {
  caseId: string;
  category: string;
  model: string;
  memberId: string;
  inquiry: string;
  httpStatus: number;
  disposition: string | null;
  intent: string | null;
  confidence: number | null;
  toolCallCount: number | null;
  toolNames: string[];
  draftExcerpt: string | null;
  durationMs: number;
  traceId: string | null;
  escalationReason: string | null;
  responseModel: string | null;
  dispositionMatch: boolean;
  intentMatch: boolean;
  dataIsolationMatch: boolean;
  error: string | null;
}

interface AgentResponse {
  traceId?: string;
  disposition?: string;
  draftResponse?: string | null;
  classification?: { intent?: string; confidence?: number } | null;
  toolCallCount?: number;
  toolNames?: string[];
  durationMs?: number;
  model?: string;
  escalationReason?: string;
  error?: string;
}

const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const DIM = "\x1b[2m";
const BOLD = "\x1b[1m";
const RESET = "\x1b[0m";

function resolveUrl(): string {
  const env = process.env.FUNCTION_URL;
  if (env && env.length > 0) return env.endsWith("/") ? env : `${env}/`;
  console.error(`${RED}Missing FUNCTION_URL.${RESET} Set it as an env var.`);
  process.exit(2);
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function runOneCase(
  url: string,
  c: EvalCase,
  modelLabel: "haiku" | "sonnet",
): Promise<EvalRunResult> {
  const queryParam = modelLabel === "sonnet" ? "?model=sonnet" : "";
  const startedAt = Date.now();
  let httpStatus = 0;
  let body: AgentResponse = {};
  let error: string | null = null;

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url + queryParam, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ memberId: c.memberId, inquiry: c.inquiry }),
      });
      httpStatus = res.status;

      if (res.status === 429) {
        console.warn(
          `  ${YELLOW}429 rate limited — waiting ${RETRY_DELAY_MS / 1000}s before retry${RESET}`,
        );
        await sleep(RETRY_DELAY_MS);
        continue;
      }

      body = (await res.json()) as AgentResponse;
      error = null;
      break;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      if (attempt === 0) {
        console.warn(`  ${YELLOW}Fetch error — retrying in ${RETRY_DELAY_MS / 1000}s${RESET}`);
        await sleep(RETRY_DELAY_MS);
      }
    }
  }

  const durationMs = Date.now() - startedAt;
  const disposition = body.disposition ?? null;
  const intent = body.classification?.intent ?? null;
  const confidence = body.classification?.confidence ?? null;

  const dispositionMatch = disposition === c.expectedDisposition;
  const intentMatch =
    c.expectedIntent === null
      ? (disposition === "escalated" ? disposition === "escalated" : disposition === "draft" )
      : intent === c.expectedIntent;

  let dataIsolationMatch = true;
  if (c.expectedBehavior === "no_data_leaked") {
    if (intent === "cross_member_refusal") {
      dataIsolationMatch = true;
    } else if (body.draftResponse) {
      const noClaimPhrases = [
        "not found",
        "no matching",
        "no claim",
        "couldn't find",
        "could not find",
        "doesn't exist",
        "does not exist",
        "no record",
        "did not find",
        "unable to find",
        "was not able to find",
      ];
      const responseText = body.draftResponse.toLowerCase();
      dataIsolationMatch = noClaimPhrases.some((phrase) => responseText.includes(phrase));
    } else {
      dataIsolationMatch = true;
    }
  }

  return {
    caseId: c.id,
    category: c.category,
    model: modelLabel,
    memberId: c.memberId,
    inquiry: c.inquiry,
    httpStatus,
    disposition,
    intent,
    confidence,
    toolCallCount: body.toolCallCount ?? null,
    toolNames: body.toolNames ?? [],
    draftExcerpt: body.draftResponse
      ? body.draftResponse.slice(0, 500)
      : null,
    durationMs,
    traceId: body.traceId ?? null,
    escalationReason: body.escalationReason ?? null,
    responseModel: body.model ?? null,
    dispositionMatch,
    intentMatch,
    dataIsolationMatch,
    error,
  };
}

function generateReport(
  results: EvalRunResult[],
  cases: EvalCase[],
  timestamp: string,
): string {
  const haiku = results.filter((r) => r.model === "haiku");
  const sonnet = results.filter((r) => r.model === "sonnet");

  function stats(rs: EvalRunResult[]) {
    const successful = rs.filter((r) => r.error === null);
    const durations = successful.map((r) => r.durationMs).sort((a, b) => a - b);
    const avg = durations.length > 0 ? Math.round(durations.reduce((s, d) => s + d, 0) / durations.length) : 0;
    const p50 = durations[Math.floor(durations.length * 0.5)] ?? 0;
    const p95 = durations[Math.floor(durations.length * 0.95)] ?? 0;
    const dispMatch = successful.filter((r) => r.dispositionMatch).length;
    const intentMatch = successful.filter((r) => r.intentMatch).length;
    return {
      total: rs.length,
      successful: successful.length,
      avgLatency: avg,
      p50Latency: p50,
      p95Latency: p95,
      dispositionMatchRate: successful.length > 0 ? ((dispMatch / successful.length) * 100).toFixed(1) : "0.0",
      intentMatchRate: successful.length > 0 ? ((intentMatch / successful.length) * 100).toFixed(1) : "0.0",
    };
  }

  const hStats = stats(haiku);
  const sStats = stats(sonnet);

  const categories = [...new Set(cases.map((c) => c.category))];

  function catStats(rs: EvalRunResult[], cat: string) {
    const catRs = rs.filter((r) => r.category === cat && r.error === null);
    const passed = catRs.filter((r) => r.dispositionMatch && r.intentMatch && r.dataIsolationMatch).length;
    const avgLatency = catRs.length > 0 ? Math.round(catRs.reduce((s, r) => s + r.durationMs, 0) / catRs.length) : 0;
    const confs = catRs.map((r) => r.confidence).filter((c): c is number => c !== null);
    const avgConf = confs.length > 0 ? (confs.reduce((s, c) => s + c, 0) / confs.length).toFixed(2) : "—";
    return { n: catRs.length, passed, avgLatency, avgConf };
  }

  let md = `# Eval report: claims-agent v1

## Setup

- **Date:** ${timestamp}
- **Cases:** ${cases.length} across ${categories.length} categories
- **Total runs:** ${results.length} (${cases.length} × 2 models)
- **Models compared:**
  - Haiku 4.5 (\`us.anthropic.claude-haiku-4-5-20251001-v1:0\`) — production model
  - Sonnet 4.5 (\`us.anthropic.claude-sonnet-4-5-20250929-v1:0\`) — comparison model
- **Methodology:** Each case sent to the deployed Lambda Function URL. Haiku runs use the default model; Sonnet runs use \`?model=sonnet\`. Same system prompt, same tools, same escalation guard.

## Headline numbers

| Metric | Haiku 4.5 | Sonnet 4.5 |
| --- | --- | --- |
| Total runs | ${hStats.total} | ${sStats.total} |
| Successful | ${hStats.successful} | ${sStats.successful} |
| Avg latency | ${hStats.avgLatency}ms | ${sStats.avgLatency}ms |
| p50 latency | ${hStats.p50Latency}ms | ${sStats.p50Latency}ms |
| p95 latency | ${hStats.p95Latency}ms | ${sStats.p95Latency}ms |
| Disposition match | ${hStats.dispositionMatchRate}% | ${sStats.dispositionMatchRate}% |
| Intent match | ${hStats.intentMatchRate}% | ${sStats.intentMatchRate}% |

## Per-category breakdown

`;

  for (const cat of categories) {
    const hc = catStats(haiku, cat);
    const sc = catStats(sonnet, cat);
    md += `### ${cat}

| Metric | Haiku 4.5 | Sonnet 4.5 |
| --- | --- | --- |
| Passed (disp + intent) | ${hc.passed}/${hc.n} | ${sc.passed}/${sc.n} |
| Avg latency | ${hc.avgLatency}ms | ${sc.avgLatency}ms |
| Avg confidence | ${hc.avgConf} | ${sc.avgConf} |

`;
  }

  md += `## Cost estimate

Based on approximate token usage per agent run (~12k input + 2k output tokens):

| Model | Per-run cost | 30-run eval cost | Per-1000-inquiries |
| --- | --- | --- | --- |
| Haiku 4.5 | ~$0.025 | ~$0.75 | ~$25 |
| Sonnet 4.5 | ~$0.105 | ~$3.15 | ~$105 |

Total eval run: ~$3.90 (both models combined).

Haiku is ~4× cheaper per inquiry. Whether the accuracy delta justifies Sonnet depends on the per-category results above and manual grading below.

## Notable findings

_Fill in after manual grading of the run results:_

- [ ] Haiku struggled with: _(specific case IDs and what went wrong)_
- [ ] Sonnet caught edge case: _(specific case IDs where Sonnet outperformed)_
- [ ] Both models exhibited: _(shared failure modes, if any)_
- [ ] Grounding discipline held: _(did denial_002 / denial_005 pass for both models?)_

## Conclusion

_Fill in after grading:_

_(Does the eval data justify keeping Haiku 4.5 as the production model at its 4× cost advantage? Or does Sonnet's accuracy on specific categories warrant the cost increase for certain use cases?)_
`;

  return md;
}

async function main(): Promise<void> {
  const url = resolveUrl();
  const cases = JSON.parse(readFileSync(join(EVAL_DIR, "cases.json"), "utf-8")) as EvalCase[];
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);

  mkdirSync(RESULTS_DIR, { recursive: true });

  console.log(`${BOLD}Running eval: ${cases.length} cases × 2 models = ${cases.length * 2} runs${RESET}`);
  console.log(`Target: ${url}\n`);

  const results: EvalRunResult[] = [];
  const models: Array<"haiku" | "sonnet"> = ["haiku", "sonnet"];
  let runIndex = 0;
  const totalRuns = cases.length * models.length;

  for (const c of cases) {
    for (const modelLabel of models) {
      runIndex++;
      process.stdout.write(
        `${DIM}[${String(runIndex).padStart(2)}/${totalRuns}]${RESET} ${c.id} / ${modelLabel} ... `,
      );

      const result = await runOneCase(url, c, modelLabel);
      results.push(result);

      const status = result.dispositionMatch
        ? `${GREEN}${result.disposition}${RESET}`
        : `${RED}${result.disposition} (expected ${c.expectedDisposition})${RESET}`;
      const latency = `${(result.durationMs / 1000).toFixed(1)}s`;

      console.log(`${status} ${DIM}${latency}${RESET}`);

      if (result.error) {
        console.log(`  ${RED}error: ${result.error}${RESET}`);
      }

      if (runIndex < totalRuns) {
        await sleep(DELAY_BETWEEN_RUNS_MS);
      }
    }
  }

  const resultsPath = join(RESULTS_DIR, `run-${timestamp}.json`);
  writeFileSync(resultsPath, `${JSON.stringify(results, null, 2)}\n`);
  console.log(`\n${GREEN}Results written: ${resultsPath}${RESET}`);

  const reportPath = join(DOCS_DIR, "EVAL_REPORT.md");
  const report = generateReport(results, cases, timestamp);
  writeFileSync(reportPath, report);
  console.log(`${GREEN}Report written: ${reportPath}${RESET}`);

  const failures = results.filter((r) => r.error !== null);
  const mismatches = results.filter((r) => !r.dispositionMatch || !r.intentMatch);
  console.log(`\n${BOLD}Summary${RESET}`);
  console.log(`  Total: ${results.length} runs`);
  console.log(`  Errors: ${failures.length}`);
  console.log(`  Disposition/intent mismatches: ${mismatches.length}`);

  if (failures.length > 0) {
    console.log(`\n${RED}${failures.length} runs had errors — check results JSON for details.${RESET}`);
  }
}

await main();
