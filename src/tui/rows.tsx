// 表格行与单元格：日期 / 标题 / 紧急度 / 状态 / 标签提醒五列。
// 列宽是显示列数（CJK 占两格），对齐依赖 core/width 的同一套算法，
// 别在这里另起一套宽度计算，否则中文一多就和 CLI 表格错开。
import React from "react";
import { Box, Text } from "ink";

import { formatDate, type GroupKey } from "../core/agenda.js";
import type { Task } from "../contracts.js";
import { describeRecur } from "../core/parse.js";
import { isOverdue, localDate } from "../core/task.js";
import { displayWidth, padDisplay, truncateDisplay, truncateWithEllipsis } from "../core/width.js";
import { C, GROUP_COLOR, STATUS_COLOR } from "./theme.js";

// 列宽（显示列数）：日期 / 紧急度 / 状态 / 标签提醒；TODO 占剩余宽度
export const DATE_W = 12;
export const PRIORITY_W = 8;
export const STATUS_W = 10;
export const EXTRAS_W = 30;
// 表格以外的固定行数：横幅 + 信息行 + 表格边框/表头 + 预览行 + 输入框 + Footer
export const CHROME_LINES = 7 + 3 + 1 + 3 + 1;

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

export const GroupSeparator = ({ groupKey, name, count }: { groupKey: GroupKey; name: string; count: number }): React.ReactElement => {
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

export const TaskRow = ({ task, selected, marked = false, today, dateFormat, levels, titleWidth, depth = 0 }: {
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
