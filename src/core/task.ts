import { createHash, randomBytes } from "node:crypto";

import { TaskSchema, TombstoneSchema, type Task, type Tombstone } from "../contracts.js";

export type { Task, Tombstone } from "../contracts.js";

export const DEFAULT_STATES = ["todo", "waiting", "done", "cancelled", "meeting"] as const;
export const ACTIVE_STATES = new Set(["todo", "waiting", "meeting"]);

export const utcNow = (): string => new Date().toISOString();
export const localNow = (): string => {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
};
export const newId = (): string => randomBytes(4).toString("hex");
const stableReminderId = (taskId: string, reminder: Record<string, unknown>, occurrence: number): string => {
  const digest = createHash("sha1").update(`${taskId}|${JSON.stringify(reminder)}|${occurrence}`).digest("hex").slice(0, 16);
  return `rem-${digest}`;
};

const normalizeReminders = (taskId: string, reminders: unknown[]): unknown[] => {
  const used = new Set<string>();
  return reminders.map((raw, index) => {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
    const reminder = raw as Record<string, unknown>;
    let id = typeof reminder.id === "string" && reminder.id.length > 0 ? reminder.id : stableReminderId(taskId, reminder, index);
    while (used.has(id)) id = `${id}-${index}`;
    used.add(id);
    return { ...reminder, id };
  });
};

export const normalizeTaskRecord = (raw: unknown): unknown => {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return raw;
  const record = raw as Record<string, unknown>;
  return { ...record, reminders: Array.isArray(record.reminders) ? normalizeReminders(String(record.id ?? "legacy"), record.reminders) : record.reminders };
};

export const parseTask = (raw: unknown): Task => TaskSchema.parse(normalizeTaskRecord(raw));
export const parseTombstone = (raw: unknown): Tombstone => TombstoneSchema.parse(raw);
export const cloneTask = (task: Task): Task => TaskSchema.parse(structuredClone(task));
export const taskToLine = (task: Task): string => JSON.stringify(parseTask(task));
export const tombstone = (id: string, modified = utcNow()): Tombstone => TombstoneSchema.parse({ id, deleted: true, modified });
export const localDate = (value: string): string => value.slice(0, 10);
export const isOverdue = (task: Task, today: string): boolean => task.status === "todo" && task.due !== undefined && localDate(task.due) < today;
export const hiddenByWait = (task: Task, today: string): boolean => task.wait !== undefined && task.wait > today;

export const parseJsonl = (text: string, onMalformed?: (line: string) => void): unknown[] => {
  const out: unknown[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || /^(<<<<<<<|=======|>>>>>>>)/.test(line)) continue;
    try {
      out.push(JSON.parse(line) as unknown);
    } catch {
      onMalformed?.(line);
    }
  }
  return out;
};
