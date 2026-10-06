import { createHmac, timingSafeEqual } from "node:crypto";
import { ShapeError, parseOrder, parseTestEventData, parseWalletCreditedData, parseWebhookEnvelope } from "./parse.js";
import type { ConstructEventOptions, KnownWebhookEvent, WebhookEvent } from "./types.js";
import { assertKnownKeys, describeType, requireInteger, requireObject, requireString } from "./validate.js";

/** Default `toleranceSeconds` of `webhooks.constructEvent`: 5 minutes. */
export const DEFAULT_WEBHOOK_TOLERANCE_SECONDS = 300;

/** The event types GameCoin sends. An event of another type is still returned by `constructEvent`, with `data` untyped. */
export const WebhookEventType = Object.freeze({
  /** An order is paid and delivered. `data` is the order. */
  ORDER_FULFILLED: "order.fulfilled",
  /** An order is refunded; its coins and items are taken back. `data` is the order. */
  ORDER_REFUNDED: "order.refunded",
  /** The payer disputes the payment; its coins and items are taken back. `data` is the order. */
  ORDER_CHARGEBACK: "order.chargeback",
  /** The delivery of an order added currency to a wallet. `data` is `{ playerId, orderId, credits }`. */
  WALLET_CREDITED: "wallet.credited",
  /** Sent from the dashboard to check the endpoint. `data` is `{ message }`. */
  WEBHOOK_TEST: "webhook.test",
} as const);

export type WebhookEventType = (typeof WebhookEventType)[keyof typeof WebhookEventType];

/** Marks genuine errors across the ESM and CommonJS copies of this package. */
const BRAND = Symbol.for("@apilow/gamecoin/WebhookSignatureError");

/** Why a verification failed (`WebhookSignatureError.reason`). */
export type WebhookSignatureReason =
  | "missing_header"
  | "malformed_header"
  | "no_matching_signature"
  | "timestamp_out_of_tolerance"
  | "invalid_payload";

/**
 * Raised when a webhook call cannot be trusted. It is **not** a `GameCoinError`: nothing went wrong with a request to
 * the API. Answer `400` and do not process the call. The message never holds the secret, the body or a signature.
 */
export class WebhookSignatureError extends Error {
  readonly reason: WebhookSignatureReason;

  constructor(reason: WebhookSignatureReason, message: string) {
    super(message);
    this.name = "WebhookSignatureError";
    this.reason = reason;
    Object.defineProperty(this, BRAND, { value: true });
  }

  /** True for a `WebhookSignatureError` from any copy of this package (prefer it to `instanceof` when ESM and CommonJS mix). */
  static isWebhookSignatureError(value: unknown): value is WebhookSignatureError {
    return typeof value === "object" && value !== null && (value as Record<symbol, unknown>)[BRAND] === true;
  }
}

const KNOWN_TYPES: readonly string[] = Object.values(WebhookEventType);

/** True when the event is of a type this SDK knows: `event.data` is then typed once `event.type` is checked. */
export function isKnownWebhookEvent(event: WebhookEvent): event is KnownWebhookEvent {
  return KNOWN_TYPES.includes(event.type);
}

const SIGNATURE_PATTERN = /^[0-9a-fA-F]{64}$/;
const TIMESTAMP_PATTERN = /^[0-9]{1,15}$/;

/**
 * Checks the `GameCoin-Signature` header of a webhook call and returns the event. A pure function: no client, no network.
 *
 *     const event = webhooks.constructEvent(rawBody, req.get("GameCoin-Signature"), process.env.GAMECOIN_WEBHOOK_SECRET);
 *
 * @param rawBody the body **exactly as received**, as text or bytes. Never a parsed object: re-serialising changes it.
 * @param signatureHeader the value of `GameCoin-Signature`: `t=<unix seconds>,v1=<hex>[,v1=<hex>…]`.
 * @param secret the signing secret of the endpoint (`whsec_gc_…`).
 * @throws WebhookSignatureError when the call cannot be trusted or is not an event; TypeError or RangeError when an argument is wrong.
 */
function constructEvent(
  rawBody: string | Uint8Array | ArrayBuffer,
  signatureHeader: string | readonly string[] | null | undefined,
  secret: string,
  options?: ConstructEventOptions,
): WebhookEvent {
  const body = readRawBody(rawBody);
  const signingSecret = readSecret(secret);
  const { toleranceSeconds, now } = readOptions(options);
  const header = readHeader(signatureHeader);

  const { timestamp, signatures } = parseHeader(header);
  const expected = createHmac("sha256", signingSecret).update(`${timestamp}.`).update(body).digest();
  // Every candidate is compared, in constant time: the loop does not stop at the first match.
  let matched = false;
  for (const candidate of signatures) {
    if (SIGNATURE_PATTERN.test(candidate) && timingSafeEqual(Buffer.from(candidate, "hex"), expected)) matched = true;
  }
  if (!matched) {
    throw new WebhookSignatureError("no_matching_signature", "No signature of the GameCoin-Signature header matches the payload and the signing secret");
  }

  if (toleranceSeconds > 0) {
    const nowSeconds = toMilliseconds(now()) / 1000;
    if (Math.abs(nowSeconds - Number(timestamp)) > toleranceSeconds) {
      throw new WebhookSignatureError("timestamp_out_of_tolerance", `The signed timestamp is more than ${toleranceSeconds} seconds away from the clock`);
    }
  }
  return parseEvent(Buffer.from(body.buffer, body.byteOffset, body.byteLength).toString("utf8"));
}

/** Webhook helpers. `webhooks.constructEvent` needs no client and makes no request. */
export const webhooks = Object.freeze({ constructEvent });

// --- Arguments ---------------------------------------------------------------------------------------------

function readRawBody(value: unknown): Uint8Array {
  if (typeof value === "string") return Buffer.from(value, "utf8");
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TypeError(
    `rawBody must be the raw request body (a string, Buffer or Uint8Array), got ${describeType(value)}. Do not pass a parsed object: with Express, read this route with express.raw({ type: "application/json" }) instead of express.json()`,
  );
}

function readSecret(value: unknown): string {
  const secret = requireString(value, "secret").trim();
  if (secret === "") throw new RangeError("secret must not be empty");
  return secret;
}

function readOptions(options: ConstructEventOptions | undefined): { toleranceSeconds: number; now: () => Date | number } {
  if (options === undefined) return { toleranceSeconds: DEFAULT_WEBHOOK_TOLERANCE_SECONDS, now: Date.now };
  const settings = requireObject(options, "options");
  assertKnownKeys(settings, ["toleranceSeconds", "now"], "options");
  const toleranceSeconds =
    settings.toleranceSeconds === undefined ? DEFAULT_WEBHOOK_TOLERANCE_SECONDS : requireInteger(settings.toleranceSeconds, "options.toleranceSeconds", 0);
  if (settings.now !== undefined && typeof settings.now !== "function") throw new TypeError(`options.now must be a function, got ${describeType(settings.now)}`);
  return { toleranceSeconds, now: (settings.now as (() => Date | number) | undefined) ?? Date.now };
}

function toMilliseconds(value: Date | number): number {
  const ms = value instanceof Date ? value.getTime() : value;
  if (typeof ms !== "number" || !Number.isFinite(ms)) throw new TypeError("options.now must return a Date or a number of milliseconds");
  return ms;
}

/** The header as one string; `undefined`, `null` and the empty string are "missing", anything but text is a mistake. */
function readHeader(value: unknown): string {
  if (value === undefined || value === null) throw new WebhookSignatureError("missing_header", "The GameCoin-Signature header is missing");
  let header: string;
  if (typeof value === "string") header = value;
  else if (Array.isArray(value) && value.every((part) => typeof part === "string")) header = value.join(",");
  else throw new TypeError(`signatureHeader must be the value of the GameCoin-Signature header (a string), got ${describeType(value)}`);
  if (header.trim() === "") throw new WebhookSignatureError("missing_header", "The GameCoin-Signature header is missing");
  return header;
}

// --- Header and payload ------------------------------------------------------------------------------------

function parseHeader(header: string): { timestamp: string; signatures: string[] } {
  let timestamp: string | undefined;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const trimmed = part.trim();
    const at = trimmed.indexOf("=");
    if (at < 1) continue; // empty, or not a key=value pair: ignored like an unknown key
    const key = trimmed.slice(0, at).trim();
    const value = trimmed.slice(at + 1).trim();
    if (key === "t") {
      if (!TIMESTAMP_PATTERN.test(value) || (timestamp !== undefined && timestamp !== value)) {
        throw new WebhookSignatureError("malformed_header", "The GameCoin-Signature header has no valid timestamp (t=<unix seconds>)");
      }
      timestamp = value;
    } else if (key === "v1" && value !== "") {
      signatures.push(value);
    }
  }
  if (timestamp === undefined || signatures.length === 0) {
    throw new WebhookSignatureError("malformed_header", "The GameCoin-Signature header must look like t=<unix seconds>,v1=<hex signature>");
  }
  return { timestamp, signatures };
}

function invalidPayload(detail: string): WebhookSignatureError {
  return new WebhookSignatureError("invalid_payload", `The signed payload is not a GameCoin webhook event (${detail})`);
}

function parseEvent(text: string): WebhookEvent {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw invalidPayload("not JSON");
  }
  try {
    const { id, type, createdAt, env, data } = parseWebhookEnvelope(json);
    switch (type) {
      case "order.fulfilled":
      case "order.refunded":
      case "order.chargeback":
        return { id, type, createdAt, env, data: parseOrder(data, "event.data") };
      case "wallet.credited":
        return { id, type, createdAt, env, data: parseWalletCreditedData(data) };
      case "webhook.test":
        return { id, type, createdAt, env, data: parseTestEventData(data) };
      default:
        return { id, type, createdAt, env, data };
    }
  } catch (error) {
    if (error instanceof ShapeError) throw invalidPayload(error.message);
    throw error;
  }
}
