import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Box, Text, useApp, useInput, useStdout } from "ink";

import { ApplicationService } from "../app/service.js";
import { groups, nestTasks, type GroupKey } from "../core/agenda.js";
import { blockedIds, dependencyGraph } from "../core/deps.js";
import { setConfigValue } from "../core/config.js";
import type { Config, Task } from "../contracts.js";
import { scanDate } from "../core/parse.js";
import { localNow } from "../core/task.js";
import { taskToInput } from "../core/task-ops.js";
import { Store } from "../storage/store.js";
import { initialTuiState, tuiReducer, type TuiState } from "./state.js";
import type { KeyEvent } from "./keymap.js";
import { mapKey } from "./keymap.js";
import { setMouseTracking, subscribeMouse, type MouseEvent } from "./mouse.js";
import {
  GroupSeparator, TableHeader, TaskRow, tableColumns,
} from "./rows.js";
import { Banner, BannerInfo, FooterBar, InputBar, PreviewLine, bannerLines, footerHeight, footerKeyRanges, setTightLayout, type FooterButton } from "./chrome.js";
import { ConfirmModal, DetailModal, GraphModal, HelpModal, ModalShell, SettingsModal, WelcomeModal, modalPad } from "./modals.js";
import { cycleSetting, settingItems, type SettingItem } from "./settings.js";
import { C, DATE_FORMAT_LABEL, SKIN } from "./theme.js";
import { listSkins, resolveSkin, loadSkin } from "./skins.js";

// 鼠标点击 Footer 需要列区间；测试也直接引它，保持从 app 导出
export { footerKeyRanges };

export type TuiTestSignals = {
  onReady?: () => void;
  onDataReady?: () => void;
  onActionComplete?: (sequence: number) => void;
  onMutationComplete?: (state: { kind: "success" | "error"; id: string; message?: string }) => void;
};
export type TuiProps = {
  store: Store;
  testSignals?: TuiTestSignals;
  welcome?: boolean;
  /** 测试注入的终端行数（真实环境读 stdout.rows） */
  terminalRows?: number;
};
const nowLocal = localNow;
const flatten = (items: ReturnType<typeof groups>): Task[] => items.flatMap((group) => group.tasks);
const completeInput = (input: string, tasks: Task[]): string => {
  const tag = input.match(/#([^\s#]*)$/u);
  if (tag) {
    const prefix = tag[1] ?? "";
    const candidate = [...new Set(tasks.flatMap((task) => task.tags))].find((value) => value.startsWith(prefix));
    if (candidate) return `${input.slice(0, tag.index)}#${candidate} `;
  }
  const project = input.match(/(?:proj|project):([^\s:]*)$/u);
  if (project) {
    const prefix = project[1] ?? "";
    const candidate = [...new Set(tasks.map((task) => task.project).filter((value): value is string => Boolean(value)))].find((value) => value.startsWith(prefix));
    if (candidate) return `${input.slice(0, project.index)}proj:${candidate} `;
  }
  return input;
};

// ---------------------------------------------------------------- 主组件
type TableLine = { kind: "sep"; groupKey: GroupKey; name: string; count: number } | { kind: "task"; task: Task; depth: number; index: number };

/** 完成任务并把「派生了下一次」「还有子任务没做」这两件事说清楚，别让用户自己去发现 */
const completeAndDescribe = async (service: ApplicationService, id: string): Promise<string> => {
  const result = await service.complete(id);
  const extras: string[] = [];
  if (result.next) extras.push(`下一次 ${result.next.due ? result.next.due.slice(0, 10) : "无日期"}`);
  if (result.openChildren.length) extras.push(`还有 ${result.openChildren.length} 个子任务没完成`);
  if (result.unblocked.length) extras.push(`解锁 ${result.unblocked.map((next) => next.title).join("、")}`);
  return `✓ 完成：${result.task.title}${extras.length ? `（${extras.join("，")}）` : ""}`;
};

/** 批量跑同一个操作，逐条收集失败，最后汇总成一句话 */
const runBatch = async (ids: string[], label: string, run: (id: string) => Promise<string | void>): Promise<string> => {
  if (ids.length === 1) { const single = await run(ids[0]!); return typeof single === "string" ? single : `${label} 1 条`; }
  const failures: string[] = [];
  let done = 0;
  for (const id of ids) {
    try { await run(id); done += 1; }
    catch (error) { failures.push(error instanceof Error ? error.message : String(error)); }
  }
  return `${label} ${done} 条${failures.length ? `，${failures.length} 条没成功：${failures[0]!}` : ""}`;
};

/** n / p 这类分组键：不在这个分组就放进去，已经在了就退回待办 */
const toggleStatus = async (service: ApplicationService, task: Task | undefined, id: string, status: "doing" | "paused", label: string): Promise<string> => {
  const current = task?.id === id ? task : (await service.tasks()).find((item) => item.id === id);
  const next = current?.status === status ? "todo" : status;
  const saved = await service.setStatus(id, next);
  return next === "todo" ? `↺ 退回待办：${saved.title}` : `${label}：${saved.title}`;
};

/** 打了勾就对勾选的那些干活，没打勾就对光标所在这条干活 */
const targetIds = (state: TuiState, selected: Task): string[] => state.marked.length ? [...state.marked] : [selected.id];

// 完成动画：删除线分几帧从左划到右，划完再真正完成（任务随后离开列表）
const STRIKE_FRAMES = 8;
const STRIKE_FRAME_MS = 55;
// 表格上方的固定行：信息行 1 + 表格上边框 1 + 表头 1；下方：表格下边框 1 + 预览行 1 + 输入框 2 + Footer
const tableChrome = (columns: number | undefined, rows: number | undefined): number => bannerLines(columns, rows).length + 3 + 4 + footerHeight();

export const TuiApp = ({ store, testSignals, welcome = false, terminalRows }: TuiProps): React.ReactElement => {
  const { exit } = useApp();
  const { stdout } = useStdout();
  // 窗口尺寸放进 state：Ink 自己收到 resize 只会拿旧的 props 重排一次，
  // 组件不重新渲染的话列宽还是旧的，缩小后折行、放大后也回不来
  const readSize = useCallback(() => ({
    columns: typeof stdout?.columns === "number" && stdout.columns > 0 ? stdout.columns : undefined,
    rows: typeof stdout?.rows === "number" && stdout.rows > 0 ? stdout.rows : terminalRows,
  }), [stdout, terminalRows]);
  const [size, setSize] = useState(readSize);
  useEffect(() => {
    if (!stdout) return;
    const onResize = (): void => {
      // 先整屏清掉再按新尺寸重画：否则旧尺寸下的残行会留在屏幕上
      if (stdout.isTTY) stdout.write("\x1b[2J\x1b[H");
      setSize(readSize());
    };
    stdout.on("resize", onResize);
    return () => { stdout.off("resize", onResize); };
  }, [readSize, stdout]);
  const { columns, rows } = size;
  setTightLayout(rows !== undefined && rows < 16);
  const service = useMemo(() => new ApplicationService(store), [store]);
  const [config, setConfig] = useState<Config>();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dataRevision, setDataRevision] = useState(0);
  const [state, dispatch] = useReducer(tuiReducer, undefined, () => initialTuiState());
  const [clock, setClock] = useState(() => new Date());
  const [actionSequence, setActionSequence] = useState(0);
  const [graphOffset, setGraphOffset] = useState(0);
  const [pressedButton, setPressedButton] = useState<FooterButton>();
  const [settingIndex, setSettingIndex] = useState(0);
  const [skinChoices, setSkinChoices] = useState<Array<{ name: string; description: string }>>([]);
  const settings = useMemo(() => settingItems(skinChoices), [skinChoices]);
  const [strike, setStrike] = useState<{ ids: string[]; frame: number }>();
  useEffect(() => {
    if (pressedButton === undefined) return;
    const timer = setTimeout(() => setPressedButton(undefined), 180);
    return () => clearTimeout(timer);
  }, [pressedButton]);
  const blocked = useMemo(() => blockedIds(tasks), [tasks]);
  const graphLines = useMemo(() => dependencyGraph(tasks), [tasks]);
  // 每组内部按父子相邻重排后再摊平：显示顺序和选中索引必须用同一份顺序，
  // 否则按 j/k 选中的行和高亮的行会错开
  const visibleGroups = useMemo(() => config
    ? groups(tasks, config, state.sortMode, nowLocal(), state.query)
      .filter((group) => group.tasks.length > 0)
      .map((group) => ({ ...group, nested: nestTasks(group.tasks), tasks: nestTasks(group.tasks).map((item) => item.task) }))
    : [], [config, state.query, state.sortMode, tasks]);
  const visible = useMemo(() => flatten(visibleGroups), [visibleGroups]);
  const selected = visible[state.selectedIndex];
  // 详情浮层的数据在早返回之前算好：hooks 数量必须每帧一致，
  // 否则 React 会抛 "Rendered fewer hooks"（表现为闪退）
  const detailId = state.mode.kind === "detail" ? state.mode.taskId : undefined;
  const detailTask = detailId === undefined ? undefined : (selected ?? tasks.find((task) => task.id === detailId));
  const detailChildren = useMemo(() => detailTask ? tasks.filter((task) => task.parent === detailTask.id) : [], [detailTask, tasks]);
  const detailParent = detailTask?.parent === undefined ? undefined : tasks.find((task) => task.id === detailTask.parent);
  const detailDeps = useMemo(() => detailTask ? tasks.filter((task) => detailTask.deps?.includes(task.id)) : [], [detailTask, tasks]);
  const detailDependents = useMemo(() => detailTask ? tasks.filter((task) => task.deps?.includes(detailTask.id)) : [], [detailTask, tasks]);
  const stateRef = useRef(state);
  const configRef = useRef(config);
  const selectedRef = useRef(selected);
  const configInitRef = useRef(false);
  stateRef.current = state;
  configRef.current = config;
  selectedRef.current = selected;

  // 皮肤颜色存在模块级的可变对象里，换皮肤时靠这个 state 触发重绘
  const [, setSkinName] = useState<string>();
  const refresh = useCallback(async () => {
    const nextConfig = await service.config();
    // 皮肤跟着配置走：手改 config.toml 或皮肤文件后按 r 刷新就能看到
    const skinError = await loadSkin(nextConfig.ui.skin, store.paths.dir);
    if (skinError) dispatch({ type: "flash", message: `${skinError}；先用 classic` });
    setSkinName(SKIN.name);
    setSkinChoices(await listSkins(store.paths.dir));
    const nextTasks = await service.tasks();
    setConfig(nextConfig);
    setTasks(nextTasks);
    setDataRevision((revision) => revision + 1);
  }, [service, store]);
  useEffect(() => { void refresh().catch((error: unknown) => dispatch({ type: "flash", message: error instanceof Error ? error.message : String(error) })); }, [refresh]);
  useEffect(() => { const timer = setInterval(() => { void refresh().catch(() => {}); }, 30_000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => { const timer = setInterval(() => setClock(new Date()), 10_000); return () => clearInterval(timer); }, []);
  // 首次拿到配置后同步排序模式与日期列格式
  useEffect(() => {
    if (!config || configInitRef.current) return;
    configInitRef.current = true;
    dispatch({ type: "sort", mode: config.priority.mode });
    dispatch({ type: "dateFormat", format: config.agenda.date_format });
  }, [config]);
  useEffect(() => { if (config) setMouseTracking(config.ui.mouse); }, [config]);
  // 首次运行弹上手引导（按任意键关闭，之后不再弹）；测试默认跳过
  useEffect(() => {
    if (!welcome) return;
    const flag = join(store.paths.dir, ".welcome_shown");
    if (!existsSync(flag)) {
      dispatch({ type: "mode", mode: { kind: "welcome" } });
      void writeFile(flag, "1", "utf8").catch(() => {});
    }
  }, [welcome, store]);
  useEffect(() => { testSignals?.onReady?.(); }, [testSignals]);
  useEffect(() => { if (dataRevision > 0) testSignals?.onDataReady?.(); }, [dataRevision, testSignals]);
  useEffect(() => { if (actionSequence > 0) testSignals?.onActionComplete?.(actionSequence); }, [actionSequence, testSignals]);
  useEffect(() => { if (state.mutation.kind === "success" || state.mutation.kind === "error") testSignals?.onMutationComplete?.(state.mutation); }, [state.mutation, testSignals]);
  useEffect(() => { if (visible.length > 0 && state.selectedIndex >= visible.length) dispatch({ type: "select", index: visible.length - 1 }); }, [state.selectedIndex, visible.length]);

  const submit = useCallback(async () => {
    const currentState = stateRef.current;
    const currentConfig = configRef.current;
    const currentSelected = selectedRef.current;
    if (!currentConfig) return;
    if (!currentState.input.trim() && currentState.mode.kind !== "command") {
      // 空输入回车：回到清单区，不添加
      dispatch({ type: "mode", mode: { kind: "list" } });
      return;
    }
    const mutationId = randomUUID();
    dispatch({ type: "mutationStart", id: mutationId });
    try {
      if (currentState.mode.kind === "add") {
        const task = await service.add(currentState.input, nowLocal());
        dispatch({ type: "flash", message: `已添加：${task.title}` });
      } else if (currentState.mode.kind === "edit" && currentSelected) {
        const task = await service.edit(currentSelected.id, currentState.input, nowLocal());
        dispatch({ type: "flash", message: `已更新：${task.title}` });
      } else if (currentState.mode.kind === "search") {
        const query = currentState.input.replace(/^\//u, "");
        dispatch({ type: "query", value: query });
        dispatch({ type: "flash", message: `过滤：${query}（: 清除）` });
      } else if (currentState.mode.kind === "command") {
        const command = currentState.input.replace(/^:/u, "").trim();
        const ids = currentState.marked.length ? [...currentState.marked] : currentSelected ? [currentSelected.id] : [];
        const [verb, ...rest] = command.split(/\s+/u);
        if (command === "undo") dispatch({ type: "flash", message: await service.undo() });
        else if (command === "redo") dispatch({ type: "flash", message: await service.redo() });
        else if (command === "skin") dispatch({ type: "flash", message: `当前皮肤 ${SKIN.name}；可选：${(await listSkins(store.paths.dir)).map((skin) => skin.name).join(" / ")}` });
        else if (verb === "skin") {
          const name = rest.join(" ");
          await resolveSkin(name, store.paths.dir);
          await setConfigValue("ui.skin", name, store.paths.dir);
          dispatch({ type: "flash", message: `已换成皮肤 ${name}` });
        }
        else if (command === "settings" || command === "set") { dispatch({ type: "mode", mode: { kind: "settings" } }); await refresh(); dispatch({ type: "mutationSuccess", id: mutationId }); return; }
        else if (command === "graph") { setGraphOffset(0); dispatch({ type: "mode", mode: { kind: "graph" } }); await refresh(); dispatch({ type: "mutationSuccess", id: mutationId }); return; }
        else if (command === "sync") dispatch({ type: "flash", message: await service.sync() });
        else if (command === "mode urgency") { dispatch({ type: "sort", mode: "urgency" }); dispatch({ type: "flash", message: "排序模式：urgency" }); }
        else if (command === "mode levels") { dispatch({ type: "sort", mode: "levels" }); dispatch({ type: "flash", message: "排序模式：档位" }); }
        else if (command === "list") { dispatch({ type: "query", value: "" }); dispatch({ type: "flash", message: "已清除过滤" }); }
        else if (command.startsWith("list ")) { dispatch({ type: "query", value: command.slice(5) }); dispatch({ type: "flash", message: `过滤：${command.slice(5)}` }); }
        else if (command.startsWith("archive")) { const days = command.split(/\s+/u)[1]; dispatch({ type: "flash", message: `归档了 ${await service.archive(days ? Number(days) : 14)} 行` }); }
        else if (verb === "cancel" || verb === "meeting" || verb === "todo" || verb === "doing" || verb === "pause") {
          if (!ids.length) dispatch({ type: "flash", message: "先选中一条任务" });
          else {
            const status = verb === "cancel" ? "cancelled" : verb === "pause" ? "paused" : verb;
            dispatch({ type: "flash", message: await runBatch(ids, `已设为 ${status}`, async (id) => { await service.setStatus(id, status); }) });
            dispatch({ type: "setMarks", ids: [] });
          }
        } else if (verb === "wait") {
          const spec = rest.join(" ");
          if (!ids.length) dispatch({ type: "flash", message: "先选中一条任务" });
          else if (!spec) dispatch({ type: "flash", message: await runBatch(ids, "已设为等待", async (id) => { await service.deferUntilTomorrow(id); }) });
          else {
            const scanned = scanDate(spec, nowLocal().slice(0, 10));
            if (!scanned) dispatch({ type: "flash", message: `看不懂这个日期：${spec}` });
            else { dispatch({ type: "flash", message: await runBatch(ids, `已等到 ${scanned.date}`, async (id) => { await service.deferUntil(id, scanned.date); }) }); dispatch({ type: "setMarks", ids: [] }); }
          }
        } else if (verb === "snooze") {
          const minutes = Number(rest[0] ?? 10);
          if (!ids.length) dispatch({ type: "flash", message: "先选中一条任务" });
          else if (!Number.isFinite(minutes) || minutes <= 0) dispatch({ type: "flash", message: "用法：:snooze 30" });
          else { dispatch({ type: "flash", message: await runBatch(ids, `提醒推迟 ${minutes} 分钟`, async (id) => { await service.snooze(id, minutes); }) }); dispatch({ type: "setMarks", ids: [] }); }
        }
        else if (command === "quit") { exit(); return; }
        else if (command) dispatch({ type: "flash", message: `未知命令：${command}` });
      }
      dispatch({ type: "mode", mode: { kind: "list" } });
      dispatch({ type: "input", value: "" });
      await refresh();
      dispatch({ type: "mutationSuccess", id: mutationId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dispatch({ type: "mutationError", id: mutationId, message });
    }
  }, [exit, refresh, service]);

  const runMutation = useCallback((operation: () => Promise<unknown>): void => {
    const mutationId = randomUUID();
    dispatch({ type: "mutationStart", id: mutationId });
    void (async () => {
      try {
        const result = await operation();
        if (typeof result === "string") dispatch({ type: "flash", message: result });
        await refresh();
        dispatch({ type: "mutationSuccess", id: mutationId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        dispatch({ type: "mutationError", id: mutationId, message });
      }
    })();
  }, [refresh]);

  // 完成动画：先让删除线划过标题，最后一帧停住，再真正完成；任务列表刷新后动画自然结束
  const completeIds = useCallback((ids: string[]): void => {
    const run = (): void => runMutation(() => runBatch(ids, "✓ 已完成", (id) => completeAndDescribe(service, id)));
    if (configRef.current?.ui.animations === false) { run(); return; }
    let frame = 0;
    setStrike({ ids, frame });
    const timer = setInterval(() => {
      frame += 1;
      setStrike({ ids, frame });
      if (frame >= STRIKE_FRAMES) { clearInterval(timer); run(); }
    }, STRIKE_FRAME_MS);
  }, [runMutation, service]);
  useEffect(() => { setStrike(undefined); }, [tasks]);
  useEffect(() => { if (state.mutation.kind === "error") setStrike(undefined); }, [state.mutation]);

  // 设置页改一项：写回 config.toml，再刷新让皮肤 / 鼠标 / 排序等立即生效
  const applySetting = useCallback((item: SettingItem, delta: number): void => {
    const current = configRef.current;
    if (!current) return;
    const value = cycleSetting(item, current, delta);
    runMutation(async () => {
      await setConfigValue(item.key, value, store.paths.dir);
      if (item.key === "priority.mode") dispatch({ type: "sort", mode: value as "levels" | "urgency" });
      if (item.key === "agenda.date_format") dispatch({ type: "dateFormat", format: value as "auto" | "md" | "full" });
      return `${item.label}：${item.options.find((option) => option.value === value)?.label ?? value}`;
    });
  }, [runMutation, store]);

  useInput((input, key) => {
    const currentState = stateRef.current;
    const currentSelected = selectedRef.current;
    // 帮助 / 欢迎弹窗：任意键关闭
    if (currentState.mode.kind === "help" || currentState.mode.kind === "welcome") {
      if (input !== "" || key.return || key.escape || key.tab || key.backspace || key.delete || key.upArrow || key.downArrow) {
        setActionSequence((sequence) => sequence + 1);
        dispatch({ type: "mode", mode: { kind: "list" } });
      }
      return;
    }
    handleKeyboard(currentState, currentSelected, input, key);
  });

  // ------------------------------------------------ 键盘动作分发（鼠标点击 Footer 复用）
  const handleKeyboard = useCallback((currentState: TuiState, currentSelected: Task | undefined, input: string, key: KeyEvent["key"]): void => {
    const action = mapKey(currentState.mode, { input, key });
    if (!action) return;
    setActionSequence((sequence) => sequence + 1);
    if (action.type === "quit") { exit(); return; }
    if (action.type === "text") {
      // 在光标处插入；type-to-add：清单区首字符直接进输入态
      const chars = [...currentState.mode.kind === "list" ? "" : currentState.input];
      chars.splice(currentState.inputCursor, 0, action.value);
      if (currentState.mode.kind === "list") dispatch({ type: "mode", mode: { kind: "add" } });
      dispatch({ type: "input", value: chars.join(""), cursor: currentState.mode.kind === "list" ? [...action.value].length : currentState.inputCursor + [...action.value].length });
      return;
    }
    if (action.type === "backspace") {
      // 光标前删除；光标在末尾时等价普通退格
      const chars = [...currentState.input];
      if (currentState.inputCursor > 0 && currentState.inputCursor <= chars.length) {
        chars.splice(currentState.inputCursor - 1, 1);
        dispatch({ type: "input", value: chars.join(""), cursor: currentState.inputCursor - 1 });
      }
      return;
    }
    if (action.type === "cursorLeft") { dispatch({ type: "cursorMove", delta: -1 }); return; }
    if (action.type === "cursorRight") { dispatch({ type: "cursorMove", delta: 1 }); return; }
    if (action.type === "complete") { dispatch({ type: "input", value: completeInput(currentState.input, tasks) }); return; }
    if (action.type === "submit") { void submit(); return; }
    if (action.type === "escape") {
      if (currentState.mode.kind === "list") {
        // Esc 先清多选，再当退出的第一下；免得刚勾了一堆就被问退出
        if (currentState.marked.length) { dispatch({ type: "setMarks", ids: [] }); dispatch({ type: "flash", message: "已取消多选" }); return; }
        if (currentState.exitArmedAt && Date.now() - currentState.exitArmedAt < 1000) { exit(); return; }
        dispatch({ type: "armExit", at: Date.now() });
      } else {
        if (currentState.mode.kind === "edit") dispatch({ type: "flash", message: "取消编辑" });
        dispatch({ type: "mode", mode: { kind: "list" } });
        dispatch({ type: "input", value: "" });
      }
      return;
    }
    if (action.type === "confirmYes") {
      if (currentState.mode.kind !== "confirm") return;
      const ids = currentState.marked.length ? [...currentState.marked] : currentSelected ? [currentSelected.id] : [];
      dispatch({ type: "mode", mode: { kind: "list" } });
      dispatch({ type: "setMarks", ids: [] });
      if (!ids.length) return;
      runMutation(() => runBatch(ids, "已删除", async (id) => { await service.remove(id); }));
      return;
    }
    if (action.type === "move" && currentState.mode.kind === "settings") { setSettingIndex((index) => (index + action.delta + settings.length) % settings.length); return; }
    if (action.type === "move" && currentState.mode.kind === "graph") { setGraphOffset((offset) => Math.max(0, Math.min(graphLines.length - 1, offset + action.delta))); return; }
    if (action.type === "move") { dispatch({ type: "select", index: currentState.selectedIndex + action.delta }); return; }
    if (action.type === "page") {
      // 一页按可见任务行数算，翻不动就贴到首尾
      const page = Math.max(1, (rows ?? 24) - tableChrome(columns, rows) - 1);
      const next = Math.max(0, Math.min(visible.length - 1, currentState.selectedIndex + action.delta * page));
      dispatch({ type: "select", index: next });
      return;
    }
    if (action.type === "first") { dispatch({ type: "select", index: 0 }); return; }
    if (action.type === "last") { dispatch({ type: "select", index: Math.max(0, visible.length - 1) }); return; }
    if (action.type === "command") { dispatch({ type: "mode", mode: { kind: "command" } }); dispatch({ type: "input", value: action.value }); return; }
    if (action.type === "shortcut") {
      if (action.name === "search") { dispatch({ type: "mode", mode: { kind: "search" } }); dispatch({ type: "input", value: "/" }); return; }
      if (action.name === "help") { dispatch({ type: "mode", mode: { kind: "help" } }); return; }
      if (action.name === "1") { dispatch({ type: "sort", mode: "levels" }); dispatch({ type: "flash", message: "档位排序" }); return; }
      if (action.name === "2") { dispatch({ type: "sort", mode: "urgency" }); dispatch({ type: "flash", message: "urgency 排序" }); return; }
      if (action.name === "r") { runMutation(async () => { await refresh(); return "已刷新"; }); return; }
      if (action.name === "t") {
        const order: Array<"auto" | "md" | "full"> = ["auto", "md", "full"];
        const next = order[(order.indexOf(currentState.dateFormat) + 1) % order.length] ?? "auto";
        dispatch({ type: "dateFormat", format: next });
        dispatch({ type: "flash", message: `日期列：${DATE_FORMAT_LABEL[next]}` });
        void setConfigValue("agenda.date_format", next, store.paths.dir).catch(() => {});
        return;
      }
      if (action.name === "undo") { runMutation(() => service.undo()); return; }
      if (action.name === "redo" || action.name === "U") { runMutation(() => service.redo()); return; }
      if (action.name === "D") { setGraphOffset(0); dispatch({ type: "mode", mode: { kind: "graph" } }); return; }
      if (action.name === ",") { dispatch({ type: "mode", mode: { kind: "settings" } }); return; }
      if (action.name === "settingPrev" || action.name === "settingNext") {
        const item = settings[settingIndex];
        if (item) applySetting(item, action.name === "settingNext" ? 1 : -1);
        return;
      }
      if (action.name === "a" && currentSelected) {
        // 后续任务先写好放着，前置做完才露出来；目标分组可以用 in:等待 这类写法指定
        dispatch({ type: "mode", mode: { kind: "add" } });
        dispatch({ type: "input", value: `after:${currentSelected.id} ` });
        dispatch({ type: "flash", message: `给「${currentSelected.title}」加后续任务` });
        return;
      }
      if ((action.name === "n" || action.name === "p") && currentSelected) {
        const ids = targetIds(currentState, currentSelected);
        const status = action.name === "n" ? "doing" : "paused";
        const label = action.name === "n" ? "▸ 在做" : "‖ 暂停";
        runMutation(() => runBatch(ids, label, (id) => toggleStatus(service, currentSelected, id, status, label)));
        dispatch({ type: "setMarks", ids: [] });
        return;
      }
      if (action.name === "sync") { runMutation(() => service.sync()); return; }
      if (action.name === "i") { dispatch({ type: "mode", mode: { kind: "add" } }); return; }
      if (action.name === "e" && currentSelected) { dispatch({ type: "mode", mode: { kind: "edit", taskId: currentSelected.id } }); dispatch({ type: "input", value: taskToInput(currentSelected) }); return; }
      if (action.name === "d" && currentSelected) {
        const ids = targetIds(currentState, currentSelected);
        completeIds(ids);
        dispatch({ type: "setMarks", ids: [] });
        return;
      }
      if (action.name === "w" && currentSelected) {
        const ids = targetIds(currentState, currentSelected);
        runMutation(() => runBatch(ids, "已设为等待", async (id) => `等待至 ${(await service.deferUntilTomorrow(id)).wait ?? ""}`));
        dispatch({ type: "setMarks", ids: [] });
        return;
      }
      if (action.name === "x" && currentSelected) {
        // 删除是唯一没法恢复原样的破坏性操作，问一句再动手
        const ids = targetIds(currentState, currentSelected);
        const prompt = ids.length === 1
          ? `删除「${currentSelected.title}」？只想留个记录的话按 c 取消任务更合适。`
          : `删除选中的 ${ids.length} 条任务？`;
        dispatch({ type: "mode", mode: { kind: "confirm", prompt, pending: "delete" } });
        return;
      }
      if (action.name === "u") { runMutation(() => service.undo()); return; }
      if (action.name === "mark" && currentSelected) {
        dispatch({ type: "toggleMark", id: currentSelected.id });
        dispatch({ type: "select", index: currentState.selectedIndex + 1 });
        return;
      }
      if (action.name === "markAll") {
        const all = visible.map((task) => task.id);
        const clearing = currentState.marked.length >= all.length && all.every((id) => currentState.marked.includes(id));
        dispatch({ type: "setMarks", ids: clearing ? [] : all });
        dispatch({ type: "flash", message: clearing ? "已取消全选" : `已选中 ${all.length} 条` });
        return;
      }
      if (action.name === "v" && currentSelected) { dispatch({ type: "mode", mode: { kind: "detail", taskId: currentSelected.id } }); return; }
      if (action.name === "s" && currentSelected) {
        const ids = targetIds(currentState, currentSelected);
        runMutation(() => runBatch(ids, "已推迟提醒", async (id) => { await service.snooze(id, 10); }));
        dispatch({ type: "setMarks", ids: [] });
        return;
      }
      if (action.name === "o") {
        if (!currentSelected) return;
        const ids = targetIds(currentState, currentSelected);
        runMutation(() => runBatch(ids, "↺ 已重新打开", async (id) => `↺ 重新打开：${(await service.reopen(id)).title}`));
        dispatch({ type: "setMarks", ids: [] });
        return;
      }
      if (action.name === "c") {
        if (!currentSelected) return;
        const ids = targetIds(currentState, currentSelected);
        runMutation(() => runBatch(ids, "✗ 已取消", async (id) => `✗ 已取消：${(await service.setStatus(id, "cancelled")).title}`));
        dispatch({ type: "setMarks", ids: [] });
        return;
      }
      if (action.name === "enter" && currentSelected) {
        const task = currentSelected;
        if (task.status === "done") {
          runMutation(async () => `↺ 重新打开：${(await service.reopen(task.id)).title}`);
          return;
        }
        completeIds([task.id]);
      }
    }
  }, [applySetting, columns, completeIds, dispatch, exit, graphLines.length, refresh, rows, runMutation, service, settingIndex, settings, store, tasks, visible]);

  const today = nowLocal().slice(0, 10);
  const levels = config ? [...config.priority.levels] : ["低", "中", "高"];
  const cols = tableColumns(columns);
  const lines: TableLine[] = [];
  let taskIndex = 0;
  for (const group of visibleGroups) {
    lines.push({ kind: "sep", groupKey: group.key, name: group.name, count: group.tasks.length });
    for (const { task, depth } of group.nested) lines.push({ kind: "task", task, depth, index: taskIndex++ });
  }
  // 终端高度已知时只画放得下的那几行，并让选中行留在窗口里。
  // 必须真的切掉多出来的行：交给 Ink 自己溢出的话整帧会比屏幕高，顶部被卷走
  const avail = rows === undefined ? lines.length : Math.max(1, rows - tableChrome(columns, rows));
  let windowStart = 0;
  if (lines.length > avail) {
    const selectedLine = lines.findIndex((line) => line.kind === "task" && line.index === state.selectedIndex);
    const anchor = selectedLine < 0 ? 0 : selectedLine;
    windowStart = Math.max(0, Math.min(anchor - Math.floor(avail / 2), lines.length - avail));
  }
  const windowLines = lines.slice(windowStart, windowStart + avail);

  // ------------------------------------------------ 鼠标交互
  // 注意：以下钩子必须位于弹窗 early return 之前，否则弹窗打开时钩子数量变化
  // 会让 React 抛 "Rendered fewer hooks" 直接退出（表现为闪退）。
  // 布局行号（1 起，alt-screen 绝对坐标）：内容首行 = 横幅可见行数 + 信息行 1
  // + 表格上边框 1 + 表头 1。横幅行数随窗口大小变，和渲染共用 bannerLines。
  const firstTaskRow = bannerLines(columns, rows).length + 4;
  const viewRef = useRef({ lines: [] as TableLine[], windowStart: 0 });
  viewRef.current = { lines, windowStart };
  const keyboardRef = useRef(handleKeyboard);
  keyboardRef.current = handleKeyboard;
  const completeIdsRef = useRef(completeIds);
  completeIdsRef.current = completeIds;
  const applySettingRef = useRef(applySetting);
  applySettingRef.current = applySetting;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const settingIndexRef = useRef(settingIndex);
  settingIndexRef.current = settingIndex;
  useEffect(() => subscribeMouse((event: MouseEvent) => {
    const currentState = stateRef.current;
    const { lines: currentLines, windowStart: start } = viewRef.current;
    // 立体按钮占 3 行，点上沿 / 按钮面 / 下沿都算点中
    const onFooter = rows !== undefined && event.y > rows - footerHeight();
    const footerHit = onFooter && event.kind === "press"
      ? footerKeyRanges().find((range) => event.x >= range.start && event.x <= range.end)
      : undefined;
    if (footerHit) setPressedButton(footerHit.name);
    // 弹窗打开时点底部按钮照常生效（点「退出」就退出），其余位置任意点击关闭弹窗
    if (footerHit && currentState.mode.kind !== "list" && currentState.mode.kind !== "add" && currentState.mode.kind !== "edit" && currentState.mode.kind !== "search" && currentState.mode.kind !== "command") {
      setActionSequence((sequence) => sequence + 1);
      dispatch({ type: "mode", mode: { kind: "list" } });
      if (footerHit.name === "help" && currentState.mode.kind === "help") return;
      if (footerHit.name === "quit") { exit(); return; }
      if (footerHit.name === "help") { dispatch({ type: "mode", mode: { kind: "help" } }); return; }
      if (footerHit.name === "input") { dispatch({ type: "mode", mode: { kind: "add" } }); return; }
      if (footerHit.name === "settings" && currentState.mode.kind !== "settings") { dispatch({ type: "mode", mode: { kind: "settings" } }); return; }
      return;
    }
    // 弹窗打开时任意点击关闭（和任意键关闭一致）
    // 设置页：点一下选中那一项，再点同一项就换到下一个值
    if (currentState.mode.kind === "settings" && event.kind === "press" && !footerHit) {
      const index = event.y - (modalPad(rows, settingsRef.current.length + 7) + 4);
      const item = settingsRef.current[index];
      if (item) { setActionSequence((sequence) => sequence + 1); if (index === settingIndexRef.current) applySettingRef.current(item, 1); else setSettingIndex(index); }
      return;
    }
    if (currentState.mode.kind === "help" || currentState.mode.kind === "welcome" || currentState.mode.kind === "detail" || currentState.mode.kind === "confirm" || currentState.mode.kind === "graph" || currentState.mode.kind === "settings") {
      if (event.kind === "press") { setActionSequence((sequence) => sequence + 1); dispatch({ type: "mode", mode: { kind: "list" } }); }
      return;
    }
    // 滚轮：滚动选中行
    if (event.kind === "wheel-up" || event.kind === "wheel-down") {
      dispatch({ type: "select", index: currentState.selectedIndex + (event.kind === "wheel-up" ? -3 : 3) });
      return;
    }
    if (event.kind !== "press") return;
    // Footer 行（最后一行）：点击键帽/标签触发对应快捷键。按钮全局生效——
    // 无论当前焦点在清单区还是输入区，点 ? 就开帮助、点 q 就退出。
    if (onFooter) {
      const hit = footerHit;
      if (hit) {
        const keyByFooter: Record<typeof hit.name, { input: string; key: KeyEvent["key"] }> = {
          help: { input: "?", key: { ctrl: false } },
          input: { input: "i", key: { ctrl: false } },
          done: { input: "d", key: { ctrl: false } },
          settings: { input: ",", key: { ctrl: false } },
          quit: { input: "q", key: { ctrl: false } },
        };
        const listState: TuiState = currentState.mode.kind === "list"
          ? currentState
          : { ...currentState, mode: { kind: "list" } };
        keyboardRef.current(listState, selectedRef.current, keyByFooter[hit.name].input, keyByFooter[hit.name].key);
      }
      return;
    }
    // 点击输入框区域：聚焦输入
    const bottomInputRow = (rows ?? 24) - 1 - footerHeight();
    if (event.y >= bottomInputRow && (rows === undefined || event.y <= rows - footerHeight())) {
      if (currentState.mode.kind === "list") dispatch({ type: "mode", mode: { kind: "add" } });
      return;
    }
    // 点击任务行：选中该行；再点同一行 = 完成/重开任务
    const lineIndex = event.y - firstTaskRow + start;
    const line = currentLines[lineIndex];
    if (line && line.kind === "task") {
      if (line.index === currentState.selectedIndex) {
        const task = line.task;
        if (task.status === "done") runMutation(async () => `↺ 重新打开：${(await service.reopen(task.id)).title}`);
        else completeIdsRef.current([task.id]);
      } else {
        dispatch({ type: "select", index: line.index });
      }
    }
  }), [columns, dispatch, exit, runMutation, service, rows]);

  if (state.mode.kind === "help") return <ModalShell rows={rows} pressed={pressedButton}><HelpModal rows={rows} /></ModalShell>;
  if (state.mode.kind === "welcome") return <ModalShell rows={rows} pressed={pressedButton}><WelcomeModal rows={rows} /></ModalShell>;
  if (state.mode.kind === "settings" && config) return <ModalShell rows={rows} pressed={pressedButton}><SettingsModal items={settings} config={config} selected={settingIndex} rows={rows} columns={columns} /></ModalShell>;
  if (state.mode.kind === "graph") return <ModalShell rows={rows} pressed={pressedButton}><GraphModal lines={graphLines} offset={graphOffset} rows={rows} columns={columns} /></ModalShell>;
  if (state.mode.kind === "confirm") return <ModalShell rows={rows} pressed={pressedButton}><ConfirmModal prompt={state.mode.prompt} rows={rows} /></ModalShell>;
  if (state.mode.kind === "detail" && detailTask) {
    return (
      <ModalShell rows={rows} pressed={pressedButton}>
        <DetailModal task={detailTask} parent={detailParent} deps={detailDeps} dependents={detailDependents} rows={rows} columns={columns}>{detailChildren}</DetailModal>
      </ModalShell>
    );
  }

  return (
    <Box flexDirection="column" {...(rows !== undefined ? { height: rows } : {})}>
      <Banner columns={columns} rows={rows} />
      <BannerInfo query={state.query} sortMode={state.sortMode} tasks={tasks} clock={clock} marked={state.marked.length} />
      <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden" borderStyle={SKIN.border} borderColor={C.border} paddingLeft={1} paddingRight={1}>
        <TableHeader cols={cols} />
        {lines.length === 0 ? <Text color={C.dimmer}>（没有任务）</Text> : windowLines.map((line) => (
          line.kind === "sep"
            ? <GroupSeparator key={`sep-${line.groupKey}-${line.count}`} groupKey={line.groupKey} name={line.name} count={line.count} />
            : <TaskRow key={line.task.id} task={line.task} selected={line.index === state.selectedIndex} marked={state.marked.includes(line.task.id)} blocked={blocked.has(line.task.id)} completing={strike?.ids.includes(line.task.id) ? strike.frame / STRIKE_FRAMES : undefined} today={today} dateFormat={state.dateFormat} levels={levels} cols={cols} depth={line.depth} />
        ))}
      </Box>
      <Box paddingLeft={2} paddingRight={2}><PreviewLine state={state} levels={levels} /></Box>
      <InputBar state={state} />
      <FooterBar pressed={pressedButton} />
    </Box>
  );
};
