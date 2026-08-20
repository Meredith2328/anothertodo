import { scanDate } from "./parse.js";
import { isOverdue, localDate } from "./task.js";
import type { Task } from "../contracts.js";

export class QueryError extends Error {}
type DateRange = { kind: "range"; start: string; end: string };
type Predicate =
  | ["overdue"] | ["tag", string] | ["nottag", string] | ["level", string] | ["notlevel", string]
  | ["kw", string] | ["status", string] | ["project", string] | ["wait", string | DateRange]
  | ["due", "before" | "after" | undefined, string | DateRange];

const addDays = (date: string, days: number): string => {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};
const weekday = (date: string): number => (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;

const parseFilterValue = (raw: string, today: string): string | DateRange => {
  if (raw === "today") return today;
  if (raw === "tomorrow") return addDays(today, 1);
  if (raw === "yesterday") return addDays(today, -1);
  if (raw === "week" || raw === "thisweek") {
    const start = addDays(today, -weekday(today));
    return { kind: "range", start, end: addDays(start, 6) };
  }
  const date = scanDate(raw, today);
  return date ? date.date : raw;
};

export const compileQuery = (query: string, today = new Date().toISOString().slice(0, 10), levels = ["低", "中", "高"]): Predicate[] => {
  const predicates: Predicate[] = [];
  for (const token of query.trim().split(/\s+/u).filter(Boolean)) {
    if (token === "overdue") { predicates.push(["overdue"]); continue; }
    const tag = /^\+([^\s+]+)$/u.exec(token);
    if (tag) { predicates.push(["tag", tag[1]!]); continue; }
    const negative = /^-([^\s-]+)$/u.exec(token);
    if (negative) { predicates.push(levels.includes(negative[1]!) ? ["notlevel", negative[1]!] : ["nottag", negative[1]!]); continue; }
    const keyword = /^\/(.*)$/u.exec(token);
    if (keyword) { predicates.push(["kw", keyword[1]!.toLowerCase()]); continue; }
    const filter = /^([a-zA-Z]+):(.*)$/u.exec(token);
    if (filter) {
      const key = filter[1]!.toLowerCase();
      let value = filter[2]!;
      if (key === "due") {
        let sub: "before" | "after" | undefined;
        if (value.startsWith("before:")) { sub = "before"; value = value.slice(7); }
        else if (value.startsWith("after:")) { sub = "after"; value = value.slice(6); }
        predicates.push(["due", sub, parseFilterValue(value, today)]);
      } else if (key === "status" || key === "st") predicates.push(["status", value.toLowerCase()]);
      else if (key === "project" || key === "proj") predicates.push(["project", value]);
      else if (key === "priority") predicates.push(["level", value]);
      else if (key === "wait") predicates.push(["wait", parseFilterValue(value, today)]);
      else throw new QueryError(`不认识的过滤器：${key}`);
      continue;
    }
    predicates.push(["kw", token.toLowerCase()]);
  }
  return predicates;
};

export const match = (task: Task, predicates: Predicate[], today = new Date().toISOString().slice(0, 10)): boolean => {
  for (const predicate of predicates) {
    const [kind, value] = predicate;
    if (kind === "kw" && !task.title.toLowerCase().includes(value) && !task.tags.some((tag) => tag.toLowerCase().includes(value))) return false;
    if (kind === "tag" && !task.tags.includes(value)) return false;
    if (kind === "nottag" && task.tags.includes(value)) return false;
    if (kind === "level" && (task.priority ?? "") !== value) return false;
    if (kind === "notlevel" && (task.priority ?? "") === value) return false;
    if (kind === "status" && task.status !== value) return false;
    if (kind === "project" && (task.project ?? "") !== value) return false;
    if (kind === "overdue" && !isOverdue(task, today)) return false;
    if (kind === "wait") {
      if (typeof value === "string" && task.wait !== value) return false;
      if (typeof value !== "string" && task.wait !== undefined) return false;
    }
    if (kind === "due") {
      const sub = predicate[1];
      const expected = predicate[2];
      if (!task.due) return false;
      const dueDate = localDate(task.due);
      if (typeof expected !== "string") { if (dueDate < expected.start || dueDate > expected.end) return false; }
      else if (sub === "before" ? dueDate >= expected : sub === "after" ? dueDate <= expected : dueDate !== expected) return false;
    }
  }
  return true;
};

export const filterTasks = (tasks: Task[], query: string, today?: string): Task[] => {
  const predicates = compileQuery(query, today);
  return predicates.length === 0 ? [...tasks] : tasks.filter((task) => match(task, predicates, today));
};
