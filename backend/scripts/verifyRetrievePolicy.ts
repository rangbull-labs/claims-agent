import { createRetrievePolicyTool } from "../src/tools/retrievePolicy.js";
import { withTraceContext } from "../src/tracing/traceContext.js";

// M-001 is in the PPO Gold cohort per the deterministic fixture.
const MEMBER_ID = "M-001";
const QUERY = "what is my annual deductible";

async function main(): Promise<void> {
  const result = await withTraceContext("verify-retrieve-policy", MEMBER_ID, async () => {
    const tool = createRetrievePolicyTool(MEMBER_ID);
    return tool.invoke({ query: QUERY });
  });

  console.log(`Member: ${MEMBER_ID}`);
  console.log(`Query: ${QUERY}`);
  console.log(`Filter applied: ${result.filterApplied ?? "<none>"}`);
  console.log(`Chunks returned: ${result.chunks.length}`);
  for (const chunk of result.chunks) {
    const score = chunk.score !== null ? chunk.score.toFixed(3) : "?";
    console.log(`  - ${chunk.sourceUri ?? "<no uri>"} (score=${score})`);
    console.log(`    ${chunk.content.slice(0, 120).replace(/\n/g, " ")}...`);
  }
}

await main();
