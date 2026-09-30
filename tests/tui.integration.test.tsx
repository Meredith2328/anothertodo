import React from "react";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { render, cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ApplicationService } from "../src/app/service.js";
import { readFile } from "node:fs/promises";
import { loadConfig, setConfigValue } from "../src/core/config.js";
import { parseTask } from "../src/core/task.js";
import { Store } from "../src/storage/store.js";
import { TuiApp, type TuiTestSignals } from "../src/tui/app.js";
import { emitMouse } from "../src/tui/mouse.js";

async function withTimeout<T>(promise: Promise<T>, label: string, timeoutMs = 3000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`TUI ${label} timed out`)), timeoutMs); });
  try { return await Promise.race([promise, timeout]); }
  finally { if (timer) clearTimeout(timer); }
}

const createSignals = () => {
  let readyResolve!: () => void;
  let dataResolve!: () => void;
  let actionNumber = 0;
  let actionWaiter: { target: number; resolve: () => void } | undefined;
  let mutationResolve!: (state: { kind: "success" | "error"; id: string; message?: string }) => void;
  const ready = new Promise<void>((resolve) => { readyResolve = resolve; });
  const data = new Promise<void>((resolve) => { dataResolve = resolve; });
  const signals: TuiTestSignals = {
    onReady: () => { readyResolve(); },
    onDataReady: () => { dataResolve(); },
    onActionComplete: (sequence) => { actionNumber = Math.max(actionNumber, sequence); if (actionWaiter && sequence >= actionWaiter.target) { actionWaiter.resolve(); actionWaiter = undefined; } },
    onMutationComplete: (state) => { mutationResolve(state); },
  };
  return {
    signals,
    ready: () => withTimeout(ready, "ready"),
    data: () => withTimeout(data, "data-ready"),
    action: () => { const target = actionNumber + 1; return withTimeout(new Promise<void>((resolve) => { actionWaiter = { target, resolve }; }), "action-complete"); },
    mutation: () => withTimeout(new Promise<{ kind: "success" | "error"; id: string; message?: string }>((resolve) => { mutationResolve = resolve; }), "mutation-complete"),
  };
};

const tomorrow = (): string => {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

describe("stage 7 Ink TUI integration", () => {
  afterEach(() => cleanup());

  it("adds through the real input/Enter path", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-ink-"));
    const store = new Store(dir);
    const signals = createSignals();
    const app = render(<TuiApp store={store} testSignals={signals.signals} />);
    await signals.ready();
    await signals.data();
    const addAction = signals.action();
    app.stdin.write("i");
    await addAction;
    const textAction = signals.action();
    app.stdin.write("真实添加");
    await textAction;
    expect(app.lastFrame()).toContain("真实添加");
    const mutation = signals.mutation();
    app.stdin.write("\n");
    expect((await mutation).kind).toBe("success");
    expect((await store.tasks()).some((task) => task.title === "真实添加")).toBe(true);
  });

  it("shows complete serialized fields while editing and applies w semantics", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-ink-"));
    const store = new Store(dir);
    const task = parseTask({ id: "00000111", title: "完整任务", status: "todo", due: "2026-08-22T14:30:00", tags: ["工作"], project: "项目", reminders: [{ at: "2026-08-22T13:30", hooks: ["toast"], fired: false }], entry: "2026-08-20T10:00:00Z", modified: "2026-08-20T10:00:00Z" });
    await store.save(task);
    const signals = createSignals();
    const app = render(<TuiApp store={store} testSignals={signals.signals} />);
    await signals.ready();
    await signals.data();
    const editAction = signals.action();
    app.stdin.write("e");
    await editAction;
    expect(app.lastFrame()).toContain("#工作");
    expect(app.lastFrame()).toContain("proj:项目");
    expect(app.lastFrame()).toContain("2026-08-22");
    expect(app.lastFrame()).toContain("@2026-08-22 13:30:toast");
    const escapeAction = signals.action();
    app.stdin.write("\u001b");
    await escapeAction;
    const mutation = signals.mutation();
    app.stdin.write("w");
    expect((await mutation).kind).toBe("success");
    expect((await store.get(task.id))?.status).toBe("waiting");
    expect((await store.get(task.id))?.wait).toBe(tomorrow());
  });

  it("opens the help modal with ? and closes with any key (no crash)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-ink-"));
    const store = new Store(dir);
    const signals = createSignals();
    const app = render(<TuiApp store={store} testSignals={signals.signals} />);
    await signals.ready();
    await signals.data();
    const helpAction = signals.action();
    app.stdin.write("?");
    await helpAction;
    // 弹窗渲染不闪退：帮助面板出现、主界面隐藏（回归：钩子顺序曾致 React 崩溃退出）
    expect(app.lastFrame()).toContain("atd 帮助");
    expect(app.lastFrame()).toContain("清单区（默认焦点，光标在任务列表）");
    const closeAction = signals.action();
    app.stdin.write("x");
    await closeAction;
    expect(app.lastFrame()).toContain("ANOTHER TODO");
    expect(app.lastFrame()).not.toContain("atd 帮助");
  });

  it("a single Esc returns from the input area to the list", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-ink-"));
    const store = new Store(dir);
    const signals = createSignals();
    const app = render(<TuiApp store={store} testSignals={signals.signals} />);
    await signals.ready();
    await signals.data();
    const addAction = signals.action();
    app.stdin.write("i");
    await addAction;
    const textAction = signals.action();
    app.stdin.write("临时");
    await textAction;
    expect(app.lastFrame()).toContain("临时");
    const escAction = signals.action();
    app.stdin.write("\u001b");
    await escAction;
    // 一次 Esc 即回清单区：输入清空、提示行是清单区文案
    const frame = app.lastFrame();
    expect(frame).toContain("清单区：j/k 移动");
    expect(frame).not.toContain("临时");
  });

  it("help modal switches to the compact layout on short terminals and always fits", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-ink-"));
    const store = new Store(dir);
    const signals = createSignals();
    // 回归：完整帮助 28 行，矮终端里整帧溢出会把弹窗顶部卷出屏幕
    const app = render(<TuiApp store={store} testSignals={signals.signals} terminalRows={20} />);
    await signals.ready();
    await signals.data();
    const helpAction = signals.action();
    app.stdin.write("?");
    await helpAction;
    const frame = app.lastFrame() ?? "";
    const lines = frame.split("\n");
    expect(frame).toContain("atd 帮助");
    expect(frame).toContain("清单区"); // 紧凑版也有清单区条目
    expect(frame).not.toContain("清单区（默认焦点，光标在任务列表）"); // 完整版节名不出现
    expect(lines.length).toBeLessThanOrEqual(20);
    // 垂直居中：顶部有留白行
    expect(lines[0]?.trim()).toBe("");
    const closeAction = signals.action();
    app.stdin.write("\u001b");
    await closeAction;
    expect(app.lastFrame()).not.toContain("atd 帮助");
  });

  it("keeps the full help layout on tall terminals", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-ink-"));
    const store = new Store(dir);
    const signals = createSignals();
    const app = render(<TuiApp store={store} testSignals={signals.signals} terminalRows={44} />);
    await signals.ready();
    await signals.data();
    const helpAction = signals.action();
    app.stdin.write("?");
    await helpAction;
    const frame = app.lastFrame() ?? "";
    expect(frame).toContain("清单区（默认焦点，光标在任务列表）");
    expect(frame.split("\n").length).toBeLessThanOrEqual(44);
  });

  it("keeps the footer on the last line while help is open", async () => {
    // 回归：帮助模式曾只渲染弹窗，Footer 从帧里消失，上一帧的键帽残留在屏幕顶部
    const dir = await mkdtemp(join(tmpdir(), "atd-ink-"));
    const store = new Store(dir);
    const signals = createSignals();
    const app = render(<TuiApp store={store} testSignals={signals.signals} terminalRows={24} />);
    await signals.ready();
    await signals.data();
    const helpAction = signals.action();
    app.stdin.write("?");
    await helpAction;
    const lines = (app.lastFrame() ?? "").split("\n");
    expect(lines.length).toBe(24); // 整帧严格等于终端行数，不溢出
    const last = lines[lines.length - 1] ?? "";
    for (const label of ["帮助", "输入", "完成", "设置", "退出"]) expect(last).toContain(label);
  });
});

describe("footer mouse interaction", () => {
  afterEach(() => cleanup());

  it("clicking ? on the footer opens help even from the input area", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-ink-"));
    const store = new Store(dir);
    const signals = createSignals();
    const app = render(<TuiApp store={store} testSignals={signals.signals} terminalRows={24} />);
    await signals.ready();
    await signals.data();
    const addAction = signals.action();
    app.stdin.write("i"); // 先进输入区：Footer 按钮必须全局生效
    await addAction;
    const helpAction = signals.action();
    emitMouse({ kind: "press", button: 0, x: 6, y: 24 }); // ? 帮助 键帽区间
    await helpAction;
    expect(app.lastFrame()).toContain("atd 帮助");
  });

  it("footer buttons still work while a modal is open (help → click 输入 goes to input)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-ink-"));
    const store = new Store(dir);
    const signals = createSignals();
    const app = render(<TuiApp store={store} testSignals={signals.signals} terminalRows={24} />);
    await signals.ready();
    await signals.data();
    const helpAction = signals.action();
    app.stdin.write("?");
    await helpAction;
    expect(app.lastFrame()).toContain("atd 帮助");
    const inputAction = signals.action();
    emitMouse({ kind: "press", button: 0, x: 15, y: 24 }); // i 输入 按钮
    await inputAction;
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(app.lastFrame()).not.toContain("atd 帮助");
    expect(app.lastFrame()).toContain("输入区：Enter 提交");
  });

  it("clicking d on the footer completes the selected task", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-ink-"));
    const store = new Store(dir);
    await store.save(parseTask({ id: "00000042", title: "点我完成", status: "todo", tags: [], reminders: [], entry: "2026-08-20T10:00:00Z", modified: "2026-08-20T10:00:00Z" }));
    const signals = createSignals();
    const app = render(<TuiApp store={store} testSignals={signals.signals} terminalRows={24} />);
    await signals.ready();
    await signals.data();
    const mutation = signals.mutation();
    emitMouse({ kind: "press", button: 0, x: 24, y: 24 }); // d 完成 键帽区间
    const result = await mutation;
    expect(result.kind).toBe("success");
    expect((await store.get("00000042"))?.status).toBe("done");
  });

  it("clicking a task row hits that exact row (mapping regression)", async () => {
    // cards 布局：y=1 顶栏，y=2 组标题，y=3 首个任务。点击首任务行
    // 应直接切换完成（该行默认已选中）；若映射偏移一行则会点到组标题无效果。
    const dir = await mkdtemp(join(tmpdir(), "atd-ink-"));
    const store = new Store(dir);
    await store.save(parseTask({ id: "00000043", title: "点行选中", status: "todo", tags: [], reminders: [], entry: "2026-08-20T10:00:00Z", modified: "2026-08-20T10:00:00Z" }));
    const signals = createSignals();
    const app = render(<TuiApp store={store} testSignals={signals.signals} terminalRows={30} />);
    await signals.ready();
    await signals.data();
    const mutation = signals.mutation();
    emitMouse({ kind: "press", button: 0, x: 20, y: 5 });
    const result = await mutation;
    expect(result.kind).toBe("success");
    expect((await store.get("00000043"))?.status).toBe("done");
  });

  it("shows notes and subtasks in the detail overlay", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-ink-"));
    const store = new Store(dir);
    await store.save(parseTask({ id: "00000051", title: "装修", status: "todo", notes: "预算三万，先找师傅报价", recur: { kind: "weekly", interval: 1 }, tags: [], reminders: [], entry: "2026-08-20T10:00:00Z", modified: "2026-08-20T10:00:00Z" }));
    await store.save(parseTask({ id: "00000052", title: "买瓷砖", status: "todo", parent: "00000051", tags: [], reminders: [], entry: "2026-08-20T10:00:00Z", modified: "2026-08-20T10:00:00Z" }));
    const signals = createSignals();
    const app = render(<TuiApp store={store} testSignals={signals.signals} terminalRows={30} />);
    await signals.ready();
    await signals.data();
    const detailAction = signals.action();
    app.stdin.write("l");
    await detailAction;
    const frame = app.lastFrame() ?? "";
    // notes 之前只存不显示，详情浮层是它唯一露面的地方
    expect(frame).toContain("预算三万，先找师傅报价");
    expect(frame).toContain("每周");
    expect(frame).toContain("买瓷砖");
    const closeAction = signals.action();
    app.stdin.write("\u001b");
    await closeAction;
    expect(app.lastFrame()).toContain("ANOTHER TODO");
  });

  it("asks before deleting and does nothing when the answer is not yes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-ink-"));
    const store = new Store(dir);
    await store.save(parseTask({ id: "00000061", title: "别删我", status: "todo", tags: [], reminders: [], entry: "2026-08-20T10:00:00Z", modified: "2026-08-20T10:00:00Z" }));
    const signals = createSignals();
    const app = render(<TuiApp store={store} testSignals={signals.signals} terminalRows={30} />);
    await signals.ready();
    await signals.data();
    const askAction = signals.action();
    app.stdin.write("x");
    await askAction;
    expect(app.lastFrame()).toContain("请确认");
    expect(app.lastFrame()).toContain("别删我");
    // 按了别的键就等于取消，任务必须还在
    const cancelAction = signals.action();
    app.stdin.write("n");
    await cancelAction;
    expect(await store.get("00000061")).toBeDefined();
    // 再来一次，这次确认
    const askAgain = signals.action();
    app.stdin.write("x");
    await askAgain;
    const mutation = signals.mutation();
    app.stdin.write("y");
    expect((await mutation).kind).toBe("success");
    expect(await store.get("00000061")).toBeUndefined();
  });

  it("marks several tasks with space and completes them in one go", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-ink-"));
    const store = new Store(dir);
    for (const id of ["00000071", "00000072", "00000073"]) {
      await store.save(parseTask({ id, title: `批量${id.slice(-1)}`, status: "todo", tags: [], reminders: [], entry: "2026-08-20T10:00:00Z", modified: "2026-08-20T10:00:00Z" }));
    }
    const signals = createSignals();
    const app = render(<TuiApp store={store} testSignals={signals.signals} terminalRows={30} />);
    await signals.ready();
    await signals.data();
    for (let index = 0; index < 2; index += 1) {
      const markAction = signals.action();
      app.stdin.write(" ");
      await markAction;
    }
    expect(app.lastFrame()).toContain("已选 2");
    const mutation = signals.mutation();
    app.stdin.write("d");
    expect((await mutation).kind).toBe("success");
    const done = (await store.tasks()).filter((item) => item.status === "done");
    expect(done).toHaveLength(2);
    // 没打勾的那条不受影响
    expect((await store.tasks()).filter((item) => item.status === "todo")).toHaveLength(1);
  });

  it("cancels and reopens through the new c and o keys", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-ink-"));
    const store = new Store(dir);
    await store.save(parseTask({ id: "00000081", title: "也许不做", status: "todo", tags: [], reminders: [], entry: "2026-08-20T10:00:00Z", modified: "2026-08-20T10:00:00Z" }));
    const signals = createSignals();
    const app = render(<TuiApp store={store} testSignals={signals.signals} terminalRows={30} />);
    await signals.ready();
    await signals.data();
    const cancelMutation = signals.mutation();
    app.stdin.write("c");
    expect((await cancelMutation).kind).toBe("success");
    expect((await store.get("00000081"))?.status).toBe("cancelled");
    // cancelled 的任务不在默认议程里，用查询把它找回来再重开
    const searchAction = signals.action();
    app.stdin.write(":");
    await searchAction;
    const typeAction = signals.action();
    app.stdin.write("list status:cancelled");
    await typeAction;
    const applied = signals.mutation();
    app.stdin.write("\r");
    await applied;
    const reopenMutation = signals.mutation();
    app.stdin.write("o");
    expect((await reopenMutation).kind).toBe("success");
    expect((await store.get("00000081"))?.status).toBe("todo");
  });

  it("picks follow-up tasks with a, space and Enter", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-ink-"));
    const store = new Store(dir);
    await store.save(parseTask({ id: "00000061", title: "申请身份证", status: "todo", tags: [], reminders: [], entry: "2026-08-20T10:00:00Z", modified: "2026-08-20T10:00:00Z" }));
    await store.save(parseTask({ id: "00000062", title: "领取身份证", status: "todo", tags: [], reminders: [], entry: "2026-08-20T11:00:00Z", modified: "2026-08-20T11:00:00Z" }));
    const signals = createSignals();
    const app = render(<TuiApp store={store} testSignals={signals.signals} terminalRows={30} />);
    await signals.ready();
    await signals.data();
    const open = signals.action();
    app.stdin.write("a");
    await open;
    expect(app.lastFrame()).toContain("领取身份证");
    const toggle = signals.action();
    app.stdin.write(" ");
    await toggle;
    const mutation = signals.mutation();
    app.stdin.write("\r");
    expect((await mutation).kind).toBe("success");
    expect((await store.get("00000062"))?.deps).toEqual(["00000061"]);
  });

  it("cycles project views with Tab", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-ink-"));
    const store = new Store(dir);
    await store.save(parseTask({ id: "00000071", title: "买菜", project: "家", status: "todo", tags: [], reminders: [], entry: "2026-08-20T10:00:00Z", modified: "2026-08-20T10:00:00Z" }));
    await store.save(parseTask({ id: "00000072", title: "写周报", project: "工作", status: "todo", tags: [], reminders: [], entry: "2026-08-20T10:00:00Z", modified: "2026-08-20T10:00:00Z" }));
    const signals = createSignals();
    const app = render(<TuiApp store={store} testSignals={signals.signals} terminalRows={30} />);
    await signals.ready();
    await signals.data();
    expect(app.lastFrame()).toContain("买菜");
    expect(app.lastFrame()).toContain("写周报");
    const tab = signals.action();
    app.stdin.write("\t");
    await tab;
    await new Promise((resolve) => setTimeout(resolve, 30));
    const frame = app.lastFrame() ?? "";
    // 只剩一个项目的任务
    expect(frame.includes("买菜") !== frame.includes("写周报")).toBe(true);
  });

  it("opens the history modal with :history and rolls back the chosen step", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-ink-"));
    const store = new Store(dir);
    const signals = createSignals();
    const app = render(<TuiApp store={store} testSignals={signals.signals} terminalRows={30} />);
    await signals.ready();
    await signals.data();
    for (const title of ["第一件", "第二件"]) {
      const add = signals.action();
      app.stdin.write("i");
      await add;
      const text = signals.action();
      app.stdin.write(title);
      await text;
      const mutation = signals.mutation();
      app.stdin.write("\r");
      await mutation;
    }
    const command = signals.action();
    app.stdin.write(":history");
    await command;
    const mutationOpen = signals.action();
    app.stdin.write("\r");
    await mutationOpen;
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(app.lastFrame()).toContain("第二件");
    const down = signals.action();
    app.stdin.write("j");
    await down;
    const undo = signals.mutation();
    app.stdin.write("\r");
    expect((await undo).kind).toBe("success");
    expect((await store.tasks()).length).toBe(0);
  });
});

describe("focus views with isolated task stores", () => {
  afterEach(() => cleanup());
  const boot = async (store: Store) => {
    const signals = createSignals();
    const app = render(<TuiApp store={store} testSignals={signals.signals} terminalRows={30} />);
    await signals.ready(); await signals.data();
    const press = async (text: string) => { const action = signals.action(); app.stdin.write(text); await action; };
    return { app, signals, press };
  };
  it("shows a focused current task, keeps unscheduled explicit, and restores selection across views", async () => {
    const store = new Store(await mkdtemp(join(tmpdir(), "atd-focus-")));
    await store.save(parseTask({ id: "00000101", title: "学习上下文", status: "doing" }));
    await store.save(parseTask({ id: "00000102", title: "未排期事项", status: "todo" }));
    const { app, press } = await boot(store);
    await press("j"); await press("5");
    expect(app.lastFrame()).toContain("学习上下文");
    expect(app.lastFrame()).toContain("未安排 1 项 · b 展开");
    expect(app.lastFrame()).not.toContain("未排期事项");
    await press("3"); await press("l");
    expect(app.lastFrame()).toContain("未排期事项");
    await press("\x1b"); await press("5"); await press("b");
    expect(app.lastFrame()).toContain("未排期事项");
  });
  it("keeps edit target and draft when view changes, adds in focus, and persists on restart", async () => {
    const store = new Store(await mkdtemp(join(tmpdir(), "atd-focus-")));
    await store.save(parseTask({ id: "00000201", title: "编辑目标", status: "todo" }));
    await store.save(parseTask({ id: "00000202", title: "另一条", status: "doing" }));
    const { app, signals, press } = await boot(store);
    await press("j"); await press("e"); await press("补充"); await press("\x16"); await press("\x16");
    expect(app.lastFrame()).toContain("编辑中"); expect(app.lastFrame()).toContain("补充");
    let mutation = signals.mutation(); app.stdin.write("\n"); expect((await mutation).kind).toBe("success");
    expect((await store.get("00000201"))?.title).toBe("编辑目标补充");
    expect((await store.get("00000202"))?.title).toBe("另一条");
    await expect.poll(async () => (await loadConfig(store.paths.dir)).agenda.view).toBe("hour");
    cleanup(); const restarted = await boot(store);
    expect(restarted.app.lastFrame()).toContain("未安排 1 项 · b 展开");
    await restarted.press("i"); await restarted.press("新建未安排");
    mutation = restarted.signals.mutation(); restarted.app.stdin.write("\n"); expect((await mutation).kind).toBe("success");
    expect(restarted.app.lastFrame()).toContain("未安排 2 项");
    await restarted.press("b"); expect(restarted.app.lastFrame()).toContain("新建未安排");
  });
  it("explains the empty view and maps spaced rows to the correct mouse task", async () => {
    const store = new Store(await mkdtemp(join(tmpdir(), "atd-focus-")));
    await store.save(parseTask({ id: "00000301", title: "第一条", status: "todo" }));
    await store.save(parseTask({ id: "00000302", title: "第二条", status: "todo" }));
    await setConfigValue("ui.line_spacing", "1", store.paths.dir);
    const { app, signals, press } = await boot(store);
    await press("5"); expect(app.lastFrame()).toContain("这个范围暂无已安排事项");
    expect(app.lastFrame()).toContain("未安排 2 项"); await press("b");
    emitMouse({ kind: "press", button: 0, x: 15, y: 6 }); // 空白不选择也不完成
    expect((await store.get("00000301"))?.status).toBe("todo");
    const action = signals.action(); emitMouse({ kind: "press", button: 0, x: 15, y: 7 });
    // 鼠标行选择不发 action signal，等 React 完成渲染再按完成键
    await new Promise((resolve) => setTimeout(resolve, 50));
    const mutation = signals.mutation(); app.stdin.write("d");
    await action;
    expect((await mutation).kind).toBe("success");
    expect((await store.get("00000301"))?.status).toBe("todo");
    expect((await store.get("00000302"))?.status).toBe("done");
  });
});


describe("focus chrome and responsive ASCII", () => {
  afterEach(() => cleanup());
  it("preserves an edit draft when clicking view tabs", async () => {
    const store = new Store(await mkdtemp(join(tmpdir(), "atd-focus-")));
    await store.save(parseTask({ id: "00000401", title: "原任务", status: "todo" }));
    const signals = createSignals();
    const app = render(<TuiApp store={store} testSignals={signals.signals} terminalRows={30} />);
    await signals.ready(); await signals.data();
    let action = signals.action(); app.stdin.write("e"); await action;
    action = signals.action(); app.stdin.write("补充"); await action;
    action = signals.action(); emitMouse({ kind: "press", button: 0, x: 12, y: 2 }); await action;
    expect(app.lastFrame()).toContain("编辑中"); expect(app.lastFrame()).toContain("原任务补充");
    const mutation = signals.mutation(); app.stdin.write("\n"); await mutation;
    expect((await store.get("00000401"))?.title).toBe("原任务补充");
  });
  it.each([30, 18, 14])("keeps focused tasks and footer inside a %i-row terminal with the original ASCII", async (rows) => {
    const store = new Store(await mkdtemp(join(tmpdir(), "atd-focus-")));
    await store.save(parseTask({ id: "00000501", title: "当前学习", status: "doing" }));
    await setConfigValue("ui.banner", "full", store.paths.dir);
    await setConfigValue("agenda.view", "hour", store.paths.dir);
    const signals = createSignals();
    const app = render(<TuiApp store={store} testSignals={signals.signals} terminalRows={rows} />);
    await signals.ready(); await signals.data();
    expect(app.lastFrame()).toContain("当前学习");
    expect(app.lastFrame()).toContain("退出");
    expect((app.lastFrame() ?? "").split("\n").length).toBeLessThanOrEqual(rows);
  });
});


describe("completion feedback in the real TUI", () => {
  afterEach(() => { cleanup(); vi.restoreAllMocks(); });
  const boot = async (store: Store) => {
    const signals = createSignals();
    const app = render(<TuiApp store={store} testSignals={signals.signals} terminalRows={30} />);
    await signals.ready(); await signals.data();
    const press = async (key: string) => { const action = signals.action(); app.stdin.write(key); await action; };
    return { app, signals, press };
  };
  const fixture = async () => {
    const store = new Store(await mkdtemp(join(tmpdir(), "atd-completion-")));
    await store.save(parseTask({ id: "00000601", title: "本次阅读", status: "doing" }));
    await store.save(parseTask({ id: "00000602", title: "下一件", status: "todo" }));
    await store.save(parseTask({ id: "00000603", title: "以前完成", status: "done" }));
    return store;
  };
  it("checks the successful original row, accepts input during feedback, then moves it below active tasks", async () => {
    const store = await fixture(); const { app, signals, press } = await boot(store);
    expect(app.lastFrame()).not.toContain("以前完成");
    const mutation = signals.mutation(); app.stdin.write("d"); await mutation;
    let frame = app.lastFrame() ?? "";
    expect(frame.indexOf("本次阅读")).toBeLessThan(frame.indexOf("下一件"));
    expect(frame).toContain("✓ 本次阅读");
    await press("i"); await press("动画中输入");
    expect(app.lastFrame()).toContain("动画中输入");
    await expect.poll(() => (app.lastFrame() ?? "").indexOf("本次阅读") > (app.lastFrame() ?? "").indexOf("下一件"), { timeout: 2000 }).toBe(true);
    await press("\x1b"); await press("6");
    expect(app.lastFrame()).toContain("以前完成");
    frame = app.lastFrame() ?? "";
    expect(frame.indexOf("已完成 · 6 收起")).toBeGreaterThan(frame.indexOf("下一件"));
  });
  it("guards an in-flight repeat and never reopens on a second completion click", async () => {
    const store = await fixture();
    const complete = ApplicationService.prototype.complete;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const spy = vi.spyOn(ApplicationService.prototype, "complete").mockImplementation(async function(this: ApplicationService, ...args) { await gate; return complete.apply(this, args); });
    const { app, signals, press } = await boot(store);
    const mutation = signals.mutation(); await press("d"); await press("d");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(app.lastFrame()).not.toContain("✓ 本次阅读");
    release(); await mutation;
    await expect.poll(() => (app.lastFrame() ?? "").indexOf("本次阅读") > (app.lastFrame() ?? "").indexOf("下一件")).toBe(true);
    await press("G"); // newest completion is the last selectable row while history is collapsed
    const history = await readFile(store.paths.undo, "utf8");
    await press("d"); await press("\r");
    expect((await store.get("00000601"))?.status).toBe("done");
    expect(await readFile(store.paths.undo, "utf8")).toBe(history);
  });
  it("keeps a failed task in place without success animation", async () => {
    const store = await fixture();
    vi.spyOn(ApplicationService.prototype, "complete").mockRejectedValue(new Error("写入被拒绝"));
    const { app, signals } = await boot(store);
    const mutation = signals.mutation(); app.stdin.write("d"); expect((await mutation).kind).toBe("error");
    expect((await store.get("00000601"))?.status).toBe("doing");
    expect(app.lastFrame()).toContain("写入被拒绝");
    expect(app.lastFrame()).not.toContain("✓ 本次阅读");
  });
  it("undo cancels feedback, and view switches do not leak a ghost into another range", async () => {
    const store = await fixture(); const { app, signals, press } = await boot(store);
    let mutation = signals.mutation(); app.stdin.write("d"); await mutation;
    await press("5");
    expect((app.lastFrame() ?? "").indexOf("✓ 本次阅读")).toBeGreaterThan((app.lastFrame() ?? "").indexOf("已完成 · 6 展开"));
    mutation = signals.mutation(); app.stdin.write("u"); await mutation;
    expect((await store.get("00000601"))?.status).toBe("doing");
    expect(app.lastFrame()).toContain("本次阅读"); expect(app.lastFrame()).not.toContain("✓ 本次阅读");
    await press("3"); expect(app.lastFrame()).not.toContain("✓ 本次阅读");
  });
  it("observes an external completion once, leaves old history collapsed, and does not replay on restart", async () => {
    const store = await fixture(); const { app, signals, press } = await boot(store);
    await new ApplicationService(new Store(store.paths.dir)).complete("00000601");
    // The file watcher drives this; no UI mutation or explicit refresh is sent.
    await expect.poll(() => app.lastFrame(), { timeout: 3500, interval: 50 }).toContain("✓ 本次阅读");
    expect(app.lastFrame()).not.toContain("以前完成");
    await expect.poll(() => (app.lastFrame() ?? "").indexOf("本次阅读") > (app.lastFrame() ?? "").indexOf("下一件")).toBe(true);
    const mutation = signals.mutation(); app.stdin.write("r"); await mutation;
    expect((app.lastFrame() ?? "").indexOf("本次阅读")).toBeGreaterThan((app.lastFrame() ?? "").indexOf("下一件"));
    await press("6"); expect(app.lastFrame()).toContain("以前完成");
    cleanup(); const restarted = await boot(store);
    expect(restarted.app.lastFrame()).not.toContain("本次阅读");
    expect(restarted.app.lastFrame()).toContain("已完成 · 6 展开");
    await restarted.press("6"); expect(restarted.app.lastFrame()).toContain("本次阅读");
  });
  it("animates only successful items in a partially failed batch", async () => {
    const store = await fixture();
    const complete = ApplicationService.prototype.complete;
    vi.spyOn(ApplicationService.prototype, "complete").mockImplementation(async function(this: ApplicationService, id, ...rest) {
      if (id === "00000602") throw new Error("第二项拒绝");
      return complete.call(this, id, ...rest);
    });
    const { app, signals, press } = await boot(store);
    await press(" "); await press(" ");
    const mutation = signals.mutation(); app.stdin.write("d"); await mutation;
    expect((await store.get("00000601"))?.status).toBe("done");
    expect((await store.get("00000602"))?.status).toBe("todo");
    expect(app.lastFrame()).toContain("✓ 本次阅读");
    expect(app.lastFrame()).not.toContain("✓ 下一件");
    expect(app.lastFrame()).toContain("1 条没成功");
  });
  it("uses the completed section immediately with animations disabled and supports table/query filtering", async () => {
    const store = await fixture();
    await setConfigValue("ui.animations", "false", store.paths.dir);
    await setConfigValue("ui.layout", "table", store.paths.dir);
    const { app, signals, press } = await boot(store);
    const mutation = signals.mutation(); app.stdin.write("d"); await mutation;
    expect((app.lastFrame() ?? "").indexOf("本次阅读")).toBeGreaterThan((app.lastFrame() ?? "").indexOf("已完成 · 6 展开"));
    await press("/"); await press("下一件"); await press("\r");
    expect(app.lastFrame()).not.toContain("✓ 本次阅读");
    expect(app.lastFrame()).not.toContain("以前完成");
    await press("6"); expect(app.lastFrame()).not.toContain("以前完成");
  });
  it("ignores clicks on the temporary row and maps clicks after it to the live task", async () => {
    const store = await fixture(); await setConfigValue("ui.line_spacing", "1", store.paths.dir);
    const { app, signals } = await boot(store);
    const mutation = signals.mutation(); app.stdin.write("d"); await mutation;
    emitMouse({ kind: "press", button: 0, x: 15, y: 5 }); // checked temporary row
    expect((await store.get("00000601"))?.status).toBe("done");
    expect((await store.get("00000602"))?.status).toBe("todo");
    await expect.poll(() => (app.lastFrame() ?? "").indexOf("本次阅读") > (app.lastFrame() ?? "").indexOf("下一件")).toBe(true);
    // bottom heading is now row 7 (group heading / row / gap / completed heading)
    emitMouse({ kind: "press", button: 0, x: 15, y: 7 });
    await expect.poll(() => app.lastFrame()).toContain("以前完成");
  });
});
