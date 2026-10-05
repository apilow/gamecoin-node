import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inspect } from "node:util";
import { DEFAULT_BASE_URL, DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS, GameCoin, VERSION } from "../src/index.js";
import { LIVE_KEY, TEST_KEY, fakeFetch, harness, movementJson } from "./helpers.js";

describe("client: authentication, headers, configuration", () => {
  it("sends the secret key as a Bearer token, Accept, and the user agent gamecoin-node/<version> (node/<version>)", async () => {
    const { gamecoin, calls } = harness({ json: { currencies: [], items: [], packs: [] } });
    await gamecoin.catalog.get();
    const [call] = calls;
    assert.ok(call);
    assert.equal(call.headers.authorization, `Bearer ${TEST_KEY}`);
    assert.equal(call.headers.accept, "application/json");
    assert.equal(call.headers["user-agent"], `gamecoin-node/${VERSION} (node/${process.versions.node})`);
    assert.equal(call.method, "GET");
    assert.equal(call.url, "https://gamecoin.test/api/v1/catalog");
    assert.equal(call.headers["content-type"], undefined, "no body, no content type");
  });

  it("sets Content-Type: application/json when there is a body", async () => {
    const { gamecoin, calls } = harness({ json: movementJson });
    await gamecoin.wallet.grant("p1", { currency: "gems", amount: 1 });
    assert.equal(calls[0]?.headers["content-type"], "application/json");
  });

  it("environment comes from the key prefix", () => {
    assert.equal(new GameCoin(TEST_KEY).environment, "test");
    assert.equal(new GameCoin(LIVE_KEY).environment, "live");
  });

  it("refuses a publishable key with a message that points to the browser SDK, and never repeats the key", () => {
    const publishable = `gc_pk_test_${"Pk".repeat(20)}`;
    assert.throws(
      () => new GameCoin(publishable),
      (error: unknown) => {
        assert.ok(error instanceof RangeError);
        assert.match(error.message, /publishable key/);
        assert.match(error.message, /browser SDK/);
        assert.ok(!error.message.includes(publishable));
        return true;
      },
    );
  });

  it("refuses anything that is not a secret key: wrong type is a TypeError, wrong value a RangeError, the value is never echoed", () => {
    // A bare prefix is refused too (its message quotes the expected prefixes, so it is not checked for echo).
    assert.throws(() => new GameCoin("gc_sk_test_"), RangeError);
    for (const value of ["", "gc_sk_prod_abc", "sk_test_abc", "gc_pt_abc", "secret-value-123"]) {
      assert.throws(() => new GameCoin(value), (error: unknown) => error instanceof RangeError && (value === "" || !error.message.includes(value)), value);
    }
    for (const value of [undefined, null, 42, {}, ["gc_sk_test_abc"]]) {
      assert.throws(() => new GameCoin(value as never), TypeError);
    }
  });

  it("trims whitespace around the key (a value read from a file often ends with a newline)", async () => {
    const { fetch, calls } = fakeFetch({ json: { currencies: [], items: [], packs: [] } });
    await new GameCoin(`  ${TEST_KEY}\r\n`, { fetch }).catalog.get();
    assert.equal(calls[0]?.headers.authorization, `Bearer ${TEST_KEY}`);
  });

  it("defaults: https://gamecoin.apilow.com, 30 s timeout, 2 retries", () => {
    assert.equal(DEFAULT_BASE_URL, "https://gamecoin.apilow.com");
    assert.equal(DEFAULT_TIMEOUT_MS, 30_000);
    assert.equal(DEFAULT_MAX_RETRIES, 2);
    assert.equal(new GameCoin(TEST_KEY).baseUrl, "https://gamecoin.apilow.com");
    assert.equal(new GameCoin(TEST_KEY, { baseUrl: undefined }).baseUrl, "https://gamecoin.apilow.com");
  });

  it("baseUrl: trailing slashes are dropped, a path prefix is kept, /api/v1 is appended", async () => {
    for (const [given, expected] of [
      ["http://localhost:3400", "http://localhost:3400/api/v1/catalog"],
      ["http://localhost:3400/", "http://localhost:3400/api/v1/catalog"],
      ["https://example.com/gamecoin//", "https://example.com/gamecoin/api/v1/catalog"],
    ] as const) {
      const { fetch, calls } = fakeFetch({ json: { currencies: [], items: [], packs: [] } });
      await new GameCoin(TEST_KEY, { baseUrl: given, fetch }).catalog.get();
      assert.equal(calls[0]?.url, expected, given);
    }
  });

  it("validates its options before anything else happens", () => {
    assert.throws(() => new GameCoin(TEST_KEY, { baseUrl: "not a url" }), RangeError);
    assert.throws(() => new GameCoin(TEST_KEY, { baseUrl: "ftp://example.com" }), RangeError);
    assert.throws(() => new GameCoin(TEST_KEY, { baseUrl: "https://user:pass@example.com" }), RangeError);
    assert.throws(() => new GameCoin(TEST_KEY, { baseUrl: "https://example.com/?x=1" }), RangeError);
    assert.throws(() => new GameCoin(TEST_KEY, { baseUrl: 3 as never }), TypeError);
    assert.throws(() => new GameCoin(TEST_KEY, { timeout: 0 }), RangeError);
    assert.throws(() => new GameCoin(TEST_KEY, { timeout: 1.5 }), RangeError);
    assert.throws(() => new GameCoin(TEST_KEY, { timeout: "30" as never }), TypeError);
    assert.throws(() => new GameCoin(TEST_KEY, { maxRetries: -1 }), RangeError);
    assert.throws(() => new GameCoin(TEST_KEY, { fetch: "nope" as never }), TypeError);
    assert.throws(() => new GameCoin(TEST_KEY, { retries: 3 } as never), RangeError);
    assert.throws(() => new GameCoin(TEST_KEY, null as never), TypeError);
  });

  it("the secret key appears in no string representation of the client", () => {
    const gamecoin = new GameCoin(TEST_KEY, { baseUrl: "http://localhost:3400" });
    const representations = [
      String(gamecoin),
      `${gamecoin}`,
      JSON.stringify(gamecoin),
      inspect(gamecoin),
      inspect(gamecoin, { depth: 10, showHidden: true }),
      inspect(gamecoin.wallet, { depth: 10, showHidden: true }),
      inspect({ gamecoin }, { depth: 10 }),
      Object.keys(gamecoin).join(),
      JSON.stringify(Object.getOwnPropertyNames(gamecoin)),
    ];
    for (const text of representations) {
      assert.ok(!text.includes(TEST_KEY), text);
      assert.ok(!text.includes("TkTk"), text);
    }
    assert.deepEqual(JSON.parse(JSON.stringify(gamecoin)), { environment: "test", baseUrl: "http://localhost:3400", secretKey: "gc_sk_test_…" });
    assert.equal(String(gamecoin), "GameCoin { environment: test, baseUrl: http://localhost:3400, secretKey: gc_sk_test_… }");
  });
});
