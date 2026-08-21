import type { Config, Task } from "../contracts.js";
import { loadConfig } from "../core/config.js";
import { parse } from "../core/parse.js";
import { applyParsedUpdate } from "../core/task-ops.js";
import { cloneTask, localNow, newId, parseTask, utcNow } from "../core/task.js";
import { Store } from "../storage/store.js";
import { syncDirectory } from "../sync/sync.js";
import { snooze as snoozeReminder } from "../reminders/watcher.js";

/** 写了未来的 `~日期` 就是在说「先押后」，直接落成 waiting，别留一个看不出状态的 todo */
const initialStatus = (wait: string | undefined, today: string): "todo" | "waiting" =>
  wait !== undefined && wait > today ? "waiting" : "todo";

/** Application operations shared by CLI and TUI; presentation layers do not mutate tasks themselves. */
export class ApplicationService {
  constructor(readonly store: Store) {}

  async config(): Promise<Config> {
    const config = await loadConfig(this.store.paths.dir);
    this.store.events.emit("config.reloaded", { config });
    return config;
  }

  async tasks(): Promise<Task[]> {
    return this.store.tasks();
  }

  async add(input: string, now = localNow()): Promise<Task> {
    const config = await this.config();
    const parsed = parse(input, now, [...config.priority.levels]);
    if (!parsed.title) throw new Error("标题不能为空");
    return this.store.save(parseTask({
      id: newId(), title: parsed.title, status: initialStatus(parsed.wait, now.slice(0, 10)),
      ...(parsed.due ? { due: parsed.due } : {}), ...(parsed.priority ? { priority: parsed.priority } : {}),
      tags: parsed.tags, ...(parsed.project ? { project: parsed.project } : {}), ...(parsed.parent ? { parent: parsed.parent } : {}),
      ...(parsed.wait ? { wait: parsed.wait } : {}), ...(parsed.notes ? { notes: parsed.notes } : {}), ...(parsed.recur ? { recur: parsed.recur } : {}),
      reminders: parsed.reminders.map(({ relative: _relative, ...reminder }) => reminder), entry: utcNow(), modified: utcNow(),
    }));
  }

  async edit(idOrPrefix: string, input: string, now = localNow()): Promise<Task> {
    const task = await this.store.find(idOrPrefix);
    if (!task) throw new Error(`找不到任务：${idOrPrefix}`);
    const before = cloneTask(task);
    const config = await this.config();
    applyParsedUpdate(task, parse(input, now, [...config.priority.levels]));
    return this.store.save(task, before);
  }

  async setStatus(idOrPrefix: string, status: "todo" | "waiting" | "done"): Promise<Task> {
    const task = await this.store.find(idOrPrefix);
    if (!task) throw new Error(`找不到任务：${idOrPrefix}`);
    const before = cloneTask(task);
    task.status = status;
    if (status === "done") task.end = utcNow();
    else if (status === "todo") delete task.end;
    return this.store.save(task, before);
  }

  async deferUntilTomorrow(idOrPrefix: string, today = localNow().slice(0, 10)): Promise<Task> {
    const task = await this.store.find(idOrPrefix);
    if (!task) throw new Error(`找不到任务：${idOrPrefix}`);
    const before = cloneTask(task);
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() + 1);
    task.status = "waiting";
    task.wait = date.toISOString().slice(0, 10);
    return this.store.save(task, before);
  }

  async remove(idOrPrefix: string): Promise<void> {
    const task = await this.store.find(idOrPrefix);
    if (!task) throw new Error(`找不到任务：${idOrPrefix}`);
    await this.store.delete(task.id, task.modified);
  }

  async reopen(idOrPrefix: string): Promise<Task> {
    const task = await this.store.find(idOrPrefix);
    if (!task) throw new Error(`找不到任务：${idOrPrefix}`);
    if (task.status !== "done" && task.status !== "cancelled") throw new Error(`跳过：${task.title}（只有 done/cancelled 可 reopen）`);
    const before = cloneTask(task);
    task.status = "todo";
    delete task.end;
    task.reminders = task.reminders.map((reminder) => ({ ...reminder, fired: false, dead: false }));
    return this.store.save(task, before);
  }

  async undo(): Promise<string> {
    return this.store.undo();
  }

  async archive(days = 14): Promise<number> {
    return this.store.archive(days);
  }

  async restore(idOrPrefix: string): Promise<Record<string, unknown>> {
    return this.store.restore(idOrPrefix);
  }

  async sync(): Promise<string> {
    return syncDirectory(this.store.paths.dir, true, undefined, this.store.events);
  }

  async snooze(idOrPrefix: string, minutes: number): Promise<void> {
    await snoozeReminder(this.store, idOrPrefix, minutes);
  }
}
