import { BedrockRuntimeClient } from "@aws-sdk/client-bedrock-runtime";
import { ChatBedrockConverse } from "@langchain/aws";

import { AWS_REGION } from "../config.js";

let bedrockClient: BedrockRuntimeClient | null = null;

/**
 * Returns the process-wide singleton `BedrockRuntimeClient`.
 *
 * Constructed lazily on first call so importing this module does not open
 * AWS connections. Reuse across Lambda invocations is intentional — the
 * SDK client maintains keep-alive connections that warm up over time.
 */
export function getBedrockClient(): BedrockRuntimeClient {
  if (!bedrockClient) {
    bedrockClient = new BedrockRuntimeClient({ region: AWS_REGION });
  }
  return bedrockClient;
}

/**
 * Constructs a LangChain `ChatBedrockConverse` instance bound to the given
 * Bedrock model ID. A fresh instance is returned per call — LangChain chat
 * models can carry per-invocation state (callbacks, tool bindings), so they
 * are not memoized.
 */
export function createChatModel(modelId: string): ChatBedrockConverse {
  return new ChatBedrockConverse({
    model: modelId,
    region: AWS_REGION,
  });
}
