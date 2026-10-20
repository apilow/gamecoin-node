import type { HttpClient } from "../http.js";
import { parseManagedCurrencies, parseManagedCurrency } from "../parse.js";
import type { CreateCurrencyParams, ListCatalogParams, ManagedCurrency, RequestOptions, UpdateCurrencyParams } from "../types.js";
import { readOptions, requireString } from "../validate.js";
import { build, flag, listQuery, text } from "./catalog-body.js";

const encode = (code: string) => `/currencies/${encodeURIComponent(requireString(code, "code"))}`;

/**
 * The currencies of the game. The catalog is shared by the `test` and `live` environments: a currency created with a
 * test key exists for live keys too.
 */
export class CurrenciesResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * Creates a currency. Its `code` is final. A taken code (archived currencies keep theirs) is `CONFLICT` with
   * `details.fieldErrors.code = ["CODE_TAKEN"]`; an invalid one is `VALIDATION_FAILED`.
   *
   * A create has no idempotency key (the code is its natural key), so the SDK retries it on `429` only. After a network
   * error, a timeout or a `5xx` it raises, and you read the currency back with {@link CurrenciesResource.get}. `POST /currencies`
   */
  async create(params: CreateCurrencyParams, options?: RequestOptions): Promise<ManagedCurrency> {
    const body = build(params, { code: text, name: text, purchasable: flag }, "params", ["code", "name"]);
    const { signal } = readOptions(options, false, "currencies.create");
    return (await this.#http.call({ method: "POST", path: "/currencies", body, retry: "rate-limit", signal }, parseManagedCurrency)).value;
  }

  /** A currency, archived ones included; `NOT_FOUND` for an unknown code. `GET /currencies/{code}` */
  async get(code: string, options?: RequestOptions): Promise<ManagedCurrency> {
    const path = encode(code);
    const { signal } = readOptions(options, false, "currencies.get");
    return (await this.#http.call({ method: "GET", path, signal }, parseManagedCurrency)).value;
  }

  /**
   * Changes a currency: a field left out is unchanged. `purchasable` cannot become false while a pack that is not
   * archived sells the currency for money (`CONFLICT`, `details.blockedBy.packs`). An archived currency cannot be
   * changed (`CONFLICT`). `PATCH /currencies/{code}`
   */
  async update(code: string, params: UpdateCurrencyParams, options?: RequestOptions): Promise<ManagedCurrency> {
    const path = encode(code);
    const body = build(params, { name: text, purchasable: flag }, "params");
    const { signal } = readOptions(options, false, "currencies.update");
    return (await this.#http.call({ method: "PATCH", path, body, signal }, parseManagedCurrency)).value;
  }

  /**
   * Archives a currency (nothing is deleted; balances stay) and returns it. Refused with `CONFLICT`
   * (`details.blockedBy`) while an active pack credits it or an active item is priced in it. Archiving an archived
   * currency has no effect. `DELETE /currencies/{code}`
   */
  async archive(code: string, options?: RequestOptions): Promise<ManagedCurrency> {
    const path = encode(code);
    const { signal } = readOptions(options, false, "currencies.archive");
    return (await this.#http.call({ method: "DELETE", path, signal }, parseManagedCurrency)).value;
  }

  /** The currencies of the game, oldest first; active ones unless `includeArchived`. `GET /currencies` */
  async list(params?: ListCatalogParams, options?: RequestOptions): Promise<ManagedCurrency[]> {
    const query = listQuery(params, "params");
    const { signal } = readOptions(options, false, "currencies.list");
    return (await this.#http.call({ method: "GET", path: "/currencies", query, signal }, parseManagedCurrencies)).value;
  }
}
