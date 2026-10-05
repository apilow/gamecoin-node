// Run by scripts/check-package.mjs: the built package, loaded with `import` the way a user's ES module does it.
import assert from "node:assert/strict";
import { ErrorCode, GameCoin, GameCoinError, VERSION, ext } from "@apilow/gamecoin";
import * as namespace from "@apilow/gamecoin";

assert.deepEqual(Object.keys(namespace).sort(), ["DEFAULT_BASE_URL", "DEFAULT_MAX_RETRIES", "DEFAULT_TIMEOUT_MS", "ErrorCode", "GameCoin", "GameCoinError", "VERSION", "ext"]);
assert.equal(typeof GameCoin, "function");
assert.equal(ext("user-42"), "ext:user-42");
assert.equal(ErrorCode.INSUFFICIENT_FUNDS, "INSUFFICIENT_FUNDS");

// A full round trip through the built code, with a fake transport.
const calls = [];
const key = `gc_sk_test_${"E".repeat(30)}`;
const gamecoin = new GameCoin(key, {
  baseUrl: "https://gamecoin.example",
  fetch: async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith("/wallet/grant")) {
      const entry = { id: "e1", type: "grant", currency: "gems", paidDelta: 0, bonusDelta: 5, balanceAfter: { paid: 0, bonus: 5, total: 5 }, reason: null, metadata: {}, ref: {}, createdAt: "2026-10-05T12:00:00.000Z" };
      return new Response(JSON.stringify({ entry, balance: { currency: "gems", paid: 0, bonus: 5, total: 5 } }), { status: 200, headers: { "Idempotent-Replayed": "true" } });
    }
    return new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "Player not found" } }), { status: 404 });
  },
});

const { balance, replayed, entry } = await gamecoin.wallet.grant(ext("a b"), { currency: "gems", amount: 5 });
assert.equal(balance.total, 5);
assert.equal(replayed, true);
assert.ok(entry.createdAt instanceof Date);
assert.equal(calls[0].url, "https://gamecoin.example/api/v1/players/ext%3Aa%20b/wallet/grant");
assert.equal(calls[0].init.headers.Authorization, `Bearer ${key}`);

await assert.rejects(
  () => gamecoin.players.get(ext("nobody")),
  (error) => error instanceof GameCoinError && error.code === ErrorCode.NOT_FOUND && error.status === 404,
);
assert.ok(!String(gamecoin).includes(key));

console.log(`ESM ok: import { GameCoin, ext, GameCoinError } from "@apilow/gamecoin" (version ${VERSION})`);
