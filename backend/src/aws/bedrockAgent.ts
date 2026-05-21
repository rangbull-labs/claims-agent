import { BedrockAgentClient } from "@aws-sdk/client-bedrock-agent";

import { AWS_REGION } from "../config.js";

let bedrockAgentClient: BedrockAgentClient | null = null;

/**
 * Returns the process-wide singleton `BedrockAgentClient` — the Bedrock
 * Agent **management** plane (data sources, ingestion jobs, knowledge
 * base definitions). This is distinct from `BedrockAgentRuntimeClient`
 * used in [knowledgeBase.ts](./knowledgeBase.ts) for the runtime
 * `Retrieve` API. Constructed lazily so importing this module does not
 * open AWS connections.
 */
export function getBedrockAgentClient(): BedrockAgentClient {
  if (!bedrockAgentClient) {
    bedrockAgentClient = new BedrockAgentClient({ region: AWS_REGION });
  }
  return bedrockAgentClient;
}
