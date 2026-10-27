import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG_TEXT } from "../src/core/config.js";
import { parseTask } from "../src/core/task.js";
import { taskInView, viewCounts, viewGroups, viewWindow, wallNow } from "../src/core/views.js";
import * as TOML from "@iarna/toml";
import { ConfigSchema } from "../src/contracts.js";
const cfg = ConfigSchema.parse(TOML.parse(DEFAULT_CONFIG_TEXT));
const clock = new Date("2026-09-30T15:30:00+08:00");
const window = viewWindow(cfg, clock);
const task = (id: string, fields: Record<string, unknown> = {}) => parseTask({ id: id.padStart(8, "0"), title: id, status: "todo", ...fields });
describe("time-based focus views", () => {
  it("uses Shanghai regardless of host zone and includes the one-hour edge", () => {
    expect(wallNow(clock, cfg.agenda.timezone)).toBe("2026-09-30T15:30:00");
    expect(taskInView(task("1", { due: "2026-09-30T16:30:00" }), "hour", window)).toBe(true);
    expect(taskInView(task("2", { due: "2026-09-30T16:30:01" }), "hour", window)).toBe(false);
    expect(taskInView(task("3", { due: "2026-09-30T08:00:00Z" }), "hour", window)).toBe(true);
  });
  it("keeps ongoing, cross-day, overdue and date-only today, excludes completed/future waits", () => {
    const items = [task("1", { due: "2026-09-30T15:00", until: "2026-09-30T16:00" }), task("2", { due: "2026-09-29T23:00", until: "2026-09-30T16:00" }), task("3", { due: "2026-09-30T14:00" }), task("4", { due: "2026-09-30T00:00" }), task("5", { status: "doing" }), task("6"), task("7", { status: "done", due: "2026-09-30T16:00" }), task("8", { due: "2026-09-30T16:00", wait: "2026-10-01" })];
    const before = JSON.stringify(items);
    const grouped = viewGroups(items, cfg, "levels", clock, "", "hour");
    expect(grouped.find((g) => g.key === "doing")?.tasks.map((t) => t.id).sort()).toEqual(["00000001", "00000002", "00000005"]);
    expect(grouped.find((g) => g.key === "overdue")?.tasks.map((t) => t.id)).toEqual(["00000003"]);
    expect(grouped.flatMap((g) => g.tasks).map((t) => t.id).sort()).toEqual(["00000001", "00000002", "00000003", "00000004", "00000005"]);
    expect(viewCounts(items, cfg, clock, "", "hour")).toEqual({ unscheduled: 1, outside: 1 });
    expect(JSON.stringify(items)).toBe(before);
    expect(viewGroups(items, cfg, "levels", clock, "", "hour", true).flatMap((g) => g.tasks)).toContain(items[5]);
    expect(viewGroups(items, cfg, "levels", clock, "status:done", "all").flatMap((g) => g.tasks)).toEqual([items[6]]);
  });
  it("rolls across midnight, refreshes a newly entering boundary, and ends ongoing intervals exactly", () => {
    const start = new Date("2026-09-30T23:30:00+08:00");
    const next = task("1", { due: "2026-10-01T00:30:00" });
    expect(taskInView(next, "hour", viewWindow(cfg, start))).toBe(true);
    const later = task("2", { due: "2026-10-01T00:30:01" });
    expect(taskInView(later, "hour", viewWindow(cfg, start))).toBe(false);
    expect(taskInView(later, "hour", viewWindow(cfg, new Date(start.getTime() + 1000)))).toBe(true);
    const ongoing = task("3", { due: "2026-09-30T23:00", until: "2026-10-01T00:00" });
    expect(viewGroups([ongoing], cfg, "levels", start, "", "hour")[0]?.key).toBe("doing");
    expect(viewGroups([ongoing], cfg, "levels", new Date("2026-10-01T00:00:00+08:00"), "", "hour")[0]?.key).toBe("overdue");
  });
  it("shows a precise configurable recent range with an explicit outside count", () => {
    const inside = task("1", { due: "2026-10-07T23:59:00" });
    const outside = task("2", { due: "2026-10-08T00:00:00" });
    expect(taskInView(inside, "recent", window)).toBe(true);
    expect(taskInView(outside, "recent", window)).toBe(false);
    expect(viewCounts([inside, outside], cfg, clock, "", "recent").outside).toBe(1);
  });
});
