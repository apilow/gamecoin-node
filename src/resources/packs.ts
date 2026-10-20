import type { HttpClient } from "../http.js";
import { parseManagedPack, parseManagedPacks } from "../parse.js";
import type { CreatePackParams, ListCatalogParams, ManagedPack, RequestOptions, UpdatePackParams } from "../types.js";
import { readOptions, requireString } from "../validate.js";
import { anyInteger, availability, build, integerFrom, listQuery, nullableIntegerFrom, nullableOneOf, nullableText, oneOf, packGrants, packItems, text } from "./catalog-body.js";

const encode = (sku: string) => `/packs/${encodeURIComponent(requireString(sku, "sku"))}`;

const UPDATE_FIELDS = {
  name: text,
  description: nullableText,
  priceCents: integerFrom(0),
  grants: packGrants,
  items: packItems,
  badge: nullableOneOf("popular", "best_value"),
  maxPerPlayer: nullableIntegerFrom(1),
  sortOrder: anyInteger,
  availability,
};

/** The packs of the game (currency bundles sold for real money). The catalog is shared by the `test` and `live` environments. */
export class PacksResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * Creates a pack, as a draft unless `status` is `"active"`. Its `sku` is final. A taken sku is `CONFLICT` with
   * `details.fieldErrors.sku = ["SKU_TAKEN"]`; a pack with no grant and no item, an unknown or archived currency or
   * item, or a paid amount in a free currency is `VALIDATION_FAILED` with the faulty lines in `details.fieldErrors`.
   *
   * A create has no idempotency key (the sku is its natural key), so the SDK retries it on `429` only. After a network
   * error, a timeout or a `5xx` it raises, and you read the pack back with {@link PacksResource.get}. `POST /packs`
   */
  async create(params: CreatePackParams, options?: RequestOptions): Promise<ManagedPack> {
    const body = build(params, { sku: text, ...UPDATE_FIELDS, status: oneOf("draft", "active") }, "params", ["sku", "name", "priceCents"]);
    const { signal } = readOptions(options, false, "packs.create");
    return (await this.#http.call({ method: "POST", path: "/packs", body, retry: "rate-limit", signal }, parseManagedPack)).value;
  }

  /** A pack, archived ones included; `NOT_FOUND` for an unknown sku. `GET /packs/{sku}` */
  async get(sku: string, options?: RequestOptions): Promise<ManagedPack> {
    const path = encode(sku);
    const { signal } = readOptions(options, false, "packs.get");
    return (await this.#http.call({ method: "GET", path, signal }, parseManagedPack)).value;
  }

  /**
   * Changes a pack: a field left out is unchanged. `grants`, `items` and `availability` replace the previous value as a
   * whole. The content is applied first, then `status` (`"draft"`, `"active"` or `"archived"`); turning a pack active checks
   * that every currency and item it uses is still active. If that check fails the content change stays and the status does
   * not change. An archived pack cannot be changed (`CONFLICT`), except to bring it back with `status`. `PATCH /packs/{sku}`
   */
  async update(sku: string, params: UpdatePackParams, options?: RequestOptions): Promise<ManagedPack> {
    const path = encode(sku);
    const body = build(params, { ...UPDATE_FIELDS, status: oneOf("draft", "active", "archived") }, "params");
    const { signal } = readOptions(options, false, "packs.update");
    return (await this.#http.call({ method: "PATCH", path, body, signal }, parseManagedPack)).value;
  }

  /** Archives a pack (it is no longer sold; the orders already placed are unaffected) and returns it. `DELETE /packs/{sku}` */
  async archive(sku: string, options?: RequestOptions): Promise<ManagedPack> {
    const path = encode(sku);
    const { signal } = readOptions(options, false, "packs.archive");
    return (await this.#http.call({ method: "DELETE", path, signal }, parseManagedPack)).value;
  }

  /** The packs of the game in display order, drafts included; archived ones only with `includeArchived`. `GET /packs` */
  async list(params?: ListCatalogParams, options?: RequestOptions): Promise<ManagedPack[]> {
    const query = listQuery(params, "params");
    const { signal } = readOptions(options, false, "packs.list");
    return (await this.#http.call({ method: "GET", path: "/packs", query, signal }, parseManagedPacks)).value;
  }
}
