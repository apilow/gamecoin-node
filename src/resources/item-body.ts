import type { ItemQuantityParams } from "../types.js";
import { assertKnownKeys, requireInteger, requireObject, requireString } from "../validate.js";

/** Body of `inventory.grant`, `inventory.consume` and `purchases.create`: `quantity` is sent only when given (the API defaults it to 1). */
export function itemQuantityBody(params: ItemQuantityParams): { sku: string; quantity?: number } {
  const fields = requireObject(params, "params");
  assertKnownKeys(fields, ["sku", "quantity"], "params");
  const body: { sku: string; quantity?: number } = { sku: requireString(fields.sku, "params.sku") };
  if (fields.quantity !== undefined) body.quantity = requireInteger(fields.quantity, "params.quantity", 1);
  return body;
}
