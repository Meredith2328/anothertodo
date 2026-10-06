import type { Config, Task } from "../contracts.js";
import { loadConfig } from "../core/config.js";
import { daysBetweenDates, parse, shiftDateOnly, nextOccurrence } from "../core/parse.js";
import { applyParsedUpdate } from "../core/task-ops.js";
import { ACTIVE_STATES, cloneTask, localDate, localNow, newId, parseTask, utcNow } from "../core/task.js";
import type { Store } from "../storage/store.js";
import { syncDirectory } from "../sync/sync.js";
import { snooze as snoozeReminder } from "../reminders/watcher.js";
import { planDependencies, blockedDependencies } from '../core/dependencies.js';

/** 写了未来的 `~日期` 就是在说「先押后」，直接落成 waiting，别留一个看不出状态的 todo */
const initialStatus = (wait: string | undefined, today: string): "todo" | "waiting" =>
  wait !== undefined && wait > today ? "waiting" : "todo";

export type TaskStatus = "todo" | "waiting" | "done" | "cancelled" | "meeting";
const STATUS_LABELS: Record<TaskStatus, string> = { todo: "待办", waiting: "等待", done: "已完成", cancelled: "已取消", meeting: "会议" };

export type CompleteResult = {
  task: Task;
  /** 重复任务派生出的下一次 */
  next?: Task;
  /** 一起被带上的子任务 */
  cascaded: Task[];
  /** 还没完成、也没被带上的子任务 */
  openChildren: Task[];
};

/** Application operations shared by CLI and TUI; presentation layers do not mutate tasks themselves. */
export class ApplicationService {
  constructor(readonly store: Pick<Store, "paths" | "events" | "tasks" | "save" | "saveMany" | "archived" | "dependencyTasks" | "find" | "delete" | "undo" | "archive" | "restore">) {}

  async config(): Promise<Config> {
    const config = await loadConfig(this.store.paths.dir);
    this.store.events.emit("config.reloaded", { config });
    return config;
  }

  async tasks(): Promise<Task[]> {
    return this.store.tasks();
  }

  async add(input: string, now = localNow()): Promise<Task> {
    return (await this.addBatch([input], now))[0]!;
  }

  async dependencyTasks(): Promise<Task[]> {
    return this.store.dependencyTasks();
  }

  async addBatch(inputs: string[], now = localNow(), selections: (string | undefined)[][] = [], parent?: string, reservedIds: string[] = []): Promise<Task[]> {
    const config = await this.config();
    const parsedInputs = inputs.map(input => parse(input, now, [...config.priority.levels]));
    if (!parsedInputs.length || parsedInputs.some(parsed => !parsed.title)) throw new Error('每一行都需要填写任务标题');
    const drafts = parsedInputs.map((parsed, index) => parseTask({
      id: reservedIds[index] ?? newId(), title: parsed.title, status: initialStatus(parsed.wait, now.slice(0, 10)),
      ...(parsed.due ? { due: parsed.due } : {}), ...(parsed.priority ? { priority: parsed.priority } : {}),
      tags: parsed.tags, ...(parsed.project ? { project: parsed.project } : {}), ...((parent ?? parsed.parent) ? { parent: parent ?? parsed.parent } : {}),
      ...(parsed.wait ? { wait: parsed.wait } : {}), ...(parsed.notes ? { notes: parsed.notes } : {}), ...(parsed.recur ? { recur: parsed.recur } : {}),
      reminders: parsed.reminders.map(({ relative: _relative, ...reminder }) => reminder), entry: utcNow(), modified: utcNow(),
    }));
    const existing = await this.tasks();
    const changes = planDependencies(drafts, parsedInputs.map(parsed => parsed.dependencies), await this.dependencyTasks(), selections);
    if (changes.some(task => !existing.some(item => item.id === task.id) && !drafts.some(item => item.id === task.id))) throw new Error('归档中的任务不能新增依赖，请先恢复任务');
    const saved = await this.store.saveMany(changes.map(task => { const before = existing.find(item => item.id === task.id); return before ? { task, before } : { task }; }));
    return drafts.map(draft => saved.find(task => task.id === draft.id)!);
  }

  async edit(idOrPrefix: string, input: string, now = localNow()): Promise<Task> {
    const task = await this.store.find(idOrPrefix);
    if (!task) throw new Error(`找不到任务：${idOrPrefix}`);
    const before = cloneTask(task);
    const config = await this.config();
    const parsed = parse(input, now, [...config.priority.levels]);
    applyParsedUpdate(task, parsed);
    if (parsed.dependencies.length) {
      const existing = await this.tasks();
      const changed = planDependencies([task], [parsed.dependencies], await this.dependencyTasks());
      if (changed.some(value => !existing.some(item => item.id === value.id))) throw new Error('归档中的任务不能新增依赖，请先恢复任务');
      const saved = await this.store.saveMany(changed.map(value => ({ task: value, before: existing.find(item => item.id === value.id)! })));
      return saved.find(value => value.id === task.id)!;
    }
    return this.store.save(task, before);
  }

  async setStatus(idOrPrefix: string, status: TaskStatus): Promise<Task> {
    const task = await this.store.find(idOrPrefix);
    if (!task) throw new Error(`找不到任务：${idOrPrefix}`);
    // 重复设成同一个状态没有意义，尤其是 done——静默刷新 end 会把真正的完成时间冲掉
    if (task.status === status) throw new Error(`跳过：${task.title}（已经是${STATUS_LABELS[status]}）`);
    const before = cloneTask(task);
    if (status === 'done') {
      const catalog = await this.dependencyTasks(); const blocked = blockedDependencies(task, catalog);
      if (blocked.length) throw new Error(`依赖尚未完成：${blocked.map(id => catalog.find(item => item.id === id)?.title ?? id).join('、')}`);
    }
    task.status = status;
    if (status === "done" || status === "cancelled") task.end = utcNow();
    else delete task.end;
    // 从等待里放出来就该把 wait 一起清掉，否则它会立刻又被折叠回去
    if (status === "todo" || status === "meeting") delete task.wait;
    return this.store.save(task, before);
  }

  /** 直接找子任务；id 是全长的，父字段里存的也是全长 id */
  async children(id: string): Promise<Task[]> {
    return (await this.store.tasks()).filter((task) => task.parent === id);
  }

  /**
   * 完成一个任务，顺带处理两件只有在这里才知道该怎么做的事：
   * 重复任务要派生下一次，父任务完成时要交代还开着的子任务。
   */
  async complete(idOrPrefix: string, options: { cascade?: boolean; now?: string } = {}): Promise<CompleteResult> {
    const target = await this.store.find(idOrPrefix);
    if (!target) throw new Error(`找不到任务：${idOrPrefix}`);
    const now = options.now ?? localNow();
    const openChildren = (await this.children(target.id)).filter((child) => ACTIVE_STATES.has(child.status));
    if (target.status === 'done') throw new Error(`跳过：${target.title}（已经是已完成）`);
    const all = await this.tasks(); const ids = new Set([target.id]);
    if (options.cascade) {
      let previous = -1;
      while (previous !== ids.size) { previous = ids.size; for (const task of all) if (task.parent && ids.has(task.parent) && ACTIVE_STATES.has(task.status)) ids.add(task.id); }
    }
    const catalog = await this.dependencyTasks();
    const finished = all.filter(task => ids.has(task.id)).map(task => ({ ...cloneTask(task), status: 'done', end: utcNow() }));
    const resulting = [...catalog.filter(task => !ids.has(task.id)), ...finished];
    for (const task of finished) {
      const blocked = blockedDependencies(task, resulting);
      if (blocked.length) throw new Error(`依赖尚未完成：${blocked.map(id => catalog.find(item => item.id === id)?.title ?? id).join('、')}`);
    }
    const occurrences = new Map(finished.map(task => [task.id, this.nextOccurrence(task, now)]));
    const nextTasks = [...occurrences.values()].filter((task): task is Task => task !== undefined);
    const saved = await this.store.saveMany([...finished.map(task => ({ task, before: all.find(item => item.id === task.id)! })), ...nextTasks.map(task => ({ task }))]);
    const task = saved.find(item => item.id === target.id)!;
    const nextId = occurrences.get(target.id)?.id;
    const next = nextId ? saved.find(item => item.id === nextId) : undefined;
    return { task, ...(next ? { next } : {}), cascaded: saved.filter(item => ids.has(item.id) && item.id !== target.id), openChildren: options.cascade ? [] : openChildren };
  }

  /**
   * 重复任务完成后另开一条新任务，而不是把原任务的日期往后挪：
   * 这样历史上「哪天真的做了」还留着，也不会把已完成的提醒记录带进下一次。
   */
  private nextOccurrence(task: Task, now: string): Task | undefined {
    if (!task.recur) return undefined;
    const base = task.due ? localDate(task.due) : now.slice(0, 10);
    const nextDate = nextOccurrence(base, task.recur);
    const shift = daysBetweenDates(base, nextDate);
    const draft = structuredClone(task) as Record<string, unknown>;
    delete draft.end;
    const next = parseTask({
      ...draft,
      id: newId(),
      status: task.wait ? "waiting" : "todo",
      ...(task.due ? { due: `${nextDate}${task.due.slice(10)}` } : {}),
      ...(task.wait ? { wait: shiftDateOnly(task.wait, shift) } : {}),
      // 提醒跟着整体平移，并且清掉 id 和投递状态——旧 id 由 taskId 派生，
      // 留着会让两条任务共用一个提醒身份
      reminders: task.reminders.map(({ id: _id, leaseOwner: _owner, leaseUntil: _until, attempts: _attempts, ...reminder }) => ({
        ...reminder, at: `${shiftDateOnly(reminder.at.slice(0, 10), shift)}${reminder.at.slice(10)}`, fired: false, dead: false,
      })),
      entry: utcNow(), modified: utcNow(),
    });
    return next;
  }

  async deferUntilTomorrow(idOrPrefix: string, today = localNow().slice(0, 10)): Promise<Task> {
    return this.deferUntil(idOrPrefix, shiftDateOnly(today, 1));
  }

  /** 押后到指定日期；TUI 的 w 和 CLI 的 wait 都走这里 */
  async deferUntil(idOrPrefix: string, date: string): Promise<Task> {
    const task = await this.store.find(idOrPrefix);
    if (!task) throw new Error(`找不到任务：${idOrPrefix}`);
    const before = cloneTask(task);
    task.status = "waiting";
    task.wait = date;
    delete task.end;
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
