import type { PlayerRef } from "./types.js";
import { requireString } from "./validate.js";

/**
 * Designates a player by *your* id instead of the GameCoin id: `ext("user-42")` is `"ext:user-42"`.
 * Any string is fine (spaces, slashes, `%`, non-ASCII…): the SDK URL-encodes the whole reference exactly once.
 * With a secret key, a write on an unknown `ext:` player creates it; a read answers `NOT_FOUND`.
 */
export function ext(id: string): PlayerRef {
  return `ext:${requireString(id, "ext() id")}`;
}

/** Path of a player: the reference URL-encoded **exactly once** (`encodeURIComponent("ext:" + id)`). */
export function playerPath(player: PlayerRef, suffix = ""): string {
  return `/players/${encodeURIComponent(requireString(player, "player"))}${suffix}`;
}
