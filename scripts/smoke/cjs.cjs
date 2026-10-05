// Run by scripts/check-package.mjs: the built package, loaded with `require` the way a CommonJS program does it.
const assert = require("node:assert/strict");
const sdk = require("@apilow/gamecoin");
const { ErrorCode, GameCoin, GameCoinError, VERSION, ext } = sdk;

async function main() {
  assert.deepEqual(Object.keys(sdk).sort(), ["DEFAULT_BASE_URL", "DEFAULT_MAX_RETRIES", "DEFAULT_TIMEOUT_MS", "ErrorCode", "GameCoin", "GameCoinError", "VERSION", "ext"]);
  assert.equal(typeof GameCoin, "function");
  assert.equal(ext("user-42"), "ext:user-42");
  assert.equal(require("@apilow/gamecoin/package.json").version, VERSION);

  const key = `gc_sk_test_${"C".repeat(30)}`;
  const calls = [];
  const gamecoin = new GameCoin(key, {
    baseUrl: "https://gamecoin.example",
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ error: { code: "INSUFFICIENT_FUNDS", message: "Insufficient funds", details: { required: 50, available: 20 } } }), { status: 409 });
    },
  });
  await assert.rejects(
    () => gamecoin.wallet.spend(ext("u"), { currency: "gems", amount: 50 }),
    (error) => error instanceof GameCoinError && error.code === ErrorCode.INSUFFICIENT_FUNDS && error.details.required === 50 && error.details.available === 20,
  );
  assert.equal(calls.length, 1, "a 409 is not retried");
  assert.match(calls[0].init.headers["Idempotency-Key"], /^[0-9a-f-]{36}$/);

  // The same package loaded through `import()` is a second copy of the classes: `instanceof` cannot link them,
  // `GameCoinError.isGameCoinError` can.
  const esm = await import("@apilow/gamecoin");
  assert.equal(esm.VERSION, VERSION);
  const fromEsm = new esm.GameCoin(key, { fetch: async () => new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "x" } }), { status: 404 }) });
  const error = await fromEsm.players.get("p").catch((e) => e);
  assert.ok(!(error instanceof GameCoinError), "another copy of the class");
  assert.ok(GameCoinError.isGameCoinError(error));
  assert.ok(esm.GameCoinError.isGameCoinError(error));

  console.log(`CommonJS ok: const { GameCoin, ext, GameCoinError } = require("@apilow/gamecoin") (version ${VERSION})`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
