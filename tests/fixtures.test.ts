import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { ConfigSchema, TaskSchema, TombstoneSchema } from "../src/contracts.js";

const fixture = async <T>(name: string): Promise<T> =>
  JSON.parse(await readFile(resolve(process.cwd(), "fixtures", name), "utf8")) as T;

describe("stage 0 frozen fixtures", () => {
  it("contains parser coverage for dates, priorities, metadata, reminders, and empty input", async () => {
    const cases = await fixture<Array<{ name: string; expected: { title: string; due: string | null } }>>("parse-cases.json");
    expect(cases.length).toBeGreaterThanOrEqual(10);
    expect(cases.map((item) => item.name)).toEqual(
      expect.arrayContaining(["relative date, time, priority, tags, and hooks", "waiting, parent, and project", "empty input"]),
    );
    expect(cases.find((item) => item.name === "empty input")?.expected).toEqual(
      expect.objectContaining({ title: "", due: null }),
    );
  });

  it("uses valid task contracts in query, priority, and agenda fixtures", async () => {
    const query = await fixture<{ tasks: unknown[] }>("query-cases.json");
    const priority = await fixture<{ tasks: unknown[]; config: unknown }>("priority-cases.json");
    const agenda = await fixture<{ tasks: unknown[] }>("agenda-cases.json");

    for (const raw of [...query.tasks, ...priority.tasks, ...agenda.tasks]) {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("fixture task must be an object");
      TaskSchema.parse({
        entry: "2026-08-18T10:00:00Z",
        modified: "2026-08-18T10:00:00Z",
        ...(raw as Record<string, unknown>),
      });
    }
    ConfigSchema.parse(priority.config);
  });

  it("represents storage and sync invariants as data, not implementation guesses", async () => {
    const storage = await fixture<{ tombstone: { line: string }; legacyRecord: unknown }>("storage-cases.json");
    const sync = await fixture<Array<{ ours: unknown[]; theirs: unknown[] }>>("sync-cases.json");
    TombstoneSchema.parse(JSON.parse(storage.tombstone.line));
    TaskSchema.parse(storage.legacyRecord);
    expect(sync).toHaveLength(2);
    expect(sync[0]?.ours).toHaveLength(2);
    expect(sync[1]?.theirs).toHaveLength(1);
  });
});
