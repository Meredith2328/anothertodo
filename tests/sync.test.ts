import { describe, expect, it } from "vitest";

import { mergeConflictText, mergeUnion } from "../src/sync/merge.js";

describe("stage 5 sync merge", () => {
  it("unions ids and chooses newer modified records", () => {
    const merged = mergeUnion(
      [{ id: "00000071", title: "A-v2", modified: "2026-08-18T10:00:00Z" }, { id: "00000072", title: "B", modified: "2026-08-18T09:00:00Z" }],
      [{ id: "00000071", title: "A-v1", modified: "2026-08-18T08:00:00Z" }, { id: "00000073", title: "C", modified: "2026-08-18T09:30:00Z" }],
    );
    expect(Object.fromEntries(merged.map((item) => [item.id, item.title]))).toEqual({ "00000071": "A-v2", "00000072": "B", "00000073": "C" });
  });

  it("lets tombstones beat edits even when the edit is newer", () => {
    const merged = mergeUnion([{ id: "00000074", deleted: true, modified: "2026-08-18T10:00:00Z" }], [{ id: "00000074", title: "旧编辑", modified: "2026-08-18T11:00:00Z" }]);
    expect(merged[0]?.deleted).toBe(true);
  });

  it("resolves a tasks.jsonl conflict into clean JSONL", () => {
    const conflict = `<<<<<<< HEAD\n{"id":"00000075","title":"本地","modified":"2026-08-18T10:00:00Z"}\n=======\n{"id":"00000076","title":"远程","modified":"2026-08-18T11:00:00Z"}\n>>>>>>> remote\n`;
    const output = mergeConflictText(conflict);
    expect(output).not.toContain("<<<<<<<");
    expect(output).toContain("00000075");
    expect(output).toContain("00000076");
  });
});
