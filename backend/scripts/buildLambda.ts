import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(SCRIPT_DIR, "..");
const DIST_DIR = join(BACKEND_DIR, "dist");

await build({
  entryPoints: [join(BACKEND_DIR, "src/index.ts")],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  outfile: join(DIST_DIR, "index.js"),
  // Lambda's Node 20 runtime provides aws-sdk v2 natively; we ship v3
  // and bundle it. No externals.
});

// backend/package.json declares `"type": "module"`, which causes Node
// to treat any `.js` under that tree as ESM. The Lambda bundle is CJS
// (Lambda handlers are most reliable as CJS). Drop a sibling
// package.json inside dist/ to override the parent's `type` for the
// bundle directory only.
writeFileSync(
  join(DIST_DIR, "package.json"),
  `${JSON.stringify({ type: "commonjs" }, null, 2)}\n`,
);

console.log("Bundle ready: dist/index.js");
