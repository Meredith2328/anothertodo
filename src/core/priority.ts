import type { Config, Task } from "../contracts.js";
import { configLevels, loadConfig, priorityMode } from "./config.js";
import { localDate, localNow } from "./task.js";

const dateOrdinal = (date: string): number => Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
export const levelRank = (task: Task, levels: string[]): number => {
  const rank = levels.indexOf(task.priority ?? "");
  return rank < 0 ? -1 : rank;
};

export const urgency = (task: Task, config: Config, now = localNow()): number => {
  const coefficients = config.priority.urgency;
  const today = now.slice(0, 10);
  let score = 0;
  if (task.due && task.status === "todo") {
    const due = localDate(task.due);
    const delta = dateOrdinal(due) - dateOrdinal(today);
    if (delta < 0) score += coefficients.overdue * Math.min(-delta, 7) / 7;
    else if (delta === 0) score += coefficients.due_today;
    else if (delta <= 7) score += coefficients.due_week_decay * (1 - delta / 7);
  }
  const levels = configLevels(config);
  if (task.priority && levels.includes(task.priority)) score += coefficients.per_level * (levels.indexOf(task.priority) + 1) / levels.length;
  if (task.entry) {
    const entryMs = Date.parse(task.entry);
    const nowMs = Date.parse(`${now}:00Z`);
    if (Number.isFinite(entryMs) && Number.isFinite(nowMs)) score += Math.min(Math.max(Math.floor((nowMs - entryMs) / 86_400_000), 0) * coefficients.age_per_day, coefficients.age_cap);
  }
  if (task.status === "waiting") score -= coefficients.waiting_penalty;
  return Math.round(score * 1000) / 1000;
};

export type SortMode = "levels" | "urgency";
// 标题按拼音比较：Unicode 编码顺序会把「上午」排在「下午」前、「优化」排在「新增」前，读起来毫无规律
const pinyin = new Intl.Collator("zh-Hans-u-co-pinyin", { numeric: true });
const entryMs = (task: Task): number => { const ms = Date.parse(task.entry); return Number.isFinite(ms) ? ms : 0; };
/** 日期、优先级都相同时的最后一道比较；默认按添加时间，新加的任务落在同组末尾而不是插到中间 */
const tieBreak = (task: Task, config: Config): number | string => {
  const rule = config.agenda.tie_break;
  if (rule === "title") return task.title;
  return rule === "entry_desc" ? -entryMs(task) : entryMs(task);
};
export const sortKey = (task: Task, mode: SortMode, config: Config, now = localNow()): [number, number, number, number | string] => {
  const today = now.slice(0, 10);
  const due = task.due ? localDate(task.due) : undefined;
  const bucket = due ? task.status === "todo" && due < today ? 0 : due === today ? 1 : 2 : 3;
  const dueOrd = due ? dateOrdinal(due) - dateOrdinal("2000-01-01") : 99_999;
  return mode === "urgency" ? [bucket, -urgency(task, config, now), dueOrd, tieBreak(task, config)] : [bucket, dueOrd, -levelRank(task, configLevels(config)), tieBreak(task, config)];
};

export const sortTasks = async (tasks: Task[], mode: SortMode | undefined, config?: Config, now?: string): Promise<Task[]> => {
  const cfg = config ?? await loadConfig();
  const selected = mode ?? priorityMode(cfg);
  return [...tasks].sort((a, b) => compareTuple(sortKey(a, selected, cfg, now), sortKey(b, selected, cfg, now)));
};

export const compareTuple = (a: [number, number, number, number | string], b: [number, number, number, number | string]): number => {
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i]!;
    const bv = b[i]!;
    if (av === bv) continue;
    if (typeof av === "string" && typeof bv === "string") return pinyin.compare(av, bv);
    return Number(av) - Number(bv);
  }
  return 0;
};
