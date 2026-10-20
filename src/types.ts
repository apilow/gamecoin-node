/**
 * Objects and parameters of the GameCoin API v1, field for field as in the API reference. Timestamps are `Date`s;
 * amounts are integers. Results of the calls that take an idempotency key carry a boolean `replayed`.
 */

export type Environment = "test" | "live";

/** A GameCoin player id, or the game's own id through {@link ext}: `ext("user-42")` is `"ext:user-42"`. */
export type PlayerRef = string;

// --- Objects -----------------------------------------------------------------------------------------------

export type PlayerKind = "external" | "hosted";

export interface Player {
  id: string;
  /** Your own id for the player; `null` for an anonymous (hosted) player. */
  externalId: string | null;
  kind: PlayerKind;
  displayName: string | null;
  country: string | null;
  blocked: boolean;
  createdAt: Date;
}

export interface Balance {
  currency: string;
  /** Units bought with real money. */
  paid: number;
  /** Units granted or earned for free. */
  bonus: number;
  /** `paid` + `bonus`. */
  total: number;
}

export interface Wallet {
  playerId: string;
  /** One line per active currency, zeros included. */
  balances: Balance[];
}

export type LedgerEntryType = "purchase_credit" | "grant" | "spend" | "refund_clawback" | "chargeback_clawback" | "adjustment";

export interface LedgerEntry {
  id: string;
  type: LedgerEntryType;
  currency: string;
  paidDelta: number;
  bonusDelta: number;
  balanceAfter: { paid: number; bonus: number; total: number };
  reason: string | null;
  metadata: Record<string, string>;
  ref: { orderId?: string; itemSku?: string };
  createdAt: Date;
}

export interface InventoryItem {
  sku: string;
  quantity: number;
  updatedAt: Date;
}

export interface Currency {
  code: string;
  name: string;
  /** True when packs can sell this currency for real money. */
  purchasable: boolean;
}

export type ItemType = "consumable" | "durable";

export interface Item {
  sku: string;
  name: string;
  description: string | null;
  type: ItemType;
  /** Price in a currency; `null` when the item cannot be bought with currency. */
  price: { currency: string; amount: number } | null;
  /** Most units a player can own; `null` for no limit. */
  maxOwned: number | null;
  clientPurchasable: boolean;
  metadata: Record<string, string>;
}

export interface Pack {
  sku: string;
  name: string;
  description: string | null;
  /** Price in euro cents, VAT included. */
  priceCents: number;
  currency: "EUR";
  grants: { currency: string; amount: number; bonus: number }[];
  items: { sku: string; quantity: number }[];
  badge: string | null;
  /** Most orders per player; `null` for no limit. */
  maxPerPlayer: number | null;
  /** Sale window and stock; `null` for an ordinary pack (always on sale, no limit). */
  availability: PackAvailability | null;
}

/**
 * When and how many of a pack can be bought. The catalog lists every active pack, scheduled, ended or sold out ones
 * included: your shop decides what to show. `checkouts.create` refuses a pack outside its window (`PACK_NOT_AVAILABLE`)
 * or without a unit left (`PACK_SOLD_OUT`).
 */
export interface PackAvailability {
  /** First instant of sale (included); `null` for no start. */
  startsAt: Date | null;
  /** First instant when the pack is no longer on sale (excluded); `null` for no end. */
  endsAt: Date | null;
  /** Units left in this environment (test and live have separate stocks); `null` for an unlimited stock. */
  remaining: number | null;
  /** True for a founder pack. */
  founder: boolean;
}

/** Active entries only. */
export interface Catalog {
  currencies: Currency[];
  items: Item[];
  packs: Pack[];
  /** True while the game is in pre-launch: a shop shows pre-orders with `launchAt`. */
  prelaunch: boolean;
  /** The launch date set in the game settings; `null` when none. */
  launchAt: Date | null;
}

export type OrderStatus = "pending" | "paid" | "fulfilled" | "refunded" | "chargeback" | "failed" | "canceled" | "expired";

export interface Order {
  id: string;
  playerId: string;
  status: OrderStatus;
  pack: { sku: string; name: string };
  amountCents: number;
  currency: "EUR";
  country: string;
  /** VAT rate in basis points (2100 = 21 %). */
  vatRateBp: number;
  vatCents: number;
  netCents: number;
  createdAt: Date;
  paidAt: Date | null;
  fulfilledAt: Date | null;
  refundedAt: Date | null;
  /** The creator code used at checkout, with the creator's name (never the rates); `null` when none. */
  creatorCode: { code: string; creatorName: string } | null;
}

// --- Results -----------------------------------------------------------------------------------------------

/** A short-lived player token, to hand to your game client. */
export interface PlayerToken {
  token: string;
  expiresAt: Date;
}

/** Result of `wallet.grant` and `wallet.spend`. */
export interface Movement {
  entry: LedgerEntry;
  balance: Balance;
  /** True when the API answered from an earlier request with the same idempotency key. */
  replayed: boolean;
}

export interface LedgerPage {
  /** Newest first. */
  entries: LedgerEntry[];
  /** Pass as `cursor` to get the next page; `null` on the last page. */
  nextCursor: string | null;
}

/** Result of `inventory.grant` and `inventory.consume`: the item, even when it reaches 0. */
export interface InventoryChange extends InventoryItem {
  replayed: boolean;
}

/** Result of `purchases.create`. */
export interface Purchase {
  entry: LedgerEntry;
  balance: Balance;
  item: InventoryItem;
  replayed: boolean;
}

/** Result of `checkouts.create`. */
export interface Checkout {
  order: Order;
  /** Hosted payment page: send the player there. */
  checkoutUrl: string;
  /** True when the order is the replay of an earlier request; it is then in its current state. */
  replayed: boolean;
}

/**
 * Result of `codes.redeem`: what the gift code gave. Coins are always free (`bonus` bucket). `skipped` lists the items
 * the player could not receive (`maxOwned` reached).
 */
export interface Redemption {
  grants: { currency: string; amount: number; balance: Balance }[];
  items: { sku: string; quantity: number }[];
  skipped: { sku: string; quantity: number }[];
  /** True when the API answered from an earlier request with the same idempotency key (no second credit). */
  replayed: boolean;
}

// --- Parameters --------------------------------------------------------------------------------------------

/** Profile of `players.upsert`. A missing field is left unchanged; `null` clears it. */
export interface PlayerProfile {
  displayName?: string | null;
  email?: string | null;
  /** ISO 3166-1 alpha-2, e.g. `"BE"`. */
  country?: string | null;
  birthYear?: number | null;
}

/** Parameters of `wallet.grant` and `wallet.spend`. A grant always credits the `bonus` bucket. */
export interface WalletMovementParams {
  currency: string;
  /** Positive integer. */
  amount: number;
  reason?: string;
  metadata?: Record<string, string>;
}

/** Parameters of `inventory.grant`, `inventory.consume` and `purchases.create`. */
export interface ItemQuantityParams {
  sku: string;
  /** Positive integer; defaults to 1. */
  quantity?: number;
}

export interface LedgerListParams {
  /** Only the entries of this currency. */
  currency?: string;
  /** Page size, 1 to 100 (the API default is 20). */
  limit?: number;
  /** The `nextCursor` of the previous page. */
  cursor?: string;
}

export interface LedgerIterateParams {
  currency?: string;
  /** Page size, 1 to 100; pages are fetched one at a time as you iterate. */
  limit?: number;
}

export interface CheckoutParams {
  packSku: string;
  /** Where to send the player after a successful payment. */
  successUrl?: string;
  cancelUrl?: string;
  /** ISO alpha-2 country of the buyer, which decides the VAT (EU only). Defaults to the player's country, then `"BE"`. */
  country?: string;
  /**
   * Language of the hosted payment page, the receipt and the e-mails of the order: `"fr"`, `"en"` or `"nl"`. The API
   * ignores any other value. A pending order that the API reuses takes the language of the latest request.
   */
  locale?: "fr" | "en" | "nl" | (string & {});
  /**
   * A creator code typed by the buyer. The buyer then gets a bonus of free coins on delivery, and the creator a
   * commission. A refused code (unknown, disabled, not valid for the pack, or the creator's own player) is a
   * `VALIDATION_FAILED` error with `details.fieldErrors.creatorCode = ["CODE_INVALID"]`. Not sent when absent.
   */
  creatorCode?: string;
}

export interface RefundParams {
  reason?: string;
}

// --- Options -----------------------------------------------------------------------------------------------

/** Options of every call. */
export interface RequestOptions {
  /**
   * Cancels the call (and any retry in progress). When the signal aborts, the call rejects with the signal's
   * reason (an `AbortError`), not with a `GameCoinError`.
   */
  signal?: AbortSignal;
}

/** Options of the calls that send an idempotency key. */
export interface MutationOptions extends RequestOptions {
  /**
   * 1 to 100 printable ASCII characters. By default the SDK generates a UUID v4 once per call and reuses it for every
   * retry of that call. Give your own to make a retry of *your* code safe too.
   */
  idempotencyKey?: string;
}

/** Minimal request the SDK hands to the transport. */
export interface FetchRequestInit {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
  /** Always `"manual"`: the SDK never follows a redirect (a redirected POST could be replayed as a GET). */
  redirect: "manual";
}

/** Minimal response the SDK needs from the transport. The global `fetch` of Node 18+ fits. */
export interface FetchResponseLike {
  status: number;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

/** The transport: anything that behaves like `fetch`. */
export type FetchFunction = (url: string, init: FetchRequestInit) => Promise<FetchResponseLike>;

/** Waits `ms` milliseconds; rejects if `signal` aborts. */
export type SleepFunction = (ms: number, signal?: AbortSignal) => Promise<void>;

export interface GameCoinOptions {
  /** Defaults to `https://gamecoin.apilow.com`. The SDK appends `/api/v1`. */
  baseUrl?: string;
  /** Per attempt, in milliseconds. Defaults to 30000. */
  timeout?: number;
  /** Retries after the first attempt (network error, timeout, `5xx`, `429`). Defaults to 2, so three attempts. */
  maxRetries?: number;
  /** Custom transport, for tests and proxies. Defaults to the global `fetch`. */
  fetch?: FetchFunction;
  /** Custom wait between retries, for tests. Defaults to a timer. */
  sleep?: SleepFunction;
}

// --- Webhooks ----------------------------------------------------------------------------------------------

/** The event types this SDK knows. See the `WebhookEventType` constants. */
export type KnownWebhookEventType = "order.fulfilled" | "order.refunded" | "order.chargeback" | "wallet.credited" | "webhook.test";

/** `data` of `wallet.credited`: who received what, after an order was delivered. */
export interface WalletCreditedData {
  playerId: string;
  orderId: string;
  credits: { currency: string; paid: number; bonus: number }[];
}

interface WebhookEventBase {
  /** The same for the same event, even when GameCoin sends it again: use it to process an event once. */
  id: string;
  createdAt: Date;
  env: Environment;
}

export interface OrderWebhookEvent extends WebhookEventBase {
  type: "order.fulfilled" | "order.refunded" | "order.chargeback";
  /** The order, as `orders.get` returns it. */
  data: Order;
}

export interface WalletCreditedWebhookEvent extends WebhookEventBase {
  type: "wallet.credited";
  data: WalletCreditedData;
}

export interface TestWebhookEvent extends WebhookEventBase {
  type: "webhook.test";
  data: { message: string };
}

/** An event of a type that this version of the SDK does not know: passed through, `data` as received. */
export interface UnknownWebhookEvent extends WebhookEventBase {
  type: string;
  data: unknown;
}

/** The events of a known type. `isKnownWebhookEvent(event)` narrows a {@link WebhookEvent} to it. */
export type KnownWebhookEvent = OrderWebhookEvent | WalletCreditedWebhookEvent | TestWebhookEvent;

/** A verified webhook event. */
export type WebhookEvent = KnownWebhookEvent | UnknownWebhookEvent;


/** Options of `webhooks.constructEvent`. */
export interface ConstructEventOptions {
  /** Largest gap, in seconds, between the signed timestamp and the clock, in either direction. Defaults to 300; 0 turns the check off. */
  toleranceSeconds?: number;
  /** The clock, for tests: the current time as a `Date` or as milliseconds since the epoch. */
  now?: () => Date | number;
}

// --- Catalog management ------------------------------------------------------------------------------------

/** `archived` resources are no longer offered, creditable or buyable; balances, inventories and past orders are untouched. */
export type CatalogStatus = "active" | "archived";
/** A `draft` pack is not sold; an `active` one is; an `archived` one no longer is. */
export type PackStatus = "draft" | "active" | "archived";

/** A currency as `currencies` manages it: the catalog fields, the status and the dates. */
export interface ManagedCurrency extends Currency {
  status: CatalogStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface ManagedItem extends Item {
  status: CatalogStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** The sale settings of a pack, as written, with the number of units delivered. */
export interface ManagedPackAvailability {
  startsAt: Date | null;
  endsAt: Date | null;
  /** Total units that can be sold; `null` for an unlimited stock. */
  stock: number | null;
  founder: boolean;
  /** Units delivered so far. */
  sold: number;
}

export interface ManagedPack extends Omit<Pack, "availability"> {
  sortOrder: number;
  status: PackStatus;
  availability: ManagedPackAvailability | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ListCatalogParams {
  /** Also list the archived resources (left out by default). */
  includeArchived?: boolean;
}

export interface CreateCurrencyParams {
  /** A lowercase letter, then lowercase letters, digits or `_` (2 to 24 characters). Unique in the game and final. */
  code: string;
  name: string;
  /** True (default) when packs can sell it for real money; false for a currency that is only given. */
  purchasable?: boolean;
}

export interface UpdateCurrencyParams {
  name?: string;
  purchasable?: boolean;
}

export interface CreateItemParams {
  /** Unique in the game and final. */
  sku: string;
  name: string;
  description?: string | null;
  /** `consumable` can be consumed; `durable` is owned. Final. */
  type: ItemType;
  /** In an active currency of the game; leave out for an item that cannot be bought with currency. */
  price?: { currency: string; amount: number } | null;
  /** Most units per player. Left out: 1 for a durable item, no limit for a consumable; `null`: no limit. */
  maxOwned?: number | null;
  /** True when the browser SDK may sell the item (needs a price). */
  clientPurchasable?: boolean;
  metadata?: Record<string, string>;
}

/** A field left out is unchanged; `null` clears the description, the price or the limit. */
export interface UpdateItemParams {
  name?: string;
  description?: string | null;
  price?: { currency: string; amount: number } | null;
  maxOwned?: number | null;
  clientPurchasable?: boolean;
  /** Replaces the whole metadata object. */
  metadata?: Record<string, string>;
}

/** What you write of the availability of a pack: dates as `Date`s or ISO 8601 texts. A field left out is `null` (`founder`: `false`). */
export interface PackAvailabilityParams {
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
  stock?: number | null;
  founder?: boolean;
}

export interface CreatePackParams {
  /** Unique in the game and final. */
  sku: string;
  name: string;
  description?: string | null;
  /** Euro cents, VAT included: 50 to 50,000. */
  priceCents: number;
  grants?: { currency: string; amount: number; bonus: number }[];
  items?: { sku: string; quantity: number }[];
  badge?: "popular" | "best_value" | null;
  maxPerPlayer?: number | null;
  sortOrder?: number;
  availability?: PackAvailabilityParams | null;
  /** `draft` (default) or `active` (sold at once). */
  status?: "draft" | "active";
}

/** A field left out is unchanged. `grants`, `items` and `availability` replace the previous value as a whole. */
export interface UpdatePackParams {
  name?: string;
  description?: string | null;
  priceCents?: number;
  grants?: { currency: string; amount: number; bonus: number }[];
  items?: { sku: string; quantity: number }[];
  badge?: "popular" | "best_value" | null;
  maxPerPlayer?: number | null;
  sortOrder?: number;
  /** The whole availability; `{}` removes every limit. */
  availability?: PackAvailabilityParams;
  /** Applied after the rest of the change. */
  status?: PackStatus;
}
