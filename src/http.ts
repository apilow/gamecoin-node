import { randomUUID } from "node:crypto";
import { ErrorCode, GameCoinError } from "./errors.js";
import { ShapeError } from "./parse.js";
import type { FetchFunction, FetchResponseLike, SleepFunction } from "./types.js";

/** Longest `Retry-After` the SDK honours; beyond it the error is raised with `retryAfter` instead of waiting. */
export const MAX_RETRY_AFTER_SECONDS = 30;
/** First backoff delay, doubled at every attempt. */
const BACKOFF_BASE_MS = 500;

export interface HttpConfig {
  apiKey: string;
  /** Base URL of the API with `/api/v1`, without a trailing slash. */
  apiRoot: string;
  userAgent: string;
  timeout: number;
  maxRetries: number;
  fetch: FetchFunction;
  sleep: SleepFunction;
}

export interface RequestSpec {
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Path under `/api/v1`, already URL-encoded. */
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  /** Send an `Idempotency-Key` (generated unless `idempotencyKey` is given). */
  idempotent?: boolean;
  idempotencyKey?: string | undefined;
  /**
   * `all` (default): retry on network error, timeout, `5xx` and `429`.
   * `rate-limit`: retry on `429` only (calls that cannot be replayed safely).
   */
  retry?: "all" | "rate-limit";
  signal?: AbortSignal | undefined;
}

export interface CallResult<T> {
  value: T;
  /** The `Idempotent-Replayed: true` header was present. */
  replayed: boolean;
}

type Outcome = { type: "response"; status: number; headers: FetchResponseLike["headers"]; text: string } | { type: "failure"; error: GameCoinError };

/** Default wait: a timer that a signal can cut short. */
export const defaultSleep: SleepFunction = (ms, signal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortReason(signal));
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortReason(signal as AbortSignal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

function abortReason(signal: AbortSignal): unknown {
  const reason = (signal as { reason?: unknown }).reason;
  if (reason !== undefined) return reason;
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

/** `Retry-After` as seconds: a number of seconds or an HTTP date. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (value === null) return undefined;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  const at = Date.parse(trimmed);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - now) / 1000));
}

/** `0.5 s × 2^attempt`, with ±25 % jitter. */
export function backoffMs(attempt: number, random: () => number = Math.random): number {
  return BACKOFF_BASE_MS * 2 ** attempt * (0.75 + random() * 0.5);
}

function errorFromResponse(status: number, text: string, retryAfter: number | undefined): GameCoinError {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = undefined;
  }
  const error = typeof parsed === "object" && parsed !== null ? (parsed as { error?: unknown }).error : undefined;
  if (typeof error === "object" && error !== null) {
    const { code, message, details } = error as { code?: unknown; message?: unknown; details?: unknown };
    if (typeof code === "string" && typeof message === "string") {
      return new GameCoinError({
        code,
        status,
        message,
        details: typeof details === "object" && details !== null && !Array.isArray(details) ? (details as Record<string, unknown>) : {},
        retryAfter,
      });
    }
  }
  return new GameCoinError({ code: ErrorCode.INVALID_RESPONSE, status, message: `Unexpected response: HTTP ${status} without a GameCoin error body`, retryAfter });
}

export class HttpClient {
  readonly #config: HttpConfig;

  constructor(config: HttpConfig) {
    this.#config = config;
  }

  /** Sends the request (with its retries) and parses the JSON answer with `parse`. */
  async call<T>(spec: RequestSpec, parse: (body: unknown) => T): Promise<CallResult<T>> {
    const { status, headers, text } = await this.#send(spec);
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new GameCoinError({ code: ErrorCode.INVALID_RESPONSE, status, message: `Unexpected response: HTTP ${status} body is not JSON` });
    }
    try {
      return { value: parse(json), replayed: headers.get("idempotent-replayed") === "true" };
    } catch (error) {
      if (error instanceof ShapeError) {
        throw new GameCoinError({ code: ErrorCode.INVALID_RESPONSE, status, message: `Unexpected response: ${error.message}` });
      }
      throw error;
    }
  }

  async #send(spec: RequestSpec): Promise<{ status: number; headers: FetchResponseLike["headers"]; text: string }> {
    const config = this.#config;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${config.apiKey}`,
      Accept: "application/json",
      "User-Agent": config.userAgent,
    };
    let body: string | undefined;
    if (spec.body !== undefined) {
      body = JSON.stringify(spec.body);
      headers["Content-Type"] = "application/json";
    }
    // One key per call, reused by every retry of that call.
    if (spec.idempotent) headers["Idempotency-Key"] = spec.idempotencyKey ?? randomUUID();
    const url = `${config.apiRoot}${spec.path}${queryString(spec.query)}`;
    const policy = spec.retry ?? "all";

    for (let attempt = 0; ; attempt += 1) {
      const outcome = await this.#attempt(url, spec.method, headers, body, spec.signal);
      let error: GameCoinError;
      if (outcome.type === "response") {
        if (outcome.status >= 200 && outcome.status < 300) return outcome;
        error = errorFromResponse(outcome.status, outcome.text, parseRetryAfter(outcome.headers.get("retry-after")));
      } else {
        error = outcome.error;
      }
      if (!isRetryable(error, policy) || attempt >= config.maxRetries) throw error;
      await config.sleep(error.retryAfter !== undefined ? error.retryAfter * 1000 : backoffMs(attempt), spec.signal);
    }
  }

  /** One HTTP attempt, bounded by the timeout; a caller abort rethrows the signal's reason and is never retried. */
  async #attempt(url: string, method: string, headers: Record<string, string>, body: string | undefined, signal: AbortSignal | undefined): Promise<Outcome> {
    const config = this.#config;
    if (signal?.aborted) throw abortReason(signal);
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, config.timeout);
    const onCallerAbort = () => controller.abort();
    signal?.addEventListener("abort", onCallerAbort, { once: true });
    // Rejects when the attempt is aborted, so that a transport that ignores the signal cannot hang the call.
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
    });
    try {
      const exchange = async () => {
        const response = await config.fetch(url, { method, headers, ...(body !== undefined ? { body } : {}), signal: controller.signal, redirect: "manual" });
        return { type: "response" as const, status: response.status, headers: response.headers, text: await response.text() };
      };
      return await Promise.race([exchange(), aborted]);
    } catch (error) {
      if (signal?.aborted) throw abortReason(signal);
      if (timedOut) {
        return { type: "failure", error: new GameCoinError({ code: ErrorCode.TIMEOUT, status: 0, message: `No response within ${config.timeout} ms` }) };
      }
      return { type: "failure", error: this.#networkError(error) };
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onCallerAbort);
    }
  }

  /** `NETWORK_ERROR`, without the key even if a custom transport put it in its own message. */
  #networkError(cause: unknown): GameCoinError {
    const key = this.#config.apiKey;
    const detail = cause instanceof Error ? cause.message : String(cause);
    const leaks = detail.includes(key) || (cause instanceof Error && cause.cause instanceof Error && cause.cause.message.includes(key));
    const inner = cause instanceof Error && cause.cause instanceof Error ? ` (${cause.cause.message})` : "";
    const message = `Network error: ${detail}${inner}`.split(key).join("[redacted]");
    return new GameCoinError({ code: ErrorCode.NETWORK_ERROR, status: 0, message, ...(leaks ? {} : { cause }) });
  }
}

function isRetryable(error: GameCoinError, policy: "all" | "rate-limit"): boolean {
  if (error.retryAfter !== undefined && error.retryAfter > MAX_RETRY_AFTER_SECONDS) return false;
  if (error.status === 429) return true;
  if (policy === "rate-limit") return false;
  return error.status === 0 || (error.status >= 500 && error.status <= 599);
}

function queryString(query: RequestSpec["query"]): string {
  if (!query) return "";
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(query)) if (value !== undefined) params.set(name, String(value));
  const text = params.toString();
  return text === "" ? "" : `?${text}`;
}
