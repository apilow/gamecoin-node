import type { HttpClient } from "../http.js";
import { parseCheckout } from "../parse.js";
import { playerPath } from "../player.js";
import type { Checkout, CheckoutParams, MutationOptions, PlayerRef } from "../types.js";
import { assertKnownKeys, optionalString, readOptions, requireObject, requireString } from "../validate.js";

/** Selling a currency pack for real money, through a hosted payment page. */
export class CheckoutsResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * Orders a pack for a player and returns the order (`pending`) with the URL of the hosted payment page. A replay
   * with the same idempotency key returns the order in its *current* state, with `replayed: true`. Creates the `ext:`
   * player when missing. `POST /players/{player}/checkouts`
   */
  async create(player: PlayerRef, params: CheckoutParams, options?: MutationOptions): Promise<Checkout> {
    const path = playerPath(player, "/checkouts");
    const fields = requireObject(params, "params");
    assertKnownKeys(fields, ["packSku", "successUrl", "cancelUrl", "country", "locale"], "params");
    const body: Record<string, string> = { packSku: requireString(fields.packSku, "params.packSku") };
    for (const key of ["successUrl", "cancelUrl", "country", "locale"] as const) {
      const value = optionalString(fields[key], `params.${key}`);
      if (value !== undefined) body[key] = value;
    }
    const { signal, idempotencyKey } = readOptions(options, true, "checkouts.create");
    const { value, replayed } = await this.#http.call({ method: "POST", path, body, idempotent: true, idempotencyKey, signal }, parseCheckout);
    return { ...value, replayed };
  }
}
