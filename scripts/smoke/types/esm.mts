// Type-checked by scripts/check-package.mjs with module "node16": proves the `import` condition's declarations.
import { ErrorCode, GameCoin, GameCoinError, ext, type Checkout, type Movement, type Order } from "@apilow/gamecoin";

const gamecoin = new GameCoin("gc_sk_test_x", { baseUrl: "http://localhost:3400", timeout: 5_000, maxRetries: 1 });
const player = ext("user-42");

// The global fetch is a valid transport.
const withFetch = new GameCoin("gc_sk_test_x", { fetch });
void withFetch;

const movement: Movement = await gamecoin.wallet.grant(player, { currency: "gems", amount: 100, reason: "level_up", metadata: { level: "5" } }, { idempotencyKey: "k-1" });
const replayed: boolean = movement.replayed;
const checkout: Checkout = await gamecoin.checkouts.create(player, { packSku: "gems-500" });
const order: Order = await gamecoin.orders.refund(checkout.order.id, { reason: "test" });
const createdAt: Date = order.createdAt;
const paidAt: Date | null = order.paidAt;

for await (const entry of gamecoin.ledger.iterate(player, { currency: "gems", limit: 50 })) {
  const delta: number = entry.bonusDelta;
  void delta;
}

try {
  await gamecoin.wallet.spend(player, { currency: "gems", amount: 1 });
} catch (error) {
  if (error instanceof GameCoinError && error.code === ErrorCode.INSUFFICIENT_FUNDS) {
    const needed = error.details.required;
    const status: number = error.status;
    const wait: number | undefined = error.retryAfter;
    void [needed, status, wait];
  }
}

// @ts-expect-error amount must be a number
await gamecoin.wallet.grant(player, { currency: "gems", amount: "100" });
// @ts-expect-error unknown field
await gamecoin.wallet.grant(player, { currency: "gems", amount: 1, paid: 1 });
// @ts-expect-error a mutation key is not an option of a read
await gamecoin.wallet.get(player, { idempotencyKey: "k" });

void [replayed, createdAt, paidAt];

// v0.2: locale on checkouts, and the webhook helpers.
import { WebhookEventType, WebhookSignatureError, isKnownWebhookEvent, webhooks, type WebhookEvent } from "@apilow/gamecoin";

await gamecoin.checkouts.create(player, { packSku: "gems-500", locale: "fr" });

function handle(rawBody: Buffer, signature: string | undefined): string {
  try {
    const event: WebhookEvent = webhooks.constructEvent(rawBody, signature, "whsec_gc_x", { toleranceSeconds: 600, now: () => Date.now() });
    if (isKnownWebhookEvent(event) && event.type === WebhookEventType.ORDER_FULFILLED) {
      const sku: string = event.data.pack.sku;
      return sku;
    }
    if (isKnownWebhookEvent(event) && event.type === "wallet.credited") return event.data.credits[0]?.currency ?? "";
    return event.id;
  } catch (error) {
    if (error instanceof WebhookSignatureError) return error.reason;
    throw error;
  }
}

void handle;
