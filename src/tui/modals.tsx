// 浮层：帮助、上手引导、任务详情、删除确认、依赖图、设置、后续任务选择、操作历史。
//
// Ink 从上往下渲染，没有「垂直居中」布局，所以 ModalPage 按终端剩余高度在
// 弹窗上方垫空行。整帧必须严格等于终端行数（ModalShell 的 height:rows +
// 底部 Footer）——一旦溢出，矮终端里整帧上卷，上一帧的残留会留在屏幕顶部。
//
// 所有对话框共用一套规格（Dialog）：同一种边框、标题行、上下各一行留白、
// 左右两格内边距、最后一行是操作提示。
import React from "react";
import { Box, Text } from "ink";

import type { Task } from "../contracts.js";
import { GRAPH_MARK, renderGraphLine, type GraphLine } from "../core/deps.js";
import type { Config } from "../contracts.js";
import { t } from "../core/i18n.js";
import type { SettingItem } from "./settings.js";
import { describeRecur } from "../core/parse.js";
import { formatDate } from "../core/agenda.js";
import { displayWidth, padDisplay, truncateWithEllipsis } from "../core/width.js";
import { FooterBar, footerHeight, type FooterButton } from "./chrome.js";
import {
  C, COMPACT_HELP_LINES, SKIN, COMPACT_HELP_ROWS, FULL_HELP_LINES, HELP_SECTIONS, WELCOME_ROWS,
} from "./theme.js";

export const ModalShell = ({ rows, pressed, hovered, children }: {
  rows?: number | undefined;
  pressed?: FooterButton | undefined;
  hovered?: FooterButton | undefined;
  children: React.ReactNode;
}): React.ReactElement => (
  <Box flexDirection="column" {...(rows !== undefined ? { height: rows } : {})}>
    <Box flexDirection="column" flexGrow={1}>{children}</Box>
    <FooterBar pressed={pressed} hovered={hovered} />
  </Box>
);

/** 浮层上方垫的空行数；鼠标点击换算行号时要用同一个公式 */
export const modalPad = (rows: number | undefined, contentLines: number): number =>
  rows === undefined ? 0 : Math.max(0, Math.floor((rows - footerHeight() - contentLines) / 2));

/** 对话框边框 + 上下留白占的行数；内容行数加上它就是整个对话框的高度 */
export const DIALOG_CHROME = 4;

const ModalPage = ({ rows, contentLines, children }: {
  rows?: number | undefined;
  contentLines: number;
  children: React.ReactNode;
}): React.ReactElement => {
  // 减掉 ModalShell 底部的 Footer 行
  const pad = modalPad(rows, contentLines);
  return (
    <Box flexDirection="column">
      {Array.from({ length: pad }, (_, index) => <Text key={index}> </Text>)}
      {children}
    </Box>
  );
};

/**
 * 统一的对话框外壳：居中、同一种边框、上下各留一行空白、左右两格内边距。
 * totalLines 是整个对话框（含边框和留白）的高度，用来算垂直居中。
 */
const Dialog = ({ rows, totalLines, title, subtitle, color = C.accent, width, children }: {
  rows?: number | undefined;
  totalLines: number;
  title: string;
  subtitle?: string | undefined;
  color?: string;
  width?: number | undefined;
  children: React.ReactNode;
}): React.ReactElement => (
  <ModalPage rows={rows} contentLines={totalLines}>
    <Box flexDirection="column" alignItems="center">
      <Box flexDirection="column" borderStyle={SKIN.border} borderColor={color} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} {...(width !== undefined ? { width } : {})}>
        <Text wrap="truncate"><Text bold color={color}>{title}</Text>{subtitle ? <Text color={C.dim}>{`   ${subtitle}`}</Text> : null}</Text>
        {children}
      </Box>
    </Box>
  </ModalPage>
);

/** 列表滚动窗口的起点：让选中行尽量居中，到头了就贴边 */
export const listStart = (selected: number, total: number, room: number): number => Math.max(0, Math.min(selected - Math.floor(room / 2), total - room));

/** 对话框宽度：跟终端走，但别太宽，长行难读 */
export const dialogWidth = (columns: number | undefined, max = 96): number => Math.min(Math.max(40, (columns ?? 80) - 8), max);

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

/** 帮助页整个对话框的高度：终端放得下完整版（留 2 行余量）就用完整版，矮终端自动切紧凑版 */
export const helpLines = (rows: number | undefined): number => rows === undefined || rows >= FULL_HELP_LINES + 2 ? FULL_HELP_LINES : COMPACT_HELP_LINES;

export const HelpModal = ({ rows }: { rows?: number | undefined }): React.ReactElement => {
  // 保证弹窗永远完整可见。高度未知（测试/管道）时保持完整版。
  const full = helpLines(rows) === FULL_HELP_LINES;
  return (
    <Dialog rows={rows} totalLines={helpLines(rows)} title="atd 帮助" subtitle="按任意键关闭">
      {full ? HELP_SECTIONS.map(([section, entries]) => (
        <React.Fragment key={section}>
          <Text bold color={C.warn}>{section}</Text>
          <HelpRows entries={entries} keysWidth={34} />
        </React.Fragment>
      )) : <HelpRows entries={COMPACT_HELP_ROWS} keysWidth={10} />}
    </Dialog>
  );
};

export const WELCOME_LINES = DIALOG_CHROME + 1 + WELCOME_ROWS.length;

export const WelcomeModal = ({ rows }: { rows?: number | undefined }): React.ReactElement => (
  <Dialog rows={rows} totalLines={WELCOME_LINES} title="👋 atd 上手三分钟" subtitle="按任意键开始">
    <HelpRows entries={WELCOME_ROWS} keysWidth={34} />
  </Dialog>
);

const DetailRow = ({ label, value }: { label: string; value: string }): React.ReactElement => (
  <Box flexDirection="row">
    <Box width={10}><Text color={C.dim}>{label}</Text></Box>
    <Box flexGrow={1} flexShrink={1}><Text wrap="wrap">{value}</Text></Box>
  </Box>
);

type DetailParts = { fields: Array<[string, string]>; reminderLines: string[]; noteLines: string[] };

const detailParts = (task: Task, subtasks: Task[], parent: Task | undefined, deps: Task[], dependents: Task[]): DetailParts => {
  const noteLines = task.notes.trim() ? task.notes.split(/\r?\n/) : [];
  const fields: Array<[string, string]> = [
    [t("field.status"), task.status],
    [t("field.due"), task.due ? `${task.due.replace("T", " ").slice(0, 16)}${task.until ? `-${task.until.slice(11, 16)}` : ""}` : t("value.none")],
    [t("field.priority"), task.priority ?? t("value.none")],
    [t("field.project"), task.project ?? t("value.none")],
    [t("field.tags"), task.tags.length ? task.tags.map((tag) => `#${tag}`).join(" ") : t("value.none")],
    [t("field.wait"), task.wait ?? t("value.none")],
    [t("field.recur"), task.recur ? describeRecur(task.recur) : t("value.none")],
  ];
  if (parent) fields.push([t("field.parent"), `${parent.id} ${parent.title}`]);
  const doneMark = (item: Task): string => item.status === "done" || item.status === "cancelled" ? "✓" : "·";
  if (deps.length) fields.push([t("field.deps"), deps.map((dep) => `${doneMark(dep)} ${dep.title}`).join("  ")]);
  if (dependents.length) fields.push([t("field.dependents"), dependents.map((next) => `${doneMark(next)} ${next.title}`).join("  ")]);
  if (subtasks.length) fields.push([t("field.subtasks"), subtasks.map((child) => `${child.status === "done" ? "✓" : "·"} ${child.title}`).join("  ")]);
  fields.push([t("field.entry"), task.entry.replace("T", " ").slice(0, 16)]);
  if (task.end) fields.push([t("field.end"), task.end.replace("T", " ").slice(0, 16)]);
  const reminderLines = task.reminders.map((reminder) => `${reminder.at.replace("T", " ")}  ${reminder.hooks.join(",")}  ${reminder.dead ? t("reminder.dead") : reminder.fired ? t("reminder.sent") : t("reminder.pending")}`);
  return { fields, reminderLines, noteLines };
};

/** 详情对话框整个的高度；鼠标判断点在框内还是框外要用 */
export const detailLines = (task: Task, subtasks: Task[], parent: Task | undefined, deps: Task[], dependents: Task[]): number => {
  const { fields, reminderLines, noteLines } = detailParts(task, subtasks, parent, deps, dependents);
  return DIALOG_CHROME + 2 + fields.length + (reminderLines.length ? reminderLines.length + 1 : 0) + (noteLines.length ? noteLines.length + 1 : 0);
};

/** notes 一直只存不显示；详情浮层就是给它一个真正能看到的地方 */
export const DetailModal = ({ task, children: subtasks, parent, deps = [], dependents = [], rows, columns }: {
  task: Task;
  children: Task[];
  parent: Task | undefined;
  deps?: Task[];
  dependents?: Task[];
  rows?: number | undefined;
  columns?: number | undefined;
}): React.ReactElement => {
  const { fields, reminderLines, noteLines } = detailParts(task, subtasks, parent, deps, dependents);
  const totalLines = detailLines(task, subtasks, parent, deps, dependents);
  const width = dialogWidth(columns, 100);
  return (
    <Dialog rows={rows} totalLines={totalLines} title={truncateWithEllipsis(task.title, width - 20)} subtitle={task.id} width={width}>
      {fields.map(([label, value]) => <DetailRow key={label} label={label} value={value} />)}
      {reminderLines.length ? <Text bold color={C.warn}>{t("field.reminders")}</Text> : null}
      {reminderLines.map((line) => <Text key={line} color={C.yellow}>{`  ${line}`}</Text>)}
      {noteLines.length ? <Text bold color={C.warn}>{t("field.notes")}</Text> : null}
      {noteLines.map((line, index) => <Text key={`${index}-${line}`} wrap="wrap">{`  ${line}`}</Text>)}
      <Text color={C.dim}>j/k 看上下一条 · e 编辑 · 其他键关闭</Text>
    </Dialog>
  );
};

export const CONFIRM_LINES = DIALOG_CHROME + 3;

export const ConfirmModal = ({ prompt, rows }: { prompt: string; rows?: number | undefined }): React.ReactElement => (
  <Dialog rows={rows} totalLines={CONFIRM_LINES} title="请确认" color={C.overdue}>
    <Text wrap="wrap">{prompt}</Text>
    <Text color={C.dim}>y 或 Enter 确认 · 其他任意键取消</Text>
  </Dialog>
);

const GRAPH_COLOR: Record<GraphLine["mark"], string> = { done: C.dimmer, ready: C.good, blocked: C.warn };

const GRAPH_STATUS: Partial<Record<Task["status"], string>> = { doing: "在做", waiting: "等待", paused: "暂停", cancelled: "已取消", meeting: "会议" };

/** 依赖图里每个节点后面的小注：到期日、状态，点点头就知道它现在在哪 */
const graphNote = (task: Task, today: string): string => {
  const parts: string[] = [];
  if (task.due) parts.push(formatDate(task, today, "auto").trim());
  if (task.status !== "todo" && task.status !== "done") parts.push(GRAPH_STATUS[task.status] ?? task.status);
  return parts.length ? `  ${parts.join(" · ")}` : "";
};

/** 依赖图页除了图本身占的行数：边框 2 + 上下留白 2 + 标题 1 + 图例 1 + 提示 1 */
export const GRAPH_CHROME = 7;
export const graphRoom = (rows: number | undefined, total: number): number => rows === undefined ? total : Math.max(1, rows - GRAPH_CHROME - footerHeight());

/**
 * 依赖图页：从没有前置的任务往后续画成树，多前置的节点只展开一次，别处画成「见上」。
 * 光标行可以按 a 加后续、x 删掉这条边、回车跳到清单。终端放不下时跟着光标滚动。
 */
export const GraphModal = ({ lines, selected, rows, columns, today }: {
  lines: GraphLine[];
  selected: number;
  rows?: number | undefined;
  columns?: number | undefined;
  today: string;
}): React.ReactElement => {
  const room = graphRoom(rows, lines.length);
  const start = listStart(selected, lines.length, room);
  const width = Math.max(40, (columns ?? 80) - 2);
  const current = lines[selected];
  return (
    <Box flexDirection="column" borderStyle={SKIN.border} borderColor={C.accent} paddingLeft={2} paddingRight={2} paddingTop={1} paddingBottom={1} width={width} {...(rows !== undefined ? { height: rows - footerHeight() } : {})}>
      <Text><Text bold color={C.accent}>依赖图</Text><Text color={C.dim}>{`   ${lines.filter((line) => !line.ref).length} 个任务参与依赖`}</Text></Text>
      <Text>
        <Text color={GRAPH_COLOR.ready}>{`${GRAPH_MARK.ready} 可以做`}</Text><Text>{"   "}</Text>
        <Text color={GRAPH_COLOR.blocked}>{`${GRAPH_MARK.blocked} 等前置`}</Text><Text>{"   "}</Text>
        <Text color={GRAPH_COLOR.done}>{`${GRAPH_MARK.done} 已完成`}</Text>
      </Text>
      <Box flexDirection="column" flexGrow={1}>
        {lines.length === 0
          ? <Text color={C.dimmer}>（还没有任务设置前置。回到清单选中一条任务按 a，就能给它挑后续任务）</Text>
          : lines.slice(start, start + room).map((line, index) => {
            const active = start + index === selected;
            return (
              <Text key={`${start + index}-${line.task.id}`} wrap="truncate" {...(active ? { backgroundColor: C.select } : {})}>
                <Text color={C.accent}>{active ? "▍" : " "}</Text>
                <Text color={line.ref ? C.dimmer : GRAPH_COLOR[line.mark]} bold={line.mark === "ready" && !line.ref}>{truncateWithEllipsis(renderGraphLine(line, false), width - 8)}</Text>
                {line.ref ? null : <Text color={C.dimmer}>{graphNote(line.task, today)}</Text>}
              </Text>
            );
          })}
      </Box>
      <Text color={C.dim}>{current ? `j/k 移动 · a 给「${truncateWithEllipsis(current.task.title, 12)}」加后续 · ${current.via ? "x 删掉这条边 · " : ""}回车跳到清单 · ` : ""}其他键返回</Text>
    </Box>
  );
};

/** 设置页对话框里逐行是什么：节标题、空行、还是某一项；鼠标点击按它反查 */
export const settingsRows = (items: SettingItem[]): Array<{ item: SettingItem | undefined; section?: string }> => {
  const out: Array<{ item: SettingItem | undefined; section?: string }> = [];
  let last: string | undefined;
  for (const item of items) {
    if (item.section !== last) { if (last !== undefined) out.push({ item: undefined }); out.push({ item: undefined, section: item.section }); last = item.section; }
    out.push({ item });
  }
  return out;
};

/** 设置页整个对话框的高度 */
export const settingsLines = (items: SettingItem[]): number => DIALOG_CHROME + 1 + settingsRows(items).length + 3;

/** 设置页：分节列出，左边是项目名，右边把所有可选值排开，当前值高亮，一眼看出还能选什么 */
export const SettingsModal = ({ items, config, selected, rows, columns }: {
  items: SettingItem[];
  config: Config;
  selected: number;
  rows?: number | undefined;
  columns?: number | undefined;
}): React.ReactElement => {
  const width = dialogWidth(columns);
  const labelWidth = 18;
  const current = items[selected];
  const lines = settingsRows(items);
  return (
    <Dialog rows={rows} totalLines={settingsLines(items)} title="设置" subtitle="改动立即保存到 config.toml" width={width}>
      {lines.map((line, index) => {
        if (line.section) return <Text key={`section-${line.section}`} bold color={C.warn}>{line.section}</Text>;
        if (!line.item) return <Text key={`gap-${index}`}> </Text>;
        const item = line.item;
        const active = items.indexOf(item) === selected;
        const value = item.current(config);
        return (
          <Text key={item.key} wrap="truncate" {...(active ? { backgroundColor: C.select } : {})}>
            <Text color={C.accent}>{active ? "▍" : " "}</Text>
            <Text bold={active} color={active ? C.accent : C.dim}>{padDisplay(item.label, labelWidth)}</Text>
            {item.options.map((option) => (
              <Text key={option.value} {...(option.value === value ? { bold: true, color: C.accent } : { color: C.dimmer })}>
                {option.value === value ? `‹${option.label}› ` : ` ${option.label}  `}
              </Text>
            ))}
          </Text>
        );
      })}
      <Text> </Text>
      <Text wrap="truncate" color={C.dim}>{current ? current.hint : ""}</Text>
      <Text color={C.dimmer}>j/k 选择 · ←/→ 或回车改值 · 鼠标点一下选中、再点换值 · Esc 返回</Text>
    </Dialog>
  );
};

/** 后续任务选择对话框整个的高度 */
export const depsLines = (rows: number | undefined, total: number): number => DIALOG_CHROME + 3 + Math.max(1, Math.min(total, depsRoom(rows)));

/** 后续任务选择列表里的一项 */
export type DepsCandidate = { task: Task; checked: boolean; disabled?: string | undefined };

/** 选择列表最多同时显示多少行候选 */
export const DEPS_ROOM = 12;
export const depsRoom = (rows: number | undefined): number => Math.min(DEPS_ROOM, Math.max(3, (rows ?? 30) - footerHeight() - DIALOG_CHROME - 5));

/**
 * 后续任务选择：给「它做完之后」挑哪些任务露出来。列表是所有还开着的任务，
 * 空格勾选，回车保存；会成环的项标灰不能选。
 */
export const DepsModal = ({ owner, candidates, selected, rows, columns }: {
  owner: Task;
  candidates: DepsCandidate[];
  selected: number;
  rows?: number | undefined;
  columns?: number | undefined;
}): React.ReactElement => {
  const width = dialogWidth(columns, 90);
  const room = depsRoom(rows);
  const start = listStart(selected, candidates.length, room);
  const shown = candidates.slice(start, start + room);
  return (
    <Dialog rows={rows} totalLines={depsLines(rows, candidates.length)} title={`「${truncateWithEllipsis(owner.title, width - 30)}」做完之后…`} subtitle={`已选 ${candidates.filter((item) => item.checked).length}`} width={width}>
      <Text color={C.dim}>勾选的任务会等它完成后才露出来</Text>
      {candidates.length === 0
        ? <Text color={C.dimmer}>没有别的任务可选；按 n 直接新建一条后续任务</Text>
        : shown.map((item, index) => {
          const active = start + index === selected;
          const color = item.disabled ? C.dimmer : item.checked ? C.accent : undefined;
          return (
            <Text key={item.task.id} wrap="truncate" {...(active ? { backgroundColor: C.select } : {})}>
              <Text color={C.accent}>{active ? "▍" : " "}</Text>
              <Text color={item.checked ? C.accent : C.dimmer}>{item.checked ? "◉ " : "○ "}</Text>
              <Text {...(color ? { color } : {})} bold={item.checked}>{truncateWithEllipsis(item.task.title, width - 24)}</Text>
              {item.disabled ? <Text color={C.dimmer}>{`  ${item.disabled}`}</Text> : item.task.project ? <Text color={C.dimmer}>{`  ◈ ${item.task.project}`}</Text> : null}
            </Text>
          );
        })}
      <Text color={C.dimmer}>{`空格 勾选 · 回车 保存 · n 新建一条后续 · Esc 取消${candidates.length > room ? `  （${start + 1}-${start + shown.length}/${candidates.length}）` : ""}`}</Text>
    </Dialog>
  );
};

/** 操作历史对话框整个的高度 */
export const historyLines = (total: number): number => DIALOG_CHROME + 2 + Math.max(1, total);

/** 操作历史：最近几步，选一步回退到它之前 */
export const HistoryModal = ({ steps, selected, rows, columns }: {
  steps: Array<{ ts: string; summary: string }>;
  selected: number;
  rows?: number | undefined;
  columns?: number | undefined;
}): React.ReactElement => {
  const width = dialogWidth(columns, 80);
  const local = (ts: string): string => {
    const date = new Date(ts);
    if (Number.isNaN(date.getTime())) return ts.slice(11, 16);
    const pad = (value: number): string => String(value).padStart(2, "0");
    return `${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
  };
  return (
    <Dialog rows={rows} totalLines={historyLines(steps.length)} title="最近的操作" subtitle="最新的在最上面" width={width}>
      {steps.length === 0
        ? <Text color={C.dimmer}>还没有可以撤销的操作</Text>
        : steps.map((step, index) => {
          const active = index === selected;
          return (
            <Text key={`${step.ts}-${index}`} wrap="truncate" {...(active ? { backgroundColor: C.select } : {})}>
              <Text color={C.accent}>{active ? "▍" : " "}</Text>
              <Text color={C.dim}>{`${local(step.ts)}  `}</Text>
              <Text bold={active}>{truncateWithEllipsis(step.summary, width - 16 - displayWidth(local(step.ts)))}</Text>
            </Text>
          );
        })}
      <Text color={C.dimmer}>{steps.length ? `回车 撤销到选中这步之前（回退 ${selected + 1} 步）· ` : ""}Esc 返回</Text>
    </Dialog>
  );
};
