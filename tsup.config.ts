import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

// Stamped into the bundle so `aster-agent --version` can't drift from package.json.
const version: string = JSON.parse(readFileSync("./package.json", "utf8")).version;

// Bundle the CLI (and the server/db/core it pulls in) into a single ESM file.
// Runtime dependencies (hono, better-sqlite3, commander, …) stay external and
// are resolved from node_modules — correct for an npm package.
export default defineConfig({
  entry: ["src/cli/index.ts"],
  outDir: "dist-cli",
  format: ["esm"],
  target: "node20",
  platform: "node",
  clean: true,
  sourcemap: false,
  dts: false,
  splitting: false,
  shims: false,
  define: { __AAC_VERSION__: JSON.stringify(version) },
});
