import type { HttpClient } from "../http.js";
import { parseRedemption } from "../parse.js";
import { playerPath } from "../player.js";
import type { MutationOptions, PlayerRef, Redemption } from "../types.js";
import { readOptions, requireString } from "../validate.js";

/** Gift codes: free coins and items that your studio issued, typed by the player. */
export class CodesResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * Redeems a gift code for a player: the free coins go to the `bonus` bucket, the items to the inventory. The code is
   * sent as typed: the API ignores case, spaces and dashes. An unknown, expired, used up, disabled or already used code
   * is always `VALIDATION_FAILED` with `details.fieldErrors.code = ["CODE_INVALID"]` (never retried); `PLAYER_BLOCKED`,
   * `LIMIT_REACHED`, `CONFLICT` and `RATE_LIMITED` are possible too. A replay with the same idempotency key returns the
   * same result with `replayed: true`. `POST /players/{player}/codes/redeem`
   */
  async redeem(player: PlayerRef, code: string, options?: MutationOptions): Promise<Redemption> {
    const path = playerPath(player, "/codes/redeem");
    const body = { code: requireString(code, "code") };
    const { signal, idempotencyKey } = readOptions(options, true, "codes.redeem");
    const { value, replayed } = await this.#http.call({ method: "POST", path, body, idempotent: true, idempotencyKey, signal }, parseRedemption);
    return { ...value, replayed };
  }
}
