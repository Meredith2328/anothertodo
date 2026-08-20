import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { parse } from "../src/core/parse.js";

type ParseCase = {
  input: string;
  now: string;
  levels: string[];
  expected: {
    title: string;
    due: string | null;
    priority: string | null;
    tags: string[];
    project: string | null;
    parent: string | null;
    wait: string | null;
    reminders: Array<{ at: string; hooks: string[]; fired: boolean }>;
  };
};

const cases: ParseCase[] = [
  { input: "后天 下午2点半 复盘 特急 #重要 @14:00:toast,email", now: "2026-08-20T10:00:00", levels: ["低", "中", "高"], expected: { title: "复盘", due: "2026-08-22T14:30:00", priority: "高", tags: ["重要"], project: null, parent: null, wait: null, reminders: [{ at: "2026-08-22T14:00", hooks: ["toast", "email"], fired: false }] } },
  { input: "明天 晚上8点 开会", now: "2026-08-20T10:00:00", levels: ["低", "中", "高"], expected: { title: "开会", due: "2026-08-21T20:00:00", priority: null, tags: [], project: null, parent: null, wait: null, reminders: [] } },
  { input: "修车回复 ~周五 proj:车辆 ^ab12cd34", now: "2026-08-20T10:00:00", levels: ["低", "中", "高"], expected: { title: "修车回复", due: null, priority: null, tags: [], project: "车辆", parent: "ab12cd34", wait: "2026-08-21", reminders: [] } },
  { input: "交笔记 @30m", now: "2026-08-20T10:00:00", levels: ["低", "中", "高"], expected: { title: "交笔记", due: null, priority: null, tags: [], project: null, parent: null, wait: null, reminders: [{ at: "2026-08-20T10:30", hooks: ["toast"], fired: false }] } },
  { input: "买牛奶 Sol", now: "2026-08-20T10:00:00", levels: ["Terra", "Sol"], expected: { title: "买牛奶", due: null, priority: "Sol", tags: [], project: null, parent: null, wait: null, reminders: [] } },
];

describe("stage 3 parser golden behavior", () => {
  it.each(cases)("matches Python behavior for $input", ({ input, now, levels, expected }) => {
    const actual = parse(input, now, levels);
    expect({
      title: actual.title,
      due: actual.due ?? null,
      priority: actual.priority ?? null,
      tags: actual.tags,
      project: actual.project ?? null,
      parent: actual.parent ?? null,
      wait: actual.wait ?? null,
      reminders: actual.reminders.map(({ at, hooks, fired }) => ({ at, hooks, fired })),
    }).toEqual(expected);
    if (input.includes("@30m")) expect(actual.reminders[0]?.relative).toBe(true);
  });

  it("matches every frozen parse fixture", () => {
    const frozen = JSON.parse(readFileSync(resolve(process.cwd(), "fixtures", "parse-cases.json"), "utf8")) as ParseCase[];
    expect(frozen.length).toBeGreaterThanOrEqual(10);
    for (const { input, now, levels, expected } of frozen) {
      const actual = parse(input, now, levels);
      expect({
        title: actual.title,
        due: actual.due ?? null,
        priority: actual.priority ?? null,
        tags: actual.tags,
        project: actual.project ?? null,
        parent: actual.parent ?? null,
        wait: actual.wait ?? null,
        reminders: actual.reminders.map(({ at, hooks, fired }) => ({ at, hooks, fired })),
      }).toEqual(expected);
    }
  });
});
