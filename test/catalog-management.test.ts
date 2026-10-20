import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GameCoinError } from "../src/index.js";
import type { GameCoin } from "../src/index.js";
import { AT, LATER, apiError, harness } from "./helpers.js";

const BASE = "https://gamecoin.test/api/v1";

const currencyJson = { code: "gems", name: "Gems", purchasable: true, status: "active", createdAt: AT, updatedAt: LATER };
const itemJson = {
  sku: "potion",
  name: "Potion",
  description: null,
  type: "consumable",
  price: { currency: "gems", amount: 20 },
  maxOwned: null,
  clientPurchasable: true,
  metadata: { heal: "50" },
  status: "active",
  createdAt: AT,
  updatedAt: LATER,
};
const packJson = {
  sku: "gems-500",
  name: "500 gems",
  description: null,
  priceCents: 499,
  currency: "EUR",
  grants: [{ currency: "gems", amount: 500, bonus: 50 }],
  items: [{ sku: "potion", quantity: 2 }],
  badge: "popular",
  maxPerPlayer: null,
  sortOrder: 10,
  status: "active",
  availability: { startsAt: "2026-11-01T00:00:00.000Z", endsAt: null, stock: 1000, founder: false, sold: 4 },
  createdAt: AT,
  updatedAt: LATER,
};

interface Case {
  name: string;
  reply: unknown;
  run: (gamecoin: GameCoin) => Promise<unknown>;
  method: string;
  url: string;
  body?: unknown;
}

/** Every call of the catalog management: the verb, the URL and the body it produces. None sends an Idempotency-Key. */
const cases: Case[] = [
  { name: "currencies.list()", reply: { currencies: [currencyJson] }, run: (g) => g.currencies.list(), method: "GET", url: `${BASE}/currencies` },
  {
    name: "currencies.list({ includeArchived: true })",
    reply: { currencies: [] },
    run: (g) => g.currencies.list({ includeArchived: true }),
    method: "GET",
    url: `${BASE}/currencies?includeArchived=true`,
  },
  { name: "currencies.list({ includeArchived: false }) sends no flag", reply: { currencies: [] }, run: (g) => g.currencies.list({ includeArchived: false }), method: "GET", url: `${BASE}/currencies` },
  {
    name: "currencies.create(params)",
    reply: currencyJson,
    run: (g) => g.currencies.create({ code: "gems", name: "Gems", purchasable: true }),
    method: "POST",
    url: `${BASE}/currencies`,
    body: { code: "gems", name: "Gems", purchasable: true },
  },
  { name: "currencies.get(code)", reply: currencyJson, run: (g) => g.currencies.get("gems"), method: "GET", url: `${BASE}/currencies/gems` },
  {
    name: "currencies.update(code, params)",
    reply: currencyJson,
    run: (g) => g.currencies.update("gems", { name: "Shiny gems", purchasable: false }),
    method: "PATCH",
    url: `${BASE}/currencies/gems`,
    body: { name: "Shiny gems", purchasable: false },
  },
  { name: "currencies.archive(code)", reply: { ...currencyJson, status: "archived" }, run: (g) => g.currencies.archive("gems"), method: "DELETE", url: `${BASE}/currencies/gems` },
  { name: "items.list()", reply: { items: [itemJson] }, run: (g) => g.items.list(), method: "GET", url: `${BASE}/items` },
  {
    name: "items.create(params)",
    reply: itemJson,
    run: (g) => g.items.create({ sku: "potion", name: "Potion", type: "consumable", price: { currency: "gems", amount: 20 }, clientPurchasable: true, metadata: { heal: "50" } }),
    method: "POST",
    url: `${BASE}/items`,
    body: { sku: "potion", name: "Potion", type: "consumable", price: { currency: "gems", amount: 20 }, clientPurchasable: true, metadata: { heal: "50" } },
  },
  { name: "items.get(sku): the sku is URL-encoded", reply: itemJson, run: (g) => g.items.get("a b/c"), method: "GET", url: `${BASE}/items/a%20b%2Fc` },
  {
    name: "items.update(sku, params): null clears, nothing else is sent",
    reply: itemJson,
    run: (g) => g.items.update("potion", { price: null, description: null, maxOwned: null }),
    method: "PATCH",
    url: `${BASE}/items/potion`,
    body: { price: null, description: null, maxOwned: null },
  },
  { name: "items.update(sku, {}) sends {}", reply: itemJson, run: (g) => g.items.update("potion", {}), method: "PATCH", url: `${BASE}/items/potion`, body: {} },
  { name: "items.archive(sku)", reply: { ...itemJson, status: "archived" }, run: (g) => g.items.archive("potion"), method: "DELETE", url: `${BASE}/items/potion` },
  { name: "packs.list({ includeArchived: true })", reply: { packs: [packJson] }, run: (g) => g.packs.list({ includeArchived: true }), method: "GET", url: `${BASE}/packs?includeArchived=true` },
  {
    name: "packs.create(params): dates become ISO texts, left-out availability fields are null",
    reply: packJson,
    run: (g) =>
      g.packs.create({
        sku: "gems-500",
        name: "500 gems",
        priceCents: 499,
        grants: [{ currency: "gems", amount: 500, bonus: 50 }],
        badge: "popular",
        availability: { startsAt: new Date("2026-11-01T00:00:00Z"), endsAt: "2026-12-01T00:00:00+01:00", stock: 1000 },
        status: "active",
      }),
    method: "POST",
    url: `${BASE}/packs`,
    body: {
      sku: "gems-500",
      name: "500 gems",
      priceCents: 499,
      grants: [{ currency: "gems", amount: 500, bonus: 50 }],
      badge: "popular",
      availability: { startsAt: "2026-11-01T00:00:00.000Z", endsAt: "2026-12-01T00:00:00+01:00", stock: 1000, founder: false },
      status: "active",
    },
  },
  {
    name: "packs.update(sku, params): the status and an emptied availability",
    reply: packJson,
    run: (g) => g.packs.update("gems-500", { priceCents: 599, sortOrder: -3, availability: {}, status: "active" }),
    method: "PATCH",
    url: `${BASE}/packs/gems-500`,
    body: { priceCents: 599, sortOrder: -3, availability: { startsAt: null, endsAt: null, stock: null, founder: false }, status: "active" },
  },
  { name: "packs.get(sku)", reply: packJson, run: (g) => g.packs.get("gems-500"), method: "GET", url: `${BASE}/packs/gems-500` },
  { name: "packs.archive(sku)", reply: { ...packJson, status: "archived" }, run: (g) => g.packs.archive("gems-500"), method: "DELETE", url: `${BASE}/packs/gems-500` },
];

describe("catalog management: requests", () => {
  for (const c of cases) {
    it(c.name, async () => {
      const { gamecoin, calls } = harness({ json: c.reply });
      await c.run(gamecoin);
      assert.equal(calls.length, 1);
      const call = calls[0];
      assert.ok(call);
      assert.equal(call.method, c.method);
      assert.equal(call.url, c.url);
      assert.deepEqual(call.body, c.body);
      assert.equal(call.headers["idempotency-key"], undefined);
      assert.equal(call.headers.authorization?.startsWith("Bearer gc_sk_test_"), true);
      assert.equal(call.headers["content-type"], c.body === undefined ? undefined : "application/json");
    });
  }
});

describe("catalog management: results", () => {
  it("a currency, an item and a pack come back typed, with Dates", async () => {
    const currency = await harness({ json: currencyJson }).gamecoin.currencies.get("gems");
    assert.deepEqual(currency, { code: "gems", name: "Gems", purchasable: true, status: "active", createdAt: new Date(AT), updatedAt: new Date(LATER) });

    const item = await harness({ json: itemJson }).gamecoin.items.get("potion");
    assert.equal(item.price?.amount, 20);
    assert.deepEqual(item.metadata, { heal: "50" });
    assert.equal(item.updatedAt.toISOString(), LATER);

    const pack = await harness({ json: packJson }).gamecoin.packs.get("gems-500");
    assert.equal(pack.status, "active");
    assert.equal(pack.sortOrder, 10);
    assert.deepEqual(pack.items, [{ sku: "potion", quantity: 2 }]);
    assert.deepEqual(pack.availability, { startsAt: new Date("2026-11-01T00:00:00.000Z"), endsAt: null, stock: 1000, founder: false, sold: 4 });
  });

  it("a pack without availability reads as null", async () => {
    const pack = await harness({ json: { ...packJson, availability: null } }).gamecoin.packs.get("gems-500");
    assert.equal(pack.availability, null);
  });

  it("lists are arrays", async () => {
    const items = await harness({ json: { items: [itemJson, { ...itemJson, sku: "elixir" }] } }).gamecoin.items.list();
    assert.deepEqual(items.map((item) => item.sku), ["potion", "elixir"]);
  });

  it("a response of the wrong shape is INVALID_RESPONSE", async () => {
    const { gamecoin } = harness({ json: { ...currencyJson, status: undefined } });
    await assert.rejects(
      () => gamecoin.currencies.get("gems"),
      (error: unknown) => error instanceof GameCoinError && error.code === "INVALID_RESPONSE",
    );
  });

  it("API errors carry their details", async () => {
    const { gamecoin } = harness(apiError(409, "CONFLICT", "Currency is used by active packs or items", { blockedBy: { packs: ["gems-500"], items: [] } }));
    await assert.rejects(
      () => gamecoin.currencies.archive("gems"),
      (error: unknown) => error instanceof GameCoinError && error.code === "CONFLICT" && JSON.stringify(error.details) === '{"blockedBy":{"packs":["gems-500"],"items":[]}}',
    );
  });
});

describe("catalog management: arguments are checked before any request", () => {
  const bad: [string, (g: GameCoin) => Promise<unknown>, (new (...args: never[]) => Error)][] = [
    ["an empty code", (g) => g.currencies.get(""), RangeError],
    ["a missing sku", (g) => g.items.get(undefined as unknown as string), TypeError],
    ["an unknown field on create", (g) => g.currencies.create({ code: "gems", name: "Gems", rate: 3 } as never), RangeError],
    ["the code on update", (g) => g.currencies.update("gems", { code: "other" } as never), RangeError],
    ["the type on item update", (g) => g.items.update("potion", { type: "durable" } as never), RangeError],
    ["a missing name", (g) => g.currencies.create({ code: "gems" } as never), TypeError],
    ["a missing item type", (g) => g.items.create({ sku: "x", name: "X" } as never), TypeError],
    ["an item type out of the list", (g) => g.items.create({ sku: "x", name: "X", type: "weapon" as never }), RangeError],
    ["a price of 0", (g) => g.items.create({ sku: "x", name: "X", type: "durable", price: { currency: "gems", amount: 0 } }), RangeError],
    ["a float price in cents", (g) => g.packs.create({ sku: "x", name: "X", priceCents: 4.5 }), RangeError],
    ["a string price in cents", (g) => g.packs.create({ sku: "x", name: "X", priceCents: "499" as never }), TypeError],
    ["a grant without bonus", (g) => g.packs.create({ sku: "x", name: "X", priceCents: 499, grants: [{ currency: "gems", amount: 5 } as never] }), TypeError],
    ["a badge out of the list", (g) => g.packs.create({ sku: "x", name: "X", priceCents: 499, badge: "hot" as never }), RangeError],
    ["an invalid date", (g) => g.packs.update("x", { availability: { startsAt: new Date("nope") } }), RangeError],
    ["a date text that is not a date", (g) => g.packs.update("x", { availability: { endsAt: "tomorrow" } }), RangeError],
    ["a stock of 0", (g) => g.packs.update("x", { availability: { stock: 0 } }), RangeError],
    ["a status out of the list", (g) => g.packs.update("x", { status: "deleted" as never }), RangeError],
    ["an unknown list parameter", (g) => g.items.list({ status: "active" } as never), RangeError],
    ["includeArchived that is not a boolean", (g) => g.items.list({ includeArchived: "true" as never }), TypeError],
    ["metadata with a non-string value", (g) => g.items.update("potion", { metadata: { heal: 50 } as never }), TypeError],
    ["an idempotency key option (there is none)", (g) => g.packs.get("x", { idempotencyKey: "k" } as never), RangeError],
  ];
  for (const [name, run, errorType] of bad) {
    it(`refuses ${name}`, async () => {
      const { gamecoin, calls } = harness({ json: {} });
      await assert.rejects(() => run(gamecoin), errorType);
      assert.equal(calls.length, 0);
    });
  }
});

describe("catalog management: retries", () => {
  const isError = (code: string, status: number) => (error: unknown) => error instanceof GameCoinError && error.code === code && error.status === status;

  it("a create is retried on 429 only (its outcome is unknown after a 5xx)", async () => {
    const limited = harness([apiError(429, "RATE_LIMITED", "Too many requests", undefined, { "retry-after": "2" }), { json: currencyJson }]);
    await limited.gamecoin.currencies.create({ code: "gems", name: "Gems" });
    assert.equal(limited.calls.length, 2);
    assert.deepEqual(limited.waits, [2000]);

    for (const create of [
      (g: GameCoin) => g.currencies.create({ code: "gems", name: "Gems" }),
      (g: GameCoin) => g.items.create({ sku: "x", name: "X", type: "durable" }),
      (g: GameCoin) => g.packs.create({ sku: "x", name: "X", priceCents: 499, items: [{ sku: "y", quantity: 1 }] }),
    ]) {
      const failing = harness(apiError(502, "INTERNAL", "Bad gateway"));
      await assert.rejects(() => create(failing.gamecoin), isError("INTERNAL", 502));
      assert.equal(failing.calls.length, 1);
    }
  });

  it("reads, updates and archives are retried on 5xx", async () => {
    for (const run of [
      (g: GameCoin) => g.currencies.update("gems", { name: "G" }),
      (g: GameCoin) => g.items.archive("potion"),
      (g: GameCoin) => g.packs.list(),
      (g: GameCoin) => g.packs.get("x"),
    ]) {
      const { gamecoin, calls } = harness([apiError(503, "INTERNAL", "Unavailable"), { json: { ...packJson, packs: [] } }]);
      await run(gamecoin).catch(() => undefined);
      assert.equal(calls.length, 2);
    }
  });
});
