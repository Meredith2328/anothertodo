import type { Config, Task } from "../contracts.js";
import { configLevels } from "./config.js";
import { compileQuery, match } from "./query.js";
import { sortKey, urgency, type SortMode, compareTuple } from "./priority.js";
import { hiddenByWait, isOverdue, localDate, ACTIVE_STATES } from "./task.js";

export type Group = { name: string; style: string; tasks: Task[] };
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
  if (overdue.length) result.push({ name: "逾期", style: "bold red", tasks: overdue });
  if (todays.length) result.push({ name: "今天", style: "bold cyan", tasks: todays });
  if (upcoming.length) result.push({ name: "接下来", style: "green", tasks: upcoming });
  if (later.length) result.push({ name: "更远", style: "dim", tasks: later });
  if (waiting.length) result.push({ name: "等待中", style: "magenta", tasks: waiting });
  if (nodate.length) result.push({ name: "无日期", style: "dim", tasks: nodate });
  if (predicates.some((predicate) => predicate[0] === "status" && (predicate[1] === "done" || predicate[1] === "cancelled"))) {
    const finished = sort(tasks.filter((task) => task.status === "done" || task.status === "cancelled"), mode, config, now);
    if (finished.length) result.push({ name: "已完成/已取消", style: "dim strike", tasks: finished });
  }
  if (hidden.length) result.push({ name: `隐藏(等待未到) ${hidden.length} 项`, style: "dim", tasks: [] });
  return result;
};

export const formatDate = (task: Task, today: string, dateFormat: "auto" | "md" | "full" = "auto"): string => {
  if (!task.due) return "          ";
  const date = localDate(task.due);
  if (dateFormat === "md") return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
  if (dateFormat === "full") return date;
  const delta = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  if (delta === 0) return "今天";
  if (delta === 1) return "明天";
  if (delta === 2) return "后天";
  if (delta === -1) return "昨天";
  if (delta < 0) return `超${Math.abs(delta)}天`;
  if (delta <= 7) return `周${"一二三四五六日"[new Date(`${date}T00:00:00Z`).getUTCDay() === 0 ? 6 : new Date(`${date}T00:00:00Z`).getUTCDay() - 1]}`;
  return `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;
};

export const renderLine = (task: Task, config: Config, today: string, mode: SortMode, now = `${today}T00:00`): string => {
  const date = formatDate(task, today, config.agenda.date_format).padEnd(5);
  const status = task.status === "todo" ? "" : `[${task.status}]`;
  const tags = task.tags.map((tag) => `#${tag}`).join(" ");
  const line = [date, task.title, task.priority ?? "", status, tags].filter((item) => item.trim()).join("  ");
  return mode === "urgency" ? `${line}  U=${urgency(task, config, now).toFixed(1)}` : line;
};
