import type { Config, Task } from "../contracts.js";
import { configLevels } from "./config.js";
import { t, weekdayName } from "./i18n.js";
import { describeRecur } from "./parse.js";
import { compileQuery, match } from "./query.js";
import { sortKey, urgency, type SortMode, compareTuple } from "./priority.js";
import { hiddenByWait, isOverdue, localDate, ACTIVE_STATES } from "./task.js";

/**
 * 分组的 key 是稳定标识，name 只是给人看的字。
 * 上层判断分组用 key，不要去匹配 name——否则换个语言就全失效。
 */
export type GroupKey = "overdue" | "today" | "upcoming" | "later" | "waiting" | "nodate" | "finished" | "hidden";
export type Group = { key: GroupKey; name: string; style: string; tasks: Task[] };
const sort = (tasks: Task[], mode: SortMode, config: Config, now: string): Task[] => [...tasks].sort((a, b) => compareTuple(sortKey(a, mode, config, now), sortKey(b, mode, config, now)));

export const groups = (allTasks: Task[], config: Config, mode: SortMode = config.priority.mode, now = new Date().toISOString().slice(0, 16), query = ""): Group[] => {
  const today = now.slice(0, 10);
  const predicates = query ? compileQuery(query, today, configLevels(config)) : [];
  const tasks = predicates.length ? allTasks.filter((task) => match(task, predicates, today)) : [...allTasks];
  const horizon = new Date(`${today}T00:00:00Z`);
  horizon.setUTCDate(horizon.getUTCDate() + config.agenda.week_days);
  const horizonDate = horizon.toISOString().slice(0, 10);
  // 查询里明确写了 wait 条件，说明用户就是要看这些等待中的任务，此时不再折叠
  const revealWaiting = predicates.some((predicate) => predicate[0] === "wait");
  const hidden = revealWaiting ? [] : tasks.filter((task) => ACTIVE_STATES.has(task.status) && hiddenByWait(task, today));
  const hiddenIds = new Set(hidden.map((task) => task.id));
  const open = tasks.filter((task) => ACTIVE_STATES.has(task.status) && !hiddenIds.has(task.id));
  // wait 只决定「现在要不要露出来」，不再决定分组归属；否则 todo + ~日期
  // 的任务两头落空，永远看不见
  const scheduled = open.filter((task) => task.status !== "waiting" && task.due !== undefined && !isOverdue(task, today));
  const dueDate = (task: Task): string => localDate(task.due ?? "");
  const overdue = sort(open.filter((task) => isOverdue(task, today)), mode, config, now);
  const todays = sort(scheduled.filter((task) => dueDate(task) === today), mode, config, now);
  const upcoming = sort(scheduled.filter((task) => dueDate(task) > today && dueDate(task) <= horizonDate), mode, config, now);
  const later = sort(scheduled.filter((task) => dueDate(task) > horizonDate), mode, config, now);
  const waiting = sort(open.filter((task) => task.status === "waiting"), mode, config, now);
  const nodate = sort(open.filter((task) => task.status !== "waiting" && task.due === undefined), mode, config, now);
  const result: Group[] = [];
  if (overdue.length) result.push({ key: "overdue", name: t("group.overdue"), style: "bold red", tasks: overdue });
  if (todays.length) result.push({ key: "today", name: t("group.today"), style: "bold cyan", tasks: todays });
  if (upcoming.length) result.push({ key: "upcoming", name: t("group.upcoming"), style: "green", tasks: upcoming });
  if (later.length) result.push({ key: "later", name: t("group.later"), style: "dim", tasks: later });
  if (waiting.length) result.push({ key: "waiting", name: t("group.waiting"), style: "magenta", tasks: waiting });
  if (nodate.length) result.push({ key: "nodate", name: t("group.nodate"), style: "dim", tasks: nodate });
  if (predicates.some((predicate) => predicate[0] === "status" && (predicate[1] === "done" || predicate[1] === "cancelled"))) {
    const finished = sort(tasks.filter((task) => task.status === "done" || task.status === "cancelled"), mode, config, now);
    if (finished.length) result.push({ key: "finished", name: t("group.finished"), style: "dim strike", tasks: finished });
  }
  if (hidden.length) result.push({ key: "hidden", name: t("group.hidden", { count: hidden.length }), style: "dim", tasks: [] });
  return result;
};

export type NestedTask = { task: Task; depth: number };

/**
 * 把排好序的一组任务重排成父子相邻的顺序，并标出层级。
 * 父任务不在这一组里的（比如父任务已完成、或被查询滤掉了）当作顶层，
 * 免得子任务整组消失。父子成环时也保证每条任务只出现一次。
 */
export const nestTasks = (tasks: Task[]): NestedTask[] => {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const childrenOf = new Map<string, Task[]>();
  const roots: Task[] = [];
  for (const task of tasks) {
    const parent = task.parent !== undefined && task.parent !== task.id && byId.has(task.parent) ? task.parent : undefined;
    if (parent === undefined) roots.push(task);
    else childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), task]);
  }
  const out: NestedTask[] = [];
  const seen = new Set<string>();
  const visit = (task: Task, depth: number): void => {
    if (seen.has(task.id)) return;
    seen.add(task.id);
    out.push({ task, depth });
    for (const child of childrenOf.get(task.id) ?? []) visit(child, depth + 1);
  };
  for (const root of roots) visit(root, 0);
  for (const task of tasks) if (!seen.has(task.id)) { seen.add(task.id); out.push({ task, depth: 0 }); }
  return out;
};

export const formatDate = (task: Task, today: string, dateFormat: "auto" | "md" | "full" = "auto"): string => {
  if (!task.due) return "          ";
  const date = localDate(task.due);
  if (dateFormat === "md") return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
  if (dateFormat === "full") return date;
  const delta = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (delta === 0) return t("date.today");
  if (delta === 1) return t("date.tomorrow");
  if (delta === 2) return t("date.dayAfter");
  if (delta === -1) return t("date.yesterday");
  if (delta < 0) return t("date.overdueDays", { days: Math.abs(delta) });
  if (delta <= 7) return t("date.weekday", { name: weekdayName((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) });
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
};

export const renderLine = (task: Task, config: Config, today: string, mode: SortMode, now = `${today}T00:00`, depth = 0): string => {
  const date = formatDate(task, today, config.agenda.date_format).padEnd(5);
  const status = task.status === "todo" ? "" : `[${task.status}]`;
  const tags = task.tags.map((tag) => `#${tag}`).join(" ");
  const title = depth > 0 ? `${"  ".repeat(depth - 1)}↳ ${task.title}` : task.title;
  const marks = [task.recur ? `↻${describeRecur(task.recur)}` : "", task.notes.trim() ? ">>" : ""].filter(Boolean).join(" ");
  const line = [date, title, task.priority ?? "", status, tags, marks].filter((item) => item.trim()).join("  ");
  return mode === "urgency" ? `${line}  U=${urgency(task, config, now).toFixed(1)}` : line;
};
