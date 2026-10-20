import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { before, describe, it } from "node:test";
import { ErrorCode, GameCoin, GameCoinError, ext } from "../src/index.js";

/**
 * Integration test against the GameCoin sandbox game (created by `npm run sdk:sandbox` in the application repository):
 * currencies `gems` (paid) and `gold` (free); items `potion` (consumable, 20 gems) and `fire-sword` (durable, 300 gems,
 * one at most); packs `starter` and `gems-500`.
 *
 * Skipped unless GAMECOIN_BASE_URL and GAMECOIN_SECRET_KEY are set. GAMECOIN_ENV_FILE may name a dotenv file that
 * provides them (the file is read, never printed). The secret key is never written to the output.
 */

function loadEnvFile(file: string | undefined): void {
  if (!file) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    if (line.trimStart().startsWith("#")) continue;
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    const name = match?.[1];
    if (name === undefined || process.env[name] !== undefined) continue;
    process.env[name] = (match?.[2] ?? "").replace(/^(["'])(.*)\1$/, "$2");
  }
}

loadEnvFile(process.env.GAMECOIN_ENV_FILE);
const ready = Boolean(process.env.GAMECOIN_SECRET_KEY && process.env.GAMECOIN_BASE_URL);

async function failure(promise: Promise<unknown>): Promise<GameCoinError> {
  try {
    await promise;
  } catch (error) {
    assert.ok(error instanceof GameCoinError, "expected a GameCoinError");
    return error;
  }
  throw new Error("the call should have failed");
}

describe("integration: sandbox game", { skip: ready ? false : "set GAMECOIN_BASE_URL and GAMECOIN_SECRET_KEY to run it" }, () => {
  let gamecoin: GameCoin;
  // A fresh player for every run, so that the wallet starts empty.
  const externalId = `sdk-node-${randomUUID()}`;
  const player = ext(externalId);
  const grantKey = `grant-${randomUUID()}`;
  let orderId = "";

  before(() => {
    gamecoin = new GameCoin(process.env.GAMECOIN_SECRET_KEY as string, { baseUrl: process.env.GAMECOIN_BASE_URL as string });
  });

  it("uses a test key", () => {
    assert.equal(gamecoin.environment, "test");
  });

  it("catalog: gems, gold, potion, fire-sword, starter and gems-500", async () => {
    const catalog = await gamecoin.catalog.get();
    const gems = catalog.currencies.find((c) => c.code === "gems");
    const gold = catalog.currencies.find((c) => c.code === "gold");
    assert.equal(gems?.purchasable, true);
    assert.equal(gold?.purchasable, false);
    const potion = catalog.items.find((i) => i.sku === "potion");
    assert.equal(potion?.type, "consumable");
    assert.deepEqual(potion?.price, { currency: "gems", amount: 20 });
    const sword = catalog.items.find((i) => i.sku === "fire-sword");
    assert.equal(sword?.type, "durable");
    assert.deepEqual(sword?.price, { currency: "gems", amount: 300 });
    assert.equal(sword?.maxOwned, 1);
    assert.deepEqual(catalog.packs.map((p) => p.sku).sort(), ["gems-500", "starter"]);
  });

  it("upserts a fresh ext: player", async () => {
    const created = await gamecoin.players.upsert(player, { displayName: "SDK Node test" });
    assert.equal(created.externalId, externalId);
    assert.equal(created.kind, "external");
    assert.equal(created.displayName, "SDK Node test");
    assert.equal(created.blocked, false);
    assert.ok(created.createdAt instanceof Date);
    assert.equal((await gamecoin.players.get(player)).id, created.id);
  });

  it("grants 100 gems", async () => {
    const result = await gamecoin.wallet.grant(player, { currency: "gems", amount: 100, reason: "level_up", metadata: { level: "5" } }, { idempotencyKey: grantKey });
    assert.equal(result.replayed, false);
    assert.equal(result.entry.type, "grant");
    assert.deepEqual(result.entry.metadata, { level: "5" });
    assert.deepEqual(result.balance, { currency: "gems", paid: 0, bonus: 100, total: 100 });
  });

  it("replays the same key: same entry, replayed is true, nothing is credited twice", async () => {
    const again = await gamecoin.wallet.grant(player, { currency: "gems", amount: 100, reason: "level_up", metadata: { level: "5" } }, { idempotencyKey: grantKey });
    assert.equal(again.replayed, true);
    assert.equal(again.balance.total, 100);
    const wallet = await gamecoin.wallet.get(player);
    assert.equal(wallet.balances.find((b) => b.currency === "gems")?.total, 100);
  });

  it("the same key with another request is IDEMPOTENCY_CONFLICT", async () => {
    const error = await failure(gamecoin.wallet.grant(player, { currency: "gems", amount: 7 }, { idempotencyKey: grantKey }));
    assert.equal(error.code, ErrorCode.IDEMPOTENCY_CONFLICT);
    assert.equal(error.status, 409);
  });

  it("spends 30 gems", async () => {
    const result = await gamecoin.wallet.spend(player, { currency: "gems", amount: 30, reason: "revive" });
    assert.equal(result.entry.type, "spend");
    assert.equal(result.entry.bonusDelta, -30);
    assert.equal(result.balance.total, 70);
  });

  it("spending too much is INSUFFICIENT_FUNDS with required and available", async () => {
    const error = await failure(gamecoin.wallet.spend(player, { currency: "gems", amount: 1000 }));
    assert.equal(error.code, ErrorCode.INSUFFICIENT_FUNDS);
    assert.equal(error.status, 409);
    assert.equal(error.details.required, 1000);
    assert.equal(error.details.available, 70);
  });

  it("wallet: one line per active currency, zeros included", async () => {
    const wallet = await gamecoin.wallet.get(player);
    assert.deepEqual(
      wallet.balances.map((b) => [b.currency, b.total]).sort(),
      [
        ["gems", 70],
        ["gold", 0],
      ],
    );
  });

  it("ledger: iterates every entry page by page, newest first", async () => {
    const page = await gamecoin.ledger.list(player, { limit: 1 });
    assert.equal(page.entries.length, 1);
    assert.notEqual(page.nextCursor, null, "two entries, one per page");
    const types: string[] = [];
    for await (const entry of gamecoin.ledger.iterate(player, { limit: 1 })) types.push(entry.type);
    assert.deepEqual(types, ["spend", "grant"]);
    const gold = [];
    for await (const entry of gamecoin.ledger.iterate(player, { currency: "gold" })) gold.push(entry);
    assert.equal(gold.length, 0);
  });

  it("issues a player token", async () => {
    const issued = await gamecoin.players.createToken(player);
    assert.match(issued.token, /^gc_pt_/);
    assert.ok(issued.expiresAt.getTime() > Date.now());
  });

  it("grants and consumes a potion; the inventory lists owned items only", async () => {
    const granted = await gamecoin.inventory.grant(player, { sku: "potion" });
    assert.equal(granted.sku, "potion");
    assert.equal(granted.quantity, 1);
    assert.equal(granted.replayed, false);
    assert.deepEqual((await gamecoin.inventory.list(player)).map((i) => [i.sku, i.quantity]), [["potion", 1]]);
    const consumed = await gamecoin.inventory.consume(player, { sku: "potion" });
    assert.equal(consumed.quantity, 0, "the item is returned even at 0");
    assert.deepEqual(await gamecoin.inventory.list(player), []);
    const error = await failure(gamecoin.inventory.consume(player, { sku: "potion" }));
    assert.equal(error.code, ErrorCode.INSUFFICIENT_FUNDS);
  });

  it("purchases a potion with gems", async () => {
    const result = await gamecoin.purchases.create(player, { sku: "potion" });
    assert.equal(result.item.sku, "potion");
    assert.equal(result.item.quantity, 1);
    assert.equal(result.balance.total, 50);
    assert.equal(result.entry.type, "spend");
    assert.equal(result.entry.ref.itemSku, "potion");
    assert.equal(result.replayed, false);
  });

  it("checks out gems-500: a pending order and a payment URL", async () => {
    const result = await gamecoin.checkouts.create(player, { packSku: "gems-500" });
    assert.equal(result.replayed, false);
    assert.equal(result.order.status, "pending");
    assert.equal(result.order.pack.sku, "gems-500");
    assert.equal(result.order.currency, "EUR");
    assert.equal(result.order.paidAt, null);
    assert.ok(result.order.amountCents > 0);
    assert.ok(result.checkoutUrl.includes(`/pay/${result.order.id}`));
    orderId = result.order.id;
  });

  it("reads the order back", async () => {
    const order = await gamecoin.orders.get(orderId);
    assert.equal(order.id, orderId);
    assert.equal(order.status, "pending");
    assert.ok(order.createdAt instanceof Date);
  });

  it("refunding an unpaid order is CONFLICT", async () => {
    const error = await failure(gamecoin.orders.refund(orderId, { reason: "never paid" }));
    assert.equal(error.code, ErrorCode.CONFLICT);
    assert.equal(error.status, 409);
    assert.equal((await gamecoin.orders.get(orderId)).status, "pending");
  });

  it("an unknown player is NOT_FOUND on a read (and an unknown order too)", async () => {
    const error = await failure(gamecoin.players.get(ext(`unknown-${randomUUID()}`)));
    assert.equal(error.code, ErrorCode.NOT_FOUND);
    assert.equal(error.status, 404);
    assert.equal((await failure(gamecoin.wallet.get(ext(`unknown-${randomUUID()}`)))).code, ErrorCode.NOT_FOUND);
    assert.equal((await failure(gamecoin.orders.get("0".repeat(24)))).code, ErrorCode.NOT_FOUND);
  });

  it("an id with spaces, slashes, % and accents round-trips through the URL", async () => {
    const odd = ext(`odd id/with 100% é日本?#&=-${randomUUID()}`);
    const created = await gamecoin.players.upsert(odd);
    assert.equal(created.externalId, odd.slice(4));
    const moved = await gamecoin.wallet.grant(odd, { currency: "gold", amount: 5 });
    assert.equal(moved.balance.total, 5);
    assert.equal((await gamecoin.players.get(odd)).id, created.id);
  });
});

describe("integration: catalog management", { skip: ready ? false : "set GAMECOIN_BASE_URL and GAMECOIN_SECRET_KEY to run it" }, () => {
  let gamecoin: GameCoin;
  // A fresh suffix for every run: a code or a sku is never reusable, even once archived.
  const suffix = randomUUID().replace(/-/g, "").slice(0, 10);
  const code = `ruby_${suffix}`;
  const itemSku = `elixir-${suffix}`;
  const packSku = `mega-${suffix}`;

  before(() => {
    gamecoin = new GameCoin(process.env.GAMECOIN_SECRET_KEY as string, { baseUrl: process.env.GAMECOIN_BASE_URL as string });
  });

  it("creates, changes, lists and archives a currency, an item and a pack", async () => {
    const currency = await gamecoin.currencies.create({ code, name: "Ruby", purchasable: true });
    assert.equal(currency.status, "active");
    assert.ok(currency.createdAt instanceof Date);
    assert.equal((await gamecoin.currencies.update(code, { name: "Red ruby" })).name, "Red ruby");

    const item = await gamecoin.items.create({ sku: itemSku, name: "Elixir", type: "consumable", price: { currency: code, amount: 15 }, clientPurchasable: true, metadata: { heal: "30" } });
    assert.deepEqual(item.price, { currency: code, amount: 15 });
    assert.equal((await gamecoin.items.update(itemSku, { price: { currency: code, amount: 25 } })).price?.amount, 25);

    const pack = await gamecoin.packs.create({
      sku: packSku,
      name: "Mega pack",
      priceCents: 999,
      grants: [{ currency: code, amount: 1200, bonus: 100 }],
      items: [{ sku: itemSku, quantity: 2 }],
      badge: "best_value",
    });
    assert.equal(pack.status, "draft");
    assert.equal(pack.availability, null);

    const live = await gamecoin.packs.update(packSku, {
      priceCents: 1099,
      status: "active",
      availability: { startsAt: new Date("2030-01-01T00:00:00Z"), stock: 50, founder: true },
    });
    assert.equal(live.status, "active");
    assert.deepEqual(live.availability, { startsAt: new Date("2030-01-01T00:00:00Z"), endsAt: null, stock: 50, founder: true, sold: 0 });

    const catalog = await gamecoin.catalog.get();
    assert.equal(catalog.packs.find((p) => p.sku === packSku)?.availability?.remaining, 50);
    assert.ok((await gamecoin.items.list()).some((i) => i.sku === itemSku));

    // Archiving goes top-down: a pack, then the item it holds, then the currency.
    assert.equal((await gamecoin.packs.archive(packSku)).status, "archived");
    assert.equal((await gamecoin.items.archive(itemSku)).status, "archived");
    assert.equal((await gamecoin.currencies.archive(code)).status, "archived");
    assert.equal((await gamecoin.currencies.archive(code)).status, "archived");
    assert.equal((await gamecoin.currencies.get(code)).status, "archived");

    assert.ok(!(await gamecoin.currencies.list()).some((c) => c.code === code));
    assert.ok((await gamecoin.currencies.list({ includeArchived: true })).some((c) => c.code === code));
    const left = await gamecoin.catalog.get();
    assert.ok(!left.currencies.some((c) => c.code === code) && !left.packs.some((p) => p.sku === packSku));
  });

  it("answers CONFLICT, VALIDATION_FAILED and NOT_FOUND with their details", async () => {
    const taken = await failure(gamecoin.currencies.create({ code: "gems", name: "Again" }));
    assert.equal(taken.code, ErrorCode.CONFLICT);
    assert.deepEqual(taken.details.fieldErrors, { code: ["CODE_TAKEN"] });

    const blocked = await failure(gamecoin.currencies.archive("gems"));
    assert.equal(blocked.code, ErrorCode.CONFLICT);
    assert.ok(blocked.details.blockedBy);

    const invalid = await failure(gamecoin.packs.create({ sku: `empty-${suffix}`, name: "Empty", priceCents: 500 }));
    assert.equal(invalid.code, ErrorCode.VALIDATION_FAILED);
    assert.ok(invalid.details.fieldErrors);

    assert.equal((await failure(gamecoin.items.get(`nope-${suffix}`))).code, ErrorCode.NOT_FOUND);
  });
});
