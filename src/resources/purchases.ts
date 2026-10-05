import type { HttpClient } from "../http.js";
import { parsePurchase } from "../parse.js";
import { playerPath } from "../player.js";
import type { ItemQuantityParams, MutationOptions, PlayerRef, Purchase } from "../types.js";
import { readOptions } from "../validate.js";
import { itemQuantityBody } from "./item-body.js";

/** Buying an item with a currency. */
export class PurchasesResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * Debits the item's price in its currency and adds the item to the inventory, atomically. `INSUFFICIENT_FUNDS`,
   * `LIMIT_REACHED` (`maxOwned`) and `CONFLICT` (item without a price) are possible. `POST /players/{player}/purchases`
   */
  async create(player: PlayerRef, params: ItemQuantityParams, options?: MutationOptions): Promise<Purchase> {
    const path = playerPath(player, "/purchases");
    const body = itemQuantityBody(params);
    const { signal, idempotencyKey } = readOptions(options, true, "purchases.create");
    const { value, replayed } = await this.#http.call({ method: "POST", path, body, idempotent: true, idempotencyKey, signal }, parsePurchase);
    return { ...value, replayed };
  }
}
