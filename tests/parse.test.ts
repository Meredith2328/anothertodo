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
  { input: "明天 晚上8点 开会", now: "2026-08-20T10:00:00", levels: ["低", "中", "高"], expected: { title: "开会", due: "2026-08-21T20:00:00", priority: null, tags: [], project: null, parent: null, wait: null, reminders: [{ at: "2026-08-20T20:00", hooks: ["toast"], fired: false }] } },
  { input: "修车回复 ~周五 proj:车辆 ^ab12cd34", now: "2026-08-20T10:00:00", levels: ["低", "中", "高"], expected: { title: "修车回复", due: null, priority: null, tags: [], project: "车辆", parent: "ab12cd34", wait: "2026-08-21", reminders: [] } },
  { input: "交笔记 @30m", now: "2026-08-20T10:00:00", levels: ["低", "中", "高"], expected: { title: "交笔记", due: null, priority: null, tags: [], project: null, parent: null, wait: null, reminders: [{ at: "2026-08-20T10:30", hooks: ["toast"], fired: false }] } },
  { input: "买牛奶 Sol", now: "2026-08-20T10:00:00", levels: ["Terra", "Sol"], expected: { title: "买牛奶", due: null, priority: "Sol", tags: [], project: null, parent: null, wait: null, reminders: [] } },
];

describe("stage 3 parser golden behavior", () => {
  // 默认提醒是自 rust-rewrite 同步的行为，Python 版没有——除此之外与 Python 对齐
  it.each(cases)("matches Python behavior (plus synced default reminders) for $input", ({ input, now, levels, expected }) => {
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

// 以下自 rust-rewrite 分支同步：英文相对日期、tomorrow 默认 10 点、默认提醒。
// now 固定在 2026-08-20（周四）。
describe("parser features synced from rust-rewrite", () => {
  const NOW = "2026-08-20T10:00:00";
  const LEVELS = ["低", "中", "高"];

  it("parses English relative dates and removes them from the title", () => {
    expect(parse("meet the monitor seller tomorrow", NOW, LEVELS)).toMatchObject({ title: "meet the monitor seller", due: "2026-08-21T10:00:00" });
    expect(parse("submit the report tonight", NOW, LEVELS)).toMatchObject({ title: "submit the report", due: "2026-08-20T20:00:00" });
    expect(parse("water the plants today", NOW, LEVELS)).toMatchObject({ title: "water the plants", due: "2026-08-20T00:00:00" });
    expect(parse("go fishing day after tomorrow", NOW, LEVELS)).toMatchObject({ title: "go fishing", due: "2026-08-22T00:00:00" });
    expect(parse("camp this weekend", NOW, LEVELS)).toMatchObject({ title: "camp", due: "2026-08-22T00:00:00" }); // 周四 → 本周六
  });

  it("parses next + English weekday (abbreviations, any case) into the following week", () => {
    expect(parse("plan next fri", NOW, LEVELS).due).toBe("2026-08-28T00:00:00");
    expect(parse("plan NEXT MONDAY", NOW, LEVELS).due).toBe("2026-08-31T00:00:00");
    expect(parse("plan next tue", NOW, LEVELS).due).toBe("2026-09-01T00:00:00");
  });

  it("defaults tomorrow to 10am but lets an explicit time win; Chinese 明天 stays midnight", () => {
    expect(parse("meet the seller tomorrow 15:30", NOW, LEVELS).due).toBe("2026-08-21T15:30:00");
    expect(parse("明天 交房租", NOW, LEVELS)).toMatchObject({ due: "2026-08-21T00:00:00", dueHasTime: false });
  });

  it("creates default reminders based on time until due", () => {
    // 距截止超过 24 小时：提前 1 天
    const far = parse("复盘 后天 下午2点半", NOW, LEVELS);
    expect(far.reminders).toMatchObject([{ at: "2026-08-21T14:30", hooks: ["toast"], fired: false, relative: false }]);
    // 距截止不足 24 小时：提前 15 分钟
    const near = parse("meet the seller today 12:00", NOW, LEVELS);
    expect(near.reminders).toMatchObject([{ at: "2026-08-20T11:45", hooks: ["toast"], fired: false, relative: false }]);
  });

  it("keeps explicit reminders and honors opt-outs instead of defaults", () => {
    const explicit = parse("meet the seller tomorrow @30m", NOW, LEVELS);
    expect(explicit.reminders).toMatchObject([{ at: "2026-08-20T10:30", hooks: ["toast"], fired: false, relative: true }]);
    for (const text of ["meeting tomorrow @none", "meeting tomorrow @off", "meeting tomorrow no reminders"]) {
      const parsed = parse(text, NOW, LEVELS);
      expect(parsed.title).toBe("meeting");
      expect(parsed.due).toBe("2026-08-21T10:00:00");
      expect(parsed.reminders).toEqual([]);
    }
  });

  it("adds no default reminder for past dues and accepts English dates in @ tokens", () => {
    expect(parse("今天 早上9点 晨会", NOW, LEVELS).reminders).toEqual([]);
    expect(parse("call mom @tomorrow", NOW, LEVELS).reminders).toMatchObject([{ at: "2026-08-21T10:00", hooks: ["toast"], fired: false, relative: false }]);
    expect(parse("修车回复 ~tomorrow", NOW, LEVELS).wait).toBe("2026-08-21");
  });
});
