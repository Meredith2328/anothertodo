import { describe, expect, it } from "vitest";

import {
  ConfigSchema,
  ReminderSchema,
  TaskSchema,
  TombstoneSchema,
} from "../src/contracts.js";

describe("stage 1 data contracts", () => {
  it("accepts the frozen Python-compatible task shape and applies defaults", () => {
    const task = TaskSchema.parse({
      id: "deadbeef",
      title: "买牛奶",
      status: "todo",
      entry: "2026-08-20T10:00:00Z",
      modified: "2026-08-20T10:00:00+00:00",
    });

    expect(task.tags).toEqual([]);
    expect(task.notes).toBe("");
    expect(task.reminders).toEqual([]);
  });

  it("keeps local reminder timestamps and accepts compatible due timestamps", () => {
    expect(
      ReminderSchema.parse({
        at: "2026-08-22T14:00",
        hooks: ["toast", "email"],
      }),
    ).toMatchObject({ fired: false, hooks: ["toast", "email"] });

    expect(TaskSchema.parse({ id: "deadbeef", title: "UTC due", status: "todo", due: "2026-08-22T14:00:00Z", entry: "2026-08-20T10:00:00Z", modified: "2026-08-20T10:00:00Z" }).due).toBe("2026-08-22T14:00:00Z");
  });

  it("accepts Python ISO due values with offsets and microseconds", () => {
    expect(TaskSchema.parse({ id: "legacy-time", title: "带时区", status: "todo", due: "2026-08-22T14:30:00.123456+08:00", entry: "", modified: "" }).due).toBe("2026-08-22T14:30:00.123456+08:00");
    expect(TaskSchema.parse({ id: "legacy-z", title: "UTC", status: "todo", due: "2026-08-22T06:30:00Z", entry: "", modified: "" }).due).toBe("2026-08-22T06:30:00Z");
  });

  it("validates tombstones independently from tasks", () => {
    expect(
      TombstoneSchema.parse({
        id: "deadbeef",
        deleted: true,
        modified: "2026-08-20T10:00:00Z",
      }).deleted,
    ).toBe(true);
  });

  it("accepts legacy ids, statuses, and empty metadata while rejecting empty ids", () => {
    expect(TaskSchema.parse({ id: "legacy-id", title: "旧任务", status: "CUSTOM", entry: "", modified: "" })).toMatchObject({ status: "CUSTOM", entry: "" });
    expect(() =>
      TaskSchema.parse({
        id: "",
        title: "bad",
        status: "todo",
        entry: "",
        modified: "",
      }),
    ).toThrow();
  });

  it("accepts the default configuration contract", () => {
    const config = ConfigSchema.parse({
      priority: {
        mode: "levels",
        levels: ["低", "中", "高"],
        urgency: {
          overdue: 12,
          due_today: 8,
          due_week_decay: 8,
          per_level: 3,
          age_per_day: 0.05,
          age_cap: 2,
          waiting_penalty: 3,
        },
      },
      agenda: { week_days: 7, date_format: "auto" },
      watch: { interval_seconds: 30 },
      email: { host: "", port: 465, ssl: true, user: "", password: "", from: "", to: "" },
    });

    expect(config.priority.levels).toEqual(["低", "中", "高"]);
  });
});
