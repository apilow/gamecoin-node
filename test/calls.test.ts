import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { GameCoinError, ext } from "../src/index.js";
import type { GameCoin } from "../src/index.js";
import {
  AT,
  ID_ORDER,
  ID_PLAYER,
  LATER,
  balanceJson,
  checkoutJson,
  emptyCatalogJson,
  entryJson,
  harness,
  movementJson,
  orderJson,
  playerJson,
  potionJson,
  type RecordedCall,
} from "./helpers.js";

const P = ext("user-42");
const PATH = "https://gamecoin.test/api/v1/players/ext%3Auser-42";

interface Case {
  name: string;
  reply: unknown;
  run: (gamecoin: GameCoin) => Promise<unknown>;
  method: string;
  url: string;
  body?: unknown;
  /** True for the ⟳ calls: an Idempotency-Key header is sent. */
  idempotent?: boolean;
}

const catalogJson = { ...emptyCatalogJson, currencies: [{ code: "gems", name: "Gems", purchasable: true }] };
const redemptionJson = {
  grants: [{ currency: "gems", amount: 50, balance: balanceJson }],
  items: [{ sku: "potion", quantity: 2 }],
  skipped: [{ sku: "fire-sword", quantity: 1 }],
};

/** Every method of SPEC § 3: the HTTP verb, the URL, the body and the idempotency header it produces. */
const cases: Case[] = [
  { name: "catalog.get()", reply: catalogJson, run: (g) => g.catalog.get(), method: "GET", url: "https://gamecoin.test/api/v1/catalog" },
  {
    name: "players.upsert(player, profile)",
    reply: playerJson,
    run: (g) => g.players.upsert(P, { displayName: "Alice", email: null, country: "BE", birthYear: 1990 }),
    method: "PUT",
    url: PATH,
    body: { displayName: "Alice", email: null, country: "BE", birthYear: 1990 },
  },
  { name: "players.upsert(player): an empty profile is {}", reply: playerJson, run: (g) => g.players.upsert(P), method: "PUT", url: PATH, body: {} },
  { name: "players.get(player)", reply: playerJson, run: (g) => g.players.get(P), method: "GET", url: PATH },
  {
    name: "players.createToken(player)",
    reply: { token: "gc_pt_x.y", expiresAt: LATER },
    run: (g) => g.players.createToken(P),
    method: "POST",
    url: `${PATH}/tokens`,
  },
  {
    name: "wallet.get(player)",
    reply: { playerId: ID_PLAYER, balances: [balanceJson] },
    run: (g) => g.wallet.get(P),
    method: "GET",
    url: `${PATH}/wallet`,
  },
  {
    name: "wallet.grant(player, params)",
    reply: movementJson,
    run: (g) => g.wallet.grant(P, { currency: "gems", amount: 100, reason: "level_up", metadata: { level: "5" } }),
    method: "POST",
    url: `${PATH}/wallet/grant`,
    body: { currency: "gems", amount: 100, reason: "level_up", metadata: { level: "5" } },
    idempotent: true,
  },
  {
    name: "wallet.spend(player, params): optional fields are left out",
    reply: movementJson,
    run: (g) => g.wallet.spend(P, { currency: "gems", amount: 30 }),
    method: "POST",
    url: `${PATH}/wallet/spend`,
    body: { currency: "gems", amount: 30 },
    idempotent: true,
  },
  {
    name: "ledger.list(player): no query string without parameters",
    reply: { entries: [entryJson], nextCursor: null },
    run: (g) => g.ledger.list(P),
    method: "GET",
    url: `${PATH}/ledger`,
  },
  {
    name: "ledger.list(player, params): currency, limit and cursor go in the query",
    reply: { entries: [], nextCursor: null },
    run: (g) => g.ledger.list(P, { currency: "gems", limit: 5, cursor: "abc def+/=" }),
    method: "GET",
    url: `${PATH}/ledger?currency=gems&limit=5&cursor=abc+def%2B%2F%3D`,
  },
  { name: "inventory.list(player)", reply: { items: [potionJson] }, run: (g) => g.inventory.list(P), method: "GET", url: `${PATH}/inventory` },
  {
    name: "inventory.grant(player, params)",
    reply: { item: potionJson },
    run: (g) => g.inventory.grant(P, { sku: "potion", quantity: 2 }),
    method: "POST",
    url: `${PATH}/inventory/grant`,
    body: { sku: "potion", quantity: 2 },
    idempotent: true,
  },
  {
    name: "inventory.consume(player, params): quantity is left out when not given (the API defaults it to 1)",
    reply: { item: potionJson },
    run: (g) => g.inventory.consume(P, { sku: "potion" }),
    method: "POST",
    url: `${PATH}/inventory/consume`,
    body: { sku: "potion" },
    idempotent: true,
  },
  {
    name: "purchases.create(player, params)",
    reply: { entry: entryJson, balance: balanceJson, item: potionJson },
    run: (g) => g.purchases.create(P, { sku: "potion", quantity: 3 }),
    method: "POST",
    url: `${PATH}/purchases`,
    body: { sku: "potion", quantity: 3 },
    idempotent: true,
  },
  {
    name: "checkouts.create(player, params)",
    reply: checkoutJson,
    run: (g) =>
      g.checkouts.create(P, { packSku: "gems-500", successUrl: "https://example.com/ok", cancelUrl: "https://example.com/no", country: "FR" }),
    method: "POST",
    url: `${PATH}/checkouts`,
    body: { packSku: "gems-500", successUrl: "https://example.com/ok", cancelUrl: "https://example.com/no", country: "FR" },
    idempotent: true,
  },
  {
    name: "checkouts.create(player, params with locale)",
    reply: checkoutJson,
    run: (g) => g.checkouts.create(P, { packSku: "gems-500", locale: "nl" }),
    method: "POST",
    url: `${PATH}/checkouts`,
    body: { packSku: "gems-500", locale: "nl" },
    idempotent: true,
  },
  {
    name: "checkouts.create(player, only a pack): locale is not sent when absent",
    reply: checkoutJson,
    run: (g) => g.checkouts.create(P, { packSku: "gems-500", locale: undefined }),
    method: "POST",
    url: `${PATH}/checkouts`,
    body: { packSku: "gems-500" },
    idempotent: true,
  },
  {
    name: "checkouts.create(player, params with creatorCode)",
    reply: checkoutJson,
    run: (g) => g.checkouts.create(P, { packSku: "gems-500", creatorCode: "ALICE10" }),
    method: "POST",
    url: `${PATH}/checkouts`,
    body: { packSku: "gems-500", creatorCode: "ALICE10" },
    idempotent: true,
  },
  {
    name: "checkouts.create(player, only a pack): creatorCode is not sent when absent",
    reply: checkoutJson,
    run: (g) => g.checkouts.create(P, { packSku: "gems-500", creatorCode: undefined }),
    method: "POST",
    url: `${PATH}/checkouts`,
    body: { packSku: "gems-500" },
    idempotent: true,
  },
  {
    name: "codes.redeem(player, code): the code is sent as typed",
    reply: redemptionJson,
    run: (g) => g.codes.redeem(P, " gift-2026 ab "),
    method: "POST",
    url: `${PATH}/codes/redeem`,
    body: { code: " gift-2026 ab " },
    idempotent: true,
  },
  { name: "orders.get(orderId)", reply: orderJson, run: (g) => g.orders.get(ID_ORDER), method: "GET", url: `https://gamecoin.test/api/v1/orders/${ID_ORDER}` },
  {
    name: "orders.refund(orderId, params): no idempotency key",
    reply: { ...orderJson, status: "refunded", refundedAt: LATER },
    run: (g) => g.orders.refund(ID_ORDER, { reason: "chargeback risk" }),
    method: "POST",
    url: `https://gamecoin.test/api/v1/orders/${ID_ORDER}/refund`,
    body: { reason: "chargeback risk" },
  },
  {
    name: "orders.refund(orderId): an empty refund is {}",
    reply: orderJson,
    run: (g) => g.orders.refund(ID_ORDER),
    method: "POST",
    url: `https://gamecoin.test/api/v1/orders/${ID_ORDER}/refund`,
    body: {},
  },
];

describe("every method: verb, URL, query, body, idempotency header", () => {
  for (const testCase of cases) {
    it(testCase.name, async () => {
      const { gamecoin, calls } = harness({ json: testCase.reply });
      await testCase.run(gamecoin);
      assert.equal(calls.length, 1);
      const [call] = calls as [RecordedCall];
      assert.equal(call.method, testCase.method);
      assert.equal(call.url, testCase.url);
      assert.deepEqual(call.body, testCase.body);
      if (testCase.idempotent) assert.match(call.headers["idempotency-key"] ?? "", /^[\x20-\x7E]{1,100}$/);
      else assert.equal(call.headers["idempotency-key"], undefined);
    });
  }

  it("covers the 17 methods of the specification", () => {
    const names = new Set(cases.map((c) => c.name.split("(")[0]));
    assert.deepEqual(
      [...names].sort(),
      [
        "catalog.get",
        "checkouts.create",
        "codes.redeem",
        "inventory.consume",
        "inventory.grant",
        "inventory.list",
        "ledger.list",
        "orders.get",
        "orders.refund",
        "players.createToken",
        "players.get",
        "players.upsert",
        "purchases.create",
        "wallet.get",
        "wallet.grant",
        "wallet.spend",
      ],
    );
  });
});

describe("player references: URL-encoded exactly once", () => {
  const encoded: [string, string][] = [
    ["user-42", "ext%3Auser-42"],
    ["user 42", "ext%3Auser%2042"],
    ["a/b", "ext%3Aa%2Fb"],
    ["../../x", "ext%3A..%2F..%2Fx"],
    ["100%", "ext%3A100%25"],
    ["a%20b", "ext%3Aa%2520b"],
    ["é日本", "ext%3A%C3%A9%E6%97%A5%E6%9C%AC"],
    ["a?b#c&d=e", "ext%3Aa%3Fb%23c%26d%3De"],
    ["emoji 🎮", "ext%3Aemoji%20%F0%9F%8E%AE"],
  ];

  it("ext() prefixes the id and rejects an empty or non-string id", () => {
    assert.equal(ext("user-42"), "ext:user-42");
    assert.equal(ext("a b/c"), "ext:a b/c");
    assert.throws(() => ext(""), RangeError);
    assert.throws(() => ext(42 as never), TypeError);
    assert.throws(() => ext(undefined as never), TypeError);
  });

  for (const [id, segment] of encoded) {
    it(`ext(${JSON.stringify(id)}) travels as ${segment}`, async () => {
      const { gamecoin, calls } = harness({ json: { playerId: ID_PLAYER, balances: [] } });
      await gamecoin.wallet.get(ext(id));
      assert.equal(calls[0]?.url, `https://gamecoin.test/api/v1/players/${segment}/wallet`);
      // What the server decodes (once) is exactly what was sent.
      const sent = (calls[0]?.url ?? "").split("/players/")[1]?.split("/wallet")[0] ?? "";
      assert.equal(decodeURIComponent(sent), `ext:${id}`);
    });
  }

  it("a GameCoin player id goes through unchanged, and grant and spend encode like the reads", async () => {
    const reads = harness([{ json: playerJson }, { json: { playerId: ID_PLAYER, balances: [] } }]);
    await reads.gamecoin.players.get(ID_PLAYER);
    await reads.gamecoin.wallet.get(ID_PLAYER);
    assert.deepEqual(
      reads.calls.map((c) => c.url),
      [`https://gamecoin.test/api/v1/players/${ID_PLAYER}`, `https://gamecoin.test/api/v1/players/${ID_PLAYER}/wallet`],
    );
    const writes = harness({ json: movementJson });
    await writes.gamecoin.wallet.grant(ext("a b"), { currency: "gems", amount: 1 });
    await writes.gamecoin.wallet.spend(ext("a b"), { currency: "gems", amount: 1 });
    assert.deepEqual(
      writes.calls.map((c) => c.url),
      ["https://gamecoin.test/api/v1/players/ext%3Aa%20b/wallet/grant", "https://gamecoin.test/api/v1/players/ext%3Aa%20b/wallet/spend"],
    );
  });

  it("order ids are encoded too", async () => {
    const { gamecoin, calls } = harness({ json: orderJson });
    await gamecoin.orders.get("a/b c");
    assert.equal(calls[0]?.url, "https://gamecoin.test/api/v1/orders/a%2Fb%20c");
  });
});

describe("arguments are checked before any request", () => {
  const P1 = ext("u");
  const invalid: { name: string; error: ErrorConstructor; run: (g: GameCoin) => Promise<unknown> }[] = [
    { name: "empty player", error: RangeError, run: (g) => g.players.get("") },
    { name: "non-string player", error: TypeError, run: (g) => g.wallet.get(42 as never) },
    { name: "zero amount", error: RangeError, run: (g) => g.wallet.grant(P1, { currency: "gems", amount: 0 }) },
    { name: "negative amount", error: RangeError, run: (g) => g.wallet.spend(P1, { currency: "gems", amount: -5 }) },
    { name: "fractional amount", error: RangeError, run: (g) => g.wallet.grant(P1, { currency: "gems", amount: 1.5 }) },
    { name: "NaN amount", error: RangeError, run: (g) => g.wallet.grant(P1, { currency: "gems", amount: Number.NaN }) },
    { name: "infinite amount", error: RangeError, run: (g) => g.wallet.grant(P1, { currency: "gems", amount: Infinity }) },
    { name: "string amount", error: TypeError, run: (g) => g.wallet.grant(P1, { currency: "gems", amount: "10" as never }) },
    { name: "missing currency", error: TypeError, run: (g) => g.wallet.grant(P1, { amount: 1 } as never) },
    { name: "empty currency", error: RangeError, run: (g) => g.wallet.grant(P1, { currency: "", amount: 1 }) },
    { name: "unknown field (a grant cannot be 'paid')", error: RangeError, run: (g) => g.wallet.grant(P1, { currency: "gems", amount: 1, paid: 1 } as never) },
    { name: "non-string metadata value", error: TypeError, run: (g) => g.wallet.grant(P1, { currency: "gems", amount: 1, metadata: { level: 5 } as never }) },
    { name: "non-string reason", error: TypeError, run: (g) => g.wallet.grant(P1, { currency: "gems", amount: 1, reason: 5 as never }) },
    { name: "missing params", error: TypeError, run: (g) => g.wallet.grant(P1, undefined as never) },
    { name: "fractional quantity", error: RangeError, run: (g) => g.inventory.consume(P1, { sku: "potion", quantity: 0.5 }) },
    { name: "zero quantity", error: RangeError, run: (g) => g.purchases.create(P1, { sku: "potion", quantity: 0 }) },
    { name: "empty sku", error: RangeError, run: (g) => g.inventory.grant(P1, { sku: "" }) },
    { name: "empty packSku", error: RangeError, run: (g) => g.checkouts.create(P1, { packSku: "" }) },
    { name: "empty locale", error: RangeError, run: (g) => g.checkouts.create(P1, { packSku: "x", locale: "" }) },
    { name: "locale of the wrong type", error: TypeError, run: (g) => g.checkouts.create(P1, { packSku: "x", locale: 3 as never }) },
    { name: "empty creatorCode", error: RangeError, run: (g) => g.checkouts.create(P1, { packSku: "x", creatorCode: "" }) },
    { name: "creatorCode of the wrong type", error: TypeError, run: (g) => g.checkouts.create(P1, { packSku: "x", creatorCode: 3 as never }) },
    { name: "empty gift code", error: RangeError, run: (g) => g.codes.redeem(P1, "") },
    { name: "gift code of the wrong type", error: TypeError, run: (g) => g.codes.redeem(P1, 42 as never) },
    { name: "missing gift code", error: TypeError, run: (g) => g.codes.redeem(P1, undefined as never) },
    { name: "gift code given as an object", error: TypeError, run: (g) => g.codes.redeem(P1, { code: "X" } as never) },
    { name: "redeem for an empty player", error: RangeError, run: (g) => g.codes.redeem("", "X") },
    { name: "redeem with an unknown option", error: RangeError, run: (g) => g.codes.redeem(P1, "X", { foo: 1 } as never) },
    { name: "unknown checkout field", error: RangeError, run: (g) => g.checkouts.create(P1, { packSku: "x", currency: "EUR" } as never) },
    { name: "ledger limit 0", error: RangeError, run: (g) => g.ledger.list(P1, { limit: 0 }) },
    { name: "ledger limit 101", error: RangeError, run: (g) => g.ledger.list(P1, { limit: 101 }) },
    { name: "ledger limit not an integer", error: RangeError, run: (g) => g.ledger.list(P1, { limit: 2.5 }) },
    { name: "profile birthYear as a string", error: TypeError, run: (g) => g.players.upsert(P1, { birthYear: "1990" as never }) },
    { name: "profile unknown field", error: RangeError, run: (g) => g.players.upsert(P1, { blocked: true } as never) },
    { name: "empty order id", error: RangeError, run: (g) => g.orders.get("") },
    { name: "refund reason not a string", error: TypeError, run: (g) => g.orders.refund(ID_ORDER, { reason: 7 as never }) },
    { name: "empty idempotency key", error: RangeError, run: (g) => g.wallet.grant(P1, { currency: "gems", amount: 1 }, { idempotencyKey: "" }) },
    { name: "non-ASCII idempotency key", error: RangeError, run: (g) => g.wallet.grant(P1, { currency: "gems", amount: 1 }, { idempotencyKey: "clé" }) },
    { name: "idempotency key over 100 characters", error: RangeError, run: (g) => g.wallet.grant(P1, { currency: "gems", amount: 1 }, { idempotencyKey: "k".repeat(101) }) },
    { name: "idempotency key of the wrong type", error: TypeError, run: (g) => g.wallet.grant(P1, { currency: "gems", amount: 1 }, { idempotencyKey: 5 as never }) },
    { name: "idempotency key on a read", error: RangeError, run: (g) => g.wallet.get(P1, { idempotencyKey: "k" } as never) },
    { name: "signal of the wrong type", error: TypeError, run: (g) => g.wallet.get(P1, { signal: "abort" as never }) },
  ];

  for (const { name, error, run } of invalid) {
    it(`${name}: ${error.name}, no request`, async () => {
      const { gamecoin, calls } = harness({ json: {} });
      await assert.rejects(() => run(gamecoin), error);
      assert.equal(calls.length, 0);
    });
  }

  it("ledger.iterate checks its arguments right away", () => {
    const { gamecoin, calls } = harness({ json: {} });
    assert.throws(() => gamecoin.ledger.iterate("", {}), RangeError);
    assert.throws(() => gamecoin.ledger.iterate(P1, { limit: 0 }), RangeError);
    assert.throws(() => gamecoin.ledger.iterate(P1, { cursor: "x" } as never), RangeError);
    assert.equal(calls.length, 0);
  });

  it("error messages name the argument and never repeat its value", async () => {
    const { gamecoin } = harness({ json: {} });
    const secret = "do-not-echo-me";
    await assert.rejects(
      () => gamecoin.wallet.grant(P1, { currency: secret, amount: "x" as never }),
      (error: unknown) => error instanceof TypeError && /params\.amount/.test(error.message) && !error.message.includes(secret),
    );
    await assert.rejects(
      () => gamecoin.wallet.grant(P1, { currency: "gems", amount: 1, [secret]: 1 } as never),
      (error: unknown) => error instanceof RangeError && error.message.includes("unknown field"),
    );
  });
});

describe("responses become typed objects", () => {
  it("parses a player, with its dates as Date", async () => {
    const { gamecoin } = harness({ json: playerJson });
    const player = await gamecoin.players.get(P);
    assert.deepEqual(player, {
      id: ID_PLAYER,
      externalId: "user-42",
      kind: "external",
      displayName: "Alice",
      country: "BE",
      blocked: false,
      createdAt: new Date(AT),
    });
    assert.ok(player.createdAt instanceof Date);
    const anonymous = await harness({ json: { ...playerJson, externalId: null, kind: "hosted", displayName: null, country: null } }).gamecoin.players.get(P);
    assert.equal(anonymous.externalId, null);
    assert.equal(anonymous.kind, "hosted");
  });

  it("parses a wallet and its balances", async () => {
    const wallet = await harness({ json: { playerId: ID_PLAYER, balances: [balanceJson, { currency: "gold", paid: 0, bonus: 0, total: 0 }] } }).gamecoin.wallet.get(P);
    assert.deepEqual(wallet, { playerId: ID_PLAYER, balances: [balanceJson, { currency: "gold", paid: 0, bonus: 0, total: 0 }] });
  });

  it("parses a movement, a ledger entry (dates, ref, metadata) and a ledger page", async () => {
    const withRef = { ...entryJson, type: "spend", bonusDelta: -20, reason: null, metadata: {}, ref: { itemSku: "potion", orderId: ID_ORDER } };
    const { gamecoin } = harness([{ json: movementJson }, { json: { entries: [withRef, entryJson], nextCursor: "next" } }]);
    const movement = await gamecoin.wallet.grant(P, { currency: "gems", amount: 100 });
    assert.deepEqual(movement.balance, balanceJson);
    assert.equal(movement.replayed, false);
    assert.ok(movement.entry.createdAt instanceof Date);
    assert.equal(movement.entry.createdAt.toISOString(), AT);
    assert.deepEqual(movement.entry.balanceAfter, { paid: 0, bonus: 100, total: 100 });
    assert.deepEqual(movement.entry.metadata, { level: "5" });
    assert.deepEqual(movement.entry.ref, {});
    const page = await gamecoin.ledger.list(P);
    assert.equal(page.nextCursor, "next");
    assert.deepEqual(page.entries[0]?.ref, { itemSku: "potion", orderId: ID_ORDER });
    assert.equal(page.entries[0]?.reason, null);
    assert.equal(page.entries[0]?.type, "spend");
  });

  it("parses inventory items, a purchase and the result of a grant (item fields at the top level)", async () => {
    const { gamecoin } = harness([
      { json: { items: [potionJson] } },
      { json: { item: potionJson } },
      { json: { entry: entryJson, balance: balanceJson, item: potionJson } },
    ]);
    const items = await gamecoin.inventory.list(P);
    assert.deepEqual(items, [{ sku: "potion", quantity: 2, updatedAt: new Date(AT) }]);
    const granted = await gamecoin.inventory.grant(P, { sku: "potion" });
    assert.deepEqual(granted, { sku: "potion", quantity: 2, updatedAt: new Date(AT), replayed: false });
    const purchase = await gamecoin.purchases.create(P, { sku: "potion" });
    assert.deepEqual(Object.keys(purchase).sort(), ["balance", "entry", "item", "replayed"]);
    assert.equal(purchase.item.quantity, 2);
  });

  it("parses the catalog: currencies, items (with and without price) and packs", async () => {
    const catalog = await harness({
      json: {
        currencies: [{ code: "gems", name: "Gems", purchasable: true, ignored: "field" }],
        items: [
          { sku: "potion", name: "Potion", description: null, type: "consumable", price: { currency: "gems", amount: 20 }, maxOwned: null, clientPurchasable: true, metadata: {} },
          { sku: "badge", name: "Badge", description: "Shiny", type: "durable", price: null, maxOwned: 1, clientPurchasable: false, metadata: { rarity: "epic" } },
        ],
        packs: [
          { sku: "gems-500", name: "500 gems", description: null, priceCents: 499, currency: "EUR", grants: [{ currency: "gems", amount: 500, bonus: 50 }], items: [{ sku: "potion", quantity: 2 }], badge: "best", maxPerPlayer: null, availability: null },
          {
            sku: "founder",
            name: "Founder pack",
            description: null,
            priceCents: 2999,
            currency: "EUR",
            grants: [],
            items: [],
            badge: null,
            maxPerPlayer: 1,
            availability: { startsAt: AT, endsAt: null, remaining: 12, founder: true, ignored: 1 },
          },
          {
            sku: "weekend",
            name: "Weekend pack",
            description: null,
            priceCents: 999,
            currency: "EUR",
            grants: [],
            items: [],
            badge: null,
            maxPerPlayer: null,
            availability: { startsAt: null, endsAt: LATER, remaining: null, founder: false },
          },
        ],
        prelaunch: true,
        launchAt: LATER,
      },
    }).gamecoin.catalog.get();
    assert.deepEqual(catalog.currencies, [{ code: "gems", name: "Gems", purchasable: true }]);
    assert.deepEqual(catalog.items[0]?.price, { currency: "gems", amount: 20 });
    assert.equal(catalog.items[1]?.price, null);
    assert.equal(catalog.items[1]?.maxOwned, 1);
    assert.deepEqual(catalog.items[1]?.metadata, { rarity: "epic" });
    assert.deepEqual(catalog.packs[0]?.grants, [{ currency: "gems", amount: 500, bonus: 50 }]);
    assert.deepEqual(catalog.packs[0]?.items, [{ sku: "potion", quantity: 2 }]);
    assert.equal(catalog.packs[0]?.badge, "best");
    assert.equal(catalog.packs[0]?.maxPerPlayer, null);
  });

  it("parses pack availability (null, bounded, open-ended), prelaunch and launchAt", async () => {
    const catalog = await harness({
      json: {
        ...emptyCatalogJson,
        prelaunch: true,
        launchAt: LATER,
        packs: [
          { sku: "a", name: "A", description: null, priceCents: 1, currency: "EUR", grants: [], items: [], badge: null, maxPerPlayer: null, availability: null },
          { sku: "b", name: "B", description: null, priceCents: 1, currency: "EUR", grants: [], items: [], badge: null, maxPerPlayer: null, availability: { startsAt: AT, endsAt: LATER, remaining: 0, founder: true, extra: 1 } },
          { sku: "c", name: "C", description: null, priceCents: 1, currency: "EUR", grants: [], items: [], badge: null, maxPerPlayer: null, availability: { startsAt: null, endsAt: null, remaining: null, founder: false } },
        ],
      },
    }).gamecoin.catalog.get();
    assert.equal(catalog.prelaunch, true);
    assert.ok(catalog.launchAt instanceof Date);
    assert.equal(catalog.launchAt.toISOString(), LATER);
    assert.equal(catalog.packs[0]?.availability, null);
    const bounded = catalog.packs[1]?.availability;
    assert.ok(bounded);
    assert.deepEqual(bounded, { startsAt: new Date(AT), endsAt: new Date(LATER), remaining: 0, founder: true });
    assert.ok(bounded.startsAt instanceof Date && bounded.endsAt instanceof Date);
    assert.deepEqual(catalog.packs[2]?.availability, { startsAt: null, endsAt: null, remaining: null, founder: false });
    const plain = await harness({ json: emptyCatalogJson }).gamecoin.catalog.get();
    assert.equal(plain.prelaunch, false);
    assert.equal(plain.launchAt, null);
  });

  it("reads an absent Pack.availability as null, an absent Catalog.prelaunch as false and an absent Catalog.launchAt as null", async () => {
    const pack = { sku: "a", name: "A", description: null, priceCents: 1, currency: "EUR", grants: [], items: [], badge: null, maxPerPlayer: null };
    const { prelaunch: _p, launchAt: _l, ...bare } = emptyCatalogJson as Record<string, unknown>;
    const noAvailability = await harness({ json: { ...emptyCatalogJson, packs: [pack] } }).gamecoin.catalog.get();
    assert.equal(noAvailability.packs[0]?.availability, null);
    const noPrelaunch = await harness({ json: { ...bare, launchAt: LATER } }).gamecoin.catalog.get();
    assert.equal(noPrelaunch.prelaunch, false);
    assert.equal(noPrelaunch.launchAt?.toISOString(), LATER);
    const noLaunchAt = await harness({ json: { ...bare, prelaunch: true } }).gamecoin.catalog.get();
    assert.equal(noLaunchAt.prelaunch, true);
    assert.equal(noLaunchAt.launchAt, null);
    const neither = await harness({ json: bare }).gamecoin.catalog.get();
    assert.equal(neither.prelaunch, false);
    assert.equal(neither.launchAt, null);
  });

  it("reads an absent Order.creatorCode as null", async () => {
    const { creatorCode: _c, ...bare } = orderJson as Record<string, unknown>;
    assert.equal((await harness({ json: bare }).gamecoin.orders.get(ID_ORDER)).creatorCode, null);
  });

  it("rejects a catalog or an availability of the wrong shape as INVALID_RESPONSE", async () => {
    const pack = { sku: "a", name: "A", description: null, priceCents: 1, currency: "EUR", grants: [], items: [], badge: null, maxPerPlayer: null };
    const bad: unknown[] = [
      { ...emptyCatalogJson, prelaunch: "yes" },
      { ...emptyCatalogJson, launchAt: "tomorrow" },
      { ...emptyCatalogJson, prelaunch: null },
      { ...emptyCatalogJson, launchAt: 12 },
      { ...emptyCatalogJson, packs: [{ ...pack, availability: "always" }] },
      { ...emptyCatalogJson, packs: [{ ...pack, availability: { startsAt: null, endsAt: null, remaining: 1.5, founder: false } }] },
      { ...emptyCatalogJson, packs: [{ ...pack, availability: { startsAt: null, endsAt: null, remaining: null } }] },
      { ...emptyCatalogJson, packs: [{ ...pack, availability: { startsAt: "nope", endsAt: null, remaining: null, founder: false } }] },
    ];
    for (const json of bad) {
      await assert.rejects(
        () => harness({ json }).gamecoin.catalog.get(),
        (error: unknown) => error instanceof GameCoinError && error.code === "INVALID_RESPONSE",
      );
    }
  });

  it("parses Order.creatorCode: an object with the creator's name, or null", async () => {
    const withCode = { ...orderJson, creatorCode: { code: "ALICE10", creatorName: "Alice", rate: 10 } };
    const { gamecoin } = harness([{ json: withCode }, { json: orderJson }, { json: { ...orderJson, creatorCode: { code: "X" } } }]);
    const order = await gamecoin.orders.get(ID_ORDER);
    assert.deepEqual(order.creatorCode, { code: "ALICE10", creatorName: "Alice" });
    assert.equal((await gamecoin.orders.get(ID_ORDER)).creatorCode, null);
    await assert.rejects(
      () => gamecoin.orders.get(ID_ORDER),
      (error: unknown) => error instanceof GameCoinError && error.code === "INVALID_RESPONSE",
    );
  });

  it("parses a redemption: grants with their balance, items, skipped items, and replayed", async () => {
    const { gamecoin } = harness([{ json: redemptionJson }, { json: { grants: [], items: [], skipped: [] }, headers: { "Idempotent-Replayed": "true" } }]);
    const redemption = await gamecoin.codes.redeem(P, "GIFT");
    assert.deepEqual(redemption, { ...redemptionJson, replayed: false });
    assert.deepEqual(redemption.grants[0]?.balance, balanceJson);
    const replay = await gamecoin.codes.redeem(P, "GIFT", { idempotencyKey: "k-1" });
    assert.deepEqual(replay, { grants: [], items: [], skipped: [], replayed: true });
  });

  it("rejects a redemption of the wrong shape as INVALID_RESPONSE", async () => {
    for (const json of [{ ...redemptionJson, skipped: undefined }, { ...redemptionJson, grants: [{ currency: "gems", amount: 5 }] }, { ...redemptionJson, items: [{ sku: "p", quantity: "2" }] }]) {
      await assert.rejects(
        () => harness({ json }).gamecoin.codes.redeem(P, "GIFT"),
        (error: unknown) => error instanceof GameCoinError && error.code === "INVALID_RESPONSE",
      );
    }
  });

  it("parses orders: money as integers, dates as Date or null, unknown fields ignored", async () => {
    const paid = { ...orderJson, status: "fulfilled", paidAt: AT, fulfilledAt: LATER, extra: { ignored: true } };
    const { gamecoin } = harness([{ json: checkoutJson }, { json: paid }]);
    const checkout = await gamecoin.checkouts.create(P, { packSku: "gems-500" });
    assert.equal(checkout.checkoutUrl, checkoutJson.checkoutUrl);
    assert.equal(checkout.order.status, "pending");
    assert.equal(checkout.order.paidAt, null);
    assert.equal(checkout.replayed, false);
    const order = await gamecoin.orders.get(ID_ORDER);
    assert.equal(order.status, "fulfilled");
    assert.equal(order.amountCents, 499);
    assert.equal(order.vatRateBp, 2100);
    assert.deepEqual(order.pack, { sku: "gems-500", name: "500 gems" });
    assert.ok(order.paidAt instanceof Date && order.fulfilledAt instanceof Date);
    assert.equal(order.fulfilledAt.toISOString(), LATER);
    assert.equal(order.refundedAt, null);
    assert.ok(!("extra" in order));
  });

  it("parses a player token", async () => {
    const token = await harness({ json: { token: "gc_pt_a.b", expiresAt: LATER } }).gamecoin.players.createToken(P);
    assert.deepEqual(token, { token: "gc_pt_a.b", expiresAt: new Date(LATER) });
  });

  it("an unexpected status or value of an open list is passed through (the API may add values)", async () => {
    const order = await harness({ json: { ...orderJson, status: "disputed" } }).gamecoin.orders.get(ID_ORDER);
    assert.equal(order.status, "disputed" as never);
  });
});
