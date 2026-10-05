// Proves that the built package works for both kinds of user. Run `npm run build` first.
//   1. `import` of the package from an ES module, executed;
//   2. `require` of the package from a CommonJS file, executed;
//   3. the type declarations resolve and check for an ES module (.mts) and a CommonJS file (.cts) under module "node16".
// The package is loaded by its own name (self-reference through the "exports" of package.json), exactly the entry
// points a user gets after `npm install`.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");

if (!existsSync(`${root}dist/esm/index.js`) || !existsSync(`${root}dist/cjs/index.js`)) {
  console.error("dist/ is missing: run `npm run build` first.");
  process.exit(1);
}

function run(label, args) {
  const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
  process.stdout.write(result.stdout);
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    console.error(`FAILED: ${label}`);
    process.exit(result.status ?? 1);
  }
}

run("import (ESM)", ["scripts/smoke/esm.mjs"]);
run("require (CommonJS)", ["scripts/smoke/cjs.cjs"]);
run("type declarations (node16: .mts and .cts)", [tsc, "-p", "scripts/smoke/types/tsconfig.json"]);
console.log("Type declarations ok: the `import` and `require` conditions both resolve and type-check");
