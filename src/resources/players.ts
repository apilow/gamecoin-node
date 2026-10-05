import type { HttpClient } from "../http.js";
import { parsePlayer, parsePlayerToken } from "../parse.js";
import { playerPath } from "../player.js";
import type { Player, PlayerProfile, PlayerRef, PlayerToken, RequestOptions } from "../types.js";
import { assertKnownKeys, readOptions, requireInteger, requireNullableString, requireObject } from "../validate.js";

/** Players of your game. */
export class PlayersResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /**
   * Creates the `ext:` player if it does not exist, otherwise updates the profile fields you pass (a missing field is
   * left unchanged, `null` clears it). A GameCoin id that does not exist answers `NOT_FOUND`. `PUT /players/{player}`
   */
  async upsert(player: PlayerRef, profile: PlayerProfile = {}, options?: RequestOptions): Promise<Player> {
    const path = playerPath(player);
    const fields = requireObject(profile, "profile");
    assertKnownKeys(fields, ["displayName", "email", "country", "birthYear"], "profile");
    const body: Record<string, string | number | null> = {};
    for (const key of ["displayName", "email", "country"] as const) {
      if (fields[key] !== undefined) body[key] = requireNullableString(fields[key], `profile.${key}`);
    }
    if (fields.birthYear !== undefined) {
      body.birthYear = fields.birthYear === null ? null : requireInteger(fields.birthYear, "profile.birthYear", 1);
    }
    const { signal } = readOptions(options, false, "players.upsert");
    return (await this.#http.call({ method: "PUT", path, body, signal }, parsePlayer)).value;
  }

  /** A player; `NOT_FOUND` when unknown (a read never creates an `ext:` player). `GET /players/{player}` */
  async get(player: PlayerRef, options?: RequestOptions): Promise<Player> {
    const path = playerPath(player);
    const { signal } = readOptions(options, false, "players.get");
    return (await this.#http.call({ method: "GET", path, signal }, parsePlayer)).value;
  }

  /**
   * A one-hour token to hand to your game client, for the browser SDK. Creates the `ext:` player when missing.
   * `POST /players/{player}/tokens`
   */
  async createToken(player: PlayerRef, options?: RequestOptions): Promise<PlayerToken> {
    const path = playerPath(player, "/tokens");
    const { signal } = readOptions(options, false, "players.createToken");
    return (await this.#http.call({ method: "POST", path, signal }, parsePlayerToken)).value;
  }
}
