import React from "react";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { render, cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";

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
    expect(app.lastFrame()).toContain("标签 / 提醒");
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
    const app = render(<TuiApp store={store} testSignals={signals.signals} terminalRows={40} />);
    await signals.ready();
    await signals.data();
    const helpAction = signals.action();
    app.stdin.write("?");
    await helpAction;
    const frame = app.lastFrame() ?? "";
    expect(frame).toContain("清单区（默认焦点，光标在任务列表）");
    expect(frame.split("\n").length).toBeLessThanOrEqual(40);
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
    for (const label of ["帮助", "输入", "完成", "退出"]) expect(last).toContain(label);
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
    // 布局（rows=30，宽横幅）：y=9 组标题，y=10 首个任务。点击首任务行
    // 应直接切换完成（该行默认已选中）；若映射偏移一行则会点到组标题无效果。
    const dir = await mkdtemp(join(tmpdir(), "atd-ink-"));
    const store = new Store(dir);
    await store.save(parseTask({ id: "00000043", title: "点行选中", status: "todo", tags: [], reminders: [], entry: "2026-08-20T10:00:00Z", modified: "2026-08-20T10:00:00Z" }));
    const signals = createSignals();
    const app = render(<TuiApp store={store} testSignals={signals.signals} terminalRows={30} />);
    await signals.ready();
    await signals.data();
    const mutation = signals.mutation();
    emitMouse({ kind: "press", button: 0, x: 20, y: 10 });
    const result = await mutation;
    expect(result.kind).toBe("success");
    expect((await store.get("00000043"))?.status).toBe("done");
  });
});
