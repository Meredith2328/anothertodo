// 表格行与单元格：日期 / 标题 / 紧急度 / 状态 / 标签提醒五列。
// 列宽是显示列数（CJK 占两格），对齐依赖 core/width 的同一套算法，
// 别在这里另起一套宽度计算，否则中文一多就和 CLI 表格错开。
import React from "react";
import { Box, Text } from "ink";

import { formatDate, timeSpan, type GroupKey } from "../core/agenda.js";
import type { Task } from "../contracts.js";
import { describeRecur } from "../core/parse.js";
import { isOverdue, localDate } from "../core/task.js";
import { displayWidth, padDisplay, truncateDisplay, truncateWithEllipsis } from "../core/width.js";
import { C, GROUP_COLOR, STATUS_COLOR } from "./theme.js";

/**
 * 按终端宽度分配列宽（显示列数）。窄了依次收起「标签 / 提醒」、状态、紧急度，
 * 标题列拿剩下的全部宽度。每一行加起来正好等于表格内宽，一格都不能多——
 * 多一格终端就会折行，整帧超出屏幕高度，顶上的横幅被挤出去，拉宽后也回不来。
 */
export type Columns = { date: number; title: number; priority: number; status: number; extras: number };
export const tableColumns = (columns: number | undefined): Columns => {
  // 表格边框 2 + 左右内边距 2
  const inner = Math.max(20, (columns ?? 100) - 4);
  const date = inner >= 90 ? 12 : 8;
  const extras = inner >= 96 ? 30 : inner >= 80 ? 18 : 0;
  const status = inner >= 56 ? 10 : 0;
  const priority = inner >= 44 ? 8 : 0;
  return { date, priority, status, extras, title: Math.max(8, inner - date - priority - status - extras) };
};

const dayDelta = (date: string, today: string): number =>
  Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);

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
  return { text: task.status === "done" ? "已完成" : task.status, color: STATUS_COLOR[task.status] ?? C.dim, bold: false };
};

const extrasSegments = (task: Task): Array<{ text: string; color: string }> => {
  const segments: Array<{ text: string; color: string }> = [];
  if (task.project) segments.push({ text: `◈${task.project} `, color: C.proj });
  for (const tag of task.tags) segments.push({ text: `#${tag} `, color: C.tag });
  if (task.recur) segments.push({ text: `↻${describeRecur(task.recur)} `, color: C.proj });
  if (task.notes.trim()) segments.push({ text: "✎ ", color: C.dim });
  const reminder = task.reminders.find((item) => !item.fired);
  // 不用 ⏰：Ink 排版时把它当 1 格、终端却画成 2 格，整行多出一格就会折行
  if (reminder) segments.push({ text: `◷${reminder.at.slice(5, 16).replace("T", " ")}`, color: C.yellow });
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

/** 表格里的分组行：一道横线拉满整行 */
export const GroupSeparator = ({ groupKey, name, count, width }: { groupKey: GroupKey; name: string; count: number; width: number }): React.ReactElement => {
  const color = GROUP_COLOR[groupKey] ?? C.dim;
  const head = `╾─ ${name} ${count} `;
  return (
    <Text wrap="truncate">
      <Text color={color}>╾─ </Text>
      <Text bold color={color}>{name}</Text>
      <Text color={color}>{` ${count} `}</Text>
      <Text color={C.dimmer}>{"─".repeat(Math.max(4, width - displayWidth(head)))}</Text>
    </Text>
  );
};

/** 卡片式的分组标题：只有名字和数量，靠上面的空行和颜色分隔，不画线 */
export const GroupHeading = ({ groupKey, name, count }: { groupKey: GroupKey; name: string; count: number }): React.ReactElement => {
  const color = GROUP_COLOR[groupKey] ?? C.dim;
  return (
    <Text wrap="truncate">
      <Text>{" "}</Text>
      <Text bold color={color}>{name}</Text>
      <Text color={C.dimmer}>{`  ${count}`}</Text>
    </Text>
  );
};

/** 卡片式一行右侧的说明：时间段、日期、等什么、项目、标签、重复、备注、提醒，按这个顺序，放不下从右边起收 */
const metaSegments = (task: Task, today: string, dateFormat: "auto" | "md" | "full", wait: string, showDate: boolean): Array<{ text: string; color: string; bold?: boolean }> => {
  const segments: Array<{ text: string; color: string; bold?: boolean }> = [];
  const span = timeSpan(task);
  if (span) segments.push({ text: span, color: C.accent, bold: true });
  if (showDate && task.due) { const date = dateCell(task, today, dateFormat); segments.push({ text: date.text, color: date.color, bold: date.bold }); }
  if (wait) segments.push({ text: wait, color: C.tag });
  if (task.status !== "todo" && task.status !== "doing" && task.status !== "waiting" && task.status !== "paused") segments.push({ text: task.status === "done" ? "已完成" : task.status, color: STATUS_COLOR[task.status] ?? C.dim });
  if (task.project) segments.push({ text: `◈ ${task.project}`, color: C.proj });
  for (const tag of task.tags) segments.push({ text: `#${tag}`, color: C.tag });
  if (task.recur) segments.push({ text: `↻ ${describeRecur(task.recur)}`, color: C.proj });
  if (task.notes.trim()) segments.push({ text: "✎", color: C.dim });
  const reminder = task.reminders.find((item) => !item.fired);
  if (reminder) segments.push({ text: `◷ ${reminder.at.slice(5, 16).replace("T", " ")}`, color: C.yellow });
  return segments;
};

/**
 * 卡片式任务行：左边一个优先级圆点和标题，右边是淡色的说明，中间用空白撑开。
 * 说明放不下时从最右边的项起整项收掉，标题再不够才截断——标题永远是最重要的。
 */
export const CardRow = ({ task, selected, marked = false, blocked = false, completing, today, dateFormat, levels, width, depth = 0, wait = "", showDate = true, moved = false }: {
  task: Task;
  selected: boolean;
  marked?: boolean;
  blocked?: boolean;
  completing?: number | undefined;
  today: string;
  dateFormat: "auto" | "md" | "full";
  levels: string[];
  /** 整行可用的显示列数 */
  width: number;
  depth?: number;
  /** 「等 X」/「等到 M/D」，来自 deps.waitLabel */
  wait?: string;
  /** 分组已经说明了日期（今天 / 逾期）时可以不再重复 */
  showDate?: boolean;
  /** 刚被操作过、位置变了的行：短暂高亮一下让眼睛跟得上 */
  moved?: boolean;
}): React.ReactElement => {
  const indent = depth > 0 ? `${"  ".repeat(depth - 1)}↳ ` : "";
  const priority = priorityCell(task, levels);
  const dot = completing !== undefined || task.status === "done" ? "✓" : marked ? "◉" : blocked ? "⊘" : priority.text ? "●" : "○";
  const dotColor = completing !== undefined || task.status === "done" ? C.good : marked ? C.hot : blocked ? C.dimmer : priority.text ? priority.color : C.dimmer;
  const lead = `${selected ? "▍" : " "} `;
  // 左边：引导 2 + 圆点 1 + 空格 1 + 缩进；右边说明和标题之间至少留 3 格
  const meta = metaSegments(task, today, dateFormat, wait, showDate);
  const metaWidth = (items: typeof meta): number => items.reduce((total, item, index) => total + displayWidth(item.text) + (index ? 3 : 0), 0);
  const minTitle = Math.min(displayWidth(task.title), 16);
  const fixed = displayWidth(lead) + 2 + displayWidth(indent) + 1;
  let shown = meta;
  while (shown.length && fixed + minTitle + 3 + metaWidth(shown) > width) shown = shown.slice(0, -1);
  const metaText = metaWidth(shown);
  const room = Math.max(2, width - fixed - (shown.length ? metaText + 3 : 0));
  const name = [...truncateWithEllipsis(task.title, room)];
  const struck = completing === undefined ? (task.status === "done" ? name.length : 0) : Math.ceil(name.length * completing);
  const gap = " ".repeat(Math.max(1, width - fixed - displayWidth(name.join("")) - metaText));
  const background = selected ? C.select : moved ? C.border : undefined;
  const tone = (color: string): string => blocked ? C.dimmer : color;
  return (
    <Text wrap="truncate" {...(background ? { backgroundColor: background } : {})} {...(blocked ? { color: C.dimmer } : {})}>
      <Text color={C.accent}>{lead}</Text>
      <Text color={dotColor}>{`${dot} `}</Text>
      <Text color={C.dimmer}>{indent}</Text>
      <Text strikethrough color={completing === undefined ? C.dim : C.good}>{name.slice(0, struck).join("")}</Text>
      <Text bold={selected && !blocked} {...(completing !== undefined ? { color: C.dim } : {})}>{name.slice(struck).join("")}</Text>
      <Text>{gap}</Text>
      {shown.map((segment, index) => (
        <React.Fragment key={`${segment.text}-${index}`}>
          {index ? <Text color={C.dimmer}>{" · "}</Text> : null}
          <Text color={tone(segment.color)} bold={segment.bold === true && !blocked}>{segment.text}</Text>
        </React.Fragment>
      ))}
      <Text>{" "}</Text>
    </Text>
  );
};

/** 没有任务时给一句友好的引导，而不是一个冷冰冰的「（没有任务）」 */
export const EmptyState = ({ filtered }: { filtered: boolean }): React.ReactElement => (
  <Box flexDirection="column" paddingLeft={3} paddingTop={1}>
    <Text color={C.dim}>{filtered ? "没有符合条件的任务" : "还没有任务，轻松一天 ☕"}</Text>
    <Text color={C.dimmer}>{filtered ? ": 回车或 :list 清除过滤" : "直接打字就能添加，比如：明天 下午两点到三点 开会"}</Text>
  </Box>
);

/** 表头和任务行共用 tableColumns，收起的列在表头里一起消失 */
export const TableHeader = ({ cols }: { cols: Columns }): React.ReactElement => (
  <Text bold color={C.dim} wrap="truncate">
    {` ${padDisplay("日期", cols.date - 1)}${padDisplay("TODO", cols.title)}`}
    {cols.priority ? padDisplay("紧急度", cols.priority) : ""}
    {cols.status ? padDisplay("状态", cols.status) : ""}
    {cols.extras ? "标签 / 提醒" : ""}
  </Text>
);

export const TaskRow = ({ task, selected, marked = false, blocked = false, completing, today, dateFormat, levels, cols, depth = 0 }: {
  task: Task;
  selected: boolean;
  marked?: boolean;
  /** 前置还没做完：整行淡字，标题前加 ⊘ */
  blocked?: boolean;
  /** 完成动画的进度 0..1：删除线从左往右划过标题 */
  completing?: number | undefined;
  today: string;
  dateFormat: "auto" | "md" | "full";
  levels: string[];
  cols: Columns;
  depth?: number;
}): React.ReactElement => {
  // 子任务缩进后可用的标题宽度也跟着变窄，否则会挤掉右边的列
  const indent = depth > 0 ? `${"  ".repeat(depth - 1)}↳ ` : "";
  const mark = completing !== undefined || task.status === "done" ? "✓ " : `${marked ? "◉ " : ""}${blocked ? "⊘ " : ""}`;
  // 标题后面留一格空，免得和紧急度列粘在一起
  const room = Math.max(2, cols.title - displayWidth(indent) - displayWidth(mark) - 1);
  const name = [...truncateWithEllipsis(task.title, room)];
  const struck = completing === undefined ? (task.status === "done" ? name.length : 0) : Math.ceil(name.length * completing);
  const tail = " ".repeat(Math.max(0, cols.title - displayWidth(indent) - displayWidth(mark) - displayWidth(name.join(""))));
  const date = dateCell(task, today, dateFormat);
  const priority = priorityCell(task, levels);
  const status = statusCell(task);
  const extras = cols.extras ? truncateSegments(extrasSegments(task), cols.extras) : [];
  const highlight = selected ? { backgroundColor: C.select } : {};
  const tone = (color: string): string => blocked ? C.dimmer : color;
  return (
    <Text {...highlight} wrap="truncate" {...(blocked ? { color: C.dimmer } : {})}>
      {/* 选中行左边一道主色竖条，比单靠底色更容易一眼找到 */}
      <Text color={C.accent}>{selected ? "▍" : " "}</Text>
      <Text color={tone(date.color)} bold={date.bold}>{padDisplay(truncateDisplay(date.text, cols.date - 1), cols.date - 1)}</Text>
      <Text {...(completing !== undefined ? { color: C.good } : {})}>{`${indent}${mark}`}</Text>
      <Text strikethrough color={completing === undefined ? C.dim : C.good}>{name.slice(0, struck).join("")}</Text>
      <Text {...(completing !== undefined ? { color: C.dim } : {})}>{`${name.slice(struck).join("")}${tail}`}</Text>
      {cols.priority ? <Text color={tone(priority.color)} bold={priority.bold}>{padDisplay(priority.text, cols.priority)}</Text> : null}
      {cols.status ? <Text color={tone(status.color)} bold={status.bold}>{padDisplay(truncateDisplay(status.text, cols.status - 1), cols.status)}</Text> : null}
      {extras.map((segment, index) => <Text key={`${segment.text}-${index}`} color={tone(segment.color)}>{segment.text}</Text>)}
      {/* 补满到行尾，选中行的底色才能铺满整行 */}
      {cols.extras ? " ".repeat(Math.max(0, cols.extras - extras.reduce((width, segment) => width + displayWidth(segment.text), 0) - 1)) : ""}
    </Text>
  );
};
