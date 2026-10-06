/**
 * Error codes: the codes of the GameCoin API, plus three raised by the SDK itself when no usable API answer exists
 * (`NETWORK_ERROR`, `TIMEOUT`, `INVALID_RESPONSE`).
 */
export const ErrorCode = Object.freeze({
  /** 400: body, query or path parameter invalid (`details.fieldErrors`). */
  VALIDATION_FAILED: "VALIDATION_FAILED",
  /** 400: a request that needs an `Idempotency-Key` had none (the SDK always sends one). */
  IDEMPOTENCY_KEY_REQUIRED: "IDEMPOTENCY_KEY_REQUIRED",
  /** 401: secret key missing, unknown or revoked. */
  UNAUTHENTICATED: "UNAUTHENTICATED",
  /** 402: payment refused, or no payment provider for this environment. */
  PAYMENT_FAILED: "PAYMENT_FAILED",
  /** 403: key kind not allowed here. */
  FORBIDDEN: "FORBIDDEN",
  /** 403: the player is blocked. */
  PLAYER_BLOCKED: "PLAYER_BLOCKED",
  /** 403: `live` key used by a studio that is not verified. */
  ENV_NOT_ENABLED: "ENV_NOT_ENABLED",
  /** 404: unknown player, currency, item, pack or order in this game and environment. */
  NOT_FOUND: "NOT_FOUND",
  /** 409: wallet or item quantity too low (`details.required`, `details.available`). */
  INSUFFICIENT_FUNDS: "INSUFFICIENT_FUNDS",
  /** 409: `maxOwned`, `maxPerPlayer` or the balance ceiling exceeded. */
  LIMIT_REACHED: "LIMIT_REACHED",
  /** 409: the pack is outside its sale window (`details.startsAt`, `details.endsAt`: ISO 8601 text or `null`). */
  PACK_NOT_AVAILABLE: "PACK_NOT_AVAILABLE",
  /** 409: no unit of the pack is left (`details.packSku`). */
  PACK_SOLD_OUT: "PACK_SOLD_OUT",
  /** 409: an `Idempotency-Key` was reused with another request. */
  IDEMPOTENCY_CONFLICT: "IDEMPOTENCY_CONFLICT",
  /** 409: invalid state transition (e.g. refund of an unpaid order). */
  CONFLICT: "CONFLICT",
  /** 429: too many requests (`retryAfter`). */
  RATE_LIMITED: "RATE_LIMITED",
  /** Studio suspended (HTTP 423). Not returned by the server API today; listed for parity with the other SDKs. */
  READ_ONLY: "READ_ONLY",
  /** 500: unexpected error on the GameCoin side. */
  INTERNAL: "INTERNAL",
  /** SDK, status 0: no answer (connection refused, DNS failure, reset…). */
  NETWORK_ERROR: "NETWORK_ERROR",
  /** SDK, status 0: no answer within the `timeout` option. */
  TIMEOUT: "TIMEOUT",
  /** SDK: the body is not the expected JSON (the HTTP status is kept). */
  INVALID_RESPONSE: "INVALID_RESPONSE",
} as const);

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Marks genuine errors across the ESM and CommonJS copies of this package (`instanceof` fails between the two). */
const BRAND = Symbol.for("@apilow/gamecoin/GameCoinError");

export interface GameCoinErrorInit {
  code: string;
  status: number;
  message: string;
  details?: Record<string, unknown>;
  retryAfter?: number | undefined;
  cause?: unknown;
}

/**
 * The only error type of the SDK for anything that goes wrong with a request.
 * It never holds the secret key. Invalid arguments are different: they throw `TypeError` (wrong type) or
 * `RangeError` (unacceptable value) before any request is made.
 */
export class GameCoinError extends Error {
  /** API code (see {@link ErrorCode}); a code the SDK does not know yet is passed through as is. */
  readonly code: ErrorCode | (string & {});
  /** HTTP status; 0 when no response was received. */
  readonly status: number;
  /** `details` of the API (`required`, `available`, `fieldErrors`…); empty when absent. */
  readonly details: Readonly<Record<string, unknown>>;
  /** Seconds, when the API sent `Retry-After`. */
  readonly retryAfter: number | undefined;

  constructor(init: GameCoinErrorInit) {
    super(init.message, init.cause === undefined ? undefined : { cause: init.cause });
    this.name = "GameCoinError";
    this.code = init.code;
    this.status = init.status;
    this.details = init.details ?? {};
    this.retryAfter = init.retryAfter;
    Object.defineProperty(this, BRAND, { value: true });
  }

  /** True for a `GameCoinError` from any copy of this package (prefer it to `instanceof` when ESM and CommonJS mix). */
  static isGameCoinError(value: unknown): value is GameCoinError {
    return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[BRAND] === true;
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      status: this.status,
      message: this.message,
      details: this.details,
      retryAfter: this.retryAfter,
    };
  }
}
