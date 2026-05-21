import { S3Client } from "@aws-sdk/client-s3";

import { AWS_REGION } from "../config.js";

let s3Client: S3Client | null = null;

/**
 * Returns the process-wide singleton `S3Client`. Constructed lazily on
 * first call so importing this module does not open AWS connections.
 */
export function getS3Client(): S3Client {
  if (!s3Client) {
    s3Client = new S3Client({ region: AWS_REGION });
  }
  return s3Client;
}
