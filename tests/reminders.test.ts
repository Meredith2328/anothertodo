import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseTask } from "../src/core/task.js";
import { checkOnce, checkOnceDetailed, isMissedReminder, messageFor, snooze } from "../src/reminders/watcher.js";
import { Store } from "../src/storage/store.js";

describe("stage 6 reminder delivery", () => {
  it("skips finished tasks and does not add fired changes to undo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-reminder-"));
    const store = new Store(dir);
    const events: string[] = [];
    store.events.on("reminder.due", () => { events.push("due"); });
    store.events.on("reminder.fired", () => { events.push("fired"); });
    const active = parseTask({ id: "00000081", title: "活动提醒", status: "todo", reminders: [{ at: "2026-08-20T09:00", hooks: ["unknown"], fired: false }], entry: "2026-08-18T10:00:00Z", modified: "2026-08-18T10:00:00Z" });
    const done = parseTask({ id: "00000082", title: "完成提醒", status: "done", reminders: [{ at: "2026-08-20T09:00", hooks: ["unknown"], fired: false }], entry: "2026-08-18T10:00:00Z", modified: "2026-08-18T10:00:00Z" });
    await store.save(active);
    await store.save(done);
    await writeFile(join(dir, "undo.jsonl"), "", "utf8");
    const count = await checkOnce(store, true, "2026-08-20T10:00");
    expect(count).toBe(1);
    expect((await store.get(active.id))?.reminders[0]?.fired).toBe(false);
    expect((await store.get(active.id))?.reminders[0]?.attempts).toBe(1);
    expect((await store.get(done.id))?.reminders[0]?.fired).toBe(false);
    expect(events).toEqual(["due"]);
    await expect(store.undo()).rejects.toThrow("撤销");
  });

  it("snoozes only the last unfired reminder", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-reminder-"));
    const store = new Store(dir);
    const task = parseTask({ id: "00000083", title: "推迟", status: "todo", reminders: [{ at: "2026-08-20T09:00", hooks: ["unknown"], fired: false }, { at: "2026-08-20T10:00", hooks: ["unknown"], fired: false }], entry: "2026-08-18T10:00:00Z", modified: "2026-08-18T10:00:00Z" });
    await store.save(task);
    await snooze(store, task.id, 30);
    expect((await store.get(task.id))?.reminders[0]?.at).toBe("2026-08-20T09:00");
    expect((await store.get(task.id))?.reminders[1]?.at).toBe("2026-08-20T10:30");
    expect(await store.undo()).toContain("撤销修改");
    expect((await store.get(task.id))?.reminders[1]?.at).toBe("2026-08-20T10:00");
  });

  it("only marks reminders more than five minutes late as missed", () => {
    expect(isMissedReminder("2026-08-20T10:00", "2026-08-20T10:04")).toBe(false);
    expect(isMissedReminder("2026-08-20T10:00", "2026-08-20T10:05")).toBe(false);
    expect(isMissedReminder("2026-08-20T10:00", "2026-08-20T10:06")).toBe(true);
  });

  it("includes missed status in the delivered message and dead-letters repeated failures", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-reminder-"));
    const store = new Store(dir);
    const task = parseTask({ id: "00000084", title: "失败提醒", status: "todo", reminders: [{ at: "2026-08-20T09:00", hooks: ["unknown"], fired: false }], entry: "2026-08-18T10:00:00Z", modified: "2026-08-18T10:00:00Z" });
    await store.save(task);
    expect(messageFor(task, task.reminders[0]!, true)).toContain("[错过]");
    await checkOnce(store, true, "2026-08-20T10:10");
    await checkOnce(store, true, "2026-08-20T10:12");
    await checkOnce(store, true, "2026-08-20T10:16");
    const result = await store.get(task.id);
    expect(result?.reminders[0]?.attempts).toBe(3);
    expect(result?.reminders[0]?.fired).toBe(false);
    expect(result?.reminders[0]?.dead).toBe(true);
    expect(await checkOnce(store, true, "2026-08-20T11:00")).toBe(0);
  });

  it("allows only one concurrent watcher to claim a reminder", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-reminder-"));
    const first = new Store(dir);
    const second = new Store(dir);
    await first.save(parseTask({ id: "00000085", title: "lease", status: "todo", reminders: [{ at: "2026-08-20T10:00", hooks: ["unknown"], fired: false }], entry: "", modified: "" }));
    const reminderId = (await first.get("00000085"))?.reminders[0]?.id;
    expect(reminderId).toBeTruthy();
    const claims = await Promise.all([
      first.claimReminder("00000085", reminderId!, "watcher-a", "2026-08-20T10:00"),
      second.claimReminder("00000085", reminderId!, "watcher-b", "2026-08-20T10:00"),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });

  it("does not claim a reminder after the task becomes terminal", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-reminder-"));
    const store = new Store(dir);
    await store.save(parseTask({ id: "00000089", title: "终态", status: "done", reminders: [{ at: "2026-08-20T10:00", hooks: ["unknown"], fired: false }], entry: "", modified: "" }));
    const id = (await store.get("00000089"))?.reminders[0]?.id;
    expect(await store.claimReminder("00000089", id!, "watcher", "2026-08-20T10:00")).toBeUndefined();
  });

  it("completes by reminder id after another writer reorders the array", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-reminder-"));
    const writer = new Store(dir);
    const editor = new Store(dir);
    await writer.save(parseTask({ id: "00000086", title: "重排", status: "todo", reminders: [{ at: "2026-08-20T10:00", hooks: ["unknown"], fired: false }, { at: "2026-08-20T11:00", hooks: ["unknown"], fired: false }], entry: "", modified: "" }));
    const original = await writer.get("00000086");
    const reminderId = original?.reminders[0]?.id;
    const claimed = await writer.claimReminder("00000086", reminderId!, "watcher", "2026-08-20T10:00");
    const edited = await editor.get("00000086");
    const before = edited!;
    edited!.reminders.reverse();
    await editor.save(edited!, before);
    const result = await writer.completeReminder("00000086", reminderId!, "watcher", "2026-08-20T10:00", false);
    expect(claimed).toBeDefined();
    expect(result?.fired).toBe(true);
    expect((await writer.get("00000086"))?.reminders.find((reminder) => reminder.id === reminderId)?.fired).toBe(true);
  });

  it("handles seconds/offset timestamps and skips invalid timestamps without writing NaN", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-reminder-"));
    const store = new Store(dir);
    const task = parseTask({ id: "00000087", title: "时间兼容", status: "todo", reminders: [
      { at: "2026-08-20T09:00:30", hooks: ["unknown"], fired: false },
      { at: "2026-08-20T17:00:00+08:00", hooks: ["unknown"], fired: false },
      { at: "not-a-date", hooks: ["unknown"], fired: false },
    ], entry: "", modified: "" });
    await store.save(task);
    await checkOnce(store, true, "2026-08-20T09:01");
    const result = await store.get(task.id);
    expect(result?.reminders[0]?.at).not.toContain("NaN");
    expect(result?.reminders[2]?.at).toBe("not-a-date");
    expect(result?.reminders[2]?.attempts).toBeUndefined();
  });

  it("passes a custom Store directory through watcher hook delivery", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-reminder-profile-"));
    await mkdir(join(dir, "hooks"), { recursive: true });
    await writeFile(join(dir, "hooks", "record.js"), "process.stdin.resume(); process.stdin.on('end', () => process.exit(0));", "utf8");
    const store = new Store(dir);
    await store.save(parseTask({ id: "00000088", title: "profile", status: "todo", reminders: [{ at: "2026-08-20T10:00", hooks: ["record"], fired: false }], entry: "", modified: "" }));
    const summary = await checkOnceDetailed(store, false, "2026-08-20T10:00", dir);
    expect(summary.sent).toBe(1);
    expect((await store.get("00000088"))?.reminders[0]?.fired).toBe(true);
  });
});
