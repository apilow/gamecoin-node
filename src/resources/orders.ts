import type { HttpClient } from "../http.js";
import { parseOrder } from "../parse.js";
import type { Order, RefundParams, RequestOptions } from "../types.js";
import { assertKnownKeys, readOptions, requireObject, requireString } from "../validate.js";

/** Reading and refunding orders. */
export class OrdersResource {
  readonly #http: HttpClient;

  constructor(http: HttpClient) {
    this.#http = http;
  }

  /** An order of the game; `NOT_FOUND` for an unknown one. `GET /orders/{orderId}` */
  async get(orderId: string, options?: RequestOptions): Promise<Order> {
    const path = `/orders/${encodeURIComponent(requireString(orderId, "orderId"))}`;
    const { signal } = readOptions(options, false, "orders.get");
    return (await this.#http.call({ method: "GET", path, signal }, parseOrder)).value;
  }

  /**
   * Refunds a fulfilled order and takes the coins and items back; `CONFLICT` for an order that cannot be refunded
   * (for instance one that was never paid).
   *
   * A refund has no idempotency key, so the SDK retries it on `429` only. After a network error, a timeout or a `5xx`
   * it raises, and you check the order with {@link OrdersResource.get} before trying again. `POST /orders/{orderId}/refund`
   */
  async refund(orderId: string, params: RefundParams = {}, options?: RequestOptions): Promise<Order> {
    const path = `/orders/${encodeURIComponent(requireString(orderId, "orderId"))}/refund`;
    const fields = requireObject(params, "params");
    assertKnownKeys(fields, ["reason"], "params");
    const body: { reason?: string } = {};
    if (fields.reason !== undefined) {
      if (typeof fields.reason !== "string") throw new TypeError("params.reason must be a string");
      body.reason = fields.reason;
    }
    const { signal } = readOptions(options, false, "orders.refund");
    return (await this.#http.call({ method: "POST", path, body, retry: "rate-limit", signal }, parseOrder)).value;
  }
}
