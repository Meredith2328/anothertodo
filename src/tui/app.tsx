import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Box, Text, useApp, useInput, useStdout } from "ink";

import { ApplicationService } from "../app/service.js";
import { formatDate, groups, nestTasks, type GroupKey } from "../core/agenda.js";
import { setConfigValue } from "../core/config.js";
import type { Config, Task } from "../contracts.js";
import { t } from "../core/i18n.js";
import { describeRecur, preview, scanDate } from "../core/parse.js";
import { isOverdue, localDate, localNow } from "../core/task.js";
import { taskToInput } from "../core/task-ops.js";
import { displayWidth, padDisplay, truncateDisplay, truncateWithEllipsis } from "../core/width.js";
import { Store } from "../storage/store.js";
import { initialTuiState, tuiReducer, type TuiState } from "./state.js";
import type { KeyAction, KeyEvent } from "./keymap.js";
import { mapKey } from "./keymap.js";
import { subscribeMouse, type MouseEvent } from "./mouse.js";
import {
  BANNER_COLORS, BANNER_FULL, BANNER_SMALL, C, COMPACT_HELP_LINES, COMPACT_HELP_ROWS,
  DATE_FORMAT_LABEL, FULL_HELP_LINES, GROUP_COLOR, HELP_SECTIONS, INPUT_PLACEHOLDER,
  MODE_LABEL, STATUS_COLOR, WELCOME_ROWS,
} from "./theme.js";

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

// 列宽（显示列数）：日期 / 紧急度 / 状态 / 标签提醒；TODO 占剩余宽度
const DATE_W = 12;
const PRIORITY_W = 8;
const STATUS_W = 10;
const EXTRAS_W = 30;
// 表格以外的固定行数：横幅 + 信息行 + 表格边框/表头 + 预览行 + 输入框 + Footer
const CHROME_LINES = 7 + 3 + 1 + 3 + 1;

const dayDelta = (date: string, today: string): number =>
  Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);

// ---------------------------------------------------------------- 单元格
type Cell = { text: string; color: string; bold: boolean };

const dateCell = (task: Task, today: string, dateFormat: "auto" | "md" | "full"): Cell => {
  if (!task.due) return { text: "—", color: C.dimmer, bold: false };
  const label = formatDate(task, today, dateFormat);
  if (isOverdue(task, today)) return { text: label, color: C.overdue, bold: true };
  const delta = dayDelta(localDate(task.due), today);
  if (delta === 0) return { text: label, color: C.accent, bold: true };
  if (delta <= 2) return { text: label, color: C.future, bold: false };
  return { text: label, color: C.dim, bold: false };
};

const priorityCell = (task: Task, levels: string[]): Cell => {
  const index = task.priority ? levels.indexOf(task.priority) : -1;
  if (index < 0 || !task.priority) return { text: "", color: C.dimmer, bold: false };
  const ratio = (index + 1) / levels.length;
  if (ratio >= 0.99) return { text: task.priority, color: C.hot, bold: true };
  if (ratio > 0.5) return { text: task.priority, color: C.warn, bold: false };
  return { text: task.priority, color: C.good, bold: false };
};

const statusCell = (task: Task): Cell => {
  if (task.status === "todo") return { text: "", color: C.dim, bold: false };
  return { text: task.status, color: STATUS_COLOR[task.status] ?? C.dim, bold: false };
};

const extrasSegments = (task: Task): Array<{ text: string; color: string }> => {
  const segments: Array<{ text: string; color: string }> = [];
  if (task.project) segments.push({ text: `◈${task.project} `, color: C.proj });
  for (const tag of task.tags) segments.push({ text: `#${tag} `, color: C.tag });
  if (task.recur) segments.push({ text: `↻${describeRecur(task.recur)} `, color: C.proj });
  if (task.notes.trim()) segments.push({ text: "✎ ", color: C.dim });
  const reminder = task.reminders.find((item) => !item.fired);
  if (reminder) segments.push({ text: `⏰${reminder.at.slice(5, 16).replace("T", " ")}`, color: C.yellow });
  return segments;
};

const truncateSegments = (segments: Array<{ text: string; color: string }>, width: number): Array<{ text: string; color: string }> => {
  const out: Array<{ text: string; color: string }> = [];
  let used = 0;
  for (const segment of segments) {
    const room = width - used;
    if (room <= 0) break;
    const text = truncateDisplay(segment.text, room);
    if (!text) break;
    out.push({ text, color: segment.color });
    used += displayWidth(text);
  }
  return out;
};

const GroupSeparator = ({ groupKey, name, count }: { groupKey: GroupKey; name: string; count: number }): React.ReactElement => {
  const color = GROUP_COLOR[groupKey] ?? C.dim;
  return (
    <Text>
      <Text color={color}>╾─ </Text>
      <Text bold color={color}>{name}</Text>
      <Text color={color}>{` ${count} `}</Text>
      <Text color={C.dimmer}>{"─".repeat(18)}</Text>
    </Text>
  );
};

const TaskRow = ({ task, selected, marked = false, today, dateFormat, levels, titleWidth, depth = 0 }: {
  task: Task;
  selected: boolean;
  marked?: boolean;
  today: string;
  dateFormat: "auto" | "md" | "full";
  levels: string[];
  titleWidth: number;
  depth?: number;
}): React.ReactElement => {
  // 子任务缩进后可用的标题宽度也跟着变窄，否则会挤掉右边的列
  const indent = depth > 0 ? `${"  ".repeat(depth - 1)}↳ ` : "";
  const check = marked ? "◉ " : "";
  const room = Math.max(4, titleWidth - displayWidth(indent) - displayWidth(check));
  const title = `${indent}${check}${truncateWithEllipsis(task.title, room)}`;
  const date = dateCell(task, today, dateFormat);
  const priority = priorityCell(task, levels);
  const status = statusCell(task);
  const extras = truncateSegments(extrasSegments(task), EXTRAS_W);
  const highlight = selected ? { backgroundColor: C.select } : {};
  return (
    <Text {...highlight}>
      <Text color={date.color} bold={date.bold}>{padDisplay(date.text, DATE_W)}</Text>
      <Text wrap="truncate">{padDisplay(title, titleWidth)}</Text>
      <Text color={priority.color} bold={priority.bold}>{padDisplay(priority.text, PRIORITY_W)}</Text>
      <Text color={status.color} bold={status.bold}>{padDisplay(status.text, STATUS_W)}</Text>
      {extras.map((segment, index) => <Text key={`${segment.text}-${index}`} color={segment.color}>{segment.text}</Text>)}
    </Text>
  );
};

// ---------------------------------------------------------------- 横幅 / 状态栏
const Banner = ({ columns }: { columns: number | undefined }): React.ReactElement => {
  const lines = columns === undefined || columns >= 72 ? BANNER_FULL : BANNER_SMALL;
  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
      {lines.map((line, index) => (
        <Text key={index} color={BANNER_COLORS[index % BANNER_COLORS.length] ?? C.hot}>{line}</Text>
      ))}
    </Box>
  );
};

const BannerInfo = ({ query, sortMode, tasks, clock, marked = 0 }: {
  query: string;
  sortMode: "levels" | "urgency";
  tasks: Task[];
  clock: Date;
  marked?: number;
}): React.ReactElement => {
  const today = nowLocal().slice(0, 10);
  const overdue = tasks.filter((task) => isOverdue(task, today)).length;
  const dueToday = tasks.filter((task) => (task.status === "todo" || task.status === "meeting") && task.due !== undefined && localDate(task.due) === today).length;
  const active = tasks.filter((task) => task.status === "todo" || task.status === "waiting" || task.status === "meeting").length;
  const hhmm = `${String(clock.getHours()).padStart(2, "0")}:${String(clock.getMinutes()).padStart(2, "0")}`;
  return (
    <Box justifyContent="flex-end" paddingLeft={1} paddingRight={1}>
      <Text>
        {marked ? <Text bold color={C.hot}>{`◉${marked} `}</Text> : null}
        {query ? <Text color={C.dim}>过滤 </Text> : null}
        {query ? <Text color={C.yellow}>{query}</Text> : null}
        {query ? <Text color={C.dim}>{"   "}</Text> : null}
        <Text color={C.accent}>{`${MODE_LABEL[sortMode]}排序`}</Text>
        <Text color={C.dim}>{"   "}</Text>
        <Text bold color={C.overdue}>{`!${overdue}`}</Text>
        <Text color={C.dim}>{"  "}</Text>
        <Text color={C.accent}>●</Text>
        <Text bold color={C.accent}>{String(dueToday)}</Text>
        <Text color={C.dim}>{"  "}</Text>
        <Text color={C.dim}>∑</Text>
        <Text bold color={C.accent}>{String(active)}</Text>
        <Text color={C.dim}>{`   ${hhmm}`}</Text>
      </Text>
    </Box>
  );
};

// ---------------------------------------------------------------- 预览行 / 输入框 / Footer
const PreviewLine = ({ state, levels }: { state: TuiState; levels: string[] }): React.ReactElement => {
  if (!state.input) {
    if (state.flashMessage) return <Text color={C.flash}>{`› ${state.flashMessage}`}</Text>;
    const hint = state.mode.kind === "list"
      ? "清单区：j/k 移动 · d 完成 · l 详情 · 空格多选 · 打字即添加 · : 命令"
      : "输入区：Enter 提交 · Esc 回清单";
    return <Text><Text color={C.accent}>› </Text><Text color={C.dimmer}>{hint}</Text></Text>;
  }
  if (state.input.startsWith(":") || state.input.startsWith("/")) {
    return <Text><Text color={C.accent}>› </Text><Text color={C.dim}>命令：list &lt;查询&gt; / undo / sync / mode levels|urgency / archive / cancel / meeting / todo / wait &lt;日期&gt; / snooze &lt;分钟&gt; / quit</Text></Text>;
  }
  return (
    <Text>
      <Text color={C.accent}>› </Text>
      {state.mode.kind === "edit" ? <Text color={C.yellow}>编辑中(回车保存,Esc取消) </Text> : null}
      <Text>{preview(state.input, nowLocal(), levels)}</Text>
    </Text>
  );
};

const InputBar = ({ state }: { state: TuiState }): React.ReactElement => {
  const active = state.mode.kind !== "list";
  const chars = [...state.input];
  const cursor = Math.max(0, Math.min(chars.length, state.inputCursor));
  // 光标块：覆盖光标处字符；光标在末尾时覆盖一个空格
  const under = active ? (chars[cursor] ?? " ") : " ";
  const before = active ? chars.slice(0, cursor).join("") : state.input;
  const after = active ? chars.slice(cursor + 1).join("") : "";
  return (
    <Box
      borderStyle="single"
      borderTop={false}
      borderLeft={false}
      borderRight={false}
      borderColor={active ? C.accent : C.border}
      paddingLeft={1}
      paddingRight={1}
    >
      <Text>
        {!active && !state.input ? <Text color={C.dimmer}>{INPUT_PLACEHOLDER}</Text> : null}
        <Text>{before}</Text>
        {active ? <Text inverse bold>{under}</Text> : null}
        <Text>{after}</Text>
      </Text>
    </Box>
  );
};

const FOOTER_KEYS = [
  { name: "help" as const, key: "?", label: "帮助" },
  { name: "input" as const, key: "i", label: "输入" },
  { name: "done" as const, key: "d", label: "完成" },
  { name: "quit" as const, key: "q", label: "退出" },
];
// 每个 Footer 键的屏幕列区间（1 起，含键帽与标签）。布局：Box paddingLeft=1
// 占第 1 列；每项 = 键帽 ` x `(3 列) + 空格(1) + 标签(width 列) + 3 空格。
export const footerKeyRanges = (): Array<{ name: "help" | "input" | "done" | "quit"; start: number; end: number }> => {
  const ranges: Array<{ name: "help" | "input" | "done" | "quit"; start: number; end: number }> = [];
  let column = 2; // paddingLeft 1 → 内容从第 2 列开始
  for (const entry of FOOTER_KEYS) {
    const entryWidth = 3 + 1 + displayWidth(entry.label) + 3;
    ranges.push({ name: entry.name, start: column, end: column + entryWidth - 1 });
    column += entryWidth;
  }
  return ranges;
};
const FooterBar = (): React.ReactElement => (
  <Box paddingLeft={1} paddingRight={1}>
    <Text>
      {FOOTER_KEYS.map((entry) => (
        <React.Fragment key={entry.name}>
          <Text bold color="black" backgroundColor={C.dim}>{` ${entry.key} `}</Text>
          <Text color={C.dim}>{` ${entry.label}   `}</Text>
        </React.Fragment>
      ))}
    </Text>
  </Box>
);

// ---------------------------------------------------------------- 弹窗
// Ink 从上往下渲染，没有「垂直居中」布局；按终端剩余高度在弹窗上方垫空行。
// 整帧必须严格等于终端行数（外层 height:rows + 底部 Footer）——一旦溢出，
// 矮终端里整帧上卷，上一帧的残留（比如旧 Footer）会留在屏幕顶部。
const ModalShell = ({ rows, children }: {
  rows?: number | undefined;
  children: React.ReactNode;
}): React.ReactElement => (
  <Box flexDirection="column" {...(rows !== undefined ? { height: rows } : {})}>
    <Box flexDirection="column" flexGrow={1}>{children}</Box>
    <FooterBar />
  </Box>
);

const ModalPage = ({ rows, contentLines, children }: {
  rows?: number | undefined;
  contentLines: number;
  children: React.ReactNode;
}): React.ReactElement => {
  // 减 1 给 ModalShell 底部的 Footer 行
  const pad = rows === undefined ? 0 : Math.max(0, Math.floor((rows - 1 - contentLines) / 2));
  return (
    <Box flexDirection="column">
      {Array.from({ length: pad }, (_, index) => <Text key={index}> </Text>)}
      {children}
    </Box>
  );
};

const HelpRows = ({ entries, keysWidth }: {
  entries: ReadonlyArray<readonly [string, string]>;
  keysWidth: number;
}): React.ReactElement => (
  <>
    {entries.map(([keys, description], index) => (
      <Box key={`${index}-${keys}`} flexDirection="row">
        <Box width={keysWidth}><Text color={C.accent}>{keys}</Text></Box>
        <Box flexGrow={1} flexShrink={1}><Text>{description}</Text></Box>
      </Box>
    ))}
  </>
);

const HelpModal = ({ rows }: { rows?: number | undefined }): React.ReactElement => {
  // 终端放得下完整版（留 2 行余量）就用完整版；矮终端自动切紧凑版，
  // 保证弹窗永远完整可见。高度未知（测试/管道）时保持完整版。
  const full = rows === undefined || rows >= FULL_HELP_LINES + 2;
  return (
    <ModalPage rows={rows} contentLines={full ? FULL_HELP_LINES : COMPACT_HELP_LINES}>
      <Box flexDirection="column" alignItems="center">
        <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingLeft={2} paddingRight={2}>
          <Text><Text bold color={C.accent}>atd 帮助</Text><Text color={C.dim}>   （按任意键关闭）</Text></Text>
          {full ? HELP_SECTIONS.map(([section, entries]) => (
            <React.Fragment key={section}>
              <Text bold color={C.warn}>{section}</Text>
              <HelpRows entries={entries} keysWidth={34} />
            </React.Fragment>
          )) : <HelpRows entries={COMPACT_HELP_ROWS} keysWidth={10} />}
        </Box>
      </Box>
    </ModalPage>
  );
};

const WELCOME_LINES = 3 + WELCOME_ROWS.length;

const WelcomeModal = ({ rows }: { rows?: number | undefined }): React.ReactElement => (
  <ModalPage rows={rows} contentLines={WELCOME_LINES}>
    <Box flexDirection="column" alignItems="center">
      <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingLeft={2} paddingRight={2}>
        <Text><Text bold color={C.accent}>👋 atd 上手三分钟</Text><Text color={C.dim}>   （按任意键开始）</Text></Text>
        <HelpRows entries={WELCOME_ROWS} keysWidth={34} />
      </Box>
    </Box>
  </ModalPage>
);

// ---------------------------------------------------------------- 详情 / 确认浮层
const DetailRow = ({ label, value }: { label: string; value: string }): React.ReactElement => (
  <Box flexDirection="row">
    <Box width={10}><Text color={C.dim}>{label}</Text></Box>
    <Box flexGrow={1} flexShrink={1}><Text wrap="wrap">{value}</Text></Box>
  </Box>
);

/** notes 一直只存不显示；详情浮层就是给它一个真正能看到的地方 */
const DetailModal = ({ task, children: subtasks, parent, rows, columns }: {
  task: Task;
  children: Task[];
  parent: Task | undefined;
  rows?: number | undefined;
  columns?: number | undefined;
}): React.ReactElement => {
  const noteLines = task.notes.trim() ? task.notes.split(/\r?\n/) : [];
  const fields: Array<[string, string]> = [
    [t("field.status"), task.status],
    [t("field.due"), task.due ? task.due.replace("T", " ").slice(0, 16) : t("value.none")],
    [t("field.priority"), task.priority ?? t("value.none")],
    [t("field.project"), task.project ?? t("value.none")],
    [t("field.tags"), task.tags.length ? task.tags.map((tag) => `#${tag}`).join(" ") : t("value.none")],
    [t("field.wait"), task.wait ?? t("value.none")],
    [t("field.recur"), task.recur ? describeRecur(task.recur) : t("value.none")],
  ];
  if (parent) fields.push([t("field.parent"), `${parent.id} ${parent.title}`]);
  if (subtasks.length) fields.push([t("field.subtasks"), subtasks.map((child) => `${child.status === "done" ? "✓" : "·"} ${child.title}`).join("  ")]);
  fields.push([t("field.entry"), task.entry.replace("T", " ").slice(0, 16)]);
  if (task.end) fields.push([t("field.end"), task.end.replace("T", " ").slice(0, 16)]);
  const reminderLines = task.reminders.map((reminder) => `${reminder.at.replace("T", " ")}  ${reminder.hooks.join(",")}  ${reminder.dead ? t("reminder.dead") : reminder.fired ? t("reminder.sent") : t("reminder.pending")}`);
  const contentLines = 4 + fields.length + (reminderLines.length ? reminderLines.length + 1 : 0) + (noteLines.length ? noteLines.length + 1 : 0);
  const width = Math.min(Math.max(40, (columns ?? 80) - 8), 100);
  return (
    <ModalPage rows={rows} contentLines={contentLines}>
      <Box flexDirection="column" alignItems="center">
        <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingLeft={2} paddingRight={2} width={width}>
          <Text><Text bold color={C.accent}>{truncateWithEllipsis(task.title, width - 16)}</Text><Text color={C.dimmer}>{`  ${task.id}`}</Text></Text>
          {fields.map(([label, value]) => <DetailRow key={label} label={label} value={value} />)}
          {reminderLines.length ? <Text bold color={C.warn}>{t("field.reminders")}</Text> : null}
          {reminderLines.map((line) => <Text key={line} color={C.yellow}>{`  ${line}`}</Text>)}
          {noteLines.length ? <Text bold color={C.warn}>{t("field.notes")}</Text> : null}
          {noteLines.map((line, index) => <Text key={`${index}-${line}`} wrap="wrap">{`  ${line}`}</Text>)}
          <Text color={C.dim}>j/k 看上下一条 · e 编辑 · 其他键关闭</Text>
        </Box>
      </Box>
    </ModalPage>
  );
};

const ConfirmModal = ({ prompt, rows }: { prompt: string; rows?: number | undefined }): React.ReactElement => (
  <ModalPage rows={rows} contentLines={4}>
    <Box flexDirection="column" alignItems="center">
      <Box flexDirection="column" borderStyle="round" borderColor={C.overdue} paddingLeft={2} paddingRight={2}>
        <Text bold color={C.overdue}>请确认</Text>
        <Text wrap="wrap">{prompt}</Text>
        <Text color={C.dim}>y 或 Enter 确认 · 其他任意键取消</Text>
      </Box>
    </Box>
  </ModalPage>
);

// ---------------------------------------------------------------- 主组件
type TableLine = { kind: "sep"; groupKey: GroupKey; name: string; count: number } | { kind: "task"; task: Task; depth: number; index: number };

/** 完成任务并把「派生了下一次」「还有子任务没做」这两件事说清楚，别让用户自己去发现 */
const completeAndDescribe = async (service: ApplicationService, id: string): Promise<string> => {
  const result = await service.complete(id);
  const extras: string[] = [];
  if (result.next) extras.push(`下一次 ${result.next.due ? result.next.due.slice(0, 10) : "无日期"}`);
  if (result.openChildren.length) extras.push(`还有 ${result.openChildren.length} 个子任务没完成`);
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

/** 打了勾就对勾选的那些干活，没打勾就对光标所在这条干活 */
const targetIds = (state: TuiState, selected: Task): string[] => state.marked.length ? [...state.marked] : [selected.id];

export const TuiApp = ({ store, testSignals, welcome = false, terminalRows }: TuiProps): React.ReactElement => {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const columns = typeof stdout?.columns === "number" && stdout.columns > 0 ? stdout.columns : undefined;
  const rows = typeof stdout?.rows === "number" && stdout.rows > 0 ? stdout.rows : terminalRows;
  const service = useMemo(() => new ApplicationService(store), [store]);
  const [config, setConfig] = useState<Config>();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dataRevision, setDataRevision] = useState(0);
  const [state, dispatch] = useReducer(tuiReducer, undefined, () => initialTuiState());
  const [clock, setClock] = useState(() => new Date());
  const [actionSequence, setActionSequence] = useState(0);
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
  const stateRef = useRef(state);
  const configRef = useRef(config);
  const selectedRef = useRef(selected);
  const configInitRef = useRef(false);
  stateRef.current = state;
  configRef.current = config;
  selectedRef.current = selected;

  const refresh = useCallback(async () => {
    const nextConfig = await service.config();
    const nextTasks = await service.tasks();
    setConfig(nextConfig);
    setTasks(nextTasks);
    setDataRevision((revision) => revision + 1);
  }, [service]);
  useEffect(() => { void refresh().catch((error: unknown) => dispatch({ type: "flash", message: error instanceof Error ? error.message : String(error) })); }, [refresh]);
  useEffect(() => { const timer = setInterval(() => { void refresh().catch(() => {}); }, 30_000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => { const timer = setInterval(() => setClock(new Date()), 10_000); return () => clearInterval(timer); }, []);
  // 首次拿到配置后同步排序模式与日期列格式（对应 Python 版启动时读 config）
  useEffect(() => {
    if (!config || configInitRef.current) return;
    configInitRef.current = true;
    dispatch({ type: "sort", mode: config.priority.mode });
    dispatch({ type: "dateFormat", format: config.agenda.date_format });
  }, [config]);
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
        else if (command === "sync") dispatch({ type: "flash", message: await service.sync() });
        else if (command === "mode urgency") { dispatch({ type: "sort", mode: "urgency" }); dispatch({ type: "flash", message: "排序模式：urgency" }); }
        else if (command === "mode levels") { dispatch({ type: "sort", mode: "levels" }); dispatch({ type: "flash", message: "排序模式：档位" }); }
        else if (command === "list") { dispatch({ type: "query", value: "" }); dispatch({ type: "flash", message: "已清除过滤" }); }
        else if (command.startsWith("list ")) { dispatch({ type: "query", value: command.slice(5) }); dispatch({ type: "flash", message: `过滤：${command.slice(5)}` }); }
        else if (command.startsWith("archive")) { const days = command.split(/\s+/u)[1]; dispatch({ type: "flash", message: `归档了 ${await service.archive(days ? Number(days) : 14)} 行` }); }
        else if (verb === "cancel" || verb === "meeting" || verb === "todo") {
          if (!ids.length) dispatch({ type: "flash", message: "先选中一条任务" });
          else {
            const status = verb === "cancel" ? "cancelled" : verb;
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
    if (action.type === "move") { dispatch({ type: "select", index: currentState.selectedIndex + action.delta }); return; }
    if (action.type === "page") {
      // 一页按可见任务行数算，翻不动就贴到首尾
      const page = Math.max(1, (rows ?? 24) - CHROME_LINES - 1);
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
      if (action.name === "sync") { runMutation(() => service.sync()); return; }
      if (action.name === "i") { dispatch({ type: "mode", mode: { kind: "add" } }); return; }
      if (action.name === "e" && currentSelected) { dispatch({ type: "mode", mode: { kind: "edit", taskId: currentSelected.id } }); dispatch({ type: "input", value: taskToInput(currentSelected) }); return; }
      if (action.name === "d" && currentSelected) {
        const ids = targetIds(currentState, currentSelected);
        runMutation(() => runBatch(ids, "✓ 已完成", (id) => completeAndDescribe(service, id)));
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
        runMutation(() => runBatch(ids, "↩ 已重新打开", async (id) => `↩ 重新打开：${(await service.reopen(id)).title}`));
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
          runMutation(async () => `↩ 重新打开：${(await service.reopen(task.id)).title}`);
          return;
        }
        runMutation(() => completeAndDescribe(service, task.id));
      }
    }
  }, [dispatch, exit, refresh, runMutation, service, store, tasks, visible]);

  const today = nowLocal().slice(0, 10);
  const levels = config ? [...config.priority.levels] : ["低", "中", "高"];
  // TODO 列占剩余宽度：总宽 - 四个固定列 - 表格边框与内边距（4）
  const titleWidth = Math.max(10, (columns ?? 80) - DATE_W - PRIORITY_W - STATUS_W - EXTRAS_W - 4);
  const lines: TableLine[] = [];
  let taskIndex = 0;
  for (const group of visibleGroups) {
    lines.push({ kind: "sep", groupKey: group.key, name: group.name, count: group.tasks.length });
    for (const { task, depth } of group.nested) lines.push({ kind: "task", task, depth, index: taskIndex++ });
  }
  // 终端高度已知时做滚动窗口，保证选中行始终可见
  let windowStart = 0;
  if (rows !== undefined && lines.length > Math.max(4, rows - CHROME_LINES)) {
    const avail = Math.max(4, rows - CHROME_LINES);
    const selectedLine = lines.findIndex((line) => line.kind === "task" && line.index === state.selectedIndex);
    const anchor = selectedLine < 0 ? 0 : selectedLine;
    windowStart = Math.max(0, Math.min(anchor - Math.floor(avail / 2), lines.length - avail));
  }
  const windowLines = lines.slice(windowStart);

  // ------------------------------------------------ 鼠标交互
  // 注意：以下钩子必须位于弹窗 early return 之前，否则帮助/欢迎弹窗打开时
  // 钩子数量变化会让 React 抛 "Rendered fewer hooks" 直接退出（表现为闪退）。
  // 布局行号（1 起，alt-screen 绝对坐标）：内容首行 = 横幅可见行数 + 信息行
  // 1 + 表格上边框 1 + 表头 1。BANNER_FULL 末行是空串（Ink 不渲染空行），
  // 可见 5 行；BANNER_SMALL 两行都非空，可见 2 行。
  const bannerVisibleLines = columns !== undefined && columns < 72
    ? BANNER_SMALL.length
    : BANNER_FULL.length - 1;
  const firstTaskRow = bannerVisibleLines + 4;
  const viewRef = useRef({ lines: [] as TableLine[], windowStart: 0 });
  viewRef.current = { lines, windowStart };
  const keyboardRef = useRef(handleKeyboard);
  keyboardRef.current = handleKeyboard;
  useEffect(() => subscribeMouse((event: MouseEvent) => {
    const currentState = stateRef.current;
    const { lines: currentLines, windowStart: start } = viewRef.current;
    // 弹窗打开时任意点击关闭（和任意键关闭一致）
    if (currentState.mode.kind === "help" || currentState.mode.kind === "welcome" || currentState.mode.kind === "detail" || currentState.mode.kind === "confirm") {
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
    if (rows !== undefined && event.y === rows) {
      const hit = footerKeyRanges().find((range) => event.x >= range.start && event.x <= range.end);
      if (hit) {
        const keyByFooter: Record<typeof hit.name, { input: string; key: KeyEvent["key"] }> = {
          help: { input: "?", key: { ctrl: false } },
          input: { input: "i", key: { ctrl: false } },
          done: { input: "d", key: { ctrl: false } },
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
    const bottomInputRow = (rows ?? 24) - 2;
    if (event.y >= bottomInputRow && (rows === undefined || event.y < rows)) {
      if (currentState.mode.kind === "list") dispatch({ type: "mode", mode: { kind: "add" } });
      return;
    }
    // 点击任务行：选中该行；再点同一行 = 完成/重开任务（Textual 行点击语义）。
    // firstTaskRow 是内容首行的屏幕行号（1 起）：横幅可见行数 + 信息行 + 表格
    // 边框 + 表头。注意 BANNER_FULL 末行是空串，Ink 不渲染空行，实际少占一行。
    const lineIndex = event.y - firstTaskRow + start;
    const line = currentLines[lineIndex];
    if (line && line.kind === "task") {
      if (line.index === currentState.selectedIndex) {
        const task = line.task;
        if (task.status === "done") runMutation(async () => `↩ 重新打开：${(await service.reopen(task.id)).title}`);
        else runMutation(() => completeAndDescribe(service, task.id));
      } else {
        dispatch({ type: "select", index: line.index });
      }
    }
  }), [columns, dispatch, runMutation, service, rows]);

  if (state.mode.kind === "help") return <ModalShell rows={rows}><HelpModal rows={rows} /></ModalShell>;
  if (state.mode.kind === "welcome") return <ModalShell rows={rows}><WelcomeModal rows={rows} /></ModalShell>;
  if (state.mode.kind === "confirm") return <ModalShell rows={rows}><ConfirmModal prompt={state.mode.prompt} rows={rows} /></ModalShell>;
  if (state.mode.kind === "detail" && detailTask) {
    return (
      <ModalShell rows={rows}>
        <DetailModal task={detailTask} parent={detailParent} rows={rows} columns={columns}>{detailChildren}</DetailModal>
      </ModalShell>
    );
  }

  return (
    <Box flexDirection="column" {...(rows !== undefined ? { height: rows } : {})}>
      <Banner columns={columns} />
      <BannerInfo query={state.query} sortMode={state.sortMode} tasks={tasks} clock={clock} marked={state.marked.length} />
      <Box flexDirection="column" flexGrow={1} borderStyle="round" borderColor={C.border} paddingLeft={1} paddingRight={1}>
        <Box flexDirection="row">
          <Box width={DATE_W}><Text bold color={C.dim}>日期</Text></Box>
          <Box flexGrow={1}><Text bold color={C.dim}>TODO</Text></Box>
          <Box width={PRIORITY_W}><Text bold color={C.dim}>紧急度</Text></Box>
          <Box width={STATUS_W}><Text bold color={C.dim}>状态</Text></Box>
          <Box width={EXTRAS_W}><Text bold color={C.dim}>标签 / 提醒</Text></Box>
        </Box>
        {lines.length === 0 ? <Text color={C.dimmer}>（没有任务）</Text> : windowLines.map((line) => (
          line.kind === "sep"
            ? <GroupSeparator key={`sep-${line.groupKey}-${line.count}`} groupKey={line.groupKey} name={line.name} count={line.count} />
            : <TaskRow key={line.task.id} task={line.task} selected={line.index === state.selectedIndex} marked={state.marked.includes(line.task.id)} today={today} dateFormat={state.dateFormat} levels={levels} titleWidth={titleWidth} depth={line.depth} />
        ))}
      </Box>
      <Box paddingLeft={2} paddingRight={2}><PreviewLine state={state} levels={levels} /></Box>
      <InputBar state={state} />
      <FooterBar />
    </Box>
  );
};
