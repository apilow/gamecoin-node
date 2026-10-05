import { HttpClient, defaultSleep } from "./http.js";
import { CatalogResource } from "./resources/catalog.js";
import { CheckoutsResource } from "./resources/checkouts.js";
import { InventoryResource } from "./resources/inventory.js";
import { LedgerResource } from "./resources/ledger.js";
import { OrdersResource } from "./resources/orders.js";
import { PlayersResource } from "./resources/players.js";
import { PurchasesResource } from "./resources/purchases.js";
import { WalletResource } from "./resources/wallet.js";
import type { Environment, FetchFunction, GameCoinOptions } from "./types.js";
import { VERSION } from "./version.js";
import { assertKnownKeys, describeType, requireInteger, requireObject } from "./validate.js";

/** Default base URL; the SDK appends `/api/v1`. */
export const DEFAULT_BASE_URL = "https://gamecoin.apilow.com";
export const DEFAULT_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_RETRIES = 2;

const SECRET_KEY_PREFIX = /^gc_sk_(test|live)_/;
/** What `util.inspect` calls on an object to print it. */
const INSPECT = Symbol.for("nodejs.util.inspect.custom");
/** `setTimeout` fires at once beyond this many milliseconds. */
const MAX_TIMER_MS = 2_147_483_647;

/**
 * GameCoin server client. One instance per game and environment: the secret key decides both.
 *
 *     const gamecoin = new GameCoin(process.env.GAMECOIN_SECRET_KEY);
 *     const { balance } = await gamecoin.wallet.grant(ext("user-42"), { currency: "gems", amount: 100 });
 *
 * The secret key is kept out of reach: it appears in no error, no log line and no string representation
 * (`util.inspect`, `JSON.stringify`, `String`) of the client.
 */
export class GameCoin {
  /** `"test"` or `"live"`, read from the prefix of the key. */
  readonly environment: Environment;
  /** The base URL in use, without a trailing slash and without `/api/v1`. */
  readonly baseUrl: string;
  readonly catalog: CatalogResource;
  readonly players: PlayersResource;
  readonly wallet: WalletResource;
  readonly ledger: LedgerResource;
  readonly inventory: InventoryResource;
  readonly purchases: PurchasesResource;
  readonly checkouts: CheckoutsResource;
  readonly orders: OrdersResource;

  readonly #maskedKey: string;

  /**
   * @param secretKey `gc_sk_test_…` or `gc_sk_live_…`. A publishable key (`gc_pk_…`) is for the browser SDK and is refused.
   * @throws TypeError when an argument has the wrong type, RangeError when a value is not acceptable.
   */
  constructor(secretKey: string, options: GameCoinOptions = {}) {
    if (typeof secretKey !== "string") throw new TypeError(`secretKey must be a string, got ${describeType(secretKey)}`);
    const key = secretKey.trim();
    if (key.startsWith("gc_pk_")) {
      throw new RangeError(
        "This is a publishable key (gc_pk_…). The server SDK needs a secret key (gc_sk_test_… or gc_sk_live_…); use the browser SDK with a publishable key.",
      );
    }
    const prefix = SECRET_KEY_PREFIX.exec(key)?.[0];
    if (prefix === undefined || key.length === prefix.length) {
      throw new RangeError("secretKey must be a GameCoin secret key (gc_sk_test_… or gc_sk_live_…)");
    }
    this.#maskedKey = `${prefix}…`;
    this.environment = prefix === "gc_sk_test_" ? "test" : "live";

    const settings = requireObject(options, "options");
    assertKnownKeys(settings, ["baseUrl", "timeout", "maxRetries", "fetch", "sleep"], "options");
    this.baseUrl = normalizeBaseUrl(settings.baseUrl);
    const timeout = settings.timeout === undefined ? DEFAULT_TIMEOUT_MS : requireInteger(settings.timeout, "options.timeout", 1, MAX_TIMER_MS);
    const maxRetries = settings.maxRetries === undefined ? DEFAULT_MAX_RETRIES : requireInteger(settings.maxRetries, "options.maxRetries", 0, 10);

    const http = new HttpClient({
      apiKey: key,
      apiRoot: `${this.baseUrl}/api/v1`,
      userAgent: `gamecoin-node/${VERSION} (node/${process.versions.node})`,
      timeout,
      maxRetries,
      fetch: resolveFetch(settings.fetch),
      sleep: resolveFunction(settings.sleep, "options.sleep") ?? defaultSleep,
    });
    this.catalog = new CatalogResource(http);
    this.players = new PlayersResource(http);
    this.wallet = new WalletResource(http);
    this.ledger = new LedgerResource(http);
    this.inventory = new InventoryResource(http);
    this.purchases = new PurchasesResource(http);
    this.checkouts = new CheckoutsResource(http);
    this.orders = new OrdersResource(http);
  }

  toJSON(): { environment: Environment; baseUrl: string; secretKey: string } {
    return { environment: this.environment, baseUrl: this.baseUrl, secretKey: this.#maskedKey };
  }

  toString(): string {
    return `GameCoin { environment: ${this.environment}, baseUrl: ${this.baseUrl}, secretKey: ${this.#maskedKey} }`;
  }

  [INSPECT](): string {
    return this.toString();
  }
}

function normalizeBaseUrl(value: unknown): string {
  if (value === undefined) return DEFAULT_BASE_URL;
  if (typeof value !== "string") throw new TypeError(`options.baseUrl must be a string, got ${describeType(value)}`);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new RangeError("options.baseUrl must be an absolute http(s) URL, e.g. https://gamecoin.apilow.com");
  }
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.search !== "" || url.hash !== "" || url.username !== "" || url.password !== "") {
    throw new RangeError("options.baseUrl must be an http(s) URL without credentials, query or fragment");
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

function resolveFunction<T extends (...args: never[]) => unknown>(value: unknown, name: string): T | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "function") throw new TypeError(`${name} must be a function, got ${describeType(value)}`);
  return value as T;
}

function resolveFetch(value: unknown): FetchFunction {
  const custom = resolveFunction<FetchFunction>(value, "options.fetch");
  if (custom) return custom;
  if (typeof globalThis.fetch !== "function") {
    throw new TypeError("No global fetch in this runtime (Node 18+ has one): pass options.fetch");
  }
  return (url, init) => globalThis.fetch(url, init);
}
