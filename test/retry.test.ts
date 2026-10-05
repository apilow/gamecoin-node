import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GameCoin, GameCoinError, ErrorCode, ext } from "../src/index.js";
import { backoffMs, parseRetryAfter } from "../src/http.js";
import { ID_ORDER, TEST_KEY, apiError, fakeFetch, harness, movementJson, orderJson, playerJson } from "./helpers.js";

const P = ext("user-42");
const grant = (gamecoin: GameCoin) => gamecoin.wallet.grant(P, { currency: "gems", amount: 1 });

function isError(code: string, status: number) {
  return (error: unknown) => error instanceof GameCoinError && error.code === code && error.status === status;
}

describe("retries: network error, timeout, 5xx, 429", () => {
  it("retries a network error and succeeds on the second attempt", async () => {
    const { gamecoin, calls, waits } = harness([new TypeError("fetch failed"), { json: movementJson }]);
    const result = await grant(gamecoin);
    assert.equal(result.balance.total, 100);
    assert.equal(calls.length, 2);
    assert.equal(waits.length, 1);
  });

  it("retries 5xx (500, 502, 503) and succeeds", async () => {
    for (const status of [500, 502, 503, 504]) {
      const { gamecoin, calls } = harness([apiError(status, "INTERNAL", "Internal error"), { json: movementJson }]);
      await grant(gamecoin);
      assert.equal(calls.length, 2, `HTTP ${status}`);
    }
  });

  it("retries a 5xx whose body is not JSON (a proxy error page)", async () => {
    const { gamecoin, calls } = harness([{ status: 502, text: "<html>Bad gateway</html>" }, { json: movementJson }]);
    await grant(gamecoin);
    assert.equal(calls.length, 2);
  });

  it("retries 429 and waits for Retry-After seconds (no jitter), then succeeds", async () => {
    const { gamecoin, calls, waits } = harness([
      apiError(429, "RATE_LIMITED", "Too many requests", undefined, { "Retry-After": "7" }),
      { json: movementJson },
    ]);
    await grant(gamecoin);
    assert.equal(calls.length, 2);
    assert.deepEqual(waits, [7000]);
  });

  it("a 429 without Retry-After uses the exponential backoff", async () => {
    const { gamecoin, waits } = harness([apiError(429, "RATE_LIMITED", "Too many requests"), { json: movementJson }]);
    await grant(gamecoin);
    assert.equal(waits.length, 1);
    assert.ok((waits[0] ?? 0) >= 375 && (waits[0] ?? 0) <= 625, `first wait ${waits[0]} ms is 0.5 s ±25 %`);
  });

  it("makes three attempts at most by default (maxRetries 2), then raises the last error", async () => {
    const { gamecoin, calls, waits } = harness(apiError(503, "INTERNAL", "Internal error"));
    await assert.rejects(() => grant(gamecoin), isError("INTERNAL", 503));
    assert.equal(calls.length, 3);
    assert.equal(waits.length, 2);
    // 0.5 s × 2^attempt, ±25 % jitter
    assert.ok((waits[0] ?? 0) >= 375 && (waits[0] ?? 0) <= 625, `${waits[0]}`);
    assert.ok((waits[1] ?? 0) >= 750 && (waits[1] ?? 0) <= 1250, `${waits[1]}`);
  });

  it("maxRetries: 0 disables retries; maxRetries: 4 allows five attempts", async () => {
    const none = harness(apiError(500, "INTERNAL", "Internal error"), { maxRetries: 0 });
    await assert.rejects(() => grant(none.gamecoin), isError("INTERNAL", 500));
    assert.equal(none.calls.length, 1);
    const many = harness(new Error("connection reset"), { maxRetries: 4 });
    await assert.rejects(() => grant(many.gamecoin), isError("NETWORK_ERROR", 0));
    assert.equal(many.calls.length, 5);
    assert.equal(many.waits.length, 4);
  });

  it("backoff: 0.5 s × 2^attempt with ±25 % jitter", () => {
    assert.equal(backoffMs(0, () => 0.5), 500);
    assert.equal(backoffMs(1, () => 0.5), 1000);
    assert.equal(backoffMs(3, () => 0.5), 4000);
    assert.equal(backoffMs(0, () => 0), 375);
    assert.equal(backoffMs(0, () => 1), 625);
  });

  it("Retry-After beyond 30 s is not waited for: no retry, the error carries retryAfter", async () => {
    const { gamecoin, calls, waits } = harness(apiError(429, "RATE_LIMITED", "Too many requests", undefined, { "Retry-After": "31" }));
    await assert.rejects(
      () => grant(gamecoin),
      (error: unknown) => error instanceof GameCoinError && error.code === "RATE_LIMITED" && error.status === 429 && error.retryAfter === 31,
    );
    assert.equal(calls.length, 1);
    assert.deepEqual(waits, []);
  });

  it("Retry-After of exactly 30 s is honoured; the cap also applies to a 503", async () => {
    const ok = harness([apiError(429, "RATE_LIMITED", "Too many requests", undefined, { "Retry-After": "30" }), { json: movementJson }]);
    await grant(ok.gamecoin);
    assert.deepEqual(ok.waits, [30_000]);
    const capped = harness(apiError(503, "INTERNAL", "Internal error", undefined, { "Retry-After": "120" }));
    await assert.rejects(() => grant(capped.gamecoin), isError("INTERNAL", 503));
    assert.equal(capped.calls.length, 1);
  });

  it("Retry-After as an HTTP date", () => {
    const now = Date.parse("2026-10-05T12:00:00Z");
    assert.equal(parseRetryAfter("12", now), 12);
    assert.equal(parseRetryAfter("0", now), 0);
    assert.equal(parseRetryAfter("Mon, 05 Oct 2026 12:00:09 GMT", now), 9);
    assert.equal(parseRetryAfter("Mon, 05 Oct 2026 11:00:00 GMT", now), 0);
    assert.equal(parseRetryAfter("soon", now), undefined);
    assert.equal(parseRetryAfter(null, now), undefined);
  });

  it("a timeout is retried (NETWORK-class failure) and ends as TIMEOUT with status 0", async () => {
    const hang = (call: { signal: AbortSignal }) => new Promise<never>((_resolve, reject) => call.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    const { fetch, calls } = fakeFetch(hang as never);
    const waits: number[] = [];
    const gamecoin = new GameCoin(TEST_KEY, { fetch, timeout: 20, maxRetries: 1, sleep: async (ms) => void waits.push(ms) });
    await assert.rejects(() => grant(gamecoin), isError("TIMEOUT", 0));
    assert.equal(calls.length, 2);
    assert.equal(waits.length, 1);
  });

  it("a transport that ignores the abort signal cannot hang the call", async () => {
    const stuck = () => new Promise<never>(() => undefined);
    const gamecoin = new GameCoin(TEST_KEY, { fetch: stuck as never, timeout: 20, maxRetries: 0 });
    await assert.rejects(() => grant(gamecoin), (error: unknown) => error instanceof GameCoinError && error.code === "TIMEOUT" && /20 ms/.test(error.message));
  });

  it("the timeout applies to reading the body too", async () => {
    const slowBody = async (_url: string, init: { signal: AbortSignal }) => ({
      status: 200,
      headers: { get: () => null },
      text: () => new Promise<string>((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))),
    });
    const gamecoin = new GameCoin(TEST_KEY, { fetch: slowBody as never, timeout: 20, maxRetries: 0 });
    await assert.rejects(() => grant(gamecoin), isError("TIMEOUT", 0));
  });
});

describe("no retry on 4xx", () => {
  const codes: [number, string][] = [
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
  ];
  for (const [status, code] of codes) {
    it(`${status} ${code}: raised after one attempt`, async () => {
      const { gamecoin, calls, waits } = harness(apiError(status, code, "Nope"));
      await assert.rejects(() => grant(gamecoin), isError(code, status));
      assert.equal(calls.length, 1);
      assert.deepEqual(waits, []);
    });
  }

  it("a 4xx outside the API's list (418) is not retried either, and an unparseable body is INVALID_RESPONSE", async () => {
    const { gamecoin, calls } = harness({ status: 418, text: "teapot" });
    await assert.rejects(() => grant(gamecoin), isError("INVALID_RESPONSE", 418));
    assert.equal(calls.length, 1);
  });
});

describe("orders.refund is retried on 429 only", () => {
  it("retries a 429 (with Retry-After)", async () => {
    const { gamecoin, calls, waits } = harness([apiError(429, "RATE_LIMITED", "Too many requests", undefined, { "Retry-After": "2" }), { json: orderJson }]);
    const order = await gamecoin.orders.refund(ID_ORDER);
    assert.equal(order.id, ID_ORDER);
    assert.equal(calls.length, 2);
    assert.deepEqual(waits, [2000]);
    assert.equal(calls[1]?.headers["idempotency-key"], undefined);
  });

  it("raises at once after a 5xx", async () => {
    const { gamecoin, calls } = harness([apiError(500, "INTERNAL", "Internal error"), { json: orderJson }]);
    await assert.rejects(() => gamecoin.orders.refund(ID_ORDER), isError("INTERNAL", 500));
    assert.equal(calls.length, 1);
  });

  it("raises at once after a network error", async () => {
    const { gamecoin, calls } = harness([new TypeError("fetch failed"), { json: orderJson }]);
    await assert.rejects(() => gamecoin.orders.refund(ID_ORDER), isError("NETWORK_ERROR", 0));
    assert.equal(calls.length, 1);
  });

  it("raises at once after a timeout", async () => {
    const stuck = () => new Promise<never>(() => undefined);
    const gamecoin = new GameCoin(TEST_KEY, { fetch: stuck as never, timeout: 20 });
    await assert.rejects(() => gamecoin.orders.refund(ID_ORDER), isError("TIMEOUT", 0));
  });

  it("gives up on a 429 after the retries are used up", async () => {
    const { gamecoin, calls } = harness(apiError(429, "RATE_LIMITED", "Too many requests", undefined, { "Retry-After": "1" }));
    await assert.rejects(() => gamecoin.orders.refund(ID_ORDER), isError("RATE_LIMITED", 429));
    assert.equal(calls.length, 3);
  });

  it("the other calls (reads, upsert, token) do retry a 5xx", async () => {
    const { gamecoin, calls } = harness([apiError(500, "INTERNAL", "Internal error"), { json: playerJson }]);
    await gamecoin.players.get(P);
    assert.equal(calls.length, 2);
  });
});

describe("cancelling a call", () => {
  it("an already aborted signal rejects with the signal's reason, without any request", async () => {
    const controller = new AbortController();
    controller.abort();
    const { gamecoin, calls } = harness({ json: movementJson });
    await assert.rejects(() => gamecoin.wallet.get(P, { signal: controller.signal }), (error: unknown) => !(error instanceof GameCoinError) && (error as Error).name === "AbortError");
    assert.equal(calls.length, 0);
  });

  it("aborting during a request rejects with the signal's reason and does not retry", async () => {
    const controller = new AbortController();
    const hang = (call: { signal: AbortSignal }) => new Promise<never>((_resolve, reject) => call.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    const { gamecoin, calls } = harness(hang as never);
    const cancelled = gamecoin.wallet.grant(P, { currency: "gems", amount: 1 }, { signal: controller.signal });
    setTimeout(() => controller.abort(new Error("player left")), 10);
    await assert.rejects(() => cancelled, (error: unknown) => error instanceof Error && !(error instanceof GameCoinError) && error.message === "player left");
    assert.equal(calls.length, 1);
  });

  it("aborting during the wait between retries stops the call", async () => {
    const controller = new AbortController();
    const { fetch, calls } = fakeFetch(apiError(503, "INTERNAL", "Internal error"));
    const gamecoin = new GameCoin(TEST_KEY, {
      fetch,
      sleep: (_ms, signal) =>
        new Promise<void>((_resolve, reject) => {
          controller.abort(new Error("stop"));
          if (signal?.aborted) reject(signal.reason);
        }),
    });
    await assert.rejects(() => gamecoin.wallet.grant(P, { currency: "gems", amount: 1 }, { signal: controller.signal }), /stop/);
    assert.equal(calls.length, 1);
  });

  it("the real wait is cut short by the signal", async () => {
    const controller = new AbortController();
    const { fetch } = fakeFetch(apiError(503, "INTERNAL", "Internal error"));
    const gamecoin = new GameCoin(TEST_KEY, { fetch });
    const started = Date.now();
    setTimeout(() => controller.abort(new Error("enough")), 30);
    await assert.rejects(() => gamecoin.wallet.grant(P, { currency: "gems", amount: 1 }, { signal: controller.signal }), /enough/);
    assert.ok(Date.now() - started < 400, "did not sit through the 0.5 s backoff");
  });
});

describe("unusable responses", () => {
  it("a 200 whose body is not JSON is INVALID_RESPONSE (status kept), not retried", async () => {
    const { gamecoin, calls } = harness({ status: 200, text: "<html>captive portal</html>" });
    await assert.rejects(() => grant(gamecoin), isError("INVALID_RESPONSE", 200));
    assert.equal(calls.length, 1);
  });

  it("a 200 with the wrong shape is INVALID_RESPONSE and names the field", async () => {
    const { gamecoin } = harness({ json: { entry: movementJson.entry } });
    await assert.rejects(
      () => grant(gamecoin),
      (error: unknown) => error instanceof GameCoinError && error.code === "INVALID_RESPONSE" && error.status === 200 && /response\.balance/.test(error.message),
    );
  });

  it("a date that is not a date is INVALID_RESPONSE", async () => {
    const { gamecoin } = harness({ json: { ...playerJson, createdAt: "yesterday" } });
    await assert.rejects(() => gamecoin.players.get(P), isError("INVALID_RESPONSE", 200));
  });

  it("an error body without the GameCoin shape keeps the HTTP status", async () => {
    const { gamecoin } = harness({ status: 400, json: { message: "bad" } });
    await assert.rejects(() => grant(gamecoin), isError("INVALID_RESPONSE", 400));
  });

  it("an unknown API code is passed through untouched", async () => {
    const { gamecoin } = harness(apiError(409, "SOMETHING_NEW", "A newer code"));
    await assert.rejects(() => grant(gamecoin), isError("SOMETHING_NEW", 409));
  });

  it("every error code the SDK can raise is an exported constant", () => {
    assert.deepEqual(Object.values(ErrorCode).sort(), [
      "CONFLICT",
      "ENV_NOT_ENABLED",
      "FORBIDDEN",
      "IDEMPOTENCY_CONFLICT",
      "IDEMPOTENCY_KEY_REQUIRED",
      "INSUFFICIENT_FUNDS",
      "INTERNAL",
      "INVALID_RESPONSE",
      "LIMIT_REACHED",
      "NETWORK_ERROR",
      "NOT_FOUND",
      "PAYMENT_FAILED",
      "PLAYER_BLOCKED",
      "RATE_LIMITED",
      "READ_ONLY",
      "TIMEOUT",
      "UNAUTHENTICATED",
      "VALIDATION_FAILED",
    ]);
    assert.throws(() => {
      (ErrorCode as Record<string, string>).NEW = "x";
    }, TypeError);
  });
});
