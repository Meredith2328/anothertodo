import { describe, expect, it } from "vitest";
import { mergeConflictText, mergeUnion, type SyncRecord } from "../src/sync/merge.js";

const byIdMap = (records: readonly SyncRecord[]): Record<string, SyncRecord> => {
  const entries = [...records]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((r) => [r.id, r] as const);
  return Object.fromEntries(entries);
};

// Deterministic PRNG (Mulberry32) so fuzz tests are 100% reproducible in CI
const mulberry32 = (seed: number) => {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const randomReplica = (rand: () => number): SyncRecord[] => {
  const ids = ["t1", "t2", "t3", "t4"];
  const timestamps = [
    undefined,
    "not-a-valid-date",
    "2026-01-01T00:00:00.000Z",
    "2026-01-01T00:00:01.000Z",
    "2026-01-02T12:00:00.000Z",
  ];
  const titles = ["alpha", "beta", "gamma", "delta"];
  const out: SyncRecord[] = [];
  for (const id of ids) {
    if (rand() < 0.25) continue;
    const deleted = rand() < 0.25;
    const modified = timestamps[Math.floor(rand() * timestamps.length)];
    const title = titles[Math.floor(rand() * titles.length)];
    const rec: SyncRecord = deleted
      ? { id, deleted: true, ...(modified !== undefined ? { modified } : {}) }
      : { id, title, ...(modified !== undefined ? { modified } : {}) };
    out.push(rec);
  }
  return out;
};

describe("sync merge CRDT properties (formally verified in Lean 4)", () => {
  it("is commutative even on identical timestamps (Lean counterexample regression)", () => {
    const a: SyncRecord = { id: "t1", title: "A", modified: "2026-01-01T00:00:00.000Z" };
    const b: SyncRecord = { id: "t1", title: "B", modified: "2026-01-01T00:00:00.000Z" };
    expect(byIdMap(mergeUnion([a], [b]))).toEqual(byIdMap(mergeUnion([b], [a])));
  });

  it("valid timestamp always beats corrupt (NaN) timestamp regardless of merge direction", () => {
    const corrupt: SyncRecord = { id: "t1", title: "corrupt", modified: "invalid-date" };
    const valid: SyncRecord = { id: "t1", title: "valid", modified: "2026-01-01T00:00:00.000Z" };
    expect(byIdMap(mergeUnion([corrupt], [valid]))).toEqual(byIdMap([valid]));
    expect(byIdMap(mergeUnion([valid], [corrupt]))).toEqual(byIdMap([valid]));
  });

  it("handles git diff3/zdiff3 conflict markers without resurrecting base lines", () => {
    const conflict = [
      "<<<<<<< HEAD",
      '{"id":"t1","deleted":true,"modified":"2026-01-02T00:00:00.000Z"}',
      "||||||| merged common ancestors",
      '{"id":"t1","title":"old-base","modified":"2026-01-01T00:00:00.000Z"}',
      '{"id":"t2","title":"deleted-on-both-sides","modified":"2026-01-01T00:00:00.000Z"}',
      "=======",
      '{"id":"t1","title":"remote-edit","modified":"2026-01-03T00:00:00.000Z"}',
      ">>>>>>> origin/main",
    ].join("\n");
    const merged = mergeConflictText(conflict)
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as SyncRecord);
    expect(merged).toEqual([{ id: "t1", deleted: true, modified: "2026-01-02T00:00:00.000Z" }]);
  });

  it("satisfies CRDT semilattice laws (Idempotence, Commutativity, Associativity, Tombstone Dominance) across 500 random 3-replica scenarios", () => {
    const rand = mulberry32(20261122);
    for (let trial = 0; trial < 500; trial++) {
      const a = randomReplica(rand);
      const b = randomReplica(rand);
      const c = randomReplica(rand);

      // 1. Idempotence: merge(A, A) == A
      expect(byIdMap(mergeUnion(a, a))).toEqual(byIdMap(a));

      // 2. Commutativity: merge(A, B) == merge(B, A)
      const ab = mergeUnion(a, b);
      const ba = mergeUnion(b, a);
      expect(byIdMap(ab)).toEqual(byIdMap(ba));

      // 3. Associativity: merge(merge(A, B), C) == merge(A, merge(B, C))
      const ab_c = mergeUnion(ab, c);
      const a_bc = mergeUnion(a, mergeUnion(b, c));
      expect(byIdMap(ab_c)).toEqual(byIdMap(a_bc));

      // 4. Tombstone Dominance: any deleted id in A, B, or C stays deleted
      const mergedMap = byIdMap(ab_c);
      for (const replica of [a, b, c]) {
        for (const rec of replica) {
          if (rec.deleted === true) {
            expect(mergedMap[rec.id]?.deleted).toBe(true);
          }
        }
      }
    }
  });
});
