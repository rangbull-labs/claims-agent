import dotenv from "dotenv";
import { z } from "zod";

if (process.env.NODE_ENV !== "production") {
  dotenv.config();
}

const envSchema = z.object({
  AWS_REGION: z.string().min(1, "AWS_REGION must be set"),
  BEDROCK_MODEL_ID: z.string().min(1, "BEDROCK_MODEL_ID must be set"),
  BEDROCK_EVAL_MODEL_ID: z.string().min(1, "BEDROCK_EVAL_MODEL_ID must be set"),
  BEDROCK_EMBEDDING_MODEL_ID: z.string().min(1, "BEDROCK_EMBEDDING_MODEL_ID must be set"),
  KNOWLEDGE_BASE_ID: z.string().min(1, "KNOWLEDGE_BASE_ID must be set"),
  PINECONE_API_KEY: z.string().optional(),
  DYNAMODB_MEMBERS_TABLE: z.string().min(1, "DYNAMODB_MEMBERS_TABLE must be set"),
  DYNAMODB_CLAIMS_TABLE: z.string().min(1, "DYNAMODB_CLAIMS_TABLE must be set"),
  DYNAMODB_TRACES_TABLE: z.string().min(1, "DYNAMODB_TRACES_TABLE must be set"),
  POLICY_DOCS_BUCKET: z.string().min(1, "POLICY_DOCS_BUCKET must be set"),
  FRONTEND_ORIGIN: z.string().min(1, "FRONTEND_ORIGIN must be set"),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const env = parsed.data;

export const AWS_REGION = env.AWS_REGION;
export const BEDROCK_MODEL_ID = env.BEDROCK_MODEL_ID;
export const BEDROCK_EVAL_MODEL_ID = env.BEDROCK_EVAL_MODEL_ID;
export const BEDROCK_EMBEDDING_MODEL_ID = env.BEDROCK_EMBEDDING_MODEL_ID;
export const KNOWLEDGE_BASE_ID = env.KNOWLEDGE_BASE_ID;
export const PINECONE_API_KEY = env.PINECONE_API_KEY;
export const DYNAMODB_MEMBERS_TABLE = env.DYNAMODB_MEMBERS_TABLE;
export const DYNAMODB_CLAIMS_TABLE = env.DYNAMODB_CLAIMS_TABLE;
export const DYNAMODB_TRACES_TABLE = env.DYNAMODB_TRACES_TABLE;
export const POLICY_DOCS_BUCKET = env.POLICY_DOCS_BUCKET;
export const FRONTEND_ORIGIN = env.FRONTEND_ORIGIN;
