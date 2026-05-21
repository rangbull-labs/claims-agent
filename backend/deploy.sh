#!/usr/bin/env bash
set -euo pipefail

# Resolve to the backend directory regardless of where the script is invoked from.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

FUNCTION_NAME="claims-agent"
REGION="us-east-1"

echo "==> Cleaning previous build artifacts"
rm -rf dist
mkdir -p dist

echo "==> Bundling src/index.ts via esbuild JS API (cjs, node20)"
# Invoked through tsx because pnpm's cmd-shim for esbuild's native binary
# doesn't work in pnpm 11 — see scripts/buildLambda.ts for details.
pnpm exec tsx scripts/buildLambda.ts

echo "==> Zipping bundle"
( cd dist && zip -q function.zip index.js package.json )

echo "==> Uploading to Lambda ($FUNCTION_NAME in $REGION)"
aws lambda update-function-code \
  --function-name "$FUNCTION_NAME" \
  --zip-file fileb://dist/function.zip \
  --region "$REGION"
