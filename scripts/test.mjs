// Runs the tests with node:test. They are written in TypeScript: the compiler type-checks them and writes plain
// JavaScript to .test-build/, which every Node version of the CI matrix can run (no loader, no extra dependency).
//   node scripts/test.mjs                 every test; the integration test is skipped unless its variables are set
//   node scripts/test.mjs --integration   the integration test only
import { spawnSync } from "node:child_process";
import { readdirSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const tsc = createRequire(import.meta.url).resolve("typescript/bin/tsc");
const integrationOnly = process.argv.includes("--integration");

rmSync(`${root}.test-build`, { recursive: true, force: true });
const compiled = spawnSync(process.execPath, [tsc, "-p", "tsconfig.test.json"], { cwd: root, stdio: "inherit" });
if (compiled.status !== 0) process.exit(compiled.status ?? 1);

const files = readdirSync(`${root}.test-build/test`)
  .filter((name) => name.endsWith(".test.js"))
  .filter((name) => !integrationOnly || name === "integration.test.js")
  .map((name) => `.test-build/test/${name}`);

// The readable reporter exists from Node 18.15; older versions keep their default.
const [major = 0, minor = 0] = process.versions.node.split(".").map(Number);
const reporter = major > 18 || (major === 18 && minor >= 15) ? ["--test-reporter=spec"] : [];
const result = spawnSync(process.execPath, ["--test", ...reporter, ...files], { cwd: root, stdio: "inherit" });
process.exit(result.status ?? 1);
