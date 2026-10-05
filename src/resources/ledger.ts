import type { HttpClient } from "../http.js";
import { parseLedgerPage } from "../parse.js";
import { playerPath } from "../player.js";
import type { LedgerEntry, LedgerIterateParams, LedgerListParams, LedgerPage, PlayerRef, RequestOptions } from "../types.js";
import { assertKnownKeys, optionalString, readOptions, requireInteger, requireObject } from "../validate.js";

const MAX_PAGE_LIMIT = 100;

function optionalLimit(value: unknown): number | undefined {
  return value === undefined ? undefined : requireInteger(value, "params.limit", 1, MAX_PAGE_LIMIT);
}

/** The immutable history of every wallet change. */
export class LedgerResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** One page of entries, newest first. `GET /players/{player}/ledger` */
  async list(player: PlayerRef, params: LedgerListParams = {}, options?: RequestOptions): Promise<LedgerPage> {
    const path = playerPath(player, "/ledger");
    const fields = requireObject(params, "params");
    assertKnownKeys(fields, ["currency", "limit", "cursor"], "params");
    const query = {
      currency: optionalString(fields.currency, "params.currency"),
      limit: optionalLimit(fields.limit),
      cursor: optionalString(fields.cursor, "params.cursor"),
    };
    const { signal } = readOptions(options, false, "ledger.list");
    return (await this.#http.call({ method: "GET", path, query, signal }, parseLedgerPage)).value;
  }

  /**
   * Every entry, newest first, page after page. A page is fetched only when the iteration needs it, so you can stop
   * early. Arguments are checked right away; requests start with the first `next()`.
   *
   *     for await (const entry of gamecoin.ledger.iterate(ext("user-42"), { currency: "gems" })) { ... }
   */
  iterate(player: PlayerRef, params: LedgerIterateParams = {}, options?: RequestOptions): AsyncGenerator<LedgerEntry, void, undefined> {
    playerPath(player);
    const fields = requireObject(params, "params");
    assertKnownKeys(fields, ["currency", "limit"], "params");
    const base: LedgerListParams = {};
    const currency = optionalString(fields.currency, "params.currency");
    const limit = optionalLimit(fields.limit);
    if (currency !== undefined) base.currency = currency;
    if (limit !== undefined) base.limit = limit;
    readOptions(options, false, "ledger.iterate");
    return this.#pages(player, base, options);
  }

  async *#pages(player: PlayerRef, base: LedgerListParams, options: RequestOptions | undefined): AsyncGenerator<LedgerEntry, void, undefined> {
    let cursor: string | undefined;
    do {
      const page: LedgerPage = await this.list(player, cursor === undefined ? base : { ...base, cursor }, options);
      yield* page.entries;
      cursor = page.nextCursor ?? undefined;
    } while (cursor !== undefined);
  }
}
