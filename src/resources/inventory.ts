import type { HttpClient } from "../http.js";
import { parseInventoryChange, parseInventoryList } from "../parse.js";
import { playerPath } from "../player.js";
import type { InventoryChange, InventoryItem, ItemQuantityParams, MutationOptions, PlayerRef, RequestOptions } from "../types.js";
import { readOptions } from "../validate.js";
import { itemQuantityBody } from "./item-body.js";

/** Items owned by a player. */
export class InventoryResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** The owned items only (quantity above 0). `GET /players/{player}/inventory` */
  async list(player: PlayerRef, options?: RequestOptions): Promise<InventoryItem[]> {
    const path = playerPath(player, "/inventory");
    const { signal } = readOptions(options, false, "inventory.list");
    return (await this.#http.call({ method: "GET", path, signal }, parseInventoryList)).value;
  }

  /**
   * Adds units to the inventory; `LIMIT_REACHED` beyond the item's `maxOwned`. Creates the `ext:` player when missing.
   * `POST /players/{player}/inventory/grant`
   */
  grant(player: PlayerRef, params: ItemQuantityParams, options?: MutationOptions): Promise<InventoryChange> {
    return this.#change("grant", player, params, options);
  }

  /**
   * Removes units of a `consumable` item: `INSUFFICIENT_FUNDS` when the player owns fewer, `CONFLICT` for a durable
   * item. The item is returned even when it reaches 0. `POST /players/{player}/inventory/consume`
   */
  consume(player: PlayerRef, params: ItemQuantityParams, options?: MutationOptions): Promise<InventoryChange> {
    return this.#change("consume", player, params, options);
  }

  async #change(action: "grant" | "consume", player: PlayerRef, params: ItemQuantityParams, options: MutationOptions | undefined): Promise<InventoryChange> {
    const path = playerPath(player, `/inventory/${action}`);
    const body = itemQuantityBody(params);
    const { signal, idempotencyKey } = readOptions(options, true, `inventory.${action}`);
    const { value, replayed } = await this.#http.call({ method: "POST", path, body, idempotent: true, idempotencyKey, signal }, parseInventoryChange);
    return { ...value, replayed };
  }
}
