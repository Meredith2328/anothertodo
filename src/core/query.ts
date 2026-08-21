import { scanDate } from "./parse.js";
import { isOverdue, localDate } from "./task.js";
import type { Task } from "../contracts.js";

export class QueryError extends Error {}
type DateRange = { kind: "range"; start: string; end: string };
/** 日期类过滤器的取值：具体日期、日期区间，或「有 / 无」存在性判断 */
type DateValue = string | DateRange | { kind: "any" } | { kind: "none" };
type Predicate =
  | ["overdue"]
  | ["tag", string] | ["nottag", string]
  | ["level", string] | ["notlevel", string]
  | ["kw", string] | ["notkw", string]
  | ["status", string] | ["notstatus", string]
  | ["project", string] | ["notproject", string]
  | ["parent", string]
  | ["has", string] | ["nothas", string]
  | ["wait", "before" | "after" | undefined, DateValue]
  | ["due", "before" | "after" | undefined, DateValue];

const addDays = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const weekIndex = (date: string): number => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;

const parseFilterValue = (raw: string, today: string): DateValue => {
  const value = raw.toLowerCase();
  if (value === "any" || value === "yes" || value === "有") return { kind: "any" };
  if (value === "none" || value === "no" || value === "无") return { kind: "none" };
  if (value === "today" || value === "今天") return today;
  if (value === "tomorrow" || value === "明天") return addDays(today, 1);
  if (value === "yesterday" || value === "昨天") return addDays(today, -1);
  if (value === "week" || value === "thisweek" || value === "本周") {
    const start = addDays(today, -weekIndex(today));
    return { kind: "range", start, end: addDays(start, 6) };
  }
  if (value === "nextweek" || value === "下周") {
    const start = addDays(today, 7 - weekIndex(today));
    return { kind: "range", start, end: addDays(start, 6) };
  }
  if (value === "month" || value === "thismonth" || value === "本月") {
    const start = `${today.slice(0, 7)}-01`;
    return { kind: "range", start, end: addDays(`${addDays(start, 31).slice(0, 7)}-01`, -1) };
  }
  const date = scanDate(raw, today);
  return date ? date.date : raw;
};

/** has: 支持的字段名；写错时直接报错，而不是静默返回空结果 */
const HAS_FIELDS = new Set(["due", "time", "wait", "notes", "note", "reminder", "reminders", "project", "proj", "tag", "tags", "parent", "priority"]);

const hasField = (task: Task, field: string): boolean => {
  switch (field) {
    case "due": return task.due !== undefined;
    case "time": return task.due !== undefined && task.due.slice(11, 16) !== "00:00";
    case "wait": return task.wait !== undefined;
    case "notes": case "note": return task.notes.trim().length > 0;
    case "reminder": case "reminders": return task.reminders.length > 0;
    case "project": case "proj": return task.project !== undefined;
    case "tag": case "tags": return task.tags.length > 0;
    case "parent": return task.parent !== undefined;
    case "priority": return task.priority !== undefined;
    default: return false;
  }
};

const matchDateValue = (actual: string | undefined, sub: "before" | "after" | undefined, expected: DateValue): boolean => {
  if (typeof expected === "object" && expected.kind === "any") return actual !== undefined;
  if (typeof expected === "object" && expected.kind === "none") return actual === undefined;
  if (actual === undefined) return false;
  if (typeof expected === "object") return actual >= expected.start && actual <= expected.end;
  if (sub === "before") return actual < expected;
  if (sub === "after") return actual > expected;
  return actual === expected;
};

/** `+X` 与 `-X` 对称：X 是配置里的档位名就按紧急度过滤，否则按标签过滤 */
const signedPredicate = (value: string, levels: string[], negated: boolean): Predicate => {
  if (levels.includes(value)) return negated ? ["notlevel", value] : ["level", value];
  return negated ? ["nottag", value] : ["tag", value];
};

const hasFieldPredicate = (raw: string, negated: boolean): Predicate => {
  const field = raw.toLowerCase();
  if (!HAS_FIELDS.has(field)) throw new QueryError(`has: 不认识的字段：${raw}`);
  return negated ? ["nothas", field] : ["has", field];
};

const positivePredicate = (key: string, rawValue: string, today: string, levels: string[]): Predicate => {
  if (key === "due" || key === "wait") {
    let value = rawValue;
    let sub: "before" | "after" | undefined;
    if (value.startsWith("before:")) { sub = "before"; value = value.slice(7); }
    else if (value.startsWith("after:")) { sub = "after"; value = value.slice(6); }
    const parsed = parseFilterValue(value, today);
    return key === "due" ? ["due", sub, parsed] : ["wait", sub, parsed];
  }
  if (key === "status" || key === "st") return ["status", rawValue.toLowerCase()];
  if (key === "project" || key === "proj") return ["project", rawValue];
  if (key === "priority" || key === "prio") return ["level", rawValue];
  if (key === "tag") return signedPredicate(rawValue, levels, false);
  if (key === "parent") return ["parent", rawValue];
  if (key === "has") return hasFieldPredicate(rawValue, false);
  throw new QueryError(`不认识的过滤器：${key}`);
};

const negatedPredicate = (key: string, rawValue: string, levels: string[]): Predicate => {
  if (key === "status" || key === "st") return ["notstatus", rawValue.toLowerCase()];
  if (key === "project" || key === "proj") return ["notproject", rawValue];
  if (key === "priority" || key === "prio") return ["notlevel", rawValue];
  if (key === "tag") return signedPredicate(rawValue, levels, true);
  if (key === "has") return hasFieldPredicate(rawValue, true);
  throw new QueryError(`不支持取反的过滤器：${key}`);
};

const POSITIVE_RE = /^\+([^\s+]+)$/u;
/** `-X` 与 `!X` 等价；`!` 不会被 commander 当成命令行选项，在 shell 里更省事 */
const NEGATIVE_RE = /^[-!](\S+)$/u;
const KEYWORD_RE = /^\/(.*)$/u;
const TAG_RE = /^#([^\s#]+)$/u;
const FILTER_RE = /^([a-zA-Z]+):(.*)$/u;

export const compileQuery = (query: string, today = new Date().toISOString().slice(0, 10), levels = ["低", "中", "高"]): Predicate[] => {
  const predicates: Predicate[] = [];
  for (const token of query.trim().split(/\s+/u).filter(Boolean)) {
    if (token === "overdue" || token === "逾期") { predicates.push(["overdue"]); continue; }
    const positive = token.match(POSITIVE_RE);
    if (positive) { predicates.push(signedPredicate(positive[1]!, levels, false)); continue; }
    const negative = token.match(NEGATIVE_RE);
    if (negative) {
      const inner = negative[1]!;
      const negatedFilter = inner.match(FILTER_RE);
      if (negatedFilter) { predicates.push(negatedPredicate(negatedFilter[1]!.toLowerCase(), negatedFilter[2]!, levels)); continue; }
      if (inner.startsWith("#")) { predicates.push(signedPredicate(inner.slice(1), levels, true)); continue; }
      if (inner.startsWith("/")) { predicates.push(["notkw", inner.slice(1).toLowerCase()]); continue; }
      predicates.push(signedPredicate(inner, levels, true));
      continue;
    }
    const keyword = token.match(KEYWORD_RE);
    if (keyword) { predicates.push(["kw", keyword[1]!.toLowerCase()]); continue; }
    const tag = token.match(TAG_RE);
    if (tag) { predicates.push(signedPredicate(tag[1]!, levels, false)); continue; }
    const filter = token.match(FILTER_RE);
    if (filter) { predicates.push(positivePredicate(filter[1]!.toLowerCase(), filter[2]!, today, levels)); continue; }
    predicates.push(["kw", token.toLowerCase()]);
  }
  return predicates;
};

/** 关键字覆盖标题、标签、项目和备注，避免「记在备注里就搜不到」 */
const keywordHit = (task: Task, value: string): boolean =>
  task.title.toLowerCase().includes(value)
  || task.tags.some((tag) => tag.toLowerCase().includes(value))
  || (task.project ?? "").toLowerCase().includes(value)
  || task.notes.toLowerCase().includes(value);

const matchParent = (task: Task, value: string): boolean => {
  if (value === "none" || value === "无") return task.parent === undefined;
  if (value === "any" || value === "有") return task.parent !== undefined;
  return task.parent !== undefined && task.parent.startsWith(value);
};

export const match = (task: Task, predicates: Predicate[], today = new Date().toISOString().slice(0, 10)): boolean => {
  for (const predicate of predicates) {
    const [kind, value] = predicate;
    if (kind === "kw" && !keywordHit(task, value)) return false;
    if (kind === "notkw" && keywordHit(task, value)) return false;
    if (kind === "tag" && !task.tags.includes(value)) return false;
    if (kind === "nottag" && task.tags.includes(value)) return false;
    if (kind === "level" && (task.priority ?? "") !== value) return false;
    if (kind === "notlevel" && (task.priority ?? "") === value) return false;
    if (kind === "status" && task.status !== value) return false;
    if (kind === "notstatus" && task.status === value) return false;
    if (kind === "project" && (task.project ?? "") !== value) return false;
    if (kind === "notproject" && (task.project ?? "") === value) return false;
    if (kind === "parent" && !matchParent(task, value)) return false;
    if (kind === "has" && !hasField(task, value)) return false;
    if (kind === "nothas" && hasField(task, value)) return false;
    if (kind === "overdue" && !isOverdue(task, today)) return false;
    if (kind === "wait" && !matchDateValue(task.wait, predicate[1], predicate[2])) return false;
    if (kind === "due" && !matchDateValue(task.due ? localDate(task.due) : undefined, predicate[1], predicate[2])) return false;
  }
  return true;
};

export const filterTasks = (tasks: Task[], query: string, today?: string, levels?: string[]): Task[] => {
  const predicates = compileQuery(query, today, levels);
  return predicates.length === 0 ? [...tasks] : tasks.filter((task) => match(task, predicates, today));
};
