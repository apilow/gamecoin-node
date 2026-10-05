export { GameCoin, DEFAULT_BASE_URL, DEFAULT_MAX_RETRIES, DEFAULT_TIMEOUT_MS } from "./client.js";
export { ErrorCode, GameCoinError } from "./errors.js";
export type { GameCoinErrorInit } from "./errors.js";
export { ext } from "./player.js";
export { VERSION } from "./version.js";

export type { CatalogResource } from "./resources/catalog.js";
export type { CheckoutsResource } from "./resources/checkouts.js";
export type { InventoryResource } from "./resources/inventory.js";
export type { LedgerResource } from "./resources/ledger.js";
export type { OrdersResource } from "./resources/orders.js";
export type { PlayersResource } from "./resources/players.js";
export type { PurchasesResource } from "./resources/purchases.js";
export type { WalletResource } from "./resources/wallet.js";

export type {
  Balance,
  Catalog,
  Checkout,
  CheckoutParams,
  Currency,
  Environment,
  FetchFunction,
  FetchRequestInit,
  FetchResponseLike,
  GameCoinOptions,
  InventoryChange,
  InventoryItem,
  Item,
  ItemQuantityParams,
  ItemType,
  LedgerEntry,
  LedgerEntryType,
  LedgerIterateParams,
  LedgerListParams,
  LedgerPage,
  Movement,
  MutationOptions,
  Order,
  OrderStatus,
  Pack,
  Player,
  PlayerKind,
  PlayerProfile,
  PlayerRef,
  PlayerToken,
  Purchase,
  RefundParams,
  RequestOptions,
  SleepFunction,
  Wallet,
  WalletMovementParams,
} from "./types.js";
