import type { Config, Task } from "../contracts.js";
import { describeRecur } from "./parse.js";
import { urgency } from "./priority.js";
import { ACTIVE_STATES, isOverdue, localDate } from "./task.js";

export type GroupCount = { name: string; open: number; done: number; overdue: number };

/** 按项目或标签汇总；没有项目的归到「（无项目）」，而不是悄悄消失 */
const countBy = (tasks: Task[], keysOf: (task: Task) => string[], fallback: string, today: string): GroupCount[] => {
  const table = new Map<string, GroupCount>();
  for (const task of tasks) {
    const keys = keysOf(task);
    for (const key of keys.length ? keys : [fallback]) {
      const row = table.get(key) ?? { name: key, open: 0, done: 0, overdue: 0 };
      if (ACTIVE_STATES.has(task.status)) row.open += 1;
      if (task.status === "done") row.done += 1;
      if (isOverdue(task, today)) row.overdue += 1;
      table.set(key, row);
    }
  }
  return [...table.values()].sort((a, b) => b.open - a.open || a.name.localeCompare(b.name, "zh"));
};

const nowDate = (): string => new Date().toISOString().slice(0, 10);

export const projectSummary = (tasks: Task[], today = nowDate()): GroupCount[] => countBy(tasks, (task) => task.project ? [task.project] : [], "（无项目）", today);
export const tagSummary = (tasks: Task[], today = nowDate()): GroupCount[] => countBy(tasks, (task) => task.tags, "（无标签）", today);

export type Stats = {
  total: number;
  byStatus: Array<{ status: string; count: number }>;
  overdue: number;
  dueToday: number;
  dueThisWeek: number;
  hiddenByWait: number;
  recurring: number;
  withNotes: number;
  subtasks: number;
  pendingReminders: number;
  deadReminders: number;
  completedLast7Days: number;
  completedLast30Days: number;
  oldestOpenDays?: number;
  topUrgent: Array<{ id: string; title: string; score: number }>;
};

const addDays = (date: string, days: number): string => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
};

export const collectStats = (tasks: Task[], config: Config, now = new Date().toISOString().slice(0, 16)): Stats => {
  const today = now.slice(0, 10);
  const weekEnd = addDays(today, config.agenda.week_days);
  const open = tasks.filter((task) => ACTIVE_STATES.has(task.status));
  const byStatus = new Map<string, number>();
  for (const task of tasks) byStatus.set(task.status, (byStatus.get(task.status) ?? 0) + 1);
  const completedSince = (days: number): number => {
    const cutoff = addDays(today, -days);
    return tasks.filter((task) => task.status === "done" && task.end !== undefined && task.end.slice(0, 10) >= cutoff).length;
  };
  const entryDates = open.map((task) => task.entry.slice(0, 10)).filter((value) => /^\d{4}-\d{2}-\d{2}$/u.test(value)).sort();
  const oldest = entryDates[0];
  const scored = open
    .map((task) => ({ id: task.id, title: task.title, score: Number(urgency(task, config, now).toFixed(1)) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  return {
    total: tasks.length,
    byStatus: [...byStatus.entries()].map(([status, count]) => ({ status, count })).sort((a, b) => b.count - a.count),
    overdue: tasks.filter((task) => isOverdue(task, today)).length,
    dueToday: open.filter((task) => task.due !== undefined && localDate(task.due) === today).length,
    dueThisWeek: open.filter((task) => task.due !== undefined && localDate(task.due) >= today && localDate(task.due) <= weekEnd).length,
    hiddenByWait: open.filter((task) => task.wait !== undefined && task.wait > today).length,
    recurring: tasks.filter((task) => task.recur !== undefined).length,
    withNotes: tasks.filter((task) => task.notes.trim().length > 0).length,
    subtasks: tasks.filter((task) => task.parent !== undefined).length,
    pendingReminders: open.reduce((sum, task) => sum + task.reminders.filter((reminder) => !reminder.fired && !reminder.dead).length, 0),
    deadReminders: tasks.reduce((sum, task) => sum + task.reminders.filter((reminder) => reminder.dead).length, 0),
    completedLast7Days: completedSince(7),
    completedLast30Days: completedSince(30),
    ...(oldest ? { oldestOpenDays: Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${oldest}T00:00:00Z`)) / 86_400_000) } : {}),
    topUrgent: scored,
  };
};

const csvCell = (value: string): string => /[",\n\r]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;

export type ExportFormat = "json" | "csv" | "markdown";

export const exportTasks = (tasks: Task[], format: ExportFormat): string => {
  if (format === "json") return JSON.stringify(tasks, null, 2);
  if (format === "csv") {
    const header = ["id", "title", "status", "due", "priority", "project", "tags", "parent", "wait", "recur", "notes", "entry", "end"];
    const rows = tasks.map((task) => [
      task.id, task.title, task.status, task.due ?? "", task.priority ?? "", task.project ?? "",
      task.tags.join("|"), task.parent ?? "", task.wait ?? "", task.recur ? describeRecur(task.recur) : "",
      task.notes.replace(/\r?\n/gu, " "), task.entry, task.end ?? "",
    ]);
    return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n");
  }
  const lines: string[] = [];
  for (const task of tasks) {
    const box = task.status === "done" ? "[x]" : task.status === "cancelled" ? "[-]" : "[ ]";
    const bits = [
      task.due ? `📅 ${task.due.slice(0, 10)}` : "",
      task.priority ? `(${task.priority})` : "",
      task.project ? `◈${task.project}` : "",
      ...task.tags.map((tag) => `#${tag}`),
      task.recur ? `↻${describeRecur(task.recur)}` : "",
    ].filter(Boolean);
    lines.push(`- ${box} ${task.title}${bits.length ? `  ${bits.join(" ")}` : ""}`);
    if (task.notes.trim()) for (const line of task.notes.split(/\r?\n/)) lines.push(`      ${line}`);
  }
  return lines.join("\n");
};
