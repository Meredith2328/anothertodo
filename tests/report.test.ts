import { describe, expect, it } from "vitest";

import { ConfigSchema, TaskSchema } from "../src/contracts.js";
import { collectStats, exportTasks, projectSummary, tagSummary } from "../src/core/report.js";
import { displayWidth, padDisplay, truncateWithEllipsis } from "../src/core/width.js";

const config = ConfigSchema.parse({
  priority: { mode: "levels", levels: ["低", "中", "高"], urgency: { overdue: 12, due_today: 8, due_week_decay: 8, per_level: 3, age_per_day: 0.05, age_cap: 2, waiting_penalty: 3 } },
  agenda: { week_days: 7, date_format: "auto" },
  watch: { interval_seconds: 30 },
  email: { host: "", port: 465, ssl: true, user: "", password: "", from: "", to: "" },
});
const task = (value: Record<string, unknown>) => TaskSchema.parse({ entry: "2026-08-18T10:00:00Z", modified: "2026-08-18T10:00:00Z", ...value });

const sample = [
  task({ id: "00000001", title: "写周报", status: "todo", due: "2026-08-20T09:00:00", priority: "高", project: "季度", tags: ["工作"], notes: "带上上周数据" }),
  task({ id: "00000002", title: "倒垃圾", status: "todo", due: "2026-08-19T20:00:00", recur: { kind: "daily", interval: 1 } }),
  task({ id: "00000003", title: "逾期的事", status: "todo", due: "2026-08-15T09:00:00", tags: ["工作", "杂事"] }),
  task({ id: "00000004", title: "做完了", status: "done", project: "季度", end: "2026-08-18T09:00:00Z" }),
  task({ id: "00000005", title: "买瓷砖", status: "todo", parent: "00000001" }),
  task({ id: "00000006", title: "等着", status: "waiting", wait: "2026-09-01" }),
];

describe("project and tag summaries", () => {
  it("counts open, done, and overdue per project", () => {
    const rows = projectSummary(sample, "2026-08-19");
    expect(rows.find((row) => row.name === "季度")).toEqual({ name: "季度", open: 1, done: 1, overdue: 0 });
    // 没有项目的任务归到「（无项目）」而不是消失
    expect(rows.find((row) => row.name === "（无项目）")?.open).toBe(4);
    expect(rows.reduce((sum, row) => sum + row.open + row.done, 0)).toBe(sample.length);
    // 逾期数跟着传入的日期走，不看真实时钟
    expect(projectSummary(sample, "2026-08-25").find((row) => row.name === "季度")?.overdue).toBe(1);
  });

  it("counts a task once per tag it carries", () => {
    const rows = tagSummary(sample, "2026-08-19");
    expect(rows.find((row) => row.name === "工作")?.open).toBe(2);
    expect(rows.find((row) => row.name === "杂事")?.open).toBe(1);
    expect(rows.find((row) => row.name === "（无标签）")?.open).toBe(3);
  });
});

describe("stats", () => {
  const stats = collectStats(sample, config, "2026-08-19T14:00");

  it("summarizes the pile without double counting", () => {
    expect(stats.total).toBe(6);
    expect(stats.byStatus.find((row) => row.status === "todo")?.count).toBe(4);
    expect(stats.overdue).toBe(1);
    expect(stats.dueToday).toBe(1);
    expect(stats.recurring).toBe(1);
    expect(stats.withNotes).toBe(1);
    expect(stats.subtasks).toBe(1);
    expect(stats.hiddenByWait).toBe(1);
  });

  it("ranks the most urgent open tasks and leaves finished ones out", () => {
    expect(stats.topUrgent.length).toBeGreaterThan(0);
    expect(stats.topUrgent.map((item) => item.id)).not.toContain("00000004");
    const scores = stats.topUrgent.map((item) => item.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("counts recent completions by their end time", () => {
    expect(collectStats(sample, config, "2026-08-19T14:00").completedLast7Days).toBe(1);
    expect(collectStats(sample, config, "2026-12-01T14:00").completedLast7Days).toBe(0);
    expect(collectStats(sample, config, "2026-12-01T14:00").completedLast30Days).toBe(0);
  });
});

describe("export", () => {
  it("quotes CSV cells that contain commas or quotes", () => {
    const tricky = [task({ id: "00000010", title: '带,逗号 和"引号"', status: "todo", notes: "第一行\n第二行" })];
    const csv = exportTasks(tricky, "csv");
    expect(csv.split("\n")[1]).toContain('"带,逗号 和""引号"""');
    // 备注里的换行要压平，否则 CSV 行数就乱了
    expect(csv.split("\n")).toHaveLength(2);
  });

  it("writes markdown checkboxes that match the status", () => {
    const markdown = exportTasks(sample, "markdown");
    expect(markdown).toContain("- [ ] 写周报");
    expect(markdown).toContain("- [x] 做完了");
    expect(markdown).toContain("↻每天");
    expect(markdown).toContain("      带上上周数据");
  });

  it("round-trips through JSON", () => {
    expect(JSON.parse(exportTasks(sample, "json"))).toHaveLength(sample.length);
  });
});

describe("display width", () => {
  it("counts CJK as two columns so tables line up", () => {
    expect(displayWidth("读书")).toBe(4);
    expect(displayWidth("abc")).toBe(3);
    expect(padDisplay("读书", 6)).toBe("读书  ");
    expect(displayWidth(padDisplay("读书", 6))).toBe(6);
    expect(displayWidth(padDisplay("abcdef", 6))).toBe(6);
  });

  it("truncates with an ellipsis inside the given width", () => {
    expect(truncateWithEllipsis("abcdef", 6)).toBe("abcdef");
    expect(truncateWithEllipsis("abcdefgh", 6)).toBe("abcde…");
    expect(displayWidth(truncateWithEllipsis("一二三四五六", 7))).toBeLessThanOrEqual(7);
  });
});
