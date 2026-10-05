import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import * as sdk from "../src/index.js";

// The tests run from .test-build/test, so the package root is two levels up.
const root = path.resolve(__dirname, "..", "..");
const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8")) as {
  version: string;
  dependencies?: unknown;
  engines: { node: string };
  devDependencies: Record<string, string>;
};

describe("package", () => {
  it("VERSION is the version of package.json (0.1.0)", () => {
    assert.equal(sdk.VERSION, manifest.version);
    assert.equal(manifest.version, "0.1.0");
  });

  it("has no runtime dependency, Node 18+, and only typescript and @types/node for development", () => {
    assert.equal(manifest.dependencies, undefined);
    assert.equal(manifest.engines.node, ">=18");
    assert.deepEqual(Object.keys(manifest.devDependencies).sort(), ["@types/node", "typescript"]);
  });

  it("exports GameCoin, ext, GameCoinError, ErrorCode and VERSION", () => {
    assert.deepEqual(Object.keys(sdk).sort(), ["DEFAULT_BASE_URL", "DEFAULT_MAX_RETRIES", "DEFAULT_TIMEOUT_MS", "ErrorCode", "GameCoin", "GameCoinError", "VERSION", "ext"]);
  });

  it("the client exposes the resources of the specification", () => {
    const gamecoin = new sdk.GameCoin(`gc_sk_test_${"x".repeat(30)}`);
    for (const resource of ["catalog", "players", "wallet", "ledger", "inventory", "purchases", "checkouts", "orders"] as const) {
      assert.equal(typeof gamecoin[resource], "object", resource);
    }
    const methods = {
      catalog: ["get"],
      players: ["upsert", "get", "createToken"],
      wallet: ["get", "grant", "spend"],
      ledger: ["list", "iterate"],
      inventory: ["list", "grant", "consume"],
      purchases: ["create"],
      checkouts: ["create"],
      orders: ["get", "refund"],
    } as const;
    for (const [resource, names] of Object.entries(methods)) {
      for (const name of names) assert.equal(typeof (gamecoin as unknown as Record<string, Record<string, unknown>>)[resource]?.[name], "function", `${resource}.${name}`);
    }
  });
});
