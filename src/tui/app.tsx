import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { randomUUID } from "node:crypto";
import { existsSync, watchFile, unwatchFile } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Box, Text, useApp, useInput, useStdout } from "ink";

import { ApplicationService } from "../app/service.js";
import { viewGroups, viewCounts, viewWindow, wallNow, VIEW_ORDER, type AgendaView } from "../core/views.js";
import { compileQuery, filterTasks } from "../core/query.js";
import { groups, nestTasks, type GroupKey } from "../core/agenda.js";
import { blockedIds, dependencyGraph, waitLabel, wouldCycle } from "../core/deps.js";
import { setConfigValue } from "../core/config.js";
import type { Config, Task } from "../contracts.js";
import { scanDate } from "../core/parse.js";
import { ACTIVE_STATES, localNow } from "../core/task.js";
import { taskToInput } from "../core/task-ops.js";
import { Store } from "../storage/store.js";
import { initialTuiState, tuiReducer, type TuiState } from "./state.js";
import type { KeyEvent } from "./keymap.js";
import { mapKey } from "./keymap.js";
import { setMouseTracking, subscribeMouse, type MouseEvent } from "./mouse.js";
import {
  CardRow, EmptyState, GroupHeading, GroupSeparator, TableHeader, TaskRow, tableColumns,
} from "./rows.js";
import { Banner, FooterBar, InputBar, PreviewLine, TopBar, ViewBar, viewKeyRanges, bannerRows, contentLeft, contentWidth, footerHeight, footerKeyRanges, inputHeight, setTightLayout, type FooterButton } from "./chrome.js";
import {
  CONFIRM_LINES, ConfirmModal, DetailModal, DepsModal, GraphModal, HelpModal, HistoryModal, ModalShell, SettingsModal, WELCOME_LINES, WelcomeModal,
  detailLines, depsLines, depsRoom, graphRoom, helpLines, historyLines, listStart, modalPad, settingsLines, settingsRows, type DepsCandidate,
} from "./modals.js";
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
const activeFinishedQuery = (query: string): boolean => compileQuery(query).some((predicate) => predicate[0] === "status" && predicate[1] === "done");
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
type TableLine =
  | { kind: "hint"; text: string }
  | { kind: "sep"; groupKey: GroupKey; name: string; count: number; completed?: boolean }
  | { kind: "gap"; groupKey: GroupKey }
  | { kind: "task"; task: Task; depth: number; index: number; groupKey: GroupKey; progress?: number | undefined };
type CompletionPlacement = { groupKey: GroupKey; name: string; position: number; depth: number; context: string };
type CompletionFeedback = CompletionPlacement & { task: Task; started: number };

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

// 写入成功后短暂保留原行；计时只影响绘制，不阻塞输入或存储。
const COMPLETION_MS = 700;
// Esc 连按两下退出的间隔：1 秒太赶，第二下常常按晚
const EXIT_WINDOW_MS = 2000;
// 提示行里的操作反馈停留多久后退回上下文提示
const TOAST_MS = 4000;
type Layout = { cards: boolean; compact: boolean; banner: Config["ui"]["banner"] };
const layoutOf = (config: Config | undefined): Layout => ({
  cards: (config?.ui.layout ?? "cards") === "cards",
  compact: config?.ui.density === "compact",
  banner: config?.ui.banner ?? "line",
});
// 清单区上面：横幅 + 顶栏 1（表格布局再加上边框 1 + 表头 1）；
// 下面：提示行 1 + 输入框 + Footer（表格布局再加下边框 1）
const listChrome = (columns: number | undefined, rows: number | undefined, layout: Layout): number =>
  bannerRows(columns, rows, layout.banner) + 3 + (layout.cards ? 0 : 3) + 1 + inputHeight(layout.compact) + footerHeight();
/** 清单第一行的屏幕行号（1 起），鼠标点任务行按它换算 */
const firstListRow = (columns: number | undefined, rows: number | undefined, layout: Layout): number =>
  bannerRows(columns, rows, layout.banner) + (layout.cards ? 4 : 6);

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
  const [graphIndex, setGraphIndex] = useState(0);
  const [pressedButton, setPressedButton] = useState<FooterButton>();
  const [hoveredButton, setHoveredButton] = useState<FooterButton>();
  // 后续任务选择列表：勾选状态在保存前只存在这里
  const [depsPicked, setDepsPicked] = useState<string[]>([]);
  const [depsIndex, setDepsIndex] = useState(0);
  const [historySteps, setHistorySteps] = useState<Array<{ ts: string; summary: string }>>([]);
  const [historyIndex, setHistoryIndex] = useState(0);
  // 刚添加 / 编辑过的那条：换了位置时短暂高亮，眼睛跟得上
  const [movedId, setMovedId] = useState<string>();
  // toast 过几秒自动淡出：记下消息出现的时刻
  const [toastVisible, setToastVisible] = useState(true);
  const [settingIndex, setSettingIndex] = useState(0);
  const [skinChoices, setSkinChoices] = useState<Array<{ name: string; description: string }>>([]);
  const settings = useMemo(() => settingItems(skinChoices), [skinChoices]);
  const [feedback, setFeedback] = useState<CompletionFeedback[]>([]);
  const [feedbackClock, setFeedbackClock] = useState(0);
  const [recentCompleted, setRecentCompleted] = useState<string[]>([]);
  const [completedExpanded, setCompletedExpanded] = useState(false);
  const completionPlacements = useRef(new Map<string, CompletionPlacement>());
  const observedTasks = useRef<Map<string, Task>>();
  const pendingCompletions = useRef(new Set<string>());
  const failedCompletions = useRef(new Set<string>());
  const refreshQueue = useRef(Promise.resolve());
  useEffect(() => {
    if (!feedback.length) return;
    const timer = setInterval(() => {
      const now = Date.now();
      setFeedbackClock(now);
      setFeedback((items) => items.filter((item) => now - item.started < COMPLETION_MS));
    }, 70);
    return () => clearInterval(timer);
  }, [feedback.length]);
  useEffect(() => {
    if (pressedButton === undefined) return;
    const timer = setTimeout(() => setPressedButton(undefined), 180);
    return () => clearTimeout(timer);
  }, [pressedButton]);
  useEffect(() => {
    if (movedId === undefined) return;
    const timer = setTimeout(() => setMovedId(undefined), 1500);
    return () => clearTimeout(timer);
  }, [movedId]);
  useEffect(() => {
    setToastVisible(true);
    if (state.flashMessage === undefined) return;
    const timer = setTimeout(() => setToastVisible(false), TOAST_MS);
    return () => clearTimeout(timer);
  }, [state.flashMessage]);
  const blocked = useMemo(() => blockedIds(tasks), [tasks]);
  const graphLines = useMemo(() => dependencyGraph(tasks), [tasks]);
  const projects = useMemo(() => [...new Set(tasks.filter((task) => ACTIVE_STATES.has(task.status)).map((task) => task.project).filter((value): value is string => Boolean(value)))].sort(), [tasks]);
  // 每组内部按父子相邻重排后再摊平：显示顺序和选中索引必须用同一份顺序，
  // 否则按 j/k 选中的行和高亮的行会错开
  const activeGroups = useMemo(() => {
    if (!config) return [];
    const scoped = state.project === undefined ? tasks : tasks.filter((task) => task.project === state.project);
    return viewGroups(scoped, config, state.sortMode, clock, state.query, state.view, state.showUnscheduled)
      .map((group) => ({ ...group, tasks: group.tasks.filter((task) => task.status !== "done") }))
      .filter((group) => group.tasks.length > 0)
      .map((group) => ({ ...group, nested: nestTasks(group.tasks), tasks: nestTasks(group.tasks).map((item) => item.task) }));
  }, [config, state.project, state.query, state.sortMode, state.view, state.showUnscheduled, tasks, clock]);
  const scopedTasks = state.project === undefined ? tasks : tasks.filter((task) => task.project === state.project);
  const counts = config ? viewCounts(scopedTasks, config, clock, state.query, state.view) : { unscheduled: 0, outside: 0 };
  const window = config ? viewWindow(config, clock) : undefined;
  // 后续任务选择列表的候选：除它自己以外还开着的任务；勾上会成环的标灰
  const depsOwnerId = state.mode.kind === "deps" ? state.mode.taskId : undefined;
  const depsOwner = depsOwnerId === undefined ? undefined : tasks.find((task) => task.id === depsOwnerId);
  const depsCandidates = useMemo<DepsCandidate[]>(() => {
    if (!depsOwner) return [];
    return tasks
      .filter((task) => task.id !== depsOwner.id && ACTIVE_STATES.has(task.status))
      .map((task) => ({
        task,
        checked: depsPicked.includes(task.id),
        disabled: wouldCycle(tasks, task.id, [...(task.deps ?? []), depsOwner.id]) ? "会成环" : undefined,
      }));
  }, [depsOwner, depsPicked, tasks]);
  const completionContext = JSON.stringify([state.view, state.showUnscheduled, state.query, state.project, state.sortMode]);
  const currentFeedback = feedback.filter((item) => item.context === completionContext && tasks.some((task) => task.id === item.task.id && task.status === "done"));
  // 只记录真正画在当前清单的行；外部完成不凭空把其他项目/历史塞进原位置。
  completionPlacements.current = new Map(activeGroups.flatMap((group) => group.nested.map(({ task, depth }, position) =>
    [task.id, { groupKey: group.key, name: group.name, position, depth, context: completionContext }] as const)));
  const completedTasks = useMemo(() => config ? filterTasks(scopedTasks, state.query, viewWindow(config, clock).today, [...config.priority.levels])
    .filter((task) => task.status === "done")
    .sort((a, b) => (b.end ?? b.modified).localeCompare(a.end ?? a.modified) || a.id.localeCompare(b.id)) : [],
  [config, tasks, state.project, state.query, clock]);
  const completedShown = completedTasks.filter((task) => !currentFeedback.some((item) => item.task.id === task.id))
    .filter((task) => completedExpanded || recentCompleted.slice(0, 3).includes(task.id) || activeFinishedQuery(state.query));
  const visibleKey = [...flatten(activeGroups), ...completedShown].map((task) => `${task.id}:${task.modified}`).join("|");
  const visible = useMemo(() => [...flatten(activeGroups), ...completedShown], [visibleKey]);
  const selected = visible[state.selectedIndex];
  const selections = useRef<Partial<Record<AgendaView, string>>>({});
  const previousList = useRef({ view: state.view, visible, index: state.selectedIndex, query: state.query, project: state.project });
  useEffect(() => {
    const previous = previousList.current;
    if (previous.view === state.view && previous.query === state.query && previous.project === state.project && previous.visible !== visible && previous.index === state.selectedIndex) {
      const id = previous.visible[previous.index]?.id;
      const index = visible.findIndex((task) => task.id === id);
      if (index >= 0 && index !== state.selectedIndex) dispatch({ type: "select", index });
    }
    previousList.current = { view: state.view, visible, index: state.selectedIndex, query: state.query, project: state.project };
  }, [visible, state.view, state.selectedIndex, state.query, state.project]);
  const switchView = useCallback((next: AgendaView, showUnscheduled = stateRef.current.showUnscheduled): void => {
    const current = stateRef.current;
    const cfg = configRef.current;
    if (!cfg) return;
    const currentId = selectedRef.current?.id;
    if (currentId) selections.current[current.view] = currentId;
    const scoped = current.project === undefined ? tasks : tasks.filter((task) => task.project === current.project);
    const nextTasks = viewGroups(scoped, cfg, current.sortMode, new Date(), current.query, next, showUnscheduled).flatMap((group) => nestTasks(group.tasks).map((item) => item.task)).filter((task) => task.status !== "done").concat(completedShown);
    let index = nextTasks.findIndex((task) => task.id === selections.current[next]);
    if (index < 0) index = nextTasks.findIndex((task) => task.id === currentId);
    dispatch({ type: "view", view: next, showUnscheduled });
    dispatch({ type: "select", index: Math.max(0, index) });
    if (next !== current.view) void setConfigValue("agenda.view", next, store.paths.dir).catch((error: unknown) => dispatch({ type: "flash", message: `视图未保存：${String(error)}` }));
  }, [store, tasks, visibleKey]);
  // 详情浮层的数据在早返回之前算好：hooks 数量必须每帧一致，
  // 否则 React 会抛 "Rendered fewer hooks"（表现为闪退）
  const detailId = state.mode.kind === "detail" ? state.mode.taskId : undefined;
  const detailTask = detailId === undefined ? undefined : tasks.find((task) => task.id === detailId);
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
  selectedRef.current = detailTask ?? selected;

  // 皮肤颜色存在模块级的可变对象里，换皮肤时靠这个 state 触发重绘
  const [, setSkinName] = useState<string>();
  const refresh = useCallback((): Promise<void> => {
    const queued = refreshQueue.current.catch(() => {}).then(async () => {
      const nextConfig = await service.config();
      const skinError = await loadSkin(nextConfig.ui.skin, store.paths.dir);
      if (skinError) dispatch({ type: "flash", message: `${skinError}；先用 classic` });
      setSkinName(SKIN.name);
      setSkinChoices(await listSkins(store.paths.dir));
      const nextTasks = await service.tasks();
      const previous = observedTasks.current;
      const nextObserved = new Map(nextTasks.map((task) => [task.id, task]));
      const completed = previous ? nextTasks.filter((task) => {
        const old = previous.get(task.id);
        if (pendingCompletions.current.has(task.id)) {
          if (old) nextObserved.set(task.id, old);
          return false;
        }
        return task.status === "done" && old !== undefined && ACTIVE_STATES.has(old.status) && !failedCompletions.current.has(task.id);
      }) : [];
      observedTasks.current = nextObserved;
      failedCompletions.current.clear();
      const doneIds = new Set(nextTasks.filter((task) => task.status === "done").map((task) => task.id));
      setRecentCompleted((ids) => [...completed.map((task) => task.id), ...ids.filter((id) => doneIds.has(id) && !completed.some((task) => task.id === id))]);
      const additions: CompletionFeedback[] = [];
      for (const task of completed) {
        const place = completionPlacements.current.get(task.id);
        if (place && nextConfig.ui.animations) additions.push({ ...place, task, started: Date.now() });
      }
      setFeedbackClock(Date.now());
      setFeedback((items) => [...items.filter((item) => doneIds.has(item.task.id) && !completed.some((task) => task.id === item.task.id)), ...additions]);
      setConfig(nextConfig);
      setTasks(nextTasks.map((task) => pendingCompletions.current.has(task.id) ? previous?.get(task.id) ?? task : task));
      setDataRevision((revision) => revision + 1);
    });
    refreshQueue.current = queued;
    return queued;
  }, [service, store]);
  useEffect(() => { void refresh().catch((error: unknown) => dispatch({ type: "flash", message: error instanceof Error ? error.message : String(error) })); }, [refresh]);
  useEffect(() => { const timer = setInterval(() => { void refresh().catch(() => {}); }, 30_000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => { const timer = setInterval(() => setClock(new Date()), 10_000); return () => clearInterval(timer); }, []);
  // 别的进程（CLI、同步、watcher）改了任务文件就跟着刷新；watcher 发出的提醒写进 inbox，
  // 这里只读新追加的那部分，把提醒顶到提示行上
  useEffect(() => {
    const onTasks = (): void => { void refresh().catch(() => {}); };
    let seen = -1;
    const onInbox = (): void => {
      void readFile(store.paths.inbox, "utf8").then((text) => {
        const lines = text.split("\n").filter(Boolean);
        if (seen >= 0 && lines.length > seen) {
          const latest = lines.at(-1);
          try {
            const entry = JSON.parse(latest ?? "{}") as { message?: string };
            if (entry.message) dispatch({ type: "flash", message: `◷ 提醒：${entry.message}` });
          } catch { /* 半行还没写完，下一轮再读 */ }
        }
        seen = lines.length;
      }).catch(() => { if (seen < 0) seen = 0; });
    };
    onInbox();
    watchFile(store.paths.tasks, { interval: 1000 }, onTasks);
    watchFile(store.paths.inbox, { interval: 1000 }, onInbox);
    return () => { unwatchFile(store.paths.tasks, onTasks); unwatchFile(store.paths.inbox, onInbox); };
  }, [refresh, store]);
  // 首次拿到配置后同步排序模式与日期列格式
  useEffect(() => {
    if (!config || configInitRef.current) return;
    configInitRef.current = true;
    dispatch({ type: "sort", mode: config.priority.mode });
    dispatch({ type: "dateFormat", format: config.agenda.date_format });
    dispatch({ type: "view", view: config.agenda.view });
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
        const task = await service.add(currentState.input, wallNow(new Date(), currentConfig.agenda.timezone));
        setMovedId(task.id);
        dispatch({ type: "flash", message: `已添加：${task.title}` });
      } else if (currentState.mode.kind === "edit") {
        const task = await service.edit(currentState.mode.taskId, currentState.input, wallNow(new Date(), currentConfig.agenda.timezone));
        setMovedId(task.id);
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
        else if (command === "history") { setHistorySteps(await service.history(10)); setHistoryIndex(0); dispatch({ type: "mode", mode: { kind: "history" } }); dispatch({ type: "mutationSuccess", id: mutationId }); return; }
        else if (command === "graph") { setGraphIndex(0); dispatch({ type: "mode", mode: { kind: "graph" } }); await refresh(); dispatch({ type: "mutationSuccess", id: mutationId }); return; }
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

  // 同一行在写入中只能提交一次；成功后的观察器统一处理 UI 和外部 CLI 完成。
  const completeIds = useCallback((ids: string[]): void => {
    const targets = [...new Set(ids)].filter((id) => !pendingCompletions.current.has(id) && observedTasks.current?.get(id)?.status !== "done");
    if (!targets.length) return;
    targets.forEach((id) => pendingCompletions.current.add(id));
    runMutation(async () => {
      try {
        return await runBatch(targets, "✓ 已完成", async (id) => {
          try { return await completeAndDescribe(service, id); }
          catch (error) { failedCompletions.current.add(id); throw error; }
          finally { pendingCompletions.current.delete(id); }
        });
      } finally {
        targets.forEach((id) => pendingCompletions.current.delete(id));
        // 失败也读回（批量操作可能部分成功），不把失败当作成功反馈。
        await refresh();
      }
    });
  }, [refresh, runMutation, service]);

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

  // 打开后续任务选择列表：已经在等它的任务预先勾上
  const openDeps = useCallback((owner: Task): void => {
    setDepsPicked(tasks.filter((task) => task.deps?.includes(owner.id)).map((task) => task.id));
    setDepsIndex(0);
    dispatch({ type: "mode", mode: { kind: "deps", taskId: owner.id } });
  }, [tasks]);

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
    if (action.type === "submit" && currentState.mode.kind === "deps") {
      const owner = currentState.mode.taskId;
      const picked = [...depsPicked];
      dispatch({ type: "mode", mode: { kind: "list" } });
      runMutation(async () => `已设好后续任务：${await service.setDependents(owner, picked)} 处改动`);
      return;
    }
    if (action.type === "submit" && currentState.mode.kind === "history") {
      const steps = historyIndex + 1;
      dispatch({ type: "mode", mode: { kind: "list" } });
      if (historySteps.length) runMutation(() => service.undoSteps(steps));
      return;
    }
    if (action.type === "submit") { void submit(); return; }
    if (action.type === "escape") {
      if (currentState.mode.kind === "list") {
        // Esc 先清多选，再当退出的第一下；免得刚勾了一堆就被问退出
        if (currentState.marked.length) { dispatch({ type: "setMarks", ids: [] }); dispatch({ type: "flash", message: "已取消多选" }); return; }
        if (currentState.exitArmedAt && Date.now() - currentState.exitArmedAt < EXIT_WINDOW_MS) { exit(); return; }
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
    if (action.type === "move" && currentState.mode.kind === "graph") { setGraphIndex((index) => Math.max(0, Math.min(graphLines.length - 1, index + action.delta))); return; }
    if (action.type === "move" && currentState.mode.kind === "deps") { setDepsIndex((index) => Math.max(0, Math.min(depsCandidates.length - 1, index + action.delta))); return; }
    if (action.type === "move" && currentState.mode.kind === "history") { setHistoryIndex((index) => Math.max(0, Math.min(historySteps.length - 1, index + action.delta))); return; }
    if (action.type === "move" && currentState.mode.kind === "detail") {
      const index = Math.max(0, Math.min(visible.length - 1, currentState.selectedIndex + action.delta));
      const next = visible[index];
      dispatch({ type: "select", index });
      if (next) dispatch({ type: "mode", mode: { kind: "detail", taskId: next.id } });
      return;
    }
    if (action.type === "move") { dispatch({ type: "select", index: currentState.selectedIndex + action.delta }); return; }
    if (action.type === "page") {
      // 一页按可见任务行数算，翻不动就贴到首尾
      const page = Math.max(1, (rows ?? 24) - listChrome(columns, rows, layoutOf(configRef.current)) - 1);
      const next = Math.max(0, Math.min(visible.length - 1, currentState.selectedIndex + action.delta * page));
      dispatch({ type: "select", index: next });
      return;
    }
    if (action.type === "first") { dispatch({ type: "select", index: 0 }); return; }
    if (action.type === "last") { dispatch({ type: "select", index: Math.max(0, visible.length - 1) }); return; }
    if (action.type === "command") { dispatch({ type: "mode", mode: { kind: "command" } }); dispatch({ type: "input", value: action.value }); return; }
    if (action.type === "shortcut") {
      if (action.name === "6") { setCompletedExpanded((expanded) => !expanded); return; }
      if (["3", "4", "5", "f", "b"].includes(action.name)) {
        const next = action.name === "f" ? VIEW_ORDER[(VIEW_ORDER.indexOf(currentState.view) + 1) % VIEW_ORDER.length]! : action.name === "b" ? currentState.view : VIEW_ORDER[Number(action.name) - 3]!;
        switchView(next, action.name === "b" ? !currentState.showUnscheduled : currentState.showUnscheduled);
        return;
      }
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
      if (action.name === "D") { setGraphIndex(0); dispatch({ type: "mode", mode: { kind: "graph" } }); return; }
      if (action.name === ",") { dispatch({ type: "mode", mode: { kind: "settings" } }); return; }
      if (action.name === "settingPrev" || action.name === "settingNext") {
        const item = settings[settingIndex];
        if (item) applySetting(item, action.name === "settingNext" ? 1 : -1);
        return;
      }
      if (action.name === "a" && currentSelected) { openDeps(currentSelected); return; }
      if (action.name === "tab") {
        // 全部 → 各个项目 → 回到全部
        const order = [undefined, ...projects];
        const next = order[(order.indexOf(currentState.project) + 1) % order.length];
        dispatch({ type: "project", value: next });
        dispatch({ type: "flash", message: next === undefined ? "全部项目" : `项目：${next}` });
        return;
      }
      if (action.name === "deps.toggle") {
        const item = depsCandidates[depsIndex];
        if (!item) return;
        if (item.disabled && !item.checked) { dispatch({ type: "flash", message: `「${item.task.title}」${item.disabled}，不能选` }); return; }
        setDepsPicked((picked) => picked.includes(item.task.id) ? picked.filter((id) => id !== item.task.id) : [...picked, item.task.id]);
        return;
      }
      if (action.name === "deps.new" && currentState.mode.kind === "deps") {
        // 后续任务还没写的话直接新建；目标分组可以用 in:等待 这类写法指定
        const owner = tasks.find((task) => task.id === (currentState.mode as { taskId: string }).taskId);
        dispatch({ type: "mode", mode: { kind: "add" } });
        dispatch({ type: "input", value: `after:${owner?.id ?? ""} ` });
        if (owner) dispatch({ type: "flash", message: `给「${owner.title}」加后续任务` });
        return;
      }
      if (action.name.startsWith("graph.")) {
        const line = graphLines[graphIndex];
        if (!line) return;
        if (action.name === "graph.a") { openDeps(line.task); return; }
        if (action.name === "graph.x") {
          if (!line.via) { dispatch({ type: "flash", message: "这一行是起点，没有可删的边" }); return; }
          const via = line.via;
          runMutation(async () => { await service.setDeps(line.task.id, (line.task.deps ?? []).filter((id) => id !== via.id)); return `已删掉：${via.title} → ${line.task.title}`; });
          return;
        }
        // 回车：回到清单并把光标放到那一条上；它不在当前视图里就先切回全部
        dispatch({ type: "mode", mode: { kind: "list" } });
        const index = visible.findIndex((task) => task.id === line.task.id);
        if (index >= 0) dispatch({ type: "select", index });
        else dispatch({ type: "flash", message: `「${line.task.title}」不在当前清单里（可能已完成、被过滤或在别的项目页）` });
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
          dispatch({ type: "flash", message: "已完成，按 o 重新打开" });
          return;
        }
        completeIds([task.id]);
      }
    }
  }, [applySetting, columns, completeIds, depsCandidates, depsIndex, depsPicked, dispatch, exit, graphIndex, graphLines, historyIndex, historySteps, openDeps, projects, refresh, rows, runMutation, service, settingIndex, settings, store, switchView, tasks, visible]);

  const today = window?.today ?? nowLocal().slice(0, 10);
  const levels = config ? [...config.priority.levels] : ["低", "中", "高"];
  const layout = layoutOf(config);
  const cols = tableColumns(columns);
  const lines: TableLine[] = [];
  let taskIndex = 0;
  const displayGroups = activeGroups.map((group) => ({ key: group.key, name: group.name, nested: group.nested.map((item) => ({ ...item, progress: undefined as number | undefined })) }));
  for (const item of [...currentFeedback].sort((a, b) => a.position - b.position)) {
    let group = displayGroups.find((group) => group.key === item.groupKey);
    if (!group) {
      group = { key: item.groupKey, name: item.name, nested: [] };
      // 原组刚好被做完时，仍保留它在原来的分组顺序。
      const order: GroupKey[] = ["doing", "overdue", "today", "upcoming", "later", "waiting", "paused", "nodate", "finished", "blocked"];
      const before = displayGroups.findIndex((other) => order.indexOf(other.key) > order.indexOf(item.groupKey));
      displayGroups.splice(before < 0 ? displayGroups.length : before, 0, group);
    }
    group.nested.splice(Math.min(item.position, group.nested.length), 0, { task: item.task, depth: item.depth, progress: Math.min(1, Math.max(0, (feedbackClock - item.started) / (COMPLETION_MS * 0.65))) });
  }
  for (const group of displayGroups) {
    if (layout.cards && !layout.compact && lines.length) lines.push({ kind: "gap", groupKey: group.key });
    lines.push({ kind: "sep", groupKey: group.key, name: group.name, count: group.nested.length });
    for (const [position, { task, depth, progress }] of group.nested.entries()) {
      if (position) for (let spacer = 0; spacer < (config?.ui.line_spacing ?? 0); spacer++) lines.push({ kind: "gap", groupKey: group.key });
      lines.push({ kind: "task", task, depth, index: progress === undefined ? taskIndex++ : -1, groupKey: group.key, progress });
    }
  }
  if (!lines.length && state.view !== "all" && completedTasks.length) lines.push({ kind: "hint", text: `这个范围暂无已安排事项。${counts.unscheduled ? `未安排 ${counts.unscheduled} 项，按 b 展开。` : "按 3 查看全部。"}` });
  if (completedTasks.length) {
    if (layout.cards && !layout.compact && lines.length) lines.push({ kind: "gap", groupKey: "finished" });
    lines.push({ kind: "sep", groupKey: "finished", name: `已完成 · 6 ${completedExpanded ? "收起" : "展开"}`, count: completedTasks.length, completed: true });
    for (const [position, task] of completedShown.entries()) {
      if (position) for (let spacer = 0; spacer < (config?.ui.line_spacing ?? 0); spacer++) lines.push({ kind: "gap", groupKey: "finished" });
      lines.push({ kind: "task", task, depth: 0, index: taskIndex++, groupKey: "finished" });
    }
  }
  // 终端高度已知时只画放得下的那几行，并让选中行留在窗口里。
  // 必须真的切掉多出来的行：交给 Ink 自己溢出的话整帧会比屏幕高，顶部被卷走
  const avail = rows === undefined ? lines.length : Math.max(1, rows - listChrome(columns, rows, layout));
  let windowStart = 0;
  if (lines.length > avail) {
    const selectedLine = lines.findIndex((line) => line.kind === "task" && line.index === state.selectedIndex);
    const anchor = selectedLine < 0 ? 0 : selectedLine;
    windowStart = Math.max(0, Math.min(anchor - Math.floor(avail / 2), lines.length - avail));
  }
  const windowLines = lines.slice(windowStart, windowStart + avail);

  // 当前弹窗在屏幕上占哪几行（1 起，含边框）；点在框外关闭，框内不关
  const dialogBox = ((): { top: number; bottom: number } | undefined => {
    const box = (total: number): { top: number; bottom: number } => { const top = modalPad(rows, total) + 1; return { top, bottom: top + total - 1 }; };
    switch (state.mode.kind) {
      case "help": return box(helpLines(rows));
      case "welcome": return box(WELCOME_LINES);
      case "confirm": return box(CONFIRM_LINES);
      case "settings": return box(settingsLines(settings));
      case "deps": return box(depsLines(rows, depsCandidates.length));
      case "history": return box(historyLines(historySteps.length));
      case "detail": return detailTask ? box(detailLines(detailTask, detailChildren, detailParent, detailDeps, detailDependents)) : undefined;
      case "graph": return { top: 1, bottom: (rows ?? 24) - footerHeight() };
      default: return undefined;
    }
  })();

  // ------------------------------------------------ 鼠标交互
  // 注意：以下钩子必须位于弹窗 early return 之前，否则弹窗打开时钩子数量变化
  // 会让 React 抛 "Rendered fewer hooks" 直接退出（表现为闪退）。
  const firstTaskRow = firstListRow(columns, rows, layout);
  const viewRef = useRef({ lines: [] as TableLine[], windowStart: 0, dialogBox, depsTotal: 0, graphTotal: 0 });
  viewRef.current = { lines, windowStart, dialogBox, depsTotal: depsCandidates.length, graphTotal: graphLines.length };
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
  const historyStepsRef = useRef(historySteps.length);
  historyStepsRef.current = historySteps.length;
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  const firstRowRef = useRef(firstTaskRow);
  firstRowRef.current = firstTaskRow;
  const indexRef = useRef({ deps: depsIndex, graph: graphIndex });
  indexRef.current = { deps: depsIndex, graph: graphIndex };
  useEffect(() => subscribeMouse((event: MouseEvent) => {
    const currentState = stateRef.current;
    const { lines: currentLines, windowStart: start, dialogBox: box, depsTotal, graphTotal } = viewRef.current;
    // 立体按钮占 3 行，点上沿 / 按钮面 / 下沿都算点中
    const onFooter = rows !== undefined && event.y > rows - footerHeight();
    const footerAt = onFooter ? footerKeyRanges().find((range) => event.x >= range.start && event.x <= range.end) : undefined;
    // 悬停：鼠标移到按钮上提亮（终端只在按住拖动时上报移动，普通终端悬停不一定有效果）
    if (event.kind === "move") { setHoveredButton(footerAt?.name); return; }
    const footerHit = event.kind === "press" ? footerAt : undefined;
    if (footerHit) setPressedButton(footerHit.name);
    const modal = currentState.mode.kind;
    const inModal = modal === "help" || modal === "welcome" || modal === "detail" || modal === "confirm" || modal === "graph" || modal === "settings" || modal === "deps" || modal === "history";
    // 弹窗打开时点底部按钮照常生效（点「退出」就退出）
    if (footerHit && inModal) {
      setActionSequence((sequence) => sequence + 1);
      dispatch({ type: "mode", mode: { kind: "list" } });
      if (footerHit.name === "help" && modal === "help") return;
      if (footerHit.name === "quit") { exit(); return; }
      if (footerHit.name === "help") { dispatch({ type: "mode", mode: { kind: "help" } }); return; }
      if (footerHit.name === "input") { dispatch({ type: "mode", mode: { kind: "add" } }); return; }
      if (footerHit.name === "settings" && modal !== "settings") { dispatch({ type: "mode", mode: { kind: "settings" } }); return; }
      return;
    }
    if (inModal) {
      // 滚轮在能滚的列表弹窗里移动光标
      if (event.kind === "wheel-up" || event.kind === "wheel-down") {
        const delta = event.kind === "wheel-up" ? -1 : 1;
        if (modal === "settings") setSettingIndex((index) => Math.max(0, Math.min(settingsRef.current.length - 1, index + delta)));
        else if (modal === "graph") setGraphIndex((index) => Math.max(0, Math.min(graphTotal - 1, index + delta)));
        else if (modal === "deps") setDepsIndex((index) => Math.max(0, Math.min(depsTotal - 1, index + delta)));
        else if (modal === "history") setHistoryIndex((index) => Math.max(0, Math.min(Math.max(0, historyStepsRef.current - 1), index + delta)));
        return;
      }
      if (event.kind !== "press") return;
      setActionSequence((sequence) => sequence + 1);
      const inside = box !== undefined && event.y >= box.top && event.y <= box.bottom;
      if (!inside) { dispatch({ type: "mode", mode: { kind: "list" } }); return; }
      // 设置页：点一下选中那一项，再点同一项就换到下一个值
      if (modal === "settings") {
        // 边框 1 + 留白 1 + 标题 1 之后是内容行
        const row = settingsRows(settingsRef.current)[event.y - (box.top + 3)];
        const index = row?.item ? settingsRef.current.indexOf(row.item) : -1;
        if (index >= 0) { if (index === settingIndexRef.current) applySettingRef.current(settingsRef.current[index]!, 1); else setSettingIndex(index); }
        return;
      }
      // 后续任务列表：标题、说明之后是候选；点一下勾选 / 取消
      if (modal === "deps") {
        const room = depsRoom(rows);
        const offset = listStart(indexRef.current.deps, depsTotal, room);
        const index = offset + event.y - (box.top + 4);
        if (index >= offset && index < Math.min(depsTotal, offset + room)) {
          setDepsIndex(index);
          keyboardRef.current({ ...currentState, mode: currentState.mode }, selectedRef.current, " ", { ctrl: false });
        }
        return;
      }
      // 依赖图：点哪行选哪行
      if (modal === "graph") {
        const room = graphRoom(rows, graphTotal);
        const offset = listStart(indexRef.current.graph, graphTotal, room);
        const index = offset + event.y - 5;
        if (index >= offset && index < Math.min(graphTotal, offset + room)) setGraphIndex(index);
        return;
      }
      if (modal === "history") {
        const index = event.y - (box.top + 3);
        if (index >= 0 && index < historyStepsRef.current) setHistoryIndex(index);
        return;
      }
      // 帮助、欢迎、详情、确认：框内点击不做事，免得点着看的时候被关掉
      return;
    }
    // 滚轮：滚动选中行
    if (event.kind === "wheel-up" || event.kind === "wheel-down") {
      dispatch({ type: "select", index: currentState.selectedIndex + (event.kind === "wheel-up" ? -3 : 3) });
      return;
    }
    if (event.kind !== "press") return;
    // Footer：点击键帽/标签触发对应快捷键。按钮全局生效——
    // 无论当前焦点在清单区还是输入区，点 ? 就开帮助、点 q 就退出。
    if (onFooter) {
      if (footerHit) {
        const keyByFooter: Record<FooterButton, string> = { help: "?", input: "i", done: "d", settings: ",", quit: "q" };
        const listState: TuiState = currentState.mode.kind === "list" ? currentState : { ...currentState, mode: { kind: "list" } };
        keyboardRef.current(listState, selectedRef.current, keyByFooter[footerHit.name], { ctrl: false });
      }
      return;
    }
    const viewRow = bannerRows(columns, rows, layoutRef.current.banner) + 2;
    if (event.y === viewRow) {
      const hit = viewKeyRanges(columns).find((range) => event.x >= range.start && event.x <= range.end);
      if (hit) keyboardRef.current({ ...currentState, mode: { kind: "list" } }, selectedRef.current, hit.key, { ctrl: false });
      return;
    }
    if (event.y === viewRow + 1) {
      keyboardRef.current({ ...currentState, mode: { kind: "list" } }, selectedRef.current, "b", { ctrl: false });
      return;
    }
    // 点击输入框区域：聚焦输入
    const inputTop = (rows ?? 24) - footerHeight() - inputHeight(layoutRef.current.compact) + 1;
    if (event.y >= inputTop) {
      if (currentState.mode.kind === "list") dispatch({ type: "mode", mode: { kind: "add" } });
      return;
    }
    // 点击任务行：选中该行；再点同一行 = 完成/重开任务
    const line = currentLines[event.y - firstRowRef.current + start];
    if (line?.kind === "sep" && line.completed) { setCompletedExpanded((expanded) => !expanded); return; }
    if (line && line.kind === "task" && line.index >= 0) {
      if (line.index === currentState.selectedIndex) {
        const task = line.task;
        if (task.status === "done") dispatch({ type: "flash", message: "已完成，按 o 重新打开" });
        else completeIdsRef.current([task.id]);
      } else {
        dispatch({ type: "select", index: line.index });
      }
    }
  }), [columns, dispatch, exit, runMutation, service, rows]);

  const shell = (node: React.ReactNode): React.ReactElement => <ModalShell rows={rows} pressed={pressedButton} hovered={hoveredButton}>{node}</ModalShell>;
  if (state.mode.kind === "help") return shell(<HelpModal rows={rows} />);
  if (state.mode.kind === "welcome") return shell(<WelcomeModal rows={rows} />);
  if (state.mode.kind === "settings" && config) return shell(<SettingsModal items={settings} config={config} selected={settingIndex} rows={rows} columns={columns} />);
  if (state.mode.kind === "graph") return shell(<GraphModal lines={graphLines} selected={graphIndex} rows={rows} columns={columns} today={today} />);
  if (state.mode.kind === "confirm") return shell(<ConfirmModal prompt={state.mode.prompt} rows={rows} />);
  if (state.mode.kind === "deps" && depsOwner) return shell(<DepsModal owner={depsOwner} candidates={depsCandidates} selected={depsIndex} rows={rows} columns={columns} />);
  if (state.mode.kind === "history") return shell(<HistoryModal steps={historySteps} selected={historyIndex} rows={rows} columns={columns} />);
  if (state.mode.kind === "detail" && detailTask) {
    return shell(<DetailModal task={detailTask} parent={detailParent} deps={detailDeps} dependents={detailDependents} rows={rows} columns={columns}>{detailChildren}</DetailModal>);
  }

  const filtered = Boolean(state.query) || state.project !== undefined;
  const cardWidth = contentWidth(columns) - 2;
  const renderLine = (line: TableLine, position: number): React.ReactElement => {
    if (line.kind === "hint") return <Text key="empty-focus" color={C.dim}>{line.text}</Text>;
    if (line.kind === "gap") return <Text key={`gap-${line.groupKey}-${position}`}> </Text>;
    if (line.kind === "sep") {
      return layout.cards
        ? <GroupHeading key={`sep-${line.groupKey}-${position}`} groupKey={line.groupKey} name={line.name} count={line.count} />
        : <GroupSeparator key={`sep-${line.groupKey}-${position}`} groupKey={line.groupKey} name={line.name} count={line.count} width={Math.max(20, (columns ?? 100) - 4)} />;
    }
    const common = {
      task: line.task,
      selected: line.index === state.selectedIndex,
      marked: state.marked.includes(line.task.id),
      blocked: blocked.has(line.task.id),
      completing: line.progress,
      today,
      dateFormat: state.dateFormat,
      levels,
      depth: line.depth,
    };
    return layout.cards
      ? <CardRow key={line.task.id} {...common} width={cardWidth} wait={waitLabel(line.task, tasks, today)} showDate={line.groupKey !== "today" && line.groupKey !== "overdue"} moved={movedId === line.task.id} />
      : <TaskRow key={line.task.id} {...common} cols={cols} />;
  };
  const body = lines.length === 0 && state.view !== "all"
    ? <Text color={C.dim}>这个范围暂无已安排事项。{counts.unscheduled ? `未安排 ${counts.unscheduled} 项，按 b 展开。` : "按 3 查看全部。"}</Text>
    : lines.length === 0 ? <EmptyState filtered={filtered} /> : windowLines.map(renderLine);

  return (
    <Box flexDirection="column" {...(rows !== undefined ? { height: rows } : {})}>
      <Banner columns={columns} rows={rows} mode={layout.banner} />
      <TopBar query={state.query} sortMode={state.sortMode} tasks={tasks} clock={clock} timezone={config?.agenda.timezone} marked={state.marked.length} projects={projects} project={state.project} showTitle={bannerRows(columns, rows, layout.banner) === 0} columns={columns} />
      <ViewBar view={state.view} showUnscheduled={state.showUnscheduled} counts={counts} window={window} columns={columns} />
      {layout.cards
        ? <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden" width={contentWidth(columns)} marginLeft={contentLeft(columns)} paddingLeft={1} paddingRight={1}>{body}</Box>
        : (
          <Box flexDirection="column" flexGrow={1} flexShrink={1} overflow="hidden" borderStyle={SKIN.border} borderColor={C.border} paddingLeft={1} paddingRight={1}>
            <TableHeader cols={cols} />
            {body}
          </Box>
        )}
      <PreviewLine state={state} levels={levels} toast={toastVisible ? state.flashMessage : undefined} columns={columns} />
      <InputBar state={state} columns={columns} compact={layout.compact} />
      <FooterBar pressed={pressedButton} hovered={hoveredButton} />
    </Box>
  );
};
