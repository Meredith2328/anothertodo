import { type Task, TombstoneSchema } from '../../../src/contracts.js';
import { DomainEventBus } from '../../../src/core/events.js';
import { parseTask, tombstone, utcNow, newId } from '../../../src/core/task.js';
import { mergeUnion, type SyncRecord } from '../../../src/sync/merge.js';
import { native } from './bridge.js';
import { initialConfig, readConfig, useConfig } from './config.js';
import { validateDependencies } from '../../../src/core/dependencies.js';

type Frame = { tasks: SyncRecord[]; archive: SyncRecord[]; config: string };
type Change = { id: string; before: SyncRecord | null; after: SyncRecord | null };
type Undo = { tasks: Change[]; archive: Change[]; config?: { before: string; after: string }; group?: string };
export type State = Frame & { undo: Undo[]; redo?: Undo[]; preferences?: { activity: boolean; activityRange: number } };
export const records = (text: string): SyncRecord[] => {
  const raw = text.trim().startsWith('[') ? JSON.parse(text) as unknown[] : text.split(/\r?\n/).filter(line => line.trim()).map(line => JSON.parse(line) as unknown);
  if (!Array.isArray(raw)) throw new Error('任务数据需要 JSON 数组或 JSONL');
  return raw.map(record => {
    if (typeof record !== 'object' || record === null) throw new Error('任务记录格式错误');
    return ('deleted' in record && record.deleted === true ? TombstoneSchema.parse(record) : parseTask(record)) as SyncRecord;
  });
};
export const jsonl = (items: SyncRecord[]): string => items.map(item => JSON.stringify(item)).join('\n') + (items.length ? '\n' : '');
const frame = (state: State): Frame => structuredClone({ tasks: state.tasks, archive: state.archive, config: state.config });
const latest = (items: SyncRecord[]): SyncRecord[] => [...new Map(items.map(item => [item.id, item])).values()];
const changes = (before: SyncRecord[], after: SyncRecord[]): Change[] => {
  const previous = new Map(before.map(item => [item.id, item]));
  const current = new Map(after.map(item => [item.id, item]));
  return [...new Set([...previous.keys(), ...current.keys()])].flatMap(id => {
    const old = previous.get(id) ?? null, next = current.get(id) ?? null;
    return JSON.stringify(old) === JSON.stringify(next) ? [] : [{ id, before: old, after: next }];
  });
};

export class MobileStore {
  readonly paths = { dir: '/repo', tasks: '/repo/tasks.jsonl', archive: '/repo/archive.jsonl', undo: '/repo/undo.jsonl', redo: '/repo/redo.jsonl', inbox: '/repo/inbox.jsonl', archiveJournal: '/repo/.archive.txn.json', lock: '/repo/.lock' };
  readonly events = new DomainEventBus(error => { throw error; });
  state!: State;
  private version = 0;
  private editing = false;
  private readonly taskCache = new WeakMap<object, Task>();
  constructor() { this.reload(); useConfig(() => this.state.config); }
  reload(): void {
    if (this.editing) throw new Error('操作期间无法重新读取数据');
    const result = native<{ version: number; state: State | null }>('load');
    this.version = result.version;
    this.state = result.state ?? { tasks: [], archive: [], undo: [], config: initialConfig };
    records(jsonl(this.state.tasks)); records(jsonl(this.state.archive)); readConfig(this.state.config);
    useConfig(() => this.state.config);
  }
  async run<T>(operation: () => Promise<T>, undo = true, group?: string): Promise<T> {
    if (this.editing) throw new Error('已有任务操作正在执行');
    this.reload();
    const before = frame(this.state);
    const original = structuredClone(this.state);
    this.editing = true;
    try {
      const result = await operation();
      const after = frame(this.state);
      if (undo) {
        const change: Undo = { tasks: changes(before.tasks, after.tasks), archive: changes(before.archive, after.archive), ...(before.config !== after.config ? { config: { before: before.config, after: after.config } } : {}) };
        if (change.tasks.length || change.archive.length || change.config) {
          this.state.redo = [];
          const previous = this.state.undo.at(-1);
          if (group && previous?.group === group) {
            for (const kind of ['tasks', 'archive'] as const) for (const delta of change[kind]) {
              const existing = previous[kind].find(item => item.id === delta.id);
              if (existing) existing.after = delta.after; else previous[kind].push(delta);
            }
            if (change.config) previous.config = { before: previous.config?.before ?? change.config.before, after: change.config.after };
          } else { if (group) change.group = group; this.state.undo.push(change); }
        }
      }
      this.state.undo = this.state.undo.slice(-100);
      validateDependencies([...this.state.archive, ...this.state.tasks].filter(item => !item.deleted).map(parseTask));
      this.version = native<number>('save', { version: this.version, state: this.state, config: readConfig(this.state.config) });
      return result;
    } catch (error) {
      this.state = original;
      throw error;
    } finally { this.editing = false; }
  }
  async tasks(): Promise<Task[]> {
    return latest(this.state.tasks).filter(item => !item.deleted).map(item => {
      let task = this.taskCache.get(item);
      if (!task) { task = parseTask(item); this.taskCache.set(item, task); }
      return task;
    });
  }
  async find(prefix: string): Promise<Task | undefined> {
    const found = latest(this.state.tasks).filter(task => !task.deleted && task.id.startsWith(prefix));
    if (found.length > 1) throw new Error(`任务编号匹配多个任务：${prefix}`);
    return found[0] ? parseTask(found[0]) : undefined;
  }
  async archived(): Promise<Record<string, unknown>[]> { return latest(this.state.archive); }
  async get(id: string): Promise<Task | undefined> { return (await this.tasks()).find(task => task.id === id); }
  async batch<T>(operation: () => Promise<T>): Promise<T> { return operation(); }
  async history(limit = 10): Promise<Array<{ ts: string; summary: string }>> {
    return this.state.undo.slice(-limit).reverse().map(change => ({ ts: '', summary: `${change.tasks.length + change.archive.length} 个任务${change.config ? '与配置' : ''}` }));
  }
  async dependencyTasks(): Promise<Task[]> { return latest([...this.state.archive, ...this.state.tasks]).filter(record => !record.deleted).map(parseTask); }
  async saveMany(entries: Array<{ task: Task; before?: Task }>): Promise<Task[]> {
    const saved: Task[] = [];
    for (const entry of entries) saved.push(await this.save(entry.task, entry.before));
    return saved;
  }
  async save(value: Task | (() => Promise<Task>), before?: Task, _recordUndo = true, receipt?: { id: string; payloadHash: string }): Promise<Task> {
    if (receipt) throw new Error('手机任务操作通过本地事务提交');
    const input = typeof value === 'function' ? await value() : value;
    if (!this.editing) throw new Error('写入需要处于事务之中');
    const current = await this.find(input.id);
    if (before && current?.modified !== before.modified) throw new Error('任务已经发生变化，请重新打开');
    const task = parseTask(input);
    if (!before) while (this.state.tasks.some(item => item.id === task.id)) task.id = newId();
    if (task.parent && (!before || task.parent !== before.parent)) {
      const parent = await this.find(task.parent);
      if (!parent && !this.state.tasks.some(item => item.parent === task.parent)) throw new Error(`父任务不存在：${task.parent}`);
      if (parent) task.parent = parent.id;
      const visited = new Set([task.id]);
      let ancestor: Task | undefined = parent;
      while (ancestor) {
        if (visited.has(ancestor.id)) throw new Error('父子任务不能形成循环');
        visited.add(ancestor.id);
        ancestor = ancestor.parent ? await this.find(ancestor.parent) : undefined;
      }
    }
    task.modified = utcNow();
    this.state.tasks = [...this.state.tasks.filter(item => item.id !== task.id), task as SyncRecord];
    return task;
  }
  async delete(id: string, expected?: string): Promise<void> {
    const task = await this.find(id);
    if (!task || (expected && task.modified !== expected)) throw new Error('任务已经发生变化');
    this.state.tasks = [...this.state.tasks.filter(item => item.id !== id), tombstone(id) as SyncRecord];
  }
  async undo(): Promise<string> {
    const previousFrame = frame(this.state);
    const change = this.state.undo.at(-1);
    if (!change) throw new Error('没有可撤销的操作');
    const restore = (list: SyncRecord[], deltas: Change[], deletedRecords: boolean): SyncRecord[] => {
      const ids = new Set(deltas.map(delta => delta.id));
      const restored: SyncRecord[] = [];
      for (const delta of deltas) {
        const current = list.find(item => item.id === delta.id);
        if (delta.after?.modified !== current?.modified || delta.after?.deleted !== current?.deleted) throw new Error('任务已在其他操作中更新，无法撤销');
        if (delta.before) {
          const item: SyncRecord = { ...delta.before, modified: utcNow() };
          if (!item.deleted && current && !current.deleted) {
            const runtime = parseTask(current).reminders;
            item.reminders = parseTask(item).reminders.map(reminder => {
              const newer = runtime.find(other => other.id === reminder.id);
              return newer ? { ...reminder, fired: newer.fired, dead: newer.dead, attempts: newer.attempts ?? 0 } : reminder;
            });
          }
          restored.push(item);
        } else if (deletedRecords && !change.archive.some(other => other.id === delta.id && other.before)) restored.push(tombstone(delta.id) as SyncRecord);
      }
      return [...list.filter(item => !ids.has(item.id)), ...restored];
    };
    this.state.tasks = restore(this.state.tasks, change.tasks, true);
    this.state.archive = restore(this.state.archive, change.archive, false);
    if (change.config) {
      if (this.state.config !== change.config.after) throw new Error('配置已经发生变化，无法撤销');
      this.state.config = change.config.before;
    }
    this.state.undo.pop();
    const reverse: Undo = { tasks: changes(this.state.tasks, previousFrame.tasks), archive: changes(this.state.archive, previousFrame.archive), ...(change.config ? { config: { before: this.state.config, after: previousFrame.config } } : {}) };
    (this.state.redo ??= []).push(reverse);
    for (const [kind, deltas] of [['tasks', change.tasks], ['archive', change.archive]] as const) {
      for (const delta of deltas) {
        for (let index = this.state.undo.length - 1; index >= 0; index--) {
          const previous = this.state.undo[index]![kind].find(item => item.id === delta.id);
          if (previous) { previous.after = this.state[kind].find(item => item.id === delta.id) ?? null; break; }
        }
      }
    }
    return '已撤销操作';
  }
  async redo(): Promise<string> {
    const change = this.state.redo?.at(-1);
    if (!change) throw new Error('没有可以重做的操作');
    const previous = frame(this.state);
    for (const kind of ['tasks', 'archive'] as const) for (const delta of change[kind]) {
      const current = this.state[kind].find(item => item.id === delta.id);
      if (current?.modified !== delta.before?.modified) throw new Error('任务已经更新，无法重做');
      this.state[kind] = this.state[kind].filter(item => item.id !== delta.id);
      if (delta.after) this.state[kind].push({ ...delta.after, modified: utcNow() });
    }
    if (change.config) { if (this.state.config !== change.config.before) throw new Error('配置已经更新，无法重做'); this.state.config = change.config.after; }
    this.state.redo!.pop();
    this.state.undo.push({ tasks: changes(previous.tasks, this.state.tasks), archive: changes(previous.archive, this.state.archive), ...(change.config ? { config: { before: previous.config, after: this.state.config } } : {}) });
    return '已经重做操作';
  }
  async archive(days = 14): Promise<number> {
    const moved = latest(this.state.tasks).filter(item => {
      const modified = Date.parse(String(item.modified));
      const age = Number.isFinite(modified) ? Math.floor((Date.now() - modified) / 86400000) : 999;
      return (item.deleted || item.status === 'done' || item.status === 'cancelled') && age >= days;
    });
    const ids = new Set(moved.map(item => item.id));
    this.state.tasks = this.state.tasks.filter(item => !ids.has(item.id));
    this.state.archive = mergeUnion(this.state.archive, moved);
    return moved.length;
  }
  async restore(prefix: string): Promise<Record<string, unknown>> {
    const matches = latest(this.state.archive).filter(item => item.id.startsWith(prefix));
    if (matches.length !== 1) throw new Error('归档任务编号需要匹配一个任务');
    const task: SyncRecord = { ...matches[0]!, modified: utcNow() };
    if (task.deleted) { delete task.deleted; task.status = 'todo'; }
    const restored = parseTask(task);
    this.state.archive = this.state.archive.filter(item => item.id !== restored.id);
    this.state.tasks = [...this.state.tasks.filter(item => item.id !== restored.id), restored as SyncRecord];
    return restored;
  }
  import(text: string): number {
    const incoming = records(text);
    this.state.tasks = mergeUnion(this.state.tasks, incoming);
    return incoming.length;
  }
}
