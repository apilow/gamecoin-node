# Changelog

All notable changes to this package are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the package follows
[Semantic Versioning](https://semver.org/) (while the version is 0.x, a minor release may change the API).

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
