import type { HttpClient } from "../http.js";
import { parseManagedItem, parseManagedItems } from "../parse.js";
import type { CreateItemParams, ListCatalogParams, ManagedItem, RequestOptions, UpdateItemParams } from "../types.js";
import { readOptions, requireString } from "../validate.js";
import { build, flag, itemPrice, listQuery, metadata, nullableIntegerFrom, nullableText, oneOf, text } from "./catalog-body.js";

const encode = (sku: string) => `/items/${encodeURIComponent(requireString(sku, "sku"))}`;

const UPDATE_FIELDS = {
  name: text,
  description: nullableText,
  price: itemPrice,
  maxOwned: nullableIntegerFrom(1),
  clientPurchasable: flag,
  metadata,
};

/** The items of the game (potions, skins…). The catalog is shared by the `test` and `live` environments. */
export class ItemsResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * Creates an item. Its `sku` and `type` are final. A taken sku (archived items keep theirs) is `CONFLICT` with
   * `details.fieldErrors.sku = ["SKU_TAKEN"]`; an unknown price currency or `clientPurchasable` without a price is
   * `VALIDATION_FAILED`.
   *
   * A create has no idempotency key (the sku is its natural key), so the SDK retries it on `429` only. After a network
   * error, a timeout or a `5xx` it raises, and you read the item back with {@link ItemsResource.get}. `POST /items`
   */
  async create(params: CreateItemParams, options?: RequestOptions): Promise<ManagedItem> {
    const body = build(params, { sku: text, type: oneOf("consumable", "durable"), ...UPDATE_FIELDS }, "params", ["sku", "name", "type"]);
    const { signal } = readOptions(options, false, "items.create");
    return (await this.#http.call({ method: "POST", path: "/items", body, retry: "rate-limit", signal }, parseManagedItem)).value;
  }

  /** An item, archived ones included; `NOT_FOUND` for an unknown sku. `GET /items/{sku}` */
  async get(sku: string, options?: RequestOptions): Promise<ManagedItem> {
    const path = encode(sku);
    const { signal } = readOptions(options, false, "items.get");
    return (await this.#http.call({ method: "GET", path, signal }, parseManagedItem)).value;
  }

  /**
   * Changes an item: a field left out is unchanged; `null` clears the description, the price or the limit. The `sku` and
   * the `type` are final (an unknown field is refused before any request). An archived item cannot be changed
   * (`CONFLICT`). `PATCH /items/{sku}`
   */
  async update(sku: string, params: UpdateItemParams, options?: RequestOptions): Promise<ManagedItem> {
    const path = encode(sku);
    const body = build(params, UPDATE_FIELDS, "params");
    const { signal } = readOptions(options, false, "items.update");
    return (await this.#http.call({ method: "PATCH", path, body, signal }, parseManagedItem)).value;
  }

  /**
   * Archives an item (nothing is deleted; inventories keep it) and returns it. Refused with `CONFLICT`
   * (`details.blockedBy.packs`) while an active pack contains it. Archiving an archived item has no effect.
   * `DELETE /items/{sku}`
   */
  async archive(sku: string, options?: RequestOptions): Promise<ManagedItem> {
    const path = encode(sku);
    const { signal } = readOptions(options, false, "items.archive");
    return (await this.#http.call({ method: "DELETE", path, signal }, parseManagedItem)).value;
  }

  /** The items of the game, oldest first; active ones unless `includeArchived`. `GET /items` */
  async list(params?: ListCatalogParams, options?: RequestOptions): Promise<ManagedItem[]> {
    const query = listQuery(params, "params");
    const { signal } = readOptions(options, false, "items.list");
    return (await this.#http.call({ method: "GET", path: "/items", query, signal }, parseManagedItems)).value;
  }
}
