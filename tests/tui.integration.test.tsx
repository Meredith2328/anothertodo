import React from "react";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { render, cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it } from "vitest";

import { parseTask } from "../src/core/task.js";
import { Store } from "../src/storage/store.js";
import { TuiApp, type TuiTestSignals } from "../src/tui/app.js";

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
});
