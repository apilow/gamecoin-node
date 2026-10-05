import type { MutationOptions, RequestOptions } from "./types.js";

/**
 * Local checks of the arguments, before any request: a wrong type is a `TypeError`, an unacceptable value a
 * `RangeError`. Messages name the argument, never its value (a value could be a secret).
 */

const IDEMPOTENCY_KEY_PATTERN = /^[\x20-\x7E]{1,100}$/;

export function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  return typeof value === "undefined" ? "undefined" : `a ${typeof value}`;
}

export function requireString(value: unknown, name: string): string {
  if (typeof value !== "string") throw new TypeError(`${name} must be a string, got ${describeType(value)}`);
  if (value === "") throw new RangeError(`${name} must not be empty`);
  return value;
}

export function optionalString(value: unknown, name: string): string | undefined {
  return value === undefined ? undefined : requireString(value, name);
}

/** An integer from `min` to `max`. */
export function requireInteger(value: unknown, name: string, min: number, max = Number.MAX_SAFE_INTEGER): number {
  if (typeof value !== "number") throw new TypeError(`${name} must be a number, got ${describeType(value)}`);
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be an integer ${max === Number.MAX_SAFE_INTEGER ? `of at least ${min}` : `from ${min} to ${max}`}`);
  }
  return value;
}

export function optionalInteger(value: unknown, name: string, min: number, max?: number): number | undefined {
  return value === undefined ? undefined : requireInteger(value, name, min, max);
}

/** A plain object (`params`, `profile`…); anything else is a `TypeError`. */
export function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object, got ${describeType(value)}`);
  }
  return value as Record<string, unknown>;
}

/** The API bodies are strict, so are the SDK parameters: an unknown field is rejected instead of being dropped. */
export function assertKnownKeys(value: Record<string, unknown>, allowed: readonly string[], name: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new RangeError(`${name} has an unknown field "${key}" (allowed: ${allowed.join(", ")})`);
  }
}

export function requireStringMap(value: unknown, name: string): Record<string, string> {
  const map = requireObject(value, name);
  for (const [key, entry] of Object.entries(map)) {
    if (typeof entry !== "string") throw new TypeError(`${name}.${key} must be a string, got ${describeType(entry)}`);
  }
  return map as Record<string, string>;
}

export function requireNullableString(value: unknown, name: string): string | null {
  return value === null ? null : requireString(value, name);
}

/** The options argument of a call: an optional object holding an `AbortSignal` and, for mutations, an idempotency key. */
export function readOptions(options: RequestOptions | MutationOptions | undefined, withKey: boolean, name: string): {
  signal: AbortSignal | undefined;
  idempotencyKey: string | undefined;
} {
  if (options === undefined) return { signal: undefined, idempotencyKey: undefined };
  const object = requireObject(options, `${name} options`);
  assertKnownKeys(object, withKey ? ["signal", "idempotencyKey"] : ["signal"], `${name} options`);
  const signal = object.signal;
  if (signal !== undefined && (typeof signal !== "object" || signal === null || typeof (signal as AbortSignal).aborted !== "boolean")) {
    throw new TypeError(`${name} options.signal must be an AbortSignal`);
  }
  const key = object.idempotencyKey;
  if (key !== undefined) {
    if (typeof key !== "string") throw new TypeError(`${name} options.idempotencyKey must be a string, got ${describeType(key)}`);
    if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
      throw new RangeError(`${name} options.idempotencyKey must be 1 to 100 printable ASCII characters`);
    }
  }
  return { signal: signal as AbortSignal | undefined, idempotencyKey: key };
}
