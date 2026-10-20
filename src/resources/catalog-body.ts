import { assertKnownKeys, describeType, requireInteger, requireObject, requireString, requireStringMap } from "../validate.js";

/**
 * Local checks of the parameters of the catalog management calls (`currencies`, `items`, `packs`). They only look at the
 * shape (types, integers, unknown fields); the rules of the catalog (code format, existing currency, content of a pack…)
 * are the server's, which answers `VALIDATION_FAILED` with `details.fieldErrors`.
 */

type Checker = (value: unknown, name: string) => unknown;

export const text: Checker = (value, name) => requireString(value, name);

/** A text that may be empty or `null` (a description: empty or `null` means none). */
export const nullableText: Checker = (value, name) => {
  if (value === null) return null;
  if (typeof value !== "string") throw new TypeError(`${name} must be a string or null, got ${describeType(value)}`);
  return value;
};

export const flag: Checker = (value, name) => {
  if (typeof value !== "boolean") throw new TypeError(`${name} must be a boolean, got ${describeType(value)}`);
  return value;
};

export const integerFrom =
  (min: number): Checker =>
  (value, name) =>
    requireInteger(value, name, min);

/** Any integer, negative ones included (a sort order). */
export const anyInteger: Checker = (value, name) => requireInteger(value, name, Number.MIN_SAFE_INTEGER);

export const nullableIntegerFrom =
  (min: number): Checker =>
  (value, name) =>
    value === null ? null : requireInteger(value, name, min);

export const oneOf =
  (...allowed: string[]): Checker =>
  (value, name) => {
    if (typeof value !== "string") throw new TypeError(`${name} must be a string, got ${describeType(value)}`);
    if (!allowed.includes(value)) throw new RangeError(`${name} must be one of: ${allowed.join(", ")}`);
    return value;
  };

export const nullableOneOf =
  (...allowed: string[]): Checker =>
  (value, name) =>
    value === null ? null : oneOf(...allowed)(value, name);

export const metadata: Checker = (value, name) => ({ ...requireStringMap(value, name) });

export const itemPrice: Checker = (value, name) => {
  if (value === null) return null;
  const price = requireObject(value, name);
  assertKnownKeys(price, ["currency", "amount"], name);
  return { currency: requireString(price.currency, `${name}.currency`), amount: requireInteger(price.amount, `${name}.amount`, 1) };
};

const listOf =
  (fields: Record<string, Checker>): Checker =>
  (value, name) => {
    if (!Array.isArray(value)) throw new TypeError(`${name} must be an array, got ${describeType(value)}`);
    return value.map((entry, index) => build(entry, fields, `${name}[${index}]`, Object.keys(fields)));
  };

export const packGrants: Checker = listOf({ currency: text, amount: integerFrom(0), bonus: integerFrom(0) });
export const packItems: Checker = listOf({ sku: text, quantity: integerFrom(1) });

/** A `Date` or an ISO 8601 text with a time zone, sent as an ISO 8601 text; `null` for no limit. */
function instant(value: unknown, name: string): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new RangeError(`${name} must be a valid date`);
    return value.toISOString();
  }
  if (typeof value === "string") {
    if (value === "" || Number.isNaN(Date.parse(value))) throw new RangeError(`${name} must be a Date or an ISO 8601 date-time`);
    return value;
  }
  throw new TypeError(`${name} must be a Date, an ISO 8601 text or null, got ${describeType(value)}`);
}

/**
 * The whole availability of a pack. A field left out is `null` (`founder`: `false`): the object replaces the previous
 * settings, it is not merged with them.
 */
export const availability: Checker = (value, name) => {
  if (value === null) return null;
  const fields = requireObject(value, name);
  assertKnownKeys(fields, ["startsAt", "endsAt", "stock", "founder"], name);
  return {
    startsAt: instant(fields.startsAt, `${name}.startsAt`),
    endsAt: instant(fields.endsAt, `${name}.endsAt`),
    stock: fields.stock === undefined ? null : nullableIntegerFrom(1)(fields.stock, `${name}.stock`),
    founder: fields.founder === undefined ? false : flag(fields.founder, `${name}.founder`),
  };
};

/**
 * The body of a call from its parameters: every field must be known, `required` fields must be there, and a field
 * given as `undefined` counts as left out.
 */
export function build(params: unknown, fields: Record<string, Checker>, name: string, required: readonly string[] = []): Record<string, unknown> {
  const given = requireObject(params, name);
  assertKnownKeys(given, Object.keys(fields), name);
  const body: Record<string, unknown> = {};
  for (const [key, check] of Object.entries(fields)) {
    const value = given[key];
    if (value === undefined && !required.includes(key)) continue;
    body[key] = check(value, `${name}.${key}`);
  }
  return body;
}

/** The `includeArchived` flag of a list call. */
export function listQuery(params: unknown, name: string): { includeArchived?: "true" } {
  if (params === undefined) return {};
  const given = requireObject(params, name);
  assertKnownKeys(given, ["includeArchived"], name);
  if (given.includeArchived === undefined) return {};
  return flag(given.includeArchived, `${name}.includeArchived`) ? { includeArchived: "true" } : {};
}
