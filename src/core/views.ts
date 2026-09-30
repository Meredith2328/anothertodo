import type { Config, Task } from "../contracts.js";
import { groups, type Group, type GroupKey } from "./agenda.js";
import { compareTuple, sortKey } from "./priority.js";
import { ACTIVE_STATES } from "./task.js";

export type AgendaView = Config["agenda"]["view"];
export const VIEW_ORDER: AgendaView[] = ["all", "recent", "hour"];
export const VIEW_LABEL: Record<AgendaView, string> = { all: "全部", recent: "近期", hour: "接下来一小时" };

/** 没有 offset 的既有排期是所选时区的墙上时间；带 offset 的排期先转换。 */
export const wallNow = (date: Date, timezone: string): string => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const part = (type: string): string => parts.find((item) => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
};
const wallDate = (value: string, timezone: string): string => /(?:Z|[+-]\d{2}:\d{2})$/u.test(value)
  ? wallNow(new Date(value), timezone) : `${value.slice(0, 16)}:${value.slice(17, 19) || "00"}`;
const allDay = (task: Task): boolean => Boolean(task.due && !task.until && task.due.slice(11, 16) === "00:00" && !/(?:Z|[+-]\d{2}:\d{2})$/u.test(task.due));

export type ViewWindow = { now: string; hourEnd: string; recentEnd: string; today: string; timezone: string };
export const viewWindow = (config: Config, clock: Date): ViewWindow => {
  const timezone = config.agenda.timezone;
  const now = wallNow(clock, timezone);
  const end = new Date(`${now.slice(0, 10)}T00:00:00Z`);
  end.setUTCDate(end.getUTCDate() + config.agenda.week_days);
  return { now, hourEnd: wallNow(new Date(clock.getTime() + 3_600_000), timezone), recentEnd: `${end.toISOString().slice(0, 10)}T23:59:59`, today: now.slice(0, 10), timezone };
};

export const isViewOverdue = (task: Task, window: ViewWindow): boolean => {
  if (!task.due || !["todo", "meeting"].includes(task.status) || (task.wait && task.wait > window.today)) return false;
  const start = wallDate(task.due, window.timezone);
  if (allDay(task)) return start.slice(0, 10) < window.today;
  return task.until ? wallDate(task.until, window.timezone) <= window.now : start < window.now;
};
const ongoing = (task: Task, window: ViewWindow): boolean => Boolean(task.due && task.until && ["todo", "meeting"].includes(task.status)
  && wallDate(task.due, window.timezone) <= window.now && wallDate(task.until, window.timezone) > window.now);

export const taskInView = (task: Task, view: AgendaView, window: ViewWindow): boolean => {
  if (view === "all") return true;
  if (!ACTIVE_STATES.has(task.status)) return false;
  if (task.status === "doing") return true;
  if (task.wait && task.wait > window.today) return false;
  if (isViewOverdue(task, window) || ongoing(task, window)) return true;
  if (!task.due) return false;
  const start = wallDate(task.due, window.timezone);
  // 只填日期、没有具体时刻的事项在当天可见，不能因缺少时刻漏掉今天该做的事。
  if (allDay(task)) return start.slice(0, 10) >= window.today && (view === "recent" ? start <= window.recentEnd : start.slice(0, 10) === window.today);
  return start >= window.now && start <= (view === "hour" ? window.hourEnd : window.recentEnd);
};

/** 复用既有查询、依赖规则和排序；视图从不写入或重新排期任务。 */
export const viewGroups = (tasks: Task[], config: Config, mode: Config["priority"]["mode"], clock: Date, query: string, view: AgendaView, showUnscheduled = false): Group[] => {
  const window = viewWindow(config, clock);
  const source = groups(tasks, config, mode, window.now.slice(0, 16), query);
  if (view === "all") return source;
  const buckets = new Map<GroupKey, Group>();
  for (const group of source) {
    if (!group.tasks.length) { buckets.set(group.key, group); continue; }
    for (const task of group.tasks) {
      const unscheduled = ACTIVE_STATES.has(task.status) && !task.due && task.status !== "doing";
      if (!taskInView(task, view, window) && !(showUnscheduled && unscheduled)) continue;
      const key = ongoing(task, window) ? "doing" : isViewOverdue(task, window) ? "overdue" : group.key;
      const base = key === "doing" ? { key, name: "正在进行", style: "bold yellow" } : key === "overdue" ? { key, name: "逾期", style: "bold red" } : group;
      const bucket = buckets.get(key) ?? { ...base, tasks: [] };
      bucket.tasks.push(task);
      buckets.set(key, bucket);
    }
  }
  const order: GroupKey[] = ["doing", "overdue", "today", "upcoming", "later", "waiting", "paused", "nodate", "finished", "blocked"];
  return order.flatMap((key) => {
    const bucket = buckets.get(key);
    return bucket ? [{ ...bucket, tasks: bucket.tasks.sort((a, b) => compareTuple(sortKey(a, mode, config, window.now), sortKey(b, mode, config, window.now))) }] : [];
  });
};

export const viewCounts = (tasks: Task[], config: Config, clock: Date, query: string, view: AgendaView): { unscheduled: number; outside: number } => {
  const window = viewWindow(config, clock);
  const available = groups(tasks, config, config.priority.mode, window.now.slice(0, 16), query).flatMap((group) => group.tasks);
  const unscheduled = available.filter((task) => ACTIVE_STATES.has(task.status) && !task.due && task.status !== "doing").length;
  const outside = available.filter((task) => !taskInView(task, view, window) && task.due).length;
  return { unscheduled, outside };
};
