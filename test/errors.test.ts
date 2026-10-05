import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inspect } from "node:util";
import { ErrorCode, GameCoin, GameCoinError, ext } from "../src/index.js";
import { TEST_KEY, apiError, fakeFetch, harness } from "./helpers.js";

const P = ext("user-42");

async function failure(promise: Promise<unknown>): Promise<GameCoinError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof GameCoinError, `expected a GameCoinError, got ${String(error)}`);
    return error;
  }
  throw new Error("the call should have failed");
}

describe("error mapping", () => {
  it("INSUFFICIENT_FUNDS: code, status, message, details.required / details.available", async () => {
    const { gamecoin } = harness(apiError(409, "INSUFFICIENT_FUNDS", "Insufficient funds", { required: 50, available: 20 }));
    const error = await failure(gamecoin.wallet.spend(P, { currency: "gems", amount: 50 }));
    assert.equal(error.code, ErrorCode.INSUFFICIENT_FUNDS);
    assert.equal(error.status, 409);
    assert.equal(error.message, "Insufficient funds");
    assert.deepEqual(error.details, { required: 50, available: 20 });
    assert.equal(error.retryAfter, undefined);
    assert.equal(error.name, "GameCoinError");
    assert.ok(error instanceof Error);
  });

  it("VALIDATION_FAILED: details.fieldErrors", async () => {
    const fieldErrors = { amount: ["Too small: expected number to be >=1"], country: ["COUNTRY_NOT_SELLABLE"] };
    const { gamecoin } = harness(apiError(400, "VALIDATION_FAILED", "Invalid request body", { fieldErrors }));
    const error = await failure(gamecoin.checkouts.create(P, { packSku: "gems-500", country: "US" }));
    assert.equal(error.code, "VALIDATION_FAILED");
    assert.deepEqual(error.details.fieldErrors, fieldErrors);
  });

  it("NOT_FOUND without details: details is an empty object", async () => {
    const { gamecoin } = harness(apiError(404, "NOT_FOUND", "Player not found"));
    const error = await failure(gamecoin.players.get(P));
    assert.deepEqual(error.details, {});
    assert.equal(error.status, 404);
  });

  it("RATE_LIMITED: retryAfter in seconds, once the retries are used up", async () => {
    const { gamecoin } = harness(apiError(429, "RATE_LIMITED", "Too many requests", undefined, { "Retry-After": "12" }), { maxRetries: 0 });
    const error = await failure(gamecoin.wallet.get(P));
    assert.equal(error.code, "RATE_LIMITED");
    assert.equal(error.status, 429);
    assert.equal(error.retryAfter, 12);
  });

  it("retryAfter is reported for any status that carries Retry-After", async () => {
    const { gamecoin } = harness(apiError(503, "INTERNAL", "Internal error", undefined, { "Retry-After": "90" }));
    assert.equal((await failure(gamecoin.wallet.get(P))).retryAfter, 90);
  });

  it("each documented HTTP status and code is mapped as the API sent it", async () => {
    const table: [number, string][] = [
      [400, "VALIDATION_FAILED"],
      [400, "IDEMPOTENCY_KEY_REQUIRED"],
      [401, "UNAUTHENTICATED"],
      [402, "PAYMENT_FAILED"],
      [403, "FORBIDDEN"],
      [403, "PLAYER_BLOCKED"],
      [403, "ENV_NOT_ENABLED"],
      [404, "NOT_FOUND"],
      [409, "INSUFFICIENT_FUNDS"],
      [409, "LIMIT_REACHED"],
      [409, "IDEMPOTENCY_CONFLICT"],
      [409, "CONFLICT"],
      [429, "RATE_LIMITED"],
      [500, "INTERNAL"],
    ];
    for (const [status, code] of table) {
      const { gamecoin } = harness(apiError(status, code, `message of ${code}`), { maxRetries: 0 });
      const error = await failure(gamecoin.catalog.get());
      assert.deepEqual([error.status, error.code, error.message], [status, code, `message of ${code}`]);
      assert.ok(Object.values(ErrorCode).includes(code as never), `${code} is an exported constant`);
    }
  });

  it("NETWORK_ERROR: status 0, the cause is kept", async () => {
    const cause = new TypeError("fetch failed", { cause: new Error("connect ECONNREFUSED 127.0.0.1:3400") });
    const { gamecoin } = harness(cause, { maxRetries: 0 });
    const error = await failure(gamecoin.catalog.get());
    assert.equal(error.code, ErrorCode.NETWORK_ERROR);
    assert.equal(error.status, 0);
    assert.match(error.message, /fetch failed.*ECONNREFUSED/);
    assert.equal(error.cause, cause);
    assert.deepEqual(error.details, {});
  });

  it("TIMEOUT: status 0 and the delay in the message", async () => {
    const gamecoin = new GameCoin(TEST_KEY, { fetch: (() => new Promise(() => undefined)) as never, timeout: 15, maxRetries: 0 });
    const error = await failure(gamecoin.catalog.get());
    assert.equal(error.code, ErrorCode.TIMEOUT);
    assert.equal(error.status, 0);
    assert.match(error.message, /15 ms/);
  });

  it("isGameCoinError recognises an error from another copy of the package, instanceof does not need to", async () => {
    const { gamecoin } = harness(apiError(404, "NOT_FOUND", "Player not found"));
    const error = await failure(gamecoin.players.get(P));
    assert.ok(GameCoinError.isGameCoinError(error));
    assert.ok(!GameCoinError.isGameCoinError(new Error("plain")));
    assert.ok(!GameCoinError.isGameCoinError(null));
    assert.ok(!GameCoinError.isGameCoinError({ code: "NOT_FOUND" }));
  });

  it("toJSON gives a plain, loggable object", async () => {
    const { gamecoin } = harness(apiError(409, "INSUFFICIENT_FUNDS", "Insufficient funds", { required: 5, available: 1 }));
    const error = await failure(gamecoin.wallet.spend(P, { currency: "gems", amount: 5 }));
    assert.deepEqual(JSON.parse(JSON.stringify(error)), {
      name: "GameCoinError",
      code: "INSUFFICIENT_FUNDS",
      status: 409,
      message: "Insufficient funds",
      details: { required: 5, available: 1 },
    });
  });
});

describe("the secret key stays out of errors and string representations", () => {
  const scenarios: [string, () => ReturnType<typeof harness>][] = [
    ["an API error", () => harness(apiError(401, "UNAUTHENTICATED", "Invalid API key"), { maxRetries: 0 })],
    ["an unreadable body", () => harness({ status: 200, text: `echo of ${TEST_KEY.slice(0, 9)}` }, { maxRetries: 0 })],
    ["a network error", () => harness(new TypeError("fetch failed"), { maxRetries: 0 })],
    [
      "a transport that leaks the key in its own message and cause",
      () => harness(new Error(`bad header Authorization: Bearer ${TEST_KEY}`, { cause: new Error(`inner ${TEST_KEY}`) }), { maxRetries: 0 }),
    ],
  ];

  for (const [name, make] of scenarios) {
    it(`${name}: not in message, inspect, JSON, stack or cause`, async () => {
      const { gamecoin } = make();
      const error = await failure(gamecoin.wallet.get(P));
      const representations = [
        error.message,
        String(error),
        JSON.stringify(error),
        inspect(error, { depth: 10, showHidden: true }),
        error.stack ?? "",
        inspect(error.cause, { depth: 10 }),
        JSON.stringify(error.details),
      ];
      for (const text of representations) {
        assert.ok(!text.includes(TEST_KEY), text);
        assert.ok(!text.includes("TkTkTk"), text);
      }
    });
  }

  it("local argument errors do not carry the key either", async () => {
    const { gamecoin } = harness({ json: {} });
    for (const run of [() => gamecoin.wallet.grant(P, { currency: TEST_KEY, amount: -1 }), () => gamecoin.players.get(""), () => gamecoin.orders.get(42 as never)]) {
      await assert.rejects(run, (error: unknown) => error instanceof Error && !error.message.includes(TEST_KEY));
    }
  });

  it("the key is not on the object of the transport call beyond the Authorization header", async () => {
    const { fetch, calls } = fakeFetch({ json: { currencies: [], items: [], packs: [] } });
    await new GameCoin(TEST_KEY, { fetch }).catalog.get();
    const [call] = calls;
    assert.ok(call);
    assert.ok(!call.url.includes(TEST_KEY));
    assert.equal(call.body, undefined);
    const others = Object.entries(call.headers).filter(([name]) => name !== "authorization");
    for (const [, value] of others) assert.ok(!value.includes(TEST_KEY));
  });
});
