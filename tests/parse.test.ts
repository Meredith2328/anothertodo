import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { nextOccurrence, parse, preview } from "../src/core/parse.js";

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

// 以下自 docs/input-enhancements.md：英文紧急度短语、12 小时制、~wait 多词日期。
// now 固定在 2026-08-20（周四）。
describe("input enhancements from docs/input-enhancements.md", () => {
  const NOW = "2026-08-20T10:00:00";
  const LEVELS = ["低", "中", "高"];

  it("recognizes English urgency phrases and removes them from the title", () => {
    expect(parse("tomorrow buy milk urgent", NOW, LEVELS)).toMatchObject({ title: "buy milk", priority: "高" });
    expect(parse("next friday report very urgent", NOW, LEVELS)).toMatchObject({ title: "report", priority: "高" });
    expect(parse("clean desk no rush", NOW, LEVELS)).toMatchObject({ title: "clean desk", priority: "低" });
    expect(parse("clean desk not urgent", NOW, LEVELS)).toMatchObject({ title: "clean desk", priority: "低" });
    expect(parse("review high priority", NOW, LEVELS)).toMatchObject({ title: "review", priority: "高" });
    expect(parse("polish docs asap", NOW, LEVELS)).toMatchObject({ title: "polish docs", priority: "高" });
  });

  it("does not let English urgency phrases match inside other words", () => {
    // urgent 不能误匹配 urgently / urgency；not urgent 是整体，不能只匹配其中的 urgent
    for (const [text, title] of [["reply urgently", "reply urgently"], ["measure urgency", "measure urgency"], ["regularly water the garden", "regularly water the garden"]] as const) {
      const parsed = parse(text, NOW, LEVELS);
      expect(parsed.title).toBe(title);
      expect(parsed.priority).toBeUndefined();
    }
  });

  it("parses 12-hour times with am/pm and removes them from the title", () => {
    expect(parse("tomorrow 2:30pm meeting", NOW, LEVELS)).toMatchObject({ title: "meeting", due: "2026-08-21T14:30:00", dueHasTime: true });
    expect(parse("tonight 9am gym", NOW, LEVELS)).toMatchObject({ title: "gym", due: "2026-08-20T09:00:00" });
    expect(parse("next friday 12pm lunch", NOW, LEVELS)).toMatchObject({ title: "lunch", due: "2026-08-28T12:00:00" });
    expect(parse("8.20 12am report", NOW, LEVELS)).toMatchObject({ title: "report", due: "2026-08-20T00:00:00" });
    expect(parse("day after tomorrow 2:30pm review", NOW, LEVELS)).toMatchObject({ title: "review", due: "2026-08-22T14:30:00" });
  });

  it("leaves 24-hour times and Chinese time forms unchanged", () => {
    expect(parse("meet 14:30", NOW, LEVELS)).toMatchObject({ title: "meet", due: "2026-08-20T14:30:00" });
    expect(parse("call at 12:00", NOW, LEVELS)).toMatchObject({ title: "call at", due: "2026-08-20T12:00:00" });
    expect(parse("后天 下午2点半 复盘", NOW, LEVELS)).toMatchObject({ title: "复盘", due: "2026-08-22T14:30:00" });
  });

  it("parses multi-word English dates after ~wait and removes the whole date", () => {
    expect(parse("await reply ~next monday", NOW, LEVELS)).toMatchObject({ title: "await reply", wait: "2026-08-31" });
    expect(parse("await reply ~this weekend", NOW, LEVELS)).toMatchObject({ title: "await reply", wait: "2026-08-22" });
    expect(parse("await reply ~day after tomorrow", NOW, LEVELS)).toMatchObject({ title: "await reply", wait: "2026-08-22" });
    expect(parse("await reply ~tomorrow", NOW, LEVELS)).toMatchObject({ title: "await reply", wait: "2026-08-21" });
    expect(parse("修车回复 ~周五 proj:车辆 ^ab12cd34", NOW, LEVELS)).toMatchObject({ title: "修车回复", wait: "2026-08-21", project: "车辆", parent: "ab12cd34" });
  });

  it("keeps trailing text after a multi-word wait date in the title", () => {
    expect(parse("await reply ~next monday then call", NOW, LEVELS)).toMatchObject({ title: "await reply then call", wait: "2026-08-31" });
  });
});

// 备注、重复、清空字段：stage 3 之后补的输入语法。now 固定在 2026-08-20（周四）。
describe("notes, recurrence, and field clearing", () => {
  const NOW = "2026-08-20T10:00:00";
  const LEVELS = ["低", "中", "高"];

  it("takes everything after >> as notes without parsing fields inside it", () => {
    const parsed = parse("买礼物 明天 >>她说想要 #手账 本，proj:别乱认 @9:00", NOW, LEVELS);
    expect(parsed.title).toBe("买礼物");
    expect(parsed.due).toBe("2026-08-21T00:00:00");
    expect(parsed.notes).toBe("她说想要 #手账 本，proj:别乱认 @9:00");
    expect(parsed.tags).toEqual([]);
    expect(parsed.project).toBeUndefined();
  });

  it("treats a bare >> as clearing the notes", () => {
    const parsed = parse("买礼物 >>", NOW, LEVELS);
    expect(parsed.notes).toBeUndefined();
    expect([...parsed.clears]).toEqual(["notes"]);
  });

  it("parses Chinese and English recurrence forms", () => {
    expect(parse("倒垃圾 *每天", NOW, LEVELS)).toMatchObject({ title: "倒垃圾", recur: { kind: "daily", interval: 1 } });
    expect(parse("交房租 *每月", NOW, LEVELS)).toMatchObject({ title: "交房租", recur: { kind: "monthly", interval: 1 } });
    expect(parse("体检 *每年", NOW, LEVELS)).toMatchObject({ title: "体检", recur: { kind: "yearly", interval: 1 } });
    expect(parse("大扫除 *每2周", NOW, LEVELS)).toMatchObject({ title: "大扫除", recur: { kind: "weekly", interval: 2 } });
    expect(parse("周会 *每周三", NOW, LEVELS)).toMatchObject({ title: "周会", recur: { kind: "weekly", interval: 1, weekday: 2 } });
    expect(parse("打卡 *工作日", NOW, LEVELS)).toMatchObject({ title: "打卡", recur: { kind: "weekdays" } });
    expect(parse("standup *weekly:mon", NOW, LEVELS)).toMatchObject({ title: "standup", recur: { kind: "weekly", weekday: 0 } });
    expect(parse("water plants *3d", NOW, LEVELS)).toMatchObject({ title: "water plants", recur: { kind: "daily", interval: 3 } });
  });

  it("leaves an unrecognized * token in the title instead of swallowing it", () => {
    const parsed = parse("买 *特价 木板", NOW, LEVELS);
    expect(parsed.recur).toBeUndefined();
    expect(parsed.title).toBe("买 *特价 木板");
  });

  it("collects explicit clear instructions", () => {
    const parsed = parse("改标题 -due -proj -标签 -重复", NOW, LEVELS);
    expect(parsed.title).toBe("改标题");
    expect([...parsed.clears].sort()).toEqual(["due", "project", "recur", "tags"]);
  });

  it("removes one tag with -#tag and keeps level negation out of it", () => {
    const parsed = parse("改标题 -#临时 #正式", NOW, LEVELS);
    expect(parsed.removeTags).toEqual(["临时"]);
    expect(parsed.tags).toEqual(["正式"]);
    // 档位名不是清空指令，原样留着当档位用
    expect(parse("改标题 低", NOW, LEVELS).priority).toBe("低");
  });

  it("treats @none on an edit as clearing existing reminders", () => {
    expect([...parse("改标题 @none", NOW, LEVELS).clears]).toEqual(["reminders"]);
  });

  it("distinguishes opting out of reminders from clearing them", () => {
    // 两种写法对 store 的作用一样，但语义不同，preview 的措辞不能混
    for (const text of ["下周五 交报告 @none", "会议 @off", "submit report no reminders"]) {
      const parsed = parse(text, NOW, LEVELS);
      expect(parsed.clears.has("reminders")).toBe(true);
      expect(parsed.remindersOptedOut).toBe(true);
    }
    for (const text of ["改标题 -提醒", "改标题 -reminders"]) {
      const parsed = parse(text, NOW, LEVELS);
      expect(parsed.clears.has("reminders")).toBe(true);
      expect(parsed.remindersOptedOut).toBe(false);
    }
    // 「不加提醒」是给新任务看的，「清空提醒」是给已有任务看的
    expect(preview("下周五 交报告 @none", NOW, LEVELS)).toContain("不加提醒");
    expect(preview("改标题 -提醒", NOW, LEVELS)).toContain("清空提醒");
    expect(preview("下周五 交报告 @none", NOW, LEVELS)).not.toContain("清空提醒");
  });
});

describe("recurrence date math", () => {
  it("advances by kind and interval", () => {
    expect(nextOccurrence("2026-08-20", { kind: "daily", interval: 1 })).toBe("2026-08-21");
    expect(nextOccurrence("2026-08-20", { kind: "daily", interval: 3 })).toBe("2026-08-23");
    expect(nextOccurrence("2026-08-20", { kind: "weekly", interval: 1 })).toBe("2026-08-27");
    expect(nextOccurrence("2026-08-20", { kind: "weekly", interval: 2 })).toBe("2026-09-03");
    // 周四推一周到下周四，再对齐到周一
    expect(nextOccurrence("2026-08-20", { kind: "weekly", interval: 1, weekday: 0 })).toBe("2026-08-31");
    expect(nextOccurrence("2026-08-20", { kind: "monthly", interval: 1 })).toBe("2026-09-20");
    expect(nextOccurrence("2026-12-20", { kind: "monthly", interval: 1 })).toBe("2027-01-20");
    expect(nextOccurrence("2026-08-20", { kind: "yearly", interval: 1 })).toBe("2027-08-20");
  });

  it("clamps a month-end day into short months instead of rolling over", () => {
    expect(nextOccurrence("2026-01-31", { kind: "monthly", interval: 1 })).toBe("2026-02-28");
    expect(nextOccurrence("2026-08-31", { kind: "monthly", interval: 1 })).toBe("2026-09-30");
    expect(nextOccurrence("2028-02-29", { kind: "yearly", interval: 1 })).toBe("2029-02-28");
  });

  it("skips weekends for weekday recurrence", () => {
    expect(nextOccurrence("2026-08-20", { kind: "weekdays", interval: 1 })).toBe("2026-08-21");
    // 周五的下一次是周一
    expect(nextOccurrence("2026-08-21", { kind: "weekdays", interval: 1 })).toBe("2026-08-24");
  });
});
