import { appendFile, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { parseTask } from "../src/core/task.js";
import { Store } from "../src/storage/store.js";

const task = (id: string, title: string) => parseTask({ id, title, status: "todo", entry: "2026-08-18T10:00:00Z", modified: "2026-08-18T10:00:00Z" });

describe("stage 2 JSONL store", () => {
  it("saves, canonicalizes duplicate ids, deletes, and undoes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-store-"));
    const store = new Store(dir);
    await store.save(task("00000051", "旧标题"));
    const before = await store.get("00000051");
    expect(before?.title).toBe("旧标题");
    await store.save({ ...before!, title: "新标题" }, before);
    expect((await store.get("00000051"))?.title).toBe("新标题");
    expect((await readFile(join(dir, "tasks.jsonl"), "utf8")).split("00000051").length - 1).toBe(1);
    expect(await store.undo()).toContain("撤销修改");
    expect((await store.get("00000051"))?.title).toBe("旧标题");
    await store.delete("00000051");
    expect(await store.get("00000051")).toBeUndefined();
    expect(await store.undo()).toContain("撤销删除");
    expect((await store.get("00000051"))?.title).toBe("旧标题");
  });

  it("uses the shared paths module and preserves the data directory contract", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-store-"));
    const store = new Store(dir);
    await store.save(task("00000052", "可读"));
    expect(store.paths.tasks).toBe(join(dir, "tasks.jsonl"));
    expect((await store.tasks()).map((item) => item.id)).toEqual(["00000052"]);
  });

  it("skips malformed and schema-invalid records without crashing the store", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-store-"));
    const store = new Store(dir);
    await store.save(task("00000053", "可读"));
    await appendFile(store.paths.tasks, "not-json\n{\"id\":\"\",\"title\":\"坏\"}\n", "utf8");
    expect((await store.tasks()).map((item) => item.id)).toEqual(["00000053"]);
    await expect(store.save(task("00000054", "不应覆盖"))).rejects.toThrow("已阻止写入");
  });

  it("round-trips legacy empty metadata and custom statuses", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-store-"));
    const store = new Store(dir);
    await appendFile(store.paths.tasks, JSON.stringify({ id: "legacy-id", title: "旧任务", status: "CUSTOM", entry: "", modified: "" }) + "\n", "utf8");
    expect((await store.tasks())[0]).toMatchObject({ id: "legacy-id", status: "CUSTOM", entry: "", modified: "" });
    const current = await store.get("legacy-id");
    expect(current).toBeDefined();
    await store.save({ ...current!, title: "已更新" }, current);
    expect((await store.get("legacy-id"))?.title).toBe("已更新");
  });

  it("recovers an interrupted archive transaction before the next write", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-store-"));
    const store = new Store(dir);
    const original = task("00000055", "原任务");
    await store.save(original);
    const moved = { ...original, status: "done" };
    await writeFile(store.paths.archiveJournal, JSON.stringify({ tasks: [], archive: [JSON.stringify(moved)] }), "utf8");
    await store.archive(14);
    expect(await store.get(original.id)).toBeUndefined();
    expect((await store.archived()).map((item) => item.id)).toEqual([original.id]);
  });

  it("retries an occupied id instead of overwriting the existing task", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-store-"));
    let next = 0;
    const store = new Store(dir, undefined, () => next++ === 0 ? "00000056" : "00000057");
    await store.save(task("00000056", "已有"));
    const created = await store.save(task("00000056", "新增"));
    expect(created.id).toBe("00000057");
    expect((await store.get("00000056"))?.title).toBe("已有");
    expect((await store.get("00000057"))?.title).toBe("新增");
  });

  it("rejects a stale before snapshot instead of last-writer-wins", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-store-"));
    const first = new Store(dir);
    const second = new Store(dir);
    await first.save(task("00000057", "原始"));
    const firstView = await first.get("00000057");
    const secondView = await second.get("00000057");
    await first.save({ ...firstView!, title: "第一次修改" }, firstView);
    await expect(second.save({ ...secondView!, title: "过期修改" }, secondView)).rejects.toThrow("刷新后重试");
    expect((await first.get("00000057"))?.title).toBe("第一次修改");
  });

  it("rejects undo when the task changed after the undo record was created", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-store-"));
    const store = new Store(dir);
    await store.save(task("0000005a", "原始"));
    const before = await store.get("0000005a");
    await store.save({ ...before!, title: "第一次编辑" }, before);
    const external = await store.get("0000005a");
    await store.save({ ...external!, title: "后续外部编辑" }, external, false);
    await expect(store.undo()).rejects.toThrow("刷新后重试");
    expect((await store.get("0000005a"))?.title).toBe("后续外部编辑");
    expect((await readFile(join(dir, "undo.jsonl"), "utf8")).trim().split(/\r?\n/)).toHaveLength(2);
  });

  it("rejects deleting a task from a stale UI snapshot", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-store-"));
    const first = new Store(dir);
    const second = new Store(dir);
    await first.save(task("0000005b", "待删除"));
    const stale = await second.get("0000005b");
    const current = await first.get("0000005b");
    await first.save({ ...current!, title: "已更新" }, current);
    await expect(second.delete("0000005b", stale!.modified)).rejects.toThrow("刷新后重试");
    expect((await first.get("0000005b"))?.title).toBe("已更新");
  });

  it("uses the last duplicate task record for reminder lease operations", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-store-"));
    const store = new Store(dir);
    const first = parseTask({ id: "00000058", title: "旧", status: "todo", reminders: [{ at: "2026-08-20T09:00", hooks: ["toast"], fired: false }], entry: "", modified: "" });
    const second = parseTask({ id: "00000058", title: "最新", status: "todo", reminders: [{ at: "2026-08-20T10:00", hooks: ["toast"], fired: false }], entry: "", modified: "" });
    await store.save(first);
    await appendFile(store.paths.tasks, JSON.stringify(second) + "\n", "utf8");
    const latest = await store.get("00000058");
    const id = latest?.reminders[0]?.id;
    expect(latest?.title).toBe("最新");
    expect(await store.claimReminder("00000058", id!, "watcher", "2026-08-20T10:00")).toBeDefined();
    expect((await store.get("00000058"))?.title).toBe("最新");
    expect((await store.get("00000058"))?.reminders[0]?.leaseOwner).toBe("watcher");
  });

  it("preserves reminder runtime state when undoing a user edit", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-store-"));
    const store = new Store(dir);
    const original = parseTask({ id: "00000059", title: "原始", status: "todo", reminders: [{ at: "2026-08-20T09:00", hooks: ["unknown"], fired: false }], entry: "", modified: "" });
    await store.save(original);
    const before = await store.get(original.id);
    await store.save({ ...before!, title: "编辑后" }, before);
    const reminderId = (await store.get(original.id))?.reminders[0]?.id;
    await store.claimReminder(original.id, reminderId!, "watcher", "2026-08-20T09:00");
    await store.completeReminder(original.id, reminderId!, "watcher", "2026-08-20T09:00", false);
    await store.undo();
    const restored = await store.get(original.id);
    expect(restored?.title).toBe("原始");
    expect(restored?.reminders[0]?.fired).toBe(true);
  });

  it("archives only the effective last duplicate record", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-store-"));
    const store = new Store(dir);
    await appendFile(store.paths.tasks, [
      JSON.stringify({ id: "00000060", title: "旧完成", status: "done", entry: "", modified: "2000-01-01T00:00:00Z" }),
      JSON.stringify({ id: "00000060", title: "后来重开", status: "todo", entry: "", modified: "2026-08-20T10:00:00Z" }),
    ].join("\n") + "\n", "utf8");
    expect(await store.archive(0)).toBe(0);
    expect((await store.tasks()).map((item) => item.title)).toEqual(["后来重开"]);
    expect(await store.archived()).toEqual([]);
  });
});
