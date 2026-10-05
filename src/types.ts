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
}

/** Active entries only. */
export interface Catalog {
  currencies: Currency[];
  items: Item[];
  packs: Pack[];
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
