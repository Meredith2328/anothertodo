import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ApplicationService } from "../src/app/service.js";
import { Store } from "../src/storage/store.js";

const freshService = async (name: string): Promise<ApplicationService> =>
  new ApplicationService(new Store(await mkdtemp(join(tmpdir(), `atd-${name}-`))));

describe("completion rules", () => {
  it("refuses to complete an already-completed task instead of refreshing its end time", async () => {
    const service = await freshService("done-twice");
    const task = await service.add("写周报", "2026-08-20T10:00");
    const first = await service.complete(task.id);
    expect(first.task.end).toBeDefined();
    await expect(service.complete(task.id)).rejects.toThrow("已经是已完成");
    // end 时间没被第二次调用冲掉
    expect((await service.store.find(task.id))?.end).toBe(first.task.end);
  });

  it("records an end time for cancelled tasks and clears it on the way back", async () => {
    const service = await freshService("cancel");
    const task = await service.add("也许不做", "2026-08-20T10:00");
    expect((await service.setStatus(task.id, "cancelled")).end).toBeDefined();
    expect((await service.setStatus(task.id, "todo")).end).toBeUndefined();
    await expect(service.setStatus(task.id, "todo")).rejects.toThrow("已经是待办");
  });

  it("drops the wait date when a task comes back to todo", async () => {
    const service = await freshService("unwait");
    const task = await service.add("修车 ~2026-09-01", "2026-08-20T10:00");
    expect(task.status).toBe("waiting");
    const back = await service.setStatus(task.id, "todo");
    expect(back.wait).toBeUndefined();
  });
});

describe("recurring tasks", () => {
  it("spawns the next occurrence as a new task and keeps the finished one", async () => {
    const service = await freshService("recur");
    const task = await service.add("倒垃圾 *每天 2026-08-20 20:00", "2026-08-20T10:00");
    expect(task.recur).toEqual({ kind: "daily", interval: 1 });
    const result = await service.complete(task.id, { now: "2026-08-20T21:00" });
    expect(result.next).toBeDefined();
    expect(result.next!.id).not.toBe(task.id);
    expect(result.next!.status).toBe("todo");
    expect(result.next!.due).toBe("2026-08-21T20:00:00");
    expect(result.next!.recur).toEqual({ kind: "daily", interval: 1 });
    expect(result.next!.end).toBeUndefined();
    // 原任务留在历史里，完成记录不会被下一次覆盖
    const all = await service.tasks();
    expect(all).toHaveLength(2);
    expect(all.find((item) => item.id === task.id)?.status).toBe("done");
  });

  it("shifts reminders along with the due date and gives them fresh delivery state", async () => {
    const service = await freshService("recur-reminders");
    const task = await service.add("吃药 *每周 2026-08-20 09:00 @2026-08-20T08:30", "2026-08-20T07:00");
    const result = await service.complete(task.id, { now: "2026-08-20T10:00" });
    expect(result.next!.reminders).toHaveLength(1);
    expect(result.next!.reminders[0]!.at).toBe("2026-08-27T08:30");
    expect(result.next!.reminders[0]!.fired).toBe(false);
    // 提醒 id 由任务 id 派生，两条任务不能共用一个提醒身份
    expect(result.next!.reminders[0]!.id).not.toBe(task.reminders[0]!.id);
  });

  it("keeps a waiting recurring task waiting, with the wait date moved too", async () => {
    const service = await freshService("recur-wait");
    const task = await service.add("季度复盘 *每月 2026-08-20 ~2026-08-18", "2026-08-10T10:00");
    const result = await service.complete(task.id, { now: "2026-08-20T10:00" });
    expect(result.next!.status).toBe("waiting");
    expect(result.next!.wait).toBe("2026-09-18");
  });

  it("advances from today when a recurring task has no due date", async () => {
    const service = await freshService("recur-nodue");
    const task = await service.add("随手整理 *每3天", "2026-08-20T10:00");
    const result = await service.complete(task.id, { now: "2026-08-20T10:00" });
    expect(result.next!.due).toBeUndefined();
    expect(result.next!.status).toBe("todo");
  });

  it("does not spawn anything for a plain task", async () => {
    const service = await freshService("recur-none");
    const task = await service.add("一次性的事", "2026-08-20T10:00");
    expect((await service.complete(task.id)).next).toBeUndefined();
    expect(await service.tasks()).toHaveLength(1);
  });
});

describe("subtasks", () => {
  it("reports open children instead of silently orphaning them", async () => {
    const service = await freshService("subtask");
    const parent = await service.add("装修", "2026-08-20T10:00");
    await service.add(`买瓷砖 ^${parent.id}`, "2026-08-20T10:00");
    const second = await service.add(`找师傅 ^${parent.id}`, "2026-08-20T10:00");
    await service.complete(second.id);
    const result = await service.complete(parent.id);
    expect(result.openChildren.map((child) => child.title)).toEqual(["买瓷砖"]);
    expect(result.cascaded).toEqual([]);
  });

  it("completes children too when asked to cascade", async () => {
    const service = await freshService("subtask-cascade");
    const parent = await service.add("装修", "2026-08-20T10:00");
    await service.add(`买瓷砖 ^${parent.id}`, "2026-08-20T10:00");
    await service.add(`找师傅 ^${parent.id}`, "2026-08-20T10:00");
    const result = await service.complete(parent.id, { cascade: true });
    expect(result.cascaded.map((child) => child.title).sort()).toEqual(["买瓷砖", "找师傅"]);
    expect(result.openChildren).toEqual([]);
    expect((await service.tasks()).every((task) => task.status === "done")).toBe(true);
  });
});
