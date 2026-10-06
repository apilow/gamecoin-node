import { GameCoin } from "../src/index.js";
import type { FetchFunction, FetchRequestInit, GameCoinOptions } from "../src/index.js";

/** A key shaped like a secret key and obviously fake. */
export const TEST_KEY = `gc_sk_test_${"Tk".repeat(20)}`;
export const LIVE_KEY = `gc_sk_live_${"Lk".repeat(20)}`;

export interface RecordedCall {
  url: string;
  method: string;
  /** Header names are lower-cased. */
  headers: Record<string, string>;
  /** The JSON body, `undefined` when none was sent. */
  body: unknown;
  signal: AbortSignal;
  redirect: string;
}

export interface Reply {
  status?: number;
  /** JSON body. */
  json?: unknown;
  /** Raw text body (wins over `json`). */
  text?: string;
  headers?: Record<string, string>;
}

/** A scripted answer: a reply, an error to throw, or a function that decides from the call. */
export type Script = Reply | Error | ((call: RecordedCall, index: number) => Reply | Error | Promise<Reply | Error>);

export function toResponse(reply: Reply): Response {
  const body = reply.text ?? (reply.json === undefined ? "" : JSON.stringify(reply.json));
  return new Response(body, { status: reply.status ?? 200, headers: { "content-type": "application/json", ...reply.headers } });
}

/** A transport that records every call and answers from the script, one entry per call (the last one repeats). */
export function fakeFetch(script: Script | Script[]): { fetch: FetchFunction; calls: RecordedCall[] } {
  const scripts = Array.isArray(script) ? script : [script];
  const calls: RecordedCall[] = [];
  const fetch: FetchFunction = async (url: string, init: FetchRequestInit) => {
    const headers = Object.fromEntries(Object.entries(init.headers).map(([name, value]) => [name.toLowerCase(), value]));
    const call: RecordedCall = { url, method: init.method, headers, body: init.body === undefined ? undefined : JSON.parse(init.body), signal: init.signal, redirect: init.redirect };
    const index = calls.length;
    calls.push(call);
    const entry = scripts[Math.min(index, scripts.length - 1)];
    if (entry === undefined) throw new Error("fakeFetch: empty script");
    const answer = typeof entry === "function" ? await entry(call, index) : entry;
    if (answer instanceof Error) throw answer;
    return toResponse(answer);
  };
  return { fetch, calls };
}

export interface Harness {
  gamecoin: GameCoin;
  calls: RecordedCall[];
  /** The waits requested between retries, in milliseconds (nothing really waits). */
  waits: number[];
}

/** A client wired to a scripted transport and a sleep that only records. */
export function harness(script: Script | Script[], options: GameCoinOptions = {}, key = TEST_KEY): Harness {
  const { fetch, calls } = fakeFetch(script);
  const waits: number[] = [];
  const gamecoin = new GameCoin(key, {
    baseUrl: "https://gamecoin.test",
    fetch,
    sleep: async (ms) => {
      waits.push(ms);
    },
    ...options,
  });
  return { gamecoin, calls, waits };
}

export function apiError(status: number, code: string, message: string, details?: Record<string, unknown>, headers?: Record<string, string>): Reply {
  return { status, json: { error: { code, message, ...(details ? { details } : {}) } }, ...(headers ? { headers } : {}) };
}

// --- Sample payloads, as the API sends them -----------------------------------------------------------

export const AT = "2026-10-05T12:00:00.000Z";
export const LATER = "2026-10-05T13:00:00.000Z";
export const ID_PLAYER = "665f1c2e8a3b4d5e6f708192";
export const ID_ORDER = "665f1c2e8a3b4d5e6f7081b4";

export const playerJson = { id: ID_PLAYER, externalId: "user-42", kind: "external", displayName: "Alice", country: "BE", blocked: false, createdAt: AT };
export const balanceJson = { currency: "gems", paid: 0, bonus: 100, total: 100 };
export const entryJson = {
  id: "665f1c2e8a3b4d5e6f7081a3",
  type: "grant",
  currency: "gems",
  paidDelta: 0,
  bonusDelta: 100,
  balanceAfter: { paid: 0, bonus: 100, total: 100 },
  reason: "level_up",
  metadata: { level: "5" },
  ref: {},
  createdAt: AT,
};
export const potionJson = { sku: "potion", quantity: 2, updatedAt: AT };
export const orderJson = {
  id: ID_ORDER,
  playerId: ID_PLAYER,
  status: "pending",
  pack: { sku: "gems-500", name: "500 gems" },
  amountCents: 499,
  currency: "EUR",
  country: "BE",
  vatRateBp: 2100,
  vatCents: 87,
  netCents: 412,
  createdAt: AT,
  paidAt: null,
  fulfilledAt: null,
  refundedAt: null,
  creatorCode: null,
};
export const emptyCatalogJson = { currencies: [], items: [], packs: [], prelaunch: false, launchAt: null };
export const movementJson = { entry: entryJson, balance: balanceJson };
export const checkoutJson = { order: orderJson, checkoutUrl: `https://gamecoin.test/pay/${ID_ORDER}?t=signed` };
