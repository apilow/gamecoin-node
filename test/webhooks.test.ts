import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import { inspect } from "node:util";
import {
  DEFAULT_WEBHOOK_TOLERANCE_SECONDS,
  GameCoinError,
  WebhookEventType,
  WebhookSignatureError,
  isKnownWebhookEvent,
  webhooks,
} from "../src/index.js";
import type { WebhookEvent, WebhookSignatureReason } from "../src/index.js";
import { ID_ORDER, ID_PLAYER, orderJson } from "./helpers.js";

const SECRET = `whsec_gc_${"Sx".repeat(16)}`;
const T = 1_790_000_000;
const NOW = () => T * 1000;

/** The envelope of the guide `webhooks.md`, with the order of the guide. */
const fulfilled = {
  id: "evt_6ac419fbdbe02af6c99c3d47_ful",
  type: "order.fulfilled",
  createdAt: "2026-10-06T10:00:02.000Z",
  env: "test",
  data: { ...orderJson, status: "fulfilled", paidAt: "2026-10-06T10:00:01.000Z", fulfilledAt: "2026-10-06T10:00:01.000Z" },
};
const BODY = JSON.stringify(fulfilled);

function sign(body: string | Uint8Array, secret = SECRET, t: number | string = T): string {
  return createHmac("sha256", secret).update(`${t}.`).update(body).digest("hex");
}

function header(body: string | Uint8Array = BODY, secret = SECRET, t: number | string = T): string {
  return `t=${t},v1=${sign(body, secret, t)}`;
}

function construct(body: string | Uint8Array, head: string | undefined, options: Parameters<typeof webhooks.constructEvent>[3] = { now: NOW }): WebhookEvent {
  return webhooks.constructEvent(body, head, SECRET, options);
}

function reasonOf(run: () => unknown): WebhookSignatureReason {
  try {
    run();
  } catch (error) {
    assert.ok(error instanceof WebhookSignatureError, `expected a WebhookSignatureError, got ${String(error)}`);
    return error.reason;
  }
  throw new Error("the call should have failed");
}

describe("webhooks.constructEvent: a valid call", () => {
  it("returns the typed event of the guide example", () => {
    const event = construct(BODY, header());
    assert.equal(event.id, "evt_6ac419fbdbe02af6c99c3d47_ful");
    assert.equal(event.type, "order.fulfilled");
    assert.equal(event.env, "test");
    assert.ok(event.createdAt instanceof Date);
    assert.equal(event.createdAt.toISOString(), "2026-10-06T10:00:02.000Z");
    assert.ok(isKnownWebhookEvent(event));
    if (isKnownWebhookEvent(event) && event.type === "order.fulfilled") {
      assert.equal(event.data.id, ID_ORDER);
      assert.equal(event.data.playerId, ID_PLAYER);
      assert.equal(event.data.status, "fulfilled");
      assert.equal(event.data.pack.sku, "gems-500");
      assert.ok(event.data.paidAt instanceof Date);
      assert.equal(event.data.refundedAt, null);
    } else {
      assert.fail("expected an order event");
    }
  });

  it("accepts a text body and a body in bytes (Buffer, Uint8Array, ArrayBuffer), the same event", () => {
    const bytes = Buffer.from(BODY, "utf8");
    const expected = construct(BODY, header());
    assert.deepEqual(construct(bytes, header(bytes)), expected);
    assert.deepEqual(construct(new Uint8Array(bytes), header(bytes)), expected);
    assert.deepEqual(webhooks.constructEvent(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, header(bytes), SECRET, { now: NOW }), expected);
    // A view on a bigger buffer (a pooled Buffer): only the view counts.
    const pooled = Buffer.concat([Buffer.from("xxxx"), bytes, Buffer.from("yyyy")]).subarray(4, 4 + bytes.length);
    assert.deepEqual(construct(pooled, header(bytes)), expected);
  });

  it("signs non-ASCII text as UTF-8 bytes", () => {
    const body = JSON.stringify({ ...fulfilled, data: { ...fulfilled.data, pack: { sku: "gems-500", name: "Sac de gemmes é€ 💎" } } });
    const event = construct(body, header(body));
    assert.ok(isKnownWebhookEvent(event) && event.type === "order.fulfilled" && event.data.pack.name === "Sac de gemmes é€ 💎");
  });

  it("accepts several v1 when one is right, whatever its place", () => {
    const wrong = sign(BODY, "whsec_gc_other");
    assert.equal(construct(BODY, `t=${T},v1=${wrong},v1=${sign(BODY)}`).id, fulfilled.id);
    assert.equal(construct(BODY, `t=${T},v1=${sign(BODY)},v1=${wrong}`).id, fulfilled.id);
  });

  it("ignores unknown keys, other schemes, spaces and an uppercase hex signature", () => {
    assert.equal(construct(BODY, `v0=${"0".repeat(64)}, t=${T} ,  v1=${sign(BODY).toUpperCase()}, extra=1, junk`).id, fulfilled.id);
  });

  it("trims the secret", () => {
    assert.equal(webhooks.constructEvent(BODY, header(), `  ${SECRET}\n`, { now: NOW }).id, fulfilled.id);
  });

  it("takes the header of a framework that gives a list of values", () => {
    assert.equal(webhooks.constructEvent(BODY, [header()], SECRET, { now: NOW }).id, fulfilled.id);
  });

  it("uses the real clock and a 5 minute tolerance by default", () => {
    assert.equal(DEFAULT_WEBHOOK_TOLERANCE_SECONDS, 300);
    const t = Math.floor(Date.now() / 1000);
    assert.equal(webhooks.constructEvent(BODY, header(BODY, SECRET, t), SECRET).id, fulfilled.id);
    assert.equal(reasonOf(() => webhooks.constructEvent(BODY, header(BODY, SECRET, t - 400), SECRET)), "timestamp_out_of_tolerance");
  });

  it("is a pure function: no client, no network", () => {
    const original = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("no network allowed");
    }) as typeof fetch;
    try {
      assert.equal(construct(BODY, header()).id, fulfilled.id);
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe("webhooks.constructEvent: every event type", () => {
  const credited = {
    id: "evt_6ac419fbdbe02af6c99c3d47_cre",
    type: "wallet.credited",
    createdAt: "2026-10-06T10:00:02.000Z",
    env: "test",
    data: { playerId: ID_PLAYER, orderId: ID_ORDER, credits: [{ currency: "gems", paid: 500, bonus: 50 }] },
  };

  function through(envelope: unknown): WebhookEvent {
    const body = JSON.stringify(envelope);
    return construct(body, header(body));
  }

  it("order.fulfilled, order.refunded and order.chargeback carry the order", () => {
    for (const [type, status] of [
      ["order.fulfilled", "fulfilled"],
      ["order.refunded", "refunded"],
      ["order.chargeback", "chargeback"],
    ] as const) {
      const event = through({ ...fulfilled, type, data: { ...fulfilled.data, status, refundedAt: "2026-10-06T11:00:00.000Z" } });
      assert.equal(event.type, type);
      assert.ok(isKnownWebhookEvent(event));
      if (isKnownWebhookEvent(event) && (event.type === "order.fulfilled" || event.type === "order.refunded" || event.type === "order.chargeback")) {
        assert.equal(event.data.status, status);
        assert.ok(event.data.refundedAt instanceof Date);
      }
    }
  });

  it("wallet.credited carries who received what", () => {
    const event = through(credited);
    assert.ok(isKnownWebhookEvent(event) && event.type === "wallet.credited");
    if (isKnownWebhookEvent(event) && event.type === "wallet.credited") {
      assert.deepEqual(event.data, credited.data);
    }
  });

  it("webhook.test carries a message", () => {
    const event = through({ ...credited, id: "evt_test", type: "webhook.test", data: { message: "Hello from GameCoin" } });
    assert.ok(isKnownWebhookEvent(event) && event.type === "webhook.test");
    if (isKnownWebhookEvent(event) && event.type === "webhook.test") assert.equal(event.data.message, "Hello from GameCoin");
  });

  it("an unknown type is passed through, with its data untouched", () => {
    const data = { anything: [1, { deep: true }], at: "2026-10-06T10:00:00.000Z" };
    const event = through({ ...credited, type: "payout.created", data });
    assert.equal(event.type, "payout.created");
    assert.deepEqual(event.data, data);
    assert.ok(!isKnownWebhookEvent(event));
    assert.ok(event.createdAt instanceof Date);
  });

  it("an unknown status or env value does not break parsing", () => {
    const event = through({ ...fulfilled, env: "staging", data: { ...fulfilled.data, status: "disputed" } });
    assert.equal(event.env, "staging");
  });

  it("exposes the type names as constants", () => {
    assert.deepEqual(
      { ...WebhookEventType },
      {
        ORDER_FULFILLED: "order.fulfilled",
        ORDER_REFUNDED: "order.refunded",
        ORDER_CHARGEBACK: "order.chargeback",
        WALLET_CREDITED: "wallet.credited",
        WEBHOOK_TEST: "webhook.test",
      },
    );
    assert.ok(Object.isFrozen(WebhookEventType));
    assert.equal(through({ ...credited, type: WebhookEventType.WALLET_CREDITED }).type, "wallet.credited");
  });
});

describe("webhooks.constructEvent: refusals", () => {
  it("a wrong secret: no_matching_signature", () => {
    assert.equal(reasonOf(() => webhooks.constructEvent(BODY, header(), "whsec_gc_wrong", { now: NOW })), "no_matching_signature");
  });

  it("a body altered by one character: no_matching_signature", () => {
    const altered = BODY.replace("gems-500", "gems-501");
    assert.notEqual(altered, BODY);
    assert.equal(reasonOf(() => construct(altered, header())), "no_matching_signature");
    assert.equal(reasonOf(() => construct(BODY + " ", header())), "no_matching_signature");
    assert.equal(reasonOf(() => construct(Buffer.from(BODY.replace("2026", "2027")), header())), "no_matching_signature");
  });

  it("a re-serialised body does not match: pretty-printed JSON", () => {
    assert.equal(reasonOf(() => construct(JSON.stringify(JSON.parse(BODY), null, 2), header())), "no_matching_signature");
  });

  it("a timestamp changed after signing: no_matching_signature", () => {
    assert.equal(reasonOf(() => construct(BODY, `t=${T + 1},v1=${sign(BODY)}`)), "no_matching_signature");
  });

  it("only wrong signatures, or signatures that are not 64 hex digits: no_matching_signature", () => {
    assert.equal(reasonOf(() => construct(BODY, `t=${T},v1=${sign(BODY, "whsec_gc_a")},v1=${sign(BODY, "whsec_gc_b")}`)), "no_matching_signature");
    for (const bad of ["zz", "abc", sign(BODY).slice(0, 62), `${sign(BODY)}00`, sign(BODY).replace(/.$/, "g")]) {
      assert.equal(reasonOf(() => construct(BODY, `t=${T},v1=${bad}`)), "no_matching_signature", bad);
    }
  });

  it("an expired timestamp: timestamp_out_of_tolerance", () => {
    const old = T - 301;
    assert.equal(reasonOf(() => construct(BODY, header(BODY, SECRET, old))), "timestamp_out_of_tolerance");
  });

  it("a timestamp in the future: timestamp_out_of_tolerance", () => {
    assert.equal(reasonOf(() => construct(BODY, header(BODY, SECRET, T + 301))), "timestamp_out_of_tolerance");
  });

  it("the tolerance is inclusive and configurable", () => {
    assert.equal(construct(BODY, header(BODY, SECRET, T - 300)).id, fulfilled.id);
    assert.equal(construct(BODY, header(BODY, SECRET, T + 300)).id, fulfilled.id);
    assert.equal(reasonOf(() => construct(BODY, header(BODY, SECRET, T - 61), { now: NOW, toleranceSeconds: 60 })), "timestamp_out_of_tolerance");
    assert.equal(construct(BODY, header(BODY, SECRET, T - 60), { now: NOW, toleranceSeconds: 60 }).id, fulfilled.id);
  });

  it("tolerance 0 disables the timestamp check", () => {
    assert.equal(construct(BODY, header(BODY, SECRET, 1_000_000_000), { now: NOW, toleranceSeconds: 0 }).id, fulfilled.id);
    assert.equal(construct(BODY, header(BODY, SECRET, T + 10_000_000), { now: NOW, toleranceSeconds: 0 }).id, fulfilled.id);
  });

  it("the clock may return a Date", () => {
    assert.equal(construct(BODY, header(), { now: () => new Date(T * 1000) }).id, fulfilled.id);
    assert.equal(reasonOf(() => construct(BODY, header(), { now: () => new Date((T + 1000) * 1000) })), "timestamp_out_of_tolerance");
  });

  it("a forged signature is refused before the timestamp is looked at", () => {
    assert.equal(reasonOf(() => construct(BODY, `t=${T - 100_000},v1=${sign(BODY, "whsec_gc_x", T - 100_000)}`)), "no_matching_signature");
  });

  it("a missing header: missing_header", () => {
    for (const missing of [undefined, null, "", "   "]) {
      assert.equal(reasonOf(() => webhooks.constructEvent(BODY, missing as never, SECRET, { now: NOW })), "missing_header", String(missing));
    }
  });

  it("a malformed header: malformed_header", () => {
    const sig = sign(BODY);
    for (const bad of [
      "garbage",
      `v1=${sig}`,
      `t=${T}`,
      `t=${T},v1=`,
      `t=,v1=${sig}`,
      `t=abc,v1=${sig}`,
      `t=-5,v1=${sig}`,
      `t=1.5,v1=${sig}`,
      `t=${T}x,v1=${sig}`,
      `t=${T},t=${T + 1},v1=${sig}`,
      `${T}.${sig}`,
      ",,,",
    ]) {
      assert.equal(reasonOf(() => construct(BODY, bad)), "malformed_header", bad);
    }
  });

  it("a signed payload that is not JSON, or not an envelope: invalid_payload", () => {
    const refused: unknown[] = [
      "not json at all",
      "",
      "[]",
      "null",
      "42",
      { type: "order.fulfilled", createdAt: fulfilled.createdAt, env: "test", data: {} },
      { ...fulfilled, id: 5 },
      { ...fulfilled, type: undefined },
      { ...fulfilled, createdAt: "yesterday" },
      { ...fulfilled, env: undefined },
      { id: "e", type: "payout.created", createdAt: fulfilled.createdAt, env: "test" },
      { ...fulfilled, data: { id: "only an id" } },
      { ...fulfilled, type: "wallet.credited", data: { playerId: "p", orderId: "o", credits: [{ currency: "gems", paid: "500", bonus: 0 }] } },
      { ...fulfilled, type: "webhook.test", data: {} },
    ];
    for (const payload of refused) {
      const body = typeof payload === "string" ? payload : JSON.stringify(payload);
      assert.equal(reasonOf(() => construct(body, header(body))), "invalid_payload", body.slice(0, 40));
    }
  });
});

describe("webhooks.constructEvent: arguments", () => {
  it("refuses a parsed object and says to pass the raw body", () => {
    for (const parsed of [fulfilled, [], 42, null, undefined, true]) {
      assert.throws(
        () => webhooks.constructEvent(parsed as never, header(), SECRET),
        (error) => error instanceof TypeError && /raw request body/.test(error.message) && /express\.raw/.test(error.message),
      );
    }
  });

  it("refuses a missing or wrong secret", () => {
    assert.throws(() => webhooks.constructEvent(BODY, header(), "" as never), RangeError);
    assert.throws(() => webhooks.constructEvent(BODY, header(), "   "), RangeError);
    assert.throws(() => webhooks.constructEvent(BODY, header(), undefined as never), TypeError);
    assert.throws(() => webhooks.constructEvent(BODY, header(), 12 as never), TypeError);
  });

  it("refuses a header that is not text, and bad options", () => {
    assert.throws(() => webhooks.constructEvent(BODY, 12 as never, SECRET), TypeError);
    assert.throws(() => webhooks.constructEvent(BODY, header(), SECRET, { toleranceSeconds: -1 }), RangeError);
    assert.throws(() => webhooks.constructEvent(BODY, header(), SECRET, { toleranceSeconds: 1.5 }), RangeError);
    assert.throws(() => webhooks.constructEvent(BODY, header(), SECRET, { toleranceSeconds: "300" as never }), TypeError);
    assert.throws(() => webhooks.constructEvent(BODY, header(), SECRET, { now: 5 as never }), TypeError);
    assert.throws(() => webhooks.constructEvent(BODY, header(), SECRET, { nowish: 5 } as never), RangeError);
    assert.throws(() => webhooks.constructEvent(BODY, header(), SECRET, { now: () => "x" as never }), TypeError);
  });
});

describe("WebhookSignatureError", () => {
  it("is an Error with a reason, and not a GameCoinError", () => {
    try {
      construct(BODY, undefined);
      assert.fail("should have thrown");
    } catch (error) {
      assert.ok(error instanceof WebhookSignatureError);
      assert.ok(error instanceof Error);
      assert.ok(!(error instanceof GameCoinError));
      assert.ok(!GameCoinError.isGameCoinError(error));
      assert.ok(WebhookSignatureError.isWebhookSignatureError(error));
      assert.equal(error.name, "WebhookSignatureError");
      assert.equal(error.reason, "missing_header");
    }
    assert.ok(!WebhookSignatureError.isWebhookSignatureError(new Error("x")));
    assert.ok(!WebhookSignatureError.isWebhookSignatureError(null));
  });

  it("never holds the secret, the body or a signature, in any failure", () => {
    const sig = sign(BODY);
    const secrets = [SECRET, "whsec_gc_wrong"];
    const attempts: (() => unknown)[] = [
      () => webhooks.constructEvent(BODY, header(), "whsec_gc_wrong", { now: NOW }),
      () => construct(BODY.replace("gems-500", "gems-501"), header()),
      () => construct(BODY, header(BODY, SECRET, T - 1000)),
      () => construct(BODY, `t=${T}`),
      () => construct(BODY, undefined),
      () => construct("this body is secret-ish and not json", header("this body is secret-ish and not json")),
      () => construct(JSON.stringify({ ...fulfilled, data: { id: "marker-body-value" } }), header(JSON.stringify({ ...fulfilled, data: { id: "marker-body-value" } }))),
      () => webhooks.constructEvent({ marker: "marker-body-value" } as never, header(), SECRET),
      () => webhooks.constructEvent(BODY, header(), `${SECRET} `, { toleranceSeconds: -1 }),
    ];
    for (const attempt of attempts) {
      try {
        attempt();
        assert.fail("should have thrown");
      } catch (error) {
        const shown = [String((error as Error).message), String(error), inspect(error, { depth: 5 }).split("\n    at ")[0] ?? "", JSON.stringify(error)].join("\n");
        for (const forbidden of [...secrets, sig, "gems-501", "marker-body-value", "secret-ish"]) {
          assert.ok(!shown.includes(forbidden), `the error shows ${forbidden.slice(0, 12)}…`);
        }
      }
    }
  });
});
