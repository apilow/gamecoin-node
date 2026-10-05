import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ErrorCode, ext, type GameCoin } from "../src/index.js";
import { apiError, balanceJson, checkoutJson, entryJson, harness, movementJson, orderJson, playerJson, potionJson } from "./helpers.js";

const P = ext("user-42");
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** The six ⟳ calls of the server API, each with the reply that makes it succeed. */
const mutations: { name: string; reply: unknown; run: (g: GameCoin, key?: string) => Promise<{ replayed: boolean }> }[] = [
  { name: "wallet.grant", reply: movementJson, run: (g, k) => g.wallet.grant(P, { currency: "gems", amount: 1 }, k ? { idempotencyKey: k } : undefined) },
  { name: "wallet.spend", reply: movementJson, run: (g, k) => g.wallet.spend(P, { currency: "gems", amount: 1 }, k ? { idempotencyKey: k } : undefined) },
  { name: "inventory.grant", reply: { item: potionJson }, run: (g, k) => g.inventory.grant(P, { sku: "potion" }, k ? { idempotencyKey: k } : undefined) },
  { name: "inventory.consume", reply: { item: potionJson }, run: (g, k) => g.inventory.consume(P, { sku: "potion" }, k ? { idempotencyKey: k } : undefined) },
  {
    name: "purchases.create",
    reply: { entry: entryJson, balance: balanceJson, item: potionJson },
    run: (g, k) => g.purchases.create(P, { sku: "potion" }, k ? { idempotencyKey: k } : undefined),
  },
  { name: "checkouts.create", reply: checkoutJson, run: (g, k) => g.checkouts.create(P, { packSku: "gems-500" }, k ? { idempotencyKey: k } : undefined) },
];

describe("idempotency", () => {
  for (const mutation of mutations) {
    it(`${mutation.name}: sends a generated UUID v4, a different one for each call`, async () => {
      const { gamecoin, calls } = harness({ json: mutation.reply });
      await mutation.run(gamecoin);
      await mutation.run(gamecoin);
      const keys = calls.map((call) => call.headers["idempotency-key"]);
      assert.equal(keys.length, 2);
      for (const key of keys) assert.match(key ?? "", UUID_V4);
      assert.notEqual(keys[0], keys[1]);
    });

    it(`${mutation.name}: the caller's key is sent as is`, async () => {
      const { gamecoin, calls } = harness({ json: mutation.reply });
      await mutation.run(gamecoin, "my key / ascii-only ~ 123");
      assert.equal(calls[0]?.headers["idempotency-key"], "my key / ascii-only ~ 123");
    });

    it(`${mutation.name}: replayed is false, then true when the API says Idempotent-Replayed: true`, async () => {
      const { gamecoin } = harness([{ json: mutation.reply }, { json: mutation.reply, headers: { "Idempotent-Replayed": "true" } }]);
      assert.equal((await mutation.run(gamecoin, "same")).replayed, false);
      assert.equal((await mutation.run(gamecoin, "same")).replayed, true);
    });

    it(`${mutation.name}: the same key is kept across every retry of the call`, async () => {
      const { gamecoin, calls } = harness([apiError(503, "INTERNAL", "Internal error"), new Error("socket hang up"), { json: mutation.reply }]);
      await mutation.run(gamecoin);
      assert.equal(calls.length, 3);
      const keys = new Set(calls.map((call) => call.headers["idempotency-key"]));
      assert.equal(keys.size, 1);
      assert.match([...keys][0] ?? "", UUID_V4);
    });

    it(`${mutation.name}: a caller's key is kept across retries too`, async () => {
      const { gamecoin, calls } = harness([apiError(429, "RATE_LIMITED", "Too many requests", undefined, { "Retry-After": "1" }), { json: mutation.reply }]);
      await mutation.run(gamecoin, "mine-1");
      assert.deepEqual(
        calls.map((call) => call.headers["idempotency-key"]),
        ["mine-1", "mine-1"],
      );
    });
  }

  it("a replayed checkout is reported as such, with the order in its current state", async () => {
    const paid = { ...orderJson, status: "fulfilled" };
    const { gamecoin } = harness([{ status: 201, json: checkoutJson }, { status: 200, json: { ...checkoutJson, order: paid }, headers: { "Idempotent-Replayed": "true" } }]);
    const first = await gamecoin.checkouts.create(P, { packSku: "gems-500" }, { idempotencyKey: "order-1" });
    const second = await gamecoin.checkouts.create(P, { packSku: "gems-500" }, { idempotencyKey: "order-1" });
    assert.deepEqual([first.replayed, first.order.status], [false, "pending"]);
    assert.deepEqual([second.replayed, second.order.status], [true, "fulfilled"]);
  });

  it("only the Idempotent-Replayed value 'true' counts as a replay", async () => {
    const { gamecoin } = harness({ json: movementJson, headers: { "Idempotent-Replayed": "false" } });
    assert.equal((await gamecoin.wallet.grant(P, { currency: "gems", amount: 1 })).replayed, false);
  });

  it("reusing a key for another request is the API's IDEMPOTENCY_CONFLICT (409): raised, never retried", async () => {
    const { gamecoin, calls } = harness(apiError(409, "IDEMPOTENCY_CONFLICT", "The Idempotency-Key was already used with a different request"));
    await assert.rejects(
      () => gamecoin.wallet.grant(P, { currency: "gems", amount: 2 }, { idempotencyKey: "k" }),
      (error: { code: string; status: number }) => error.code === ErrorCode.IDEMPOTENCY_CONFLICT && error.status === 409,
    );
    assert.equal(calls.length, 1);
  });

  it("reads, token issue, upsert and refund send no Idempotency-Key", async () => {
    const { gamecoin, calls } = harness([
      { json: orderJson },
      { json: orderJson },
      { json: { token: "gc_pt_x.y", expiresAt: "2026-10-05T13:00:00.000Z" } },
      { json: { currencies: [], items: [], packs: [] } },
      { json: playerJson },
    ]);
    await gamecoin.orders.get("o1");
    await gamecoin.orders.refund("o1");
    await gamecoin.players.createToken(P);
    await gamecoin.catalog.get();
    await gamecoin.players.upsert(P, { displayName: "Alice" });
    assert.equal(calls.length, 5);
    for (const call of calls) assert.equal(call.headers["idempotency-key"], undefined);
  });
});
