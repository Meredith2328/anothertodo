import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { ApplicationService } from "../src/app/service.js";
import { groups } from "../src/core/agenda.js";
import { loadConfig, setConfigValue } from "../src/core/config.js";
import { dependencyGraph, renderGraphLine } from "../src/core/deps.js";
import { parse } from "../src/core/parse.js";
import { taskToInput } from "../src/core/task-ops.js";
import { Store } from "../src/storage/store.js";

const now = "2026-09-29T10:00";
const setup = async (): Promise<{ dir: string; service: ApplicationService }> => {
  const dir = await mkdtemp(join(tmpdir(), "atd-deps-"));
  return { dir, service: new ApplicationService(new Store(dir)) };
};
const groupOf = (all: ReturnType<typeof groups>, id: string): string | undefined => all.find((group) => group.tasks.some((task) => task.id === id))?.key;

describe("custom status groups", () => {
  it("parses in:在做 / in:等待 / in:暂停 and round-trips them through taskToInput", async () => {
    expect(parse("申请身份证 in:在做", now).status).toBe("doing");
    expect(parse("领取身份证 in:等待", now).status).toBe("waiting");
    expect(parse("学吉他 in:paused", now).status).toBe("paused");
    // 不认识的分组名留在标题里，别悄悄吞掉
    expect(parse("去 in:北京 出差", now).title).toBe("去 in:北京 出差");
    const { service } = await setup();
    const task = await service.add("申请身份证 in:在做", now);
    expect(task.status).toBe("doing");
    expect(taskToInput(task)).toContain("in:在做");
  });

  it("shows 在做 first, then dated groups, 等待, 暂停", async () => {
    const { service } = await setup();
    const doing = await service.add("申请身份证 in:在做", now);
    const waiting = await service.add("等快递 in:等待", now);
    const paused = await service.add("学吉他 in:暂停 明天", now);
    const plain = await service.add("写周报", now);
    const all = groups(await service.tasks(), await loadConfig(service.store.paths.dir), "levels", now);
    expect(all.map((group) => group.key)).toEqual(["doing", "waiting", "paused", "nodate"]);
    expect([groupOf(all, doing.id), groupOf(all, waiting.id), groupOf(all, paused.id), groupOf(all, plain.id)]).toEqual(["doing", "waiting", "paused", "nodate"]);
  });
});

describe("task dependencies", () => {
  it("unblocks the follow-up when its prerequisite is done (身份证 example)", async () => {
    const { dir, service } = await setup();
    const apply = await service.add("申请身份证 in:在做", now);
    const pickup = await service.add(`领取身份证 in:等待 after:${apply.id.slice(0, 4)}`, now);
    const activate = await service.add(`激活社保卡 after:${pickup.id}`, now);
    expect(pickup.deps).toEqual([apply.id]);
    const config = await loadConfig(dir);
    // 默认 dim：后续任务留在主屏，只是被标成阻塞
    let all = groups(await service.tasks(), config, "levels", now);
    expect(groupOf(all, pickup.id)).toBe("waiting");
    const first = await service.complete(apply.id, { now });
    expect(first.unblocked.map((task) => task.title)).toEqual(["领取身份证"]);
    const second = await service.complete(pickup.id, { now });
    expect(second.unblocked.map((task) => task.title)).toEqual(["激活社保卡"]);
    all = groups(await service.tasks(), config, "levels", now);
    expect(groupOf(all, activate.id)).toBe("nodate");
  });

  it("hides blocked tasks from the main screen when deps.blocked = hide", async () => {
    const { dir, service } = await setup();
    await setConfigValue("deps.blocked", "hide", dir);
    const apply = await service.add("申请身份证", now);
    const pickup = await service.add(`领取身份证 in:等待 after:${apply.id}`, now);
    const config = await loadConfig(dir);
    let all = groups(await service.tasks(), config, "levels", now);
    expect(groupOf(all, pickup.id)).toBeUndefined();
    expect(all.find((group) => group.key === "blocked")?.name).toContain("1");
    await service.complete(apply.id, { now });
    all = groups(await service.tasks(), config, "levels", now);
    expect(groupOf(all, pickup.id)).toBe("waiting");
  });

  it("rejects self-dependencies, cycles, and unknown ids", async () => {
    const { service } = await setup();
    const a = await service.add("A", now);
    const b = await service.add(`B after:${a.id}`, now);
    await expect(service.edit(a.id, `after:${b.id}`, now)).rejects.toThrow("成环");
    await expect(service.edit(a.id, `after:${a.id}`, now)).rejects.toThrow("自己");
    await expect(service.add("C after:ffffffff", now)).rejects.toThrow("找不到前置任务");
    expect((await service.edit(b.id, "-after", now)).deps).toBeUndefined();
  });

  it("draws the DAG with shared nodes expanded once", async () => {
    const { service } = await setup();
    const a = await service.add("申请身份证", now);
    const b = await service.add("拍证件照", now);
    const c = await service.add(`领取身份证 after:${a.id},${b.id}`, now);
    await service.add(`激活社保卡 after:${c.id}`, now);
    await service.add("无关任务", now);
    const lines = dependencyGraph(await service.tasks()).map((line) => renderGraphLine(line));
    expect(lines).toEqual([
      "● 申请身份证",
      "└─▸ ○ 领取身份证  （另需：拍证件照）",
      "    └─▸ ○ 激活社保卡",
      "● 拍证件照",
      "└─▸ ⤷ 领取身份证（见上）",
    ]);
  });
});

describe("redo", () => {
  it("redoes an undone edit, add, and delete, and forgets redo after a new change", async () => {
    const { dir, service } = await setup();
    const task = await service.add("原始", now);
    await service.edit(task.id, "改过", now);
    expect(await service.undo()).toContain("撤销修改");
    expect((await service.store.get(task.id))?.title).toBe("原始");
    expect(await service.redo()).toContain("重做修改");
    expect((await service.store.get(task.id))?.title).toBe("改过");
    await service.remove(task.id);
    await service.undo();
    expect(await service.redo()).toContain("重做删除");
    expect(await service.store.get(task.id)).toBeUndefined();
    await service.undo();
    await service.add("新改动", now);
    await expect(service.redo()).rejects.toThrow("没有可重做");
    expect((await readFile(join(dir, "redo.jsonl"), "utf8")).trim()).toBe("");
  });

  it("undoes a completion together with the recurring task it spawned, and redoes both", async () => {
    const { service } = await setup();
    const task = await service.add("倒垃圾 *每天 明天", now);
    await service.complete(task.id, { now });
    expect(await service.tasks()).toHaveLength(2);
    await service.undo();
    const afterUndo = await service.tasks();
    expect(afterUndo).toHaveLength(1);
    expect(afterUndo[0]?.status).toBe("todo");
    await service.redo();
    const afterRedo = await service.tasks();
    expect(afterRedo).toHaveLength(2);
    expect(afterRedo.find((item) => item.id === task.id)?.status).toBe("done");
  });
});
