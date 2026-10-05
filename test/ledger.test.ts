import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ErrorCode, GameCoinError, ext, type LedgerEntry } from "../src/index.js";
import { AT, apiError, entryJson, harness, type RecordedCall } from "./helpers.js";

const P = ext("user-42");
const entry = (n: number) => ({ ...entryJson, id: `entry-${n}`, bonusDelta: n });
const URL_BASE = "https://gamecoin.test/api/v1/players/ext%3Auser-42/ledger";

/** Three pages of two, one and two entries. */
const pages = [
  { json: { entries: [entry(1), entry(2)], nextCursor: "c1" } },
  { json: { entries: [entry(3)], nextCursor: "c2" } },
  { json: { entries: [entry(4), entry(5)], nextCursor: null } },
];

async function collect(iterable: AsyncIterable<LedgerEntry>): Promise<LedgerEntry[]> {
  const all: LedgerEntry[] = [];
  for await (const item of iterable) all.push(item);
  return all;
}

describe("ledger.iterate", () => {
  it("walks every page, in order, following nextCursor until it is null", async () => {
    const { gamecoin, calls } = harness(pages);
    const entries = await collect(gamecoin.ledger.iterate(P, { limit: 2 }));
    assert.deepEqual(
      entries.map((e) => e.id),
      ["entry-1", "entry-2", "entry-3", "entry-4", "entry-5"],
    );
    assert.deepEqual(
      calls.map((c) => c.url),
      [`${URL_BASE}?limit=2`, `${URL_BASE}?limit=2&cursor=c1`, `${URL_BASE}?limit=2&cursor=c2`],
    );
    assert.ok(entries[0]?.createdAt instanceof Date);
    assert.equal(entries[0]?.createdAt.toISOString(), AT);
  });

  it("passes currency and limit on every page, and sends nothing when none is given", async () => {
    const withParams = harness(pages);
    await collect(withParams.gamecoin.ledger.iterate(P, { currency: "gems", limit: 2 }));
    assert.deepEqual(
      withParams.calls.map((c) => c.url),
      [`${URL_BASE}?currency=gems&limit=2`, `${URL_BASE}?currency=gems&limit=2&cursor=c1`, `${URL_BASE}?currency=gems&limit=2&cursor=c2`],
    );
    const bare = harness({ json: { entries: [], nextCursor: null } });
    assert.deepEqual(await collect(bare.gamecoin.ledger.iterate(P)), []);
    assert.deepEqual(
      bare.calls.map((c) => c.url),
      [URL_BASE],
    );
  });

  it("is lazy: no request before the iteration starts, and the next page only when the first one is used up", async () => {
    const { gamecoin, calls } = harness(pages);
    const iterator = gamecoin.ledger.iterate(P, { limit: 2 });
    assert.equal(calls.length, 0);
    assert.equal((await iterator.next()).value?.id, "entry-1");
    assert.equal(calls.length, 1);
    assert.equal((await iterator.next()).value?.id, "entry-2");
    assert.equal(calls.length, 1, "still on the first page");
    assert.equal((await iterator.next()).value?.id, "entry-3");
    assert.equal(calls.length, 2);
  });

  it("stops early: breaking out of the loop fetches nothing more", async () => {
    const { gamecoin, calls } = harness(pages);
    for await (const item of gamecoin.ledger.iterate(P, { limit: 2 })) {
      if (item.id === "entry-1") break;
    }
    assert.equal(calls.length, 1);
  });

  it("an empty first page ends the iteration", async () => {
    const { gamecoin } = harness({ json: { entries: [], nextCursor: null } });
    assert.deepEqual(await collect(gamecoin.ledger.iterate(P)), []);
  });

  it("a failing page raises GameCoinError from the loop (retried like any other call)", async () => {
    const { gamecoin, calls } = harness([pages[0] as never, apiError(503, "INTERNAL", "Internal error"), pages[1] as never, apiError(404, "NOT_FOUND", "Player not found")]);
    const seen: string[] = [];
    await assert.rejects(
      async () => {
        for await (const item of gamecoin.ledger.iterate(P, { limit: 2 })) seen.push(item.id);
      },
      (error: unknown) => error instanceof GameCoinError && error.code === ErrorCode.NOT_FOUND,
    );
    assert.deepEqual(seen, ["entry-1", "entry-2", "entry-3"]);
    assert.equal(calls.length, 4, "the 503 was retried, the 404 was not");
  });

  it("each page uses its own idempotent-free GET with the secret key", async () => {
    const { gamecoin, calls } = harness(pages);
    await collect(gamecoin.ledger.iterate(P, { limit: 2 }));
    for (const call of calls as RecordedCall[]) {
      assert.equal(call.method, "GET");
      assert.equal(call.headers["idempotency-key"], undefined);
      assert.match(call.headers.authorization ?? "", /^Bearer gc_sk_test_/);
    }
  });

  it("ledger.list returns one page with its cursor", async () => {
    const { gamecoin } = harness(pages[0] as never);
    const page = await gamecoin.ledger.list(P, { limit: 2 });
    assert.equal(page.entries.length, 2);
    assert.equal(page.nextCursor, "c1");
  });
});
