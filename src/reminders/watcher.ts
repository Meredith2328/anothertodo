import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";

import type { Task } from "../contracts.js";
import { loadConfig } from "../core/config.js";
import { cloneTask } from "../core/task.js";
import { addLocalMinutes, parseCompatibleDateTime } from "../core/time.js";
import { Store } from "../storage/store.js";
import { fireHook } from "./hooks.js";

const activeStatuses = new Set(["todo", "waiting", "meeting"]);
const MAX_HOOK_ATTEMPTS = 3;
const localNow = (): string => {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
};
export const messageFor = (task: Task, reminder: { at: string }, missed = false): string => `${missed ? "[错过] " : ""}⏰ ${task.title}（${reminder.at.replace("T", " ")}）`;
const lateMinutes = (at: string, now: string): number => {
  const reminderAt = parseCompatibleDateTime(at);
  const nowAt = parseCompatibleDateTime(now);
  return !reminderAt || !nowAt ? 0 : Math.max(0, Math.floor((nowAt.getTime() - reminderAt.getTime()) / 60_000));
};
export const isMissedReminder = (at: string, now: string): boolean => lateMinutes(at, now) > 5;
export type ReminderCheckSummary = { processed: number; sent: number; retried: number; dead: number };

export const checkOnceDetailed = async (store: Store, quiet = false, now = localNow(), dir = store.paths.dir): Promise<ReminderCheckSummary> => {
  const summary: ReminderCheckSummary = { processed: 0, sent: 0, retried: 0, dead: 0 };
  const owner = randomUUID();
  for (const initial of await store.tasks()) {
    const task = await store.get(initial.id);
    if (!task || !activeStatuses.has(task.status)) continue;
    for (const reminder of task.reminders) {
      const reminderId = reminder.id;
      if (!reminderId) continue;
      const reminderAt = parseCompatibleDateTime(reminder.at);
      const nowAt = parseCompatibleDateTime(now);
      if (!reminderAt || !nowAt) { if (!quiet) console.error(`atd: 跳过无效提醒时间：${reminder.at}`); continue; }
      if (reminder.fired || reminder.dead || reminderAt.getTime() > nowAt.getTime()) continue;
      const claimed = await store.claimReminder(task.id, reminderId, owner, now);
      if (!claimed) continue;
      const claimedReminder = claimed.reminders.find((item) => item.id === reminderId);
      if (!claimedReminder) continue;
      const missed = isMissedReminder(claimedReminder.at, now);
      const reminderIndex = claimed.reminders.findIndex((item) => item.id === reminderId);
      store.events.emit("reminder.due", { task: claimed, reminderIndex, missed });
      const results = await Promise.all(claimedReminder.hooks.map((name) => fireHook(name, { task: claimed, message: messageFor(claimed, claimedReminder, missed) }, dir)));
      for (const result of results) if (!result.ok && !quiet) console.error(`atd: reminder hook ${result.name} 失败：${result.error}`);
      const allFailed = results.length === 0 || results.every((result) => !result.ok);
      try {
        const result = await store.completeReminder(claimed.id, reminderId, owner, now, allFailed, MAX_HOOK_ATTEMPTS);
        if (!result) continue;
        if (result.fired) store.events.emit("reminder.fired", { taskId: claimed.id, reminderIndex, });
        summary.processed += 1;
        if (result.fired) summary.sent += 1;
        else if (result.dead) summary.dead += 1;
        else summary.retried += 1;
      } catch (error) { if (!quiet) console.error(`atd: reminder 状态写回失败：${error instanceof Error ? error.message : String(error)}`); }
    }
  }
  return summary;
};

export const checkOnce = async (store: Store, quiet = false, now = localNow(), dir = store.paths.dir): Promise<number> => (await checkOnceDetailed(store, quiet, now, dir)).processed;

export const snooze = async (store: Store, idOrPrefix: string, minutes: number): Promise<void> => {
  const task = await store.find(idOrPrefix);
  if (!task) throw new Error(`找不到任务：${idOrPrefix}`);
  const before = cloneTask(task);
  const index = [...task.reminders].map((reminder, i) => ({ reminder, i })).reverse().find(({ reminder }) => !reminder.fired)?.i;
  if (index === undefined) throw new Error("没有未触发的提醒");
  const nextAt = addLocalMinutes(task.reminders[index]!.at, minutes);
  if (!nextAt) throw new Error(`提醒时间无效，无法 snooze：${task.reminders[index]!.at}`);
  const snoozed = { ...task.reminders[index]!, at: nextAt, fired: false, dead: false, attempts: 0 };
  delete snoozed.leaseOwner;
  delete snoozed.leaseUntil;
  task.reminders[index] = snoozed;
  await store.save(task, before);
};

export const runForever = async (store: Store, intervalSeconds?: number): Promise<never> => {
  const config = await loadConfig(store.paths.dir);
  const interval = intervalSeconds ?? config.watch.interval_seconds;
  while (true) {
    await checkOnce(store, false, localNow(), store.paths.dir);
    await delay(interval * 1000);
  }
};
