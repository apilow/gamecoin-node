import type { HttpClient } from "../http.js";
import { parseMovement, parseWallet } from "../parse.js";
import { playerPath } from "../player.js";
import type { Movement, MutationOptions, PlayerRef, RequestOptions, Wallet, WalletMovementParams } from "../types.js";
import { assertKnownKeys, readOptions, requireInteger, requireObject, requireString, requireStringMap } from "../validate.js";

/** Balances, grants and spends. */
export class WalletResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** One balance per active currency, zeros included. `GET /players/{player}/wallet` */
  async get(player: PlayerRef, options?: RequestOptions): Promise<Wallet> {
    const path = playerPath(player, "/wallet");
    const { signal } = readOptions(options, false, "wallet.get");
    return (await this.#http.call({ method: "GET", path, signal }, parseWallet)).value;
  }

  /**
   * Credits the `bonus` bucket (a grant is never "paid"). Creates the `ext:` player when missing.
   * `POST /players/{player}/wallet/grant`
   */
  grant(player: PlayerRef, params: WalletMovementParams, options?: MutationOptions): Promise<Movement> {
    return this.#movement("grant", player, params, options);
  }

  /** Debits the wallet, `bonus` first. `INSUFFICIENT_FUNDS` when the balance is too low. `POST /players/{player}/wallet/spend` */
  spend(player: PlayerRef, params: WalletMovementParams, options?: MutationOptions): Promise<Movement> {
    return this.#movement("spend", player, params, options);
  }

  async #movement(action: "grant" | "spend", player: PlayerRef, params: WalletMovementParams, options: MutationOptions | undefined): Promise<Movement> {
    const path = playerPath(player, `/wallet/${action}`);
    const fields = requireObject(params, "params");
    assertKnownKeys(fields, ["currency", "amount", "reason", "metadata"], "params");
    const body: Record<string, unknown> = {
      currency: requireString(fields.currency, "params.currency"),
      amount: requireInteger(fields.amount, "params.amount", 1),
    };
    if (fields.reason !== undefined) body.reason = requireReason(fields.reason);
    if (fields.metadata !== undefined) body.metadata = requireStringMap(fields.metadata, "params.metadata");
    const { signal, idempotencyKey } = readOptions(options, true, `wallet.${action}`);
    const { value, replayed } = await this.#http.call({ method: "POST", path, body, idempotent: true, idempotencyKey, signal }, parseMovement);
    return { ...value, replayed };
  }
}

/** `reason` may be an empty string for the API; only the type is checked here. */
function requireReason(value: unknown): string {
  if (typeof value !== "string") throw new TypeError("params.reason must be a string");
  return value;
}
