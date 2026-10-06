import type {
  Balance,
  Catalog,
  Currency,
  Environment,
  InventoryItem,
  Item,
  LedgerEntry,
  LedgerPage,
  Order,
  Pack,
  PackAvailability,
  Player,
  PlayerToken,
  Redemption,
  Wallet,
  WalletCreditedData,
} from "./types.js";

/**
 * Turns the JSON of a response into the typed objects of `types.ts`: ISO 8601 strings become `Date`s, unknown fields
 * are ignored. A field of the wrong shape raises a `ShapeError`, which the HTTP layer reports as `INVALID_RESPONSE`.
 */

export class ShapeError extends Error {
  constructor(path: string, expected: string) {
    super(`${path} must be ${expected}`);
    this.name = "ShapeError";
  }
}

type Obj = Record<string, unknown>;

function obj(value: unknown, path: string): Obj {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new ShapeError(path, "an object");
  return value as Obj;
}

function str(o: Obj, key: string, path: string): string {
  const value = o[key];
  if (typeof value !== "string") throw new ShapeError(`${path}.${key}`, "a string");
  return value;
}

function strOrNull(o: Obj, key: string, path: string): string | null {
  const value = o[key];
  if (value === null) return null;
  if (typeof value !== "string") throw new ShapeError(`${path}.${key}`, "a string or null");
  return value;
}

function int(o: Obj, key: string, path: string): number {
  const value = o[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new ShapeError(`${path}.${key}`, "an integer");
  return value;
}

function intOrNull(o: Obj, key: string, path: string): number | null {
  return o[key] === null ? null : int(o, key, path);
}

function bool(o: Obj, key: string, path: string): boolean {
  const value = o[key];
  if (typeof value !== "boolean") throw new ShapeError(`${path}.${key}`, "a boolean");
  return value;
}

function toDate(value: unknown, path: string): Date {
  const date = typeof value === "string" ? new Date(value) : undefined;
  if (date === undefined || Number.isNaN(date.getTime())) throw new ShapeError(path, "an ISO 8601 date-time");
  return date;
}

function date(o: Obj, key: string, path: string): Date {
  return toDate(o[key], `${path}.${key}`);
}

function dateOrNull(o: Obj, key: string, path: string): Date | null {
  return o[key] === null ? null : date(o, key, path);
}

function list<T>(o: Obj, key: string, path: string, parseItem: (value: unknown, path: string) => T): T[] {
  const value = o[key];
  if (!Array.isArray(value)) throw new ShapeError(`${path}.${key}`, "an array");
  return value.map((item, index) => parseItem(item, `${path}.${key}[${index}]`));
}

function stringMap(o: Obj, key: string, path: string): Record<string, string> {
  const map = obj(o[key], `${path}.${key}`);
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(map)) {
    if (typeof value !== "string") throw new ShapeError(`${path}.${key}.${name}`, "a string");
    out[name] = value;
  }
  return out;
}

/** A string from an open list (the API may add values): typed as the known values, checked only as a string. */
function tag<T extends string>(o: Obj, key: string, path: string): T {
  return str(o, key, path) as T;
}

// --- Objects -----------------------------------------------------------------------------------------------

export function parsePlayer(value: unknown, path = "player"): Player {
  const o = obj(value, path);
  return {
    id: str(o, "id", path),
    externalId: strOrNull(o, "externalId", path),
    kind: tag<Player["kind"]>(o, "kind", path),
    displayName: strOrNull(o, "displayName", path),
    country: strOrNull(o, "country", path),
    blocked: bool(o, "blocked", path),
    createdAt: date(o, "createdAt", path),
  };
}

export function parseBalance(value: unknown, path = "balance"): Balance {
  const o = obj(value, path);
  return { currency: str(o, "currency", path), paid: int(o, "paid", path), bonus: int(o, "bonus", path), total: int(o, "total", path) };
}

export function parseWallet(value: unknown, path = "wallet"): Wallet {
  const o = obj(value, path);
  return { playerId: str(o, "playerId", path), balances: list(o, "balances", path, parseBalance) };
}

export function parseLedgerEntry(value: unknown, path = "entry"): LedgerEntry {
  const o = obj(value, path);
  const after = obj(o.balanceAfter, `${path}.balanceAfter`);
  const ref = obj(o.ref, `${path}.ref`);
  const parsedRef: LedgerEntry["ref"] = {};
  if (ref.orderId !== undefined) parsedRef.orderId = str(ref, "orderId", `${path}.ref`);
  if (ref.itemSku !== undefined) parsedRef.itemSku = str(ref, "itemSku", `${path}.ref`);
  return {
    id: str(o, "id", path),
    type: tag<LedgerEntry["type"]>(o, "type", path),
    currency: str(o, "currency", path),
    paidDelta: int(o, "paidDelta", path),
    bonusDelta: int(o, "bonusDelta", path),
    balanceAfter: {
      paid: int(after, "paid", `${path}.balanceAfter`),
      bonus: int(after, "bonus", `${path}.balanceAfter`),
      total: int(after, "total", `${path}.balanceAfter`),
    },
    reason: strOrNull(o, "reason", path),
    metadata: stringMap(o, "metadata", path),
    ref: parsedRef,
    createdAt: date(o, "createdAt", path),
  };
}

export function parseInventoryItem(value: unknown, path = "item"): InventoryItem {
  const o = obj(value, path);
  return { sku: str(o, "sku", path), quantity: int(o, "quantity", path), updatedAt: date(o, "updatedAt", path) };
}

function parseCurrency(value: unknown, path: string): Currency {
  const o = obj(value, path);
  return { code: str(o, "code", path), name: str(o, "name", path), purchasable: bool(o, "purchasable", path) };
}

function parseItem(value: unknown, path: string): Item {
  const o = obj(value, path);
  const price = o.price === null ? null : obj(o.price, `${path}.price`);
  return {
    sku: str(o, "sku", path),
    name: str(o, "name", path),
    description: strOrNull(o, "description", path),
    type: tag<Item["type"]>(o, "type", path),
    price: price === null ? null : { currency: str(price, "currency", `${path}.price`), amount: int(price, "amount", `${path}.price`) },
    maxOwned: intOrNull(o, "maxOwned", path),
    clientPurchasable: bool(o, "clientPurchasable", path),
    metadata: stringMap(o, "metadata", path),
  };
}

function parsePack(value: unknown, path: string): Pack {
  const o = obj(value, path);
  return {
    sku: str(o, "sku", path),
    name: str(o, "name", path),
    description: strOrNull(o, "description", path),
    priceCents: int(o, "priceCents", path),
    currency: tag<Pack["currency"]>(o, "currency", path),
    grants: list(o, "grants", path, (grant, grantPath) => {
      const g = obj(grant, grantPath);
      return { currency: str(g, "currency", grantPath), amount: int(g, "amount", grantPath), bonus: int(g, "bonus", grantPath) };
    }),
    items: list(o, "items", path, (line, linePath) => {
      const l = obj(line, linePath);
      return { sku: str(l, "sku", linePath), quantity: int(l, "quantity", linePath) };
    }),
    badge: strOrNull(o, "badge", path),
    maxPerPlayer: intOrNull(o, "maxPerPlayer", path),
    // Absent reads as null (spec 10.1): a pack from a server older than 0.3 is an ordinary pack.
    availability: o.availability === null || o.availability === undefined ? null : parseAvailability(o.availability, `${path}.availability`),
  };
}

function parseAvailability(value: unknown, path: string): PackAvailability {
  const o = obj(value, path);
  return {
    startsAt: dateOrNull(o, "startsAt", path),
    endsAt: dateOrNull(o, "endsAt", path),
    remaining: intOrNull(o, "remaining", path),
    founder: bool(o, "founder", path),
  };
}

export function parseCatalog(value: unknown, path = "catalog"): Catalog {
  const o = obj(value, path);
  return {
    currencies: list(o, "currencies", path, parseCurrency),
    items: list(o, "items", path, parseItem),
    packs: list(o, "packs", path, parsePack),
    // Absent reads as false / null (spec 10.1); present with the wrong type is still a ShapeError.
    prelaunch: o.prelaunch === undefined ? false : bool(o, "prelaunch", path),
    launchAt: o.launchAt === undefined ? null : dateOrNull(o, "launchAt", path),
  };
}

export function parseOrder(value: unknown, path = "order"): Order {
  const o = obj(value, path);
  const pack = obj(o.pack, `${path}.pack`);
  return {
    id: str(o, "id", path),
    playerId: str(o, "playerId", path),
    status: tag<Order["status"]>(o, "status", path),
    pack: { sku: str(pack, "sku", `${path}.pack`), name: str(pack, "name", `${path}.pack`) },
    amountCents: int(o, "amountCents", path),
    currency: tag<Order["currency"]>(o, "currency", path),
    country: str(o, "country", path),
    vatRateBp: int(o, "vatRateBp", path),
    vatCents: int(o, "vatCents", path),
    netCents: int(o, "netCents", path),
    createdAt: date(o, "createdAt", path),
    paidAt: dateOrNull(o, "paidAt", path),
    fulfilledAt: dateOrNull(o, "fulfilledAt", path),
    refundedAt: dateOrNull(o, "refundedAt", path),
    // Absent reads as null (spec 10.1): a webhook event stored before creator codes existed is sent again as it was.
    creatorCode: o.creatorCode === null || o.creatorCode === undefined ? null : parseCreatorCode(o.creatorCode, `${path}.creatorCode`),
  };
}

function parseCreatorCode(value: unknown, path: string): { code: string; creatorName: string } {
  const o = obj(value, path);
  return { code: str(o, "code", path), creatorName: str(o, "creatorName", path) };
}

// --- Composed responses ------------------------------------------------------------------------------------

export function parsePlayerToken(value: unknown): PlayerToken {
  const o = obj(value, "response");
  return { token: str(o, "token", "response"), expiresAt: date(o, "expiresAt", "response") };
}

export function parseMovement(value: unknown): { entry: LedgerEntry; balance: Balance } {
  const o = obj(value, "response");
  return { entry: parseLedgerEntry(o.entry, "response.entry"), balance: parseBalance(o.balance, "response.balance") };
}

export function parseLedgerPage(value: unknown): LedgerPage {
  const o = obj(value, "response");
  return { entries: list(o, "entries", "response", parseLedgerEntry), nextCursor: strOrNull(o, "nextCursor", "response") };
}

export function parseInventoryList(value: unknown): InventoryItem[] {
  return list(obj(value, "response"), "items", "response", parseInventoryItem);
}

export function parseInventoryChange(value: unknown): InventoryItem {
  return parseInventoryItem(obj(value, "response").item, "response.item");
}

export function parsePurchase(value: unknown): { entry: LedgerEntry; balance: Balance; item: InventoryItem } {
  const o = obj(value, "response");
  return {
    entry: parseLedgerEntry(o.entry, "response.entry"),
    balance: parseBalance(o.balance, "response.balance"),
    item: parseInventoryItem(o.item, "response.item"),
  };
}

export function parseCheckout(value: unknown): { order: Order; checkoutUrl: string } {
  const o = obj(value, "response");
  return { order: parseOrder(o.order, "response.order"), checkoutUrl: str(o, "checkoutUrl", "response") };
}

export function parseRedemption(value: unknown): Omit<Redemption, "replayed"> {
  const o = obj(value, "response");
  const line = (entry: unknown, entryPath: string): { sku: string; quantity: number } => {
    const l = obj(entry, entryPath);
    return { sku: str(l, "sku", entryPath), quantity: int(l, "quantity", entryPath) };
  };
  return {
    grants: list(o, "grants", "response", (grant, grantPath) => {
      const g = obj(grant, grantPath);
      return { currency: str(g, "currency", grantPath), amount: int(g, "amount", grantPath), balance: parseBalance(g.balance, `${grantPath}.balance`) };
    }),
    items: list(o, "items", "response", line),
    skipped: list(o, "skipped", "response", line),
  };
}

// --- Webhook events ----------------------------------------------------------------------------------------

export function parseWalletCreditedData(value: unknown, path = "event.data"): WalletCreditedData {
  const o = obj(value, path);
  return {
    playerId: str(o, "playerId", path),
    orderId: str(o, "orderId", path),
    credits: list(o, "credits", path, (credit, creditPath) => {
      const c = obj(credit, creditPath);
      return { currency: str(c, "currency", creditPath), paid: int(c, "paid", creditPath), bonus: int(c, "bonus", creditPath) };
    }),
  };
}

export function parseTestEventData(value: unknown, path = "event.data"): { message: string } {
  return { message: str(obj(value, path), "message", path) };
}

/** The envelope shared by every event: the `data` is left to the caller, which knows the type. */
export function parseWebhookEnvelope(value: unknown): { id: string; type: string; createdAt: Date; env: Environment; data: unknown } {
  const o = obj(value, "event");
  if (!("data" in o)) throw new ShapeError("event.data", "present");
  return {
    id: str(o, "id", "event"),
    type: str(o, "type", "event"),
    createdAt: date(o, "createdAt", "event"),
    env: tag<Environment>(o, "env", "event"),
    data: o.data,
  };
}
