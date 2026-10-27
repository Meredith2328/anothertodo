import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { execa } from "execa";
import { describe, expect, it, vi } from "vitest";
import { ApplicationService } from "../src/app/service.js";
import { Store } from "../src/storage/store.js";
import { parseTask } from "../src/core/task.js";
const temp = () => mkdtemp(join(tmpdir(), "atd-ai-"));
const run = (dir: string, ...args: string[]) => execa("node", ["--import", "tsx", "src/cli.ts", ...args], { env: { ...process.env, ATD_HOME: dir }, reject: false });
const decode = (stdout: string) => JSON.parse(stdout);
describe("AI CLI contracts in isolated ATD_HOME", () => {
  it("reports the package release version without touching task data", async () => {
    const dir = await temp();
    const pkg = JSON.parse(await readFile("package.json", "utf8"));
    const result = await run(dir, "--version");
    expect(result.exitCode).toBe(0); expect(result.stdout.trim()).toBe(pkg.version);
    expect(await new Store(dir).tasks()).toEqual([]);
  });
  it("returns the focused agenda from the TUI selector and can explicitly reveal unscheduled tasks", async () => {
    const dir = await temp(); const service = new ApplicationService(new Store(dir));
    await service.add("当前学习 in:在做"); await service.add("未安排事项"); await service.add("2100-01-01 10:00 更远事项");
    const list = decode((await run(dir, "list", "--json", "--view", "hour")).stdout);
    expect(list.ok).toBe(true); expect(list.window.timezone).toBe("Asia/Shanghai");
    expect(list.groups.flatMap((g: { tasks: { title: string }[] }) => g.tasks).map((t: { title: string }) => t.title)).toEqual(["当前学习"]);
    expect(list.counts).toEqual({ unscheduled: 1, outside: 1 });
    const expanded = decode((await run(dir, "list", "--json", "--view", "hour", "--include-unscheduled")).stdout);
    expect(expanded.groups.flatMap((g: { tasks: unknown[] }) => g.tasks)).toHaveLength(2);
    expect((await run(dir, "list")).stdout).toContain("更远事项"); // 默认人类清单仍完整
  });
  it("reports per-item partial success without losing the failed target, and retains human output", async () => {
    const dir = await temp(); const store = new Store(dir);
    const task = await new ApplicationService(store).add("一次操作 *每天");
    const result = await run(dir, "done", task.id, "missing-id", "--json");
    const body = decode(result.stdout);
    expect(result.exitCode).toBe(1); expect(body.ok).toBe(false);
    expect(body.items[0].data.task.id).toBe(task.id);
    expect(body.items[0].data.next.id).not.toBe(task.id);
    expect(body.items[1]).toMatchObject({ input: "missing-id", ok: false, error: { code: "NOT_FOUND" } });
    const retry = decode((await run(dir, "done", task.id, "--json")).stdout);
    expect(retry.items[0].error.code).toBe("ALREADY_IN_STATE");
    expect(await store.tasks()).toHaveLength(2);
    expect((await run(dir, "add", "人类兼容")).stdout).toContain("已添加");
  });
  it("rejects stale edits/status/done/delete and returns a current version after successful CAS", async () => {
    const dir = await temp(); const service = new ApplicationService(new Store(dir));
    const task = await service.add("原任务");
    await service.edit(task.id, "新任务");
    for (const args of [["edit", task.id, "不要覆盖"], ["doing", task.id], ["done", task.id], ["rm", task.id]]) {
      const result = await run(dir, ...args, "--if-modified", task.modified, "--json");
      expect(result.exitCode).toBe(1);
      expect(decode(result.stdout).items[0].error.code).toBe("VERSION_CONFLICT");
    }
    const current = decode((await run(dir, "show", task.id, "--json")).stdout);
    expect(current.title).toBe("新任务"); expect(current.status).toBe("todo");
    const result = decode((await run(dir, "doing", task.id, "--if-modified", current.modified, "--json")).stdout);
    expect(result.items[0].data.status).toBe("doing");
    expect(result.items[0].data.modified).not.toBe(current.modified);
  });
  it("deduplicates concurrent and repeated add requests, conflicts on different payload, and does not recreate undone tasks", async () => {
    const dir = await temp();
    const args = ["add", "一次新增 高", "--request-id", "unique-creation", "--json"];
    const results = await Promise.all([run(dir, ...args), run(dir, ...args)]);
    const ids = results.map((result) => decode(result.stdout).items[0].data.id);
    expect(ids[0]).toBe(ids[1]);
    const store = new Store(dir); expect(await store.tasks()).toHaveLength(1);
    const conflict = await run(dir, "add", "另一种输入", "--request-id", "unique-creation", "--json");
    expect(conflict.exitCode).toBe(1); expect(decode(conflict.stdout).items[0].error.code).toBe("REQUEST_CONFLICT");
    await store.undo();
    const repeat = decode((await run(dir, ...args)).stdout);
    expect(repeat.items[0].error.code).toBe("REQUEST_RESULT_UNAVAILABLE");
    expect(await store.tasks()).toHaveLength(0);
    const multi = await run(dir, "add", "A", "B", "--request-id", "bad-batch", "--json");
    expect(decode(multi.stdout).error.code).toBe("INVALID_ARGUMENT");
    expect(await store.tasks()).toHaveLength(0);
  });
  it("replays a request before reparsing removed dependencies and preserves new task data on replay", async () => {
    const dir = await temp(); const service = new ApplicationService(new Store(dir));
    const parent = await service.add("前置事项");
    const input = `依赖事项 after:${parent.id}`;
    const first = await service.add(input, undefined, { requestId: "dep-request" });
    await service.remove(parent.id); await service.edit(first.id, "已更新事项");
    const repeated = await service.add(input, undefined, { requestId: "dep-request" });
    expect(repeated.id).toBe(first.id); expect(repeated.title).toBe("已更新事项");
  });
  it("recovers an interrupted intent only if no other writer changed the task store", async () => {
    const dir = await temp(); const store = new Store(dir); await store.init();
    const task = parseTask({ id: "feed0001", title: "中断新增", entry: "2026-09-30T00:00:00Z", modified: "2026-09-30T00:00:00Z" });
    const receipt = { requestId: "pending-request", payloadHash: createHash("sha256").update("中断新增").digest("hex"), task, committed: false, beforeHash: createHash("sha256").update("[]").digest("hex") };
    await writeFile(join(dir, "requests.json"), JSON.stringify([receipt]));
    const service = new ApplicationService(store);
    expect((await service.add("中断新增", undefined, { requestId: "pending-request" })).id).toBe(task.id);
    expect(await store.tasks()).toHaveLength(1);
    const otherDir = await temp(); const other = new ApplicationService(new Store(otherDir));
    await other.add("其他进程的新任务"); await writeFile(join(otherDir, "requests.json"), JSON.stringify([receipt]));
    const before = await readFile(join(otherDir, "tasks.jsonl"), "utf8");
    await expect(other.add("中断新增", undefined, { requestId: "pending-request" })).rejects.toMatchObject({ code: "REQUEST_INCOMPLETE" });
    expect(await readFile(join(otherDir, "tasks.jsonl"), "utf8")).toBe(before);
  });
  it("advances modified even when two updates occur in the same clock tick", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-09-30T00:00:00Z"));
      const service = new ApplicationService(new Store(await temp()));
      const before = await service.add("版本测试");
      const after = await service.edit(before.id, "更新");
      expect(after.modified).not.toBe(before.modified);
      await expect(service.setStatus(after.id, "doing", { ifModified: before.modified })).rejects.toMatchObject({ code: "VERSION_CONFLICT" });
    } finally { vi.useRealTimers(); }
  });
});
