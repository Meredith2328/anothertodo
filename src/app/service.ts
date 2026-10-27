import { createHash } from "node:crypto";
import type { Config, Task } from "../contracts.js";
import { loadConfig } from "../core/config.js";
import { daysBetweenDates, parse, shiftDateOnly, nextOccurrence } from "../core/parse.js";
import { unblockedBy, wouldCycle } from "../core/deps.js";
import { applyParsedUpdate } from "../core/task-ops.js";
import { ACTIVE_STATES, cloneTask, localDate, localNow, newId, parseTask, utcNow } from "../core/task.js";
import type { Store } from "../storage/store.js";
import { OperationError } from "../core/errors.js";
import { syncDirectory } from "../sync/sync.js";
import { snooze as snoozeReminder } from "../reminders/watcher.js";
import { planDependencies, blockedDependencies, dependencyIds } from '../core/dependencies.js';

/** 写了未来的 `~日期` 就是在说「先押后」，直接落成 waiting，别留一个看不出状态的 todo */
const initialStatus = (wait: string | undefined, today: string): "todo" | "waiting" =>
  wait !== undefined && wait > today ? "waiting" : "todo";

export type MutationOptions = { ifModified?: string };
export type TaskStatus = "todo" | "doing" | "waiting" | "paused" | "done" | "cancelled" | "meeting";
const STATUS_LABELS: Record<TaskStatus, string> = { todo: "待办", doing: "在做", waiting: "等待", paused: "暂停", done: "已完成", cancelled: "已取消", meeting: "会议" };

export type CompleteResult = {
  task: Task;
  /** 重复任务派生出的下一次 */
  next?: Task;
  /** 一起被带上的子任务 */
  cascaded: Task[];
  /** 还没完成、也没被带上的子任务 */
  openChildren: Task[];
  /** 因为这次完成而不再被前置挡住、该露出来的后续任务 */
  unblocked: Task[];
};

/** Application operations shared by CLI and TUI; presentation layers do not mutate tasks themselves. */
export class ApplicationService {
  constructor(readonly store: Pick<Store, "paths" | "events" | "tasks" | "save" | "saveMany" | "archived" | "dependencyTasks" | "find" | "get" | "delete" | "undo" | "archive" | "restore" | "batch" | "history" | "redo">) {}

  async config(): Promise<Config> {
    const config = await loadConfig(this.store.paths.dir);
    this.store.events.emit("config.reloaded", { config });
    return config;
  }

  async tasks(): Promise<Task[]> {
    return this.store.tasks();
  }

  async dependencyTasks(): Promise<Task[]> {
    return this.store.dependencyTasks();
  }

  async addProject(input: string, steps: string[], now = localNow()): Promise<Task> {
    const config = await this.config();
    const parsed = [input, ...steps].map(line => parse(line, now, config.priority.levels));
    if (!steps.length || parsed.some(item => !item.title)) throw new Error('项目标题和每个步骤都需要填写');
    if (parsed.some(item => item.recur)) throw new Error('项目步骤请使用独立任务，重复规则用于普通待办');
    const rootId = newId();
    const drafts = parsed.map((item, index) => {
      const task = parseTask({ ...item, id: index === 0 ? rootId : newId(), status: initialStatus(item.wait, now.slice(0, 10)), entry: utcNow(), modified: utcNow(), ...(index === 0 ? { kind: 'project' } : { parent: rootId }), reminders: item.reminders.map(({ relative: _relative, ...reminder }) => reminder) });
      return task;
    });
    for (let index = 2; index < drafts.length; index++) drafts[index]!.dependsOn = [drafts[index - 1]!.id];
    const existing = await this.tasks();
    const changes = planDependencies(drafts, parsed.map(item => [...item.dependencies, ...(item.deps ?? []).map(reference => ({ reference, direction: 'after' as const }))]), await this.dependencyTasks());
    if (changes.some(task => !existing.some(item => item.id === task.id) && !drafts.some(item => item.id === task.id))) throw new Error('请先恢复归档中的依赖任务');
    await this.store.saveMany(changes.map(task => { const before = existing.find(item => item.id === task.id); return before ? { task, before } : { task }; }));
    return (await this.store.find(rootId))!;
  }

  async addBatch(inputs: string[], now = localNow(), selections: (string | undefined)[][] = [], parent?: string, reservedIds: string[] = []): Promise<Task[]> {
    const config = await this.config();
    const parsedInputs = inputs.map(input => parse(input, now, [...config.priority.levels]));
    if (!parsedInputs.length || parsedInputs.some(parsed => !parsed.title)) throw new Error('每一行都需要填写任务标题');
    const drafts = parsedInputs.map((parsed, index) => parseTask({
      id: reservedIds[index] ?? newId(), title: parsed.title, status: parsed.status ?? initialStatus(parsed.wait, now.slice(0, 10)),
      ...(parsed.due ? { due: parsed.due } : {}), ...(parsed.until ? { until: parsed.until } : {}), ...(parsed.priority ? { priority: parsed.priority } : {}),
      tags: parsed.tags, ...(parsed.project ? { project: parsed.project } : {}), ...((parent ?? parsed.parent) ? { parent: parent ?? parsed.parent } : {}),
      ...(parsed.wait ? { wait: parsed.wait } : {}), ...(parsed.notes ? { notes: parsed.notes } : {}), ...(parsed.recur ? { recur: parsed.recur } : {}),
      reminders: parsed.reminders.map(({ relative: _relative, ...reminder }) => reminder), entry: utcNow(), modified: utcNow(),
    }));
    const existing = await this.tasks();
    const changes = planDependencies(drafts, parsedInputs.map(parsed => [...parsed.dependencies, ...(parsed.deps ?? []).map(reference => ({ reference, direction: 'after' as const }))]), await this.dependencyTasks(), selections);
    if (changes.some(task => !existing.some(item => item.id === task.id) && !drafts.some(item => item.id === task.id))) throw new Error('归档中的任务不能新增依赖，请先恢复任务');
    const saved = await this.store.saveMany(changes.map(task => { const before = existing.find(item => item.id === task.id); return before ? { task, before } : { task }; }));
    return drafts.map(draft => saved.find(task => task.id === draft.id)!);
  }

  /** `after:` 后面既可以写 id 前缀，也可以直接写标题：先按 id 找，找不到再按标题（整个匹配，再唯一前缀） */
  private async findDep(ref: string): Promise<Task | undefined> {
    const byId = await this.store.find(ref);
    if (byId) return byId;
    const candidates = (await this.store.tasks()).filter((task) => ACTIVE_STATES.has(task.status));
    const exact = candidates.filter((task) => task.title === ref);
    if (exact.length === 1) return exact[0];
    const prefixed = candidates.filter((task) => task.title.startsWith(ref));
    if (prefixed.length === 1) return prefixed[0];
    if (prefixed.length > 1) throw new Error(`「${ref}」对上了好几条：${prefixed.map((task) => task.title).join("、")}`);
    return undefined;
  }

  /** 把 `after:` 里写的 id 前缀或标题解析成全长 id，并拒绝会让依赖成环的写法 */
  private async resolveDeps(id: string, prefixes: string[]): Promise<string[]> {
    const deps: string[] = [];
    for (const prefix of prefixes) {
      const dep = await this.findDep(prefix);
      if (!dep) throw new Error(`找不到前置任务：${prefix}`);
      if (dep.id === id) throw new Error("任务不能依赖自己");
      if (!deps.includes(dep.id)) deps.push(dep.id);
    }
    if (wouldCycle(await this.store.tasks(), id, deps)) throw new Error("前置依赖形成循环（成环）");
    return deps;
  }

  async add(input: string, now = localNow(), options: { requestId?: string } = {}): Promise<Task> {
    if (options.requestId === undefined && parse(input, now).dependencies.length) return (await this.addBatch([input], now))[0]!;
    const config = await this.config();
    return this.store.save(async () => {
      const parsed = parse(input, now, [...config.priority.levels]);
      if (!parsed.title) throw new OperationError("INVALID_INPUT", "标题不能为空");
      const id = newId();
      const deps = parsed.deps ? await this.resolveDeps(id, parsed.deps) : [];
      return parseTask({
        id, title: parsed.title, status: parsed.status ?? initialStatus(parsed.wait, now.slice(0, 10)), ...(deps.length ? { deps } : {}),
        ...(parsed.due ? { due: parsed.due } : {}), ...(parsed.until ? { until: parsed.until } : {}), ...(parsed.priority ? { priority: parsed.priority } : {}),
        tags: parsed.tags, ...(parsed.project ? { project: parsed.project } : {}), ...(parsed.parent ? { parent: parsed.parent } : {}),
        ...(parsed.wait ? { wait: parsed.wait } : {}), ...(parsed.notes ? { notes: parsed.notes } : {}), ...(parsed.recur ? { recur: parsed.recur } : {}),
        reminders: parsed.reminders.map(({ relative: _relative, ...reminder }) => reminder), entry: utcNow(), modified: utcNow(),
      });
    }, undefined, true, options.requestId === undefined ? undefined : { id: options.requestId, payloadHash: createHash("sha256").update(input).digest("hex") });
  }

  private checkVersion(task: Task, options: MutationOptions): void {
    if (options.ifModified !== undefined && task.modified !== options.ifModified) throw new OperationError("VERSION_CONFLICT", `任务 ${task.id} 已修改；请读取最新版本后重新判断`);
  }

  async edit(idOrPrefix: string, input: string, now = localNow(), options: MutationOptions = {}): Promise<Task> {
    const task = await this.store.find(idOrPrefix);
    if (!task) throw new OperationError("NOT_FOUND", `找不到任务：${idOrPrefix}`);
    this.checkVersion(task, options);
    const before = cloneTask(task);
    const config = await this.config();
    const parsed = parse(input, now, [...config.priority.levels]);
    if (parsed.deps) parsed.deps = await this.resolveDeps(task.id, parsed.deps);
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

  /** 整组改写前置；依赖图里删一条边、选择列表里勾选都走这里 */
  async setDeps(idOrPrefix: string, depIds: string[]): Promise<Task> {
    const task = await this.store.find(idOrPrefix);
    if (!task) throw new OperationError("NOT_FOUND", `找不到任务：${idOrPrefix}`);
    const before = cloneTask(task);
    const deps = await this.resolveDeps(task.id, depIds);
    delete task.dependsOn;
    if (deps.length) task.deps = deps; else delete task.deps;
    return this.store.save(task, before);
  }

  /**
   * 反过来设：让 dependentIds 这些任务都等 id 做完，其余原来等它的任务不再等。
   * 后续任务选择列表保存时走这里，整次改动算一步撤销。
   */
  async setDependents(id: string, dependentIds: string[]): Promise<number> {
    const all = await this.store.tasks();
    let changed = 0;
    await this.store.batch(async () => {
      for (const task of all) {
        if (task.id === id) continue;
        const has = dependencyIds(task).includes(id);
        const want = dependentIds.includes(task.id);
        if (has === want) continue;
        await this.setDeps(task.id, want ? [...dependencyIds(task), id] : dependencyIds(task).filter((dep) => dep !== id));
        changed += 1;
      }
    });
    return changed;
  }

  async setStatus(idOrPrefix: string, status: TaskStatus, options: MutationOptions = {}): Promise<Task> {
    if (status === 'done') return (await this.complete(idOrPrefix, options)).task;
    const task = await this.store.find(idOrPrefix);
    if (!task) throw new OperationError("NOT_FOUND", `找不到任务：${idOrPrefix}`);
    this.checkVersion(task, options);
    // 重复设成同一个状态没有意义，尤其是 done——静默刷新 end 会把真正的完成时间冲掉
    if (task.status === status) throw new OperationError("ALREADY_IN_STATE", `跳过：${task.title}（已经是${STATUS_LABELS[status]}）`);
    const before = cloneTask(task);
    task.status = status;
    if (status === "cancelled") task.end = utcNow();
    else delete task.end;
    // 从等待里放出来就该把 wait 一起清掉，否则它会立刻又被折叠回去
    if (status === "todo" || status === "meeting" || status === "doing" || status === "paused") delete task.wait;
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
  async complete(idOrPrefix: string, options: { cascade?: boolean; now?: string; ifModified?: string } = {}): Promise<CompleteResult> {
    const target = await this.store.find(idOrPrefix);
    if (!target) throw new OperationError("NOT_FOUND", `找不到任务：${idOrPrefix}`);
    this.checkVersion(target, options);
    const now = options.now ?? localNow();
    const openChildren = (await this.children(target.id)).filter((child) => ACTIVE_STATES.has(child.status));
    if (target.status === 'done') throw new OperationError('ALREADY_IN_STATE', `跳过：${target.title}（已经是已完成）`);
    const all = await this.tasks(); const ids = new Set([target.id]);
    const cascade = options.cascade || target.kind === 'project';
    if (cascade) {
      let previous = -1;
      while (previous !== ids.size) { previous = ids.size; for (const task of all) if (task.parent && ids.has(task.parent) && ACTIVE_STATES.has(task.status)) ids.add(task.id); }
    }
    const catalog = await this.dependencyTasks();
    let added = true;
    while (added) {
      added = false;
      for (const project of all.filter(task => task.kind === 'project' && ACTIVE_STATES.has(task.status) && !ids.has(task.id))) {
        const children = catalog.filter(task => task.parent === project.id);
        if (children.some(child => ids.has(child.id)) && children.every(child => child.status === 'done' || ids.has(child.id))) { ids.add(project.id); added = true; }
      }
    }
    const finished = all.filter(task => ids.has(task.id)).map(task => ({ ...cloneTask(task), status: 'done', end: utcNow() }));
    const resulting = [...catalog.filter(task => !ids.has(task.id)), ...finished];
    for (const task of finished) {
      const blocked = blockedDependencies(task, resulting);
      if (blocked.length) throw new OperationError('DEPENDENCY_BLOCKED', `依赖尚未完成：${blocked.map(id => catalog.find(item => item.id === id)?.title ?? id).join('、')}`);
    }
    const occurrences = new Map(finished.map(task => [task.id, this.nextOccurrence(task, now)]));
    const nextTasks = [...occurrences.values()].filter((task): task is Task => task !== undefined);
    const saved = await this.store.saveMany([...finished.map(task => ({ task, before: all.find(item => item.id === task.id)! })), ...nextTasks.map(task => ({ task }))]);
    const task = saved.find(item => item.id === target.id)!;
    const nextId = occurrences.get(target.id)?.id;
    const next = nextId ? saved.find(item => item.id === nextId) : undefined;
    return { task, ...(next ? { next } : {}), cascaded: saved.filter(item => ids.has(item.id) && item.id !== target.id), openChildren: cascade ? [] : openChildren, unblocked: unblockedBy(await this.tasks(), target.id) };
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
    // 前置是这一次的事，早就做完了；带到下一次只会让依赖图每周多长一条重复的枝
    delete draft.deps;
    delete draft.dependsOn;
    const next = parseTask({
      ...draft,
      id: newId(),
      status: task.wait ? "waiting" : "todo",
      ...(task.due ? { due: `${nextDate}${task.due.slice(10)}` } : {}),
      ...(task.until ? { until: `${shiftDateOnly(task.until.slice(0, 10), shift)}${task.until.slice(10)}` } : {}),
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
  async deferUntil(idOrPrefix: string, date: string, options: MutationOptions = {}): Promise<Task> {
    const task = await this.store.find(idOrPrefix);
    if (!task) throw new OperationError("NOT_FOUND", `找不到任务：${idOrPrefix}`);
    this.checkVersion(task, options);
    const before = cloneTask(task);
    task.status = "waiting";
    task.wait = date;
    delete task.end;
    return this.store.save(task, before);
  }

  async remove(idOrPrefix: string, options: MutationOptions = {}): Promise<void> {
    const task = await this.store.find(idOrPrefix);
    if (!task) throw new OperationError("NOT_FOUND", `找不到任务：${idOrPrefix}`);
    this.checkVersion(task, options);
    await this.store.delete(task.id, task.modified);
  }

  async reopen(idOrPrefix: string, options: MutationOptions = {}): Promise<Task> {
    const task = await this.store.find(idOrPrefix);
    if (!task) throw new OperationError("NOT_FOUND", `找不到任务：${idOrPrefix}`);
    this.checkVersion(task, options);
    if (task.status !== "done" && task.status !== "cancelled") throw new OperationError("INVALID_STATE", `跳过：${task.title}（只有 done/cancelled 可 reopen）`);
    const before = cloneTask(task);
    task.status = "todo";
    delete task.end;
    task.reminders = task.reminders.map((reminder) => ({ ...reminder, fired: false, dead: false }));
    return this.store.save(task, before);
  }

  async undo(): Promise<string> {
    return this.store.undo();
  }

  /** 最近几步操作，最新的在前 */
  async history(limit = 10): Promise<Array<{ ts: string; summary: string }>> {
    return this.store.history(limit);
  }

  /** 连续撤销 n 步，给「回到历史里的某一步」用 */
  async undoSteps(steps: number): Promise<string> {
    let last = "";
    for (let index = 0; index < steps; index += 1) last = await this.store.undo();
    return steps === 1 ? last : `已回退 ${steps} 步（${last}）`;
  }

  async redo(): Promise<string> {
    return this.store.redo();
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
