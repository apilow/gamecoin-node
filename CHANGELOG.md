# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package follows
[Semantic Versioning](https://semver.org/) (while the version is 0.x, a minor release may change the API).

## [0.3.0] - Unreleased

Gift codes; creator code on checkouts; pack availability.

### Added

- `codes.redeem(player, code, options?)`: redeems a gift code (free coins in the `bonus` bucket, and items). The code is sent as
  typed. Returns a `Redemption` `{ grants, items, skipped, replayed }`; it sends an idempotency key like the other
  state-changing calls. A refused code is `VALIDATION_FAILED` with `details.fieldErrors.code = ["CODE_INVALID"]`, never retried.
  New `codes` resource: nine resources and seventeen calls.
- `checkouts.create` accepts `creatorCode`; it is not sent when absent. A refused code is `VALIDATION_FAILED` with
  `details.fieldErrors.creatorCode = ["CODE_INVALID"]`.
- `Order.creatorCode` (`{ code, creatorName }` or `null`), also on the orders of the `order.*` webhook events (an event that
  has no such field reads as `null`).
- `Pack.availability` (`null` or `{ startsAt, endsAt, remaining, founder }`, dates as `Date` or `null`), `Catalog.prelaunch`
  and `Catalog.launchAt`; the `PackAvailability` and `Redemption` types.
- Error codes `ErrorCode.PACK_NOT_AVAILABLE` (`details.startsAt`, `details.endsAt`: ISO 8601 text or `null`) and
  `ErrorCode.PACK_SOLD_OUT` (`details.packSku`), both HTTP 409.

### Changed

- The response parsers are strict on the new fields: a catalog without `prelaunch` / `launchAt` or a pack without
  `availability` is an `INVALID_RESPONSE`. This version needs the GameCoin API of sprint 3 or later.

## [0.2.0] - Unreleased

`locale` on checkouts; webhook signature verification.

### Added

- `checkouts.create` accepts `locale` (`"fr"`, `"en"` or `"nl"`): the language of the hosted payment page, the receipt and
  the e-mails of the order. It is not sent when absent.
- `webhooks.constructEvent(rawBody, signatureHeader, secret, options?)`: verifies the `GameCoin-Signature` header of a
  webhook call (HMAC-SHA256, every `v1` compared in constant time, timestamp tolerance of 5 minutes by default) and returns
  a typed `WebhookEvent`. A pure function: no client, no network. Options: `toleranceSeconds` (`0` disables the check) and
  `now` (injectable clock).
- `WebhookSignatureError` (not a `GameCoinError`) with a `reason`: `missing_header`, `malformed_header`,
  `no_matching_signature`, `timestamp_out_of_tolerance` or `invalid_payload`.
- Event types as the `WebhookEventType` constants (`order.fulfilled`, `order.refunded`, `order.chargeback`,
  `wallet.credited`, `webhook.test`); an unknown type is passed through with `data` untyped; `isKnownWebhookEvent` narrows.
- `examples/webhook-server.mjs`, an Express receiver.

## [0.1.0] - Unreleased

First release: the server SDK of the GameCoin API v1.

### Added

- Redirects are never followed (`redirect: "manual"`): a `3xx` is raised as `INVALID_RESPONSE` with its status.
- `ErrorCode.READ_ONLY`, for parity with the other GameCoin server SDKs.

- `GameCoin` client with the resources `catalog`, `players`, `wallet`, `ledger`, `inventory`, `purchases`,
  `checkouts` and `orders`, covering the whole server API.
- `ext()` helper for players identified by your own id; references are URL-encoded exactly once.
- `ledger.iterate()`: every ledger entry as an async iterator, one page at a time.
- Idempotency: every state-changing call sends an `Idempotency-Key` (a UUID v4 generated once per call, or your own),
  and its result carries `replayed`.
- Automatic retries (network error, timeout, `5xx`, `429`) with exponential backoff, jitter and `Retry-After`;
  `orders.refund` is retried on `429` only.
- `GameCoinError` with `code`, `status`, `details` and `retryAfter`, and the `ErrorCode` constants.
- Per-call cancellation with an `AbortSignal`; per-attempt timeout; injectable `fetch`.
- The secret key never appears in an error or in a string representation of the client.
- ESM and CommonJS builds with type declarations; no runtime dependency; Node 18 or later.
