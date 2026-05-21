import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
  type RetrievalFilter,
} from "@aws-sdk/client-bedrock-agent-runtime";

import { AWS_REGION, KNOWLEDGE_BASE_ID } from "../config.js";

let agentRuntimeClient: BedrockAgentRuntimeClient | null = null;

/**
 * A single chunk returned from the Bedrock Knowledge Base, normalized into a
 * stable shape the agent and trace logs can rely on. Source attribution is
 * preserved so the draft response can cite the policy it relied on.
 */
export interface PolicyChunk {
  content: string;
  sourceUri: string | null;
  score: number | null;
  metadata: Record<string, unknown>;
}

/**
 * Returns the process-wide singleton `BedrockAgentRuntimeClient`. Constructed
 * lazily so that simply importing this module does not open AWS connections.
 */
export function getAgentRuntimeClient(): BedrockAgentRuntimeClient {
  if (!agentRuntimeClient) {
    agentRuntimeClient = new BedrockAgentRuntimeClient({ region: AWS_REGION });
  }
  return agentRuntimeClient;
}

/**
 * Retrieves up to `numberOfResults` policy chunks from the Bedrock Knowledge
 * Base for the given query. `metadataFilter`, when supplied, is forwarded to
 * Bedrock's vector-search filter. The returned chunks include source URIs
 * and relevance scores so the agent can cite them in its draft.
 *
 * The SDK's raw `RetrieveCommandOutput` is intentionally not exposed —
 * callers receive a stable `PolicyChunk[]` shape regardless of upstream
 * SDK changes.
 */
export async function retrievePolicy(
  query: string,
  numberOfResults: number = 5,
  metadataFilter?: object,
): Promise<PolicyChunk[]> {
  const client = getAgentRuntimeClient();
  const response = await client.send(
    new RetrieveCommand({
      knowledgeBaseId: KNOWLEDGE_BASE_ID,
      retrievalQuery: { text: query },
      retrievalConfiguration: {
        vectorSearchConfiguration: {
          numberOfResults,
          ...(metadataFilter
            ? { filter: metadataFilter as RetrievalFilter }
            : {}),
        },
      },
    }),
  );

  const results = response.retrievalResults ?? [];
  return results.map((chunk): PolicyChunk => {
    const content = chunk.content?.text ?? "";
    const sourceUri = chunk.location?.s3Location?.uri ?? null;
    const score = chunk.score ?? null;
    const metadata = (chunk.metadata ?? {}) as Record<string, unknown>;
    return { content, sourceUri, score, metadata };
  });
}
