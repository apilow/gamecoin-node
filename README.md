# @apilow/gamecoin

Server SDK for [Apilow GameCoin](https://gamecoin.apilow.com), the bank of your game: it keeps the virtual currency,
the inventory and the sales of your web or mobile game. Use it from your game backend, with a **secret key**.

- Whole server API: catalog, players, wallet, ledger, inventory, purchases, checkouts, gift codes, orders and refunds.
- Webhook signature verification: one pure function, no client needed.
- Safe to retry: every state-changing call carries an idempotency key, and failures are retried for you.
- Zero runtime dependencies (built-in `fetch`), Node 18 or later, ESM and CommonJS, TypeScript types included.
- The secret key never shows up in an error, a log line or a string representation of the client.

> A secret key must never leave your server. For a browser or a game client, use the browser SDK with a publishable
> key: it can read and spend, and it can never credit anything.

## Install

```sh
npm install @apilow/gamecoin
```

## Quickstart

Grant 100 gems, spend 30, and sell a pack: ten lines.

```js
import { GameCoin, ext } from "@apilow/gamecoin";

const gamecoin = new GameCoin(process.env.GAMECOIN_SECRET_KEY, { baseUrl: process.env.GAMECOIN_BASE_URL });
const player = ext("user-42");

const { balance } = await gamecoin.wallet.grant(player, { currency: "gems", amount: 100, reason: "welcome" });
console.log(`${balance.total} ${balance.currency}`);

await gamecoin.wallet.spend(player, { currency: "gems", amount: 30, reason: "revive" });

const { order, checkoutUrl } = await gamecoin.checkouts.create(player, { packSku: "gems-500" });
console.log(order.status, checkoutUrl); // pending, then send the player to checkoutUrl
```

The same with CommonJS:

```cjs
const { GameCoin, ext } = require("@apilow/gamecoin");
```

The examples below continue this one: `gamecoin` and `player` are the ones defined above. A runnable copy of the
quickstart is in [`examples/quickstart.mjs`](examples/quickstart.mjs).

## Configuration

```ts
new GameCoin(secretKey: string, options?: GameCoinOptions)
```

| Option | Default | Meaning |
|---|---|---|
| `baseUrl` | `https://gamecoin.apilow.com` | Where the API runs. The SDK appends `/api/v1`. |
| `timeout` | `30000` | Milliseconds to wait for one attempt (headers and body). |
| `maxRetries` | `2` | Retries after the first attempt, so three attempts by default. From `0` (no retry) to `10`. |
| `fetch` | global `fetch` | Your own transport, for tests or a proxy. |
| `sleep` | a timer | Your own wait between retries, for tests. |

The key decides the game and the environment: `gc_sk_test_…` talks to the test environment, `gc_sk_live_…` to the live
one. Nothing else in a request can change that.

```js
console.log(gamecoin.environment); // "test" or "live", read from the prefix of the key
```

Anything that is not a secret key is refused before any request, and a publishable key (`gc_pk_…`) gets a message that
points to the browser SDK. Invalid arguments throw a `TypeError` (wrong type) or a `RangeError` (unacceptable value),
never a `GameCoinError`, and no request is made.

Keep the key in an environment variable or a secret manager, never in the code. `util.inspect`, `JSON.stringify` and
`String` show only its prefix (`gc_sk_test_…`).

## Players and the `ext` helper

A player is a GameCoin player id, or **your own id** through `ext()`:

```js
ext("user-42"); // "ext:user-42"
```

Any string works as your id, spaces, slashes, `%` and accents included: the SDK URL-encodes the whole reference exactly
once. With a secret key, any write on an unknown `ext:` player creates it; a read answers `NOT_FOUND`.

```js
const profile = await gamecoin.players.upsert(player, { displayName: "Alice", country: "BE" });
const same = await gamecoin.players.get(player);
console.log(profile.id === same.id, profile.externalId); // true "user-42"

// A one-hour token for the browser SDK of your game client
const { token, expiresAt } = await gamecoin.players.createToken(player);
console.log(token.startsWith("gc_pt_"), expiresAt > new Date());
```

In `players.upsert`, a missing field is left unchanged and `null` clears it.

## Wallet and ledger

A balance has two buckets: `paid` (bought with real money) and `bonus` (granted or earned). A grant always credits
`bonus`; a spend takes `bonus` first.

```js
const wallet = await gamecoin.wallet.get(player);
for (const { currency, paid, bonus, total } of wallet.balances) console.log(currency, paid, bonus, total);

const { entry, balance: after } = await gamecoin.wallet.grant(player, {
  currency: "gold",
  amount: 25,
  reason: "daily_reward",
  metadata: { day: "3" }, // free strings, recorded in the ledger
});
console.log(entry.type, entry.bonusDelta, after.total); // "grant" 25 ...
```

The ledger is the immutable history of every change, newest first. Read one page, or let `iterate` follow the cursors
and fetch each page only when needed:

```js
const page = await gamecoin.ledger.list(player, { currency: "gold", limit: 10 });
console.log(page.entries.length, page.nextCursor); // nextCursor is null on the last page

for await (const item of gamecoin.ledger.iterate(player, { currency: "gold", limit: 50 })) {
  console.log(item.createdAt.toISOString(), item.type, item.paidDelta + item.bonusDelta);
  if (item.type === "grant") break; // stop whenever you like: no further page is fetched
}
```

## Inventory and purchases

Items are `consumable` (can be consumed) or `durable` (cannot), and may have a `maxOwned`.

```js
const potions = await gamecoin.inventory.grant(player, { sku: "potion", quantity: 3 });
console.log(potions.quantity); // 3 or more

const used = await gamecoin.inventory.consume(player, { sku: "potion" }); // quantity defaults to 1
console.log(used.quantity);

const owned = await gamecoin.inventory.list(player); // owned items only (quantity above 0)
console.log(owned.map((item) => `${item.sku} x${item.quantity}`));
```

`purchases.create` buys an item with its price in currency, atomically: the wallet is debited and the item added.

```js
const purchase = await gamecoin.purchases.create(player, { sku: "potion" });
console.log(purchase.balance.total, purchase.item.quantity, purchase.entry.ref.itemSku); // ... ... "potion"
```

## Checkout, orders and refunds

`catalog.get()` lists the active currencies, items and packs. A pack has an `availability`: `null` for an ordinary pack (always
on sale, no limit), otherwise `{ startsAt, endsAt, remaining, founder }` with the dates as `Date` or `null` and `remaining` the
units left (`null` for an unlimited stock). The catalog also lists scheduled, ended and sold-out packs: your shop decides what
to show. While the game is in pre-launch, `catalog.prelaunch` is `true` and `catalog.launchAt` holds the launch date.

```js
const catalog = await gamecoin.catalog.get();
for (const pack of catalog.packs) {
  const left = pack.availability?.remaining; // undefined: ordinary pack, null: unlimited stock
  console.log(pack.sku, pack.priceCents, left, pack.availability?.founder ?? false);
}
if (catalog.prelaunch) console.log("pre-orders until", catalog.launchAt);
```

A checkout sells a currency pack for real money through a hosted payment page.

```js
const checkout = await gamecoin.checkouts.create(player, {
  packSku: "gems-500",
  successUrl: "https://example.com/shop/thanks", // where the player goes after paying
  cancelUrl: "https://example.com/shop",
  country: "BE", // the buyer's country decides the VAT (EU countries only)
  locale: "en", // language of the payment page, the receipt and the e-mails: "fr", "en" or "nl"
  creatorCode: "ALICE10", // optional, a code that exists: free bonus coins for the buyer, a commission for the creator
});
console.log(checkout.order.status, checkout.checkoutUrl); // "pending" "https://…/pay/<order id>?t=…"

const order = await gamecoin.orders.get(checkout.order.id);
console.log(order.status, order.amountCents, order.vatCents, order.netCents);
```

A refused `creatorCode` (unknown, disabled, not valid for the pack, or the creator's own player) is a `VALIDATION_FAILED` error
with `error.details.fieldErrors.creatorCode` equal to `["CODE_INVALID"]`. The order keeps the code: `order.creatorCode` is
`{ code, creatorName }` (never the creator's rates), or `null`. A pack outside its sale window is refused with
`PACK_NOT_AVAILABLE` (`error.details.startsAt` and `error.details.endsAt`: ISO 8601 text or `null`), a pack with no unit left
with `PACK_SOLD_OUT` (`error.details.packSku`). The window is checked when the order is created: an order created in time stays payable.

In the test environment the payment page offers "Pay (simulated)" and "Decline"; real payments are not available yet.
After payment the order becomes `fulfilled`: the coins and items are delivered.

`orders.refund` takes the coins and items back from a fulfilled order. An order that was never paid answers `CONFLICT`:

```js
import { ErrorCode, GameCoinError } from "@apilow/gamecoin";

try {
  await gamecoin.orders.refund(order.id, { reason: "player request" });
} catch (error) {
  if (error instanceof GameCoinError && error.code === ErrorCode.CONFLICT) console.log("not refundable:", error.message);
  else throw error;
}
```

A refund has no idempotency key, so it is retried on `429` only. After a network error, a timeout or a `5xx` the SDK
raises, and you read the order back with `orders.get` before trying again.

## Codes

A **gift code** is issued by your studio (limited uses, one use per player, optional expiry) and typed by the player. It gives
free coins (the `bonus` bucket) and items, never paid coins. `codes.redeem` takes the player and the code as typed: the API
ignores case, spaces and dashes, so the SDK does not change it.

```js
const redemption = await gamecoin.codes.redeem(player, "SUMMER-2026");
for (const { currency, amount, balance } of redemption.grants) console.log(`+${amount} ${currency}, now ${balance.total}`);
console.log(redemption.items, redemption.skipped, redemption.replayed); // items received; items the player could not receive (maxOwned)
```

An unknown, malformed, expired, used up, disabled or already used code is always the same error, so that nothing tells a guess
from a real code: `VALIDATION_FAILED` with `error.details.fieldErrors.code` equal to `["CODE_INVALID"]`. It is never retried.
`PLAYER_BLOCKED`, `LIMIT_REACHED` (the player already owns the maximum of every item), `CONFLICT` (currencies or items archived
since) and `RATE_LIMITED` come through the usual error mapping; the code is not used up in the first three cases. Like the other
state-changing calls, `codes.redeem` sends an idempotency key: a replay returns the same result with `replayed: true` and credits
nothing twice. Creator codes are a different thing: they go in the `creatorCode` option of `checkouts.create`.

## Webhooks

GameCoin calls your server when an order is delivered, refunded or disputed. Every call is signed with the secret of
the endpoint (`whsec_gc_…`, shown once in the dashboard). `webhooks.constructEvent` checks the signature and the age
of the call, and returns the typed event. It needs no client and makes no request:

```js
import express from "express";
import { WebhookEventType, WebhookSignatureError, isKnownWebhookEvent, webhooks } from "@apilow/gamecoin";

const app = express();

// The signature covers the body exactly as received: read it as raw bytes, never through express.json().
app.post("/gamecoin/webhook", express.raw({ type: "application/json" }), async (req, res) => {
  let event;
  try {
    event = webhooks.constructEvent(req.body, req.get("GameCoin-Signature"), process.env.GAMECOIN_WEBHOOK_SECRET);
  } catch (error) {
    if (error instanceof WebhookSignatureError) return res.sendStatus(400); // not from GameCoin, or replayed
    throw error;
  }

  if (await alreadyProcessed(event.id)) return res.sendStatus(200); // GameCoin can send an event twice

  if (isKnownWebhookEvent(event) && event.type === WebhookEventType.ORDER_FULFILLED) {
    await unlockPurchase(event.data.playerId, event.data.pack.sku); // event.data is the order
  }
  await markProcessed(event.id);
  res.sendStatus(200); // any 2xx within 10 seconds
});
```

> **Pass the raw body.** A body that was parsed and serialised again can differ by one character, and the signature
> then fails. `constructEvent` takes the raw body as a string or as bytes (`Buffer`, `Uint8Array`) and refuses a parsed
> object with a `TypeError`. With Express, use `express.raw({ type: "application/json" })` on this route, and no global
> `express.json()` before it. A runnable server is in [`examples/webhook-server.mjs`](examples/webhook-server.mjs).

`webhooks.constructEvent(rawBody, signatureHeader, secret, options?)` checks, in this order: the header
(`t=<unix seconds>,v1=<hex>[,v1=<hex>…]`), the HMAC-SHA256 of `<t>.<rawBody>` (every `v1` is compared, in constant time),
the timestamp, then the JSON envelope. Options:

| Option | Meaning |
|---|---|
| `toleranceSeconds` | Largest gap between the signed timestamp and your clock, in either direction. Default `300`; `0` turns the check off. |
| `now` | Your own clock, for tests: a function that returns a `Date` or milliseconds since the epoch. |

On failure it throws a `WebhookSignatureError` (not a `GameCoinError`) whose `reason` is one of:

| `reason` | When |
|---|---|
| `missing_header` | No `GameCoin-Signature` header |
| `malformed_header` | No valid `t` or no `v1` in it |
| `no_matching_signature` | Wrong secret, or the body changed |
| `timestamp_out_of_tolerance` | Signed, but older or newer than the tolerance: a replayed call |
| `invalid_payload` | Signed, but not JSON or not an event |

Answer `400` to every one of them. The error never contains the secret, the body or a signature. An empty `secret` or a
parsed object instead of the raw body is a bug in your code: it throws `RangeError` or `TypeError`, not a
`WebhookSignatureError`.

The event is `{ id, type, createdAt, env, data }`, with `createdAt` as a `Date` and `env` the environment (`"test"` or
`"live"`) that sent the call. Use `event.id` to process an event once. `WebhookEventType` holds the types:

| Constant | `type` | `data` |
|---|---|---|
| `ORDER_FULFILLED` | `order.fulfilled` | the `Order`, as `orders.get` returns it (with `creatorCode`: `{ code, creatorName }` or `null`) |
| `ORDER_REFUNDED` | `order.refunded` | the `Order` |
| `ORDER_CHARGEBACK` | `order.chargeback` | the `Order` |
| `WALLET_CREDITED` | `wallet.credited` | `{ playerId, orderId, credits: [{ currency, paid, bonus }] }` |
| `WEBHOOK_TEST` | `webhook.test` | `{ message }` |

An event of another type (GameCoin may add some) is returned as it is, with `data` untyped, instead of failing.
`isKnownWebhookEvent(event)` tells the two apart, and narrows `event` for TypeScript.

## Idempotency and retries

Every call that changes something (`wallet.grant`, `wallet.spend`, `inventory.grant`, `inventory.consume`,
`purchases.create`, `checkouts.create`, `codes.redeem`) sends an `Idempotency-Key`. By default the SDK generates a UUID v4 **once per
call** and reuses it for every retry of that call, so a retry can never apply a change twice.

Pass your own key to make a retry of *your* code safe too, for instance the id of a quest completion. The result
tells whether the answer came from an earlier request:

```js
import { randomUUID } from "node:crypto";

const idempotencyKey = `quest-17-${randomUUID()}`; // 1 to 100 printable ASCII characters
const first = await gamecoin.wallet.grant(player, { currency: "gems", amount: 10 }, { idempotencyKey });
const again = await gamecoin.wallet.grant(player, { currency: "gems", amount: 10 }, { idempotencyKey });
console.log(first.replayed, again.replayed, first.entry.id === again.entry.id); // false true true
```

The same key with a different request is refused with `IDEMPOTENCY_CONFLICT`. Keys are kept 30 days. A replayed checkout
returns the order in its *current* state.

Retries, at most `maxRetries` (default 2):

| Failure | Retried |
|---|---|
| Network error, timeout, `5xx` | yes (not for `orders.refund`) |
| `429` | yes, waiting for `Retry-After` |
| Any other `4xx` | never |

The wait is `0.5 s × 2^attempt` with ±25 % jitter; a `Retry-After` header wins, capped at 30 seconds. Beyond the cap
nothing is retried and the error carries `retryAfter` (in seconds).

Cancel a call, and any retry in progress, with an `AbortSignal`. The call then rejects with the signal's reason:

```js
const controller = new AbortController();
setTimeout(() => controller.abort(), 5_000);
const latest = await gamecoin.wallet.get(player, { signal: controller.signal });
console.log(latest.balances.length);
```

## Errors

Anything that goes wrong with a request is a `GameCoinError`:

| Field | Content |
|---|---|
| `code` | API code (`INSUFFICIENT_FUNDS`, `NOT_FOUND`…), or `NETWORK_ERROR` / `TIMEOUT` (status 0), or `INVALID_RESPONSE` when the body is not the expected JSON |
| `status` | HTTP status, `0` when no response was received |
| `message` | The message of the API, or a short description |
| `details` | The `details` of the API (`required`, `available`, `fieldErrors`…), `{}` when absent |
| `retryAfter` | Seconds, when the API sent `Retry-After` |

```js
try {
  await gamecoin.wallet.spend(player, { currency: "gems", amount: 1_000_000 });
} catch (error) {
  if (error instanceof GameCoinError && error.code === ErrorCode.INSUFFICIENT_FUNDS) {
    console.log(`needs ${error.details.required}, has ${error.details.available}`);
  } else {
    throw error;
  }
}
```

`ErrorCode` holds a constant for every code:

| HTTP | Code | When |
|---|---|---|
| 400 | `VALIDATION_FAILED` | Body, query or reference invalid (`details.fieldErrors`) |
| 400 | `IDEMPOTENCY_KEY_REQUIRED` | Missing key (the SDK always sends one) |
| 401 | `UNAUTHENTICATED` | Secret key missing, unknown or revoked |
| 402 | `PAYMENT_FAILED` | Payment refused, or no payment provider for this environment |
| 403 | `FORBIDDEN` | Key kind not allowed here |
| 403 | `PLAYER_BLOCKED` | The player is blocked |
| 403 | `ENV_NOT_ENABLED` | `live` used by a studio that is not verified |
| 404 | `NOT_FOUND` | Unknown player, currency, item, pack or order |
| 409 | `INSUFFICIENT_FUNDS` | Wallet or item quantity too low (`details.required`, `details.available`) |
| 409 | `LIMIT_REACHED` | `maxOwned`, `maxPerPlayer` or the balance ceiling exceeded |
| 409 | `PACK_NOT_AVAILABLE` | The pack is outside its sale window (`details.startsAt`, `details.endsAt`) |
| 409 | `PACK_SOLD_OUT` | No unit of the pack is left (`details.packSku`) |
| 409 | `IDEMPOTENCY_CONFLICT` | Key reused with another request |
| 409 | `CONFLICT` | Invalid state transition, e.g. refund of an unpaid order |
| 429 | `RATE_LIMITED` | Too many requests (`retryAfter`) |
| 500 | `INTERNAL` | Unexpected |
| 0 | `NETWORK_ERROR`, `TIMEOUT` | No answer (SDK) |
| any | `INVALID_RESPONSE` | The body is not the expected JSON (SDK) |

`details` is meant for developers, not for parsing, except `required` and `available`. When ESM and CommonJS copies of
this package can meet in your program, test with `GameCoinError.isGameCoinError(error)` instead of `instanceof`.

## Running the tests

```sh
npm ci
npm run build           # dist/esm, dist/cjs and the type declarations
npm test                # unit tests (node:test), no network
npm run test:package    # the built package, loaded with import and require, and its types
```

The integration test runs against the sandbox game of a local GameCoin (currencies `gems` and `gold`, items `potion`
and `fire-sword`, packs `starter` and `gems-500`). It is skipped unless both variables are set:

```sh
GAMECOIN_BASE_URL=http://localhost:3400 GAMECOIN_SECRET_KEY=gc_sk_test_... npm run test:integration
```

`GAMECOIN_ENV_FILE=path/to/dotenv` may name a file that provides them. The tests never print the key.

## Status

Pre-release (`0.x`). The GameCoin API runs in **test mode with simulated payments**; real payments are not available
yet, and the `live` environment is reserved for verified studios. The API of this package may still change between
minor versions.

## Licence

[MIT](LICENSE) © 2026 Apilow
