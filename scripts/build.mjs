// Builds dist/: an ES module build (dist/esm) and a CommonJS build (dist/cjs), each with its own type declarations.
// Only the TypeScript compiler is needed. A tiny package.json in each folder tells Node how to read its .js files.
import { spawnSync } from "node:child_process";
import { rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");

rmSync(`${root}dist`, { recursive: true, force: true });

for (const config of ["tsconfig.esm.json", "tsconfig.cjs.json"]) {
  const result = spawnSync(process.execPath, [tsc, "-p", config], { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

writeFileSync(`${root}dist/esm/package.json`, `${JSON.stringify({ type: "module" })}\n`);
writeFileSync(`${root}dist/cjs/package.json`, `${JSON.stringify({ type: "commonjs" })}\n`);
console.log("Built dist/esm and dist/cjs");
