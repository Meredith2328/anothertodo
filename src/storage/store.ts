import { appendFile, mkdir, open, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";

import { TaskSchema, TombstoneSchema, type Task } from "../contracts.js";
import { DomainEventBus, type DomainEvents } from "../core/events.js";
import { cloneTask, newId, parseTask, tombstone, utcNow } from "../core/task.js";
import { addLocalMinutes, parseCompatibleDateTime } from "../core/time.js";
import { readJsonlDetailed } from "./jsonl.js";
import { pathsFor, type Paths } from "./paths.js";
import { atomicWriteText, withDataLock } from "./lock.js";

type JsonObject = Record<string, unknown>;
type UndoRecord = { before: JsonObject | null; after: JsonObject | null; ts: string };
type ArchiveTransaction = { tasks: string[]; archive: string[] };

export class ConcurrentModificationError extends Error {
  constructor(taskId: string) {
    super(`任务 ${taskId} 已被其他进程修改；请刷新后重试`);
    this.name = "ConcurrentModificationError";
  }
}

const jsonLine = (value: unknown): string => JSON.stringify(value);
const mergeReminderRuntime = (restored: Task, current: Task): Task => {
  const currentById = new Map(current.reminders.map((reminder) => [reminder.id, reminder]));
  restored.reminders = restored.reminders.map((reminder) => {
    const runtime = reminder.id ? currentById.get(reminder.id) : undefined;
    return runtime ? { ...reminder, fired: runtime.fired, attempts: runtime.attempts, dead: runtime.dead, leaseOwner: runtime.leaseOwner, leaseUntil: runtime.leaseUntil } : reminder;
  });
  return restored;
};
const validObject = (value: unknown): JsonObject | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const object = value as JsonObject;
  const result = object.deleted === true ? TombstoneSchema.safeParse(object) : TaskSchema.safeParse(object);
  if (!result.success) {
    console.error(`atd: 跳过无法通过 schema 校验的记录：${result.error.issues[0]?.message ?? "unknown error"}`);
    return undefined;
  }
  return result.data as JsonObject;
};

export const atomicWrite = async (path: string, lines: readonly string[]): Promise<void> => {
  await atomicWriteText(path, lines.length > 0 ? `${lines.join("\n")}\n` : "");
};

export const recoverArchiveTransaction = async (paths: Pick<Paths, "archiveJournal" | "archive" | "tasks">): Promise<void> => {
  let raw: string;
  try { raw = await readFile(paths.archiveJournal, "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  let transaction: ArchiveTransaction;
  try { transaction = JSON.parse(raw) as ArchiveTransaction; }
  catch { throw new Error(`归档事务 journal 损坏，请备份并检查 ${paths.archiveJournal}`); }
  if (!Array.isArray(transaction.tasks) || !Array.isArray(transaction.archive)) throw new Error(`归档事务 journal 无法迁移，请备份并检查 ${paths.archiveJournal}`);
  await atomicWrite(paths.archive, transaction.archive);
  await atomicWrite(paths.tasks, transaction.tasks);
  await unlink(paths.archiveJournal).catch(() => undefined);
};

export class Store {
  readonly paths: Paths;
  readonly events: DomainEventBus;
  private readonly idGenerator: () => string;
  private taskReadProblems: string[] = [];
  private archiveReadProblems: string[] = [];

  constructor(dir?: string, events = new DomainEventBus((error) => console.error("atd: domain subscriber failed", error)), idGenerator = newId) {
    this.paths = pathsFor(dir);
    this.events = events;
    this.idGenerator = idGenerator;
  }

  async init(): Promise<void> {
    await mkdir(this.paths.dir, { recursive: true });
    for (const path of [this.paths.tasks, this.paths.undo]) {
      const handle = await open(path, "a");
      await handle.close();
    }
  }

  private async withLock<T>(fn: (emit: <K extends keyof DomainEvents>(event: K, payload: DomainEvents[K]) => void) => Promise<T>): Promise<T> {
    await this.init();
    const queued: Array<() => void> = [];
    const emit = <K extends keyof DomainEvents>(event: K, payload: DomainEvents[K]): void => {
      queued.push(() => this.events.emit(event, payload));
    };
    const result = await withDataLock(this.paths.dir, async () => {
      await this.recoverArchiveTransaction();
      return fn(emit);
    });
    // Publish only after the lock has been released. A subscriber can now
    // safely read/write through Store without extending the transaction.
    for (const publish of queued) publish();
    return result;
  }

  private async recoverArchiveTransaction(): Promise<void> {
    await recoverArchiveTransaction(this.paths);
  }

  private async commitArchiveTransaction(tasks: string[], archive: string[]): Promise<void> {
    await atomicWrite(this.paths.archiveJournal, [JSON.stringify({ tasks, archive } satisfies ArchiveTransaction)]);
    await this.recoverArchiveTransaction();
  }

  private async rawObjects(): Promise<JsonObject[]> {
    const result = await readJsonlDetailed(this.paths.tasks);
    const problems = [...result.malformedLines];
    const objects = result.items.flatMap((value) => {
      const object = validObject(value);
      if (!object) problems.push(JSON.stringify(value));
      return object ? [object] : [];
    });
    this.taskReadProblems = problems;
    return objects;
  }

  private assertTasksWritable(): void {
    if (this.taskReadProblems.length > 0) {
      throw new Error(`tasks.jsonl 含有 ${this.taskReadProblems.length} 条不可迁移记录；已阻止写入，请先备份并修复 ${this.paths.tasks}`);
    }
  }

  private assertArchiveWritable(): void {
    if (this.archiveReadProblems.length > 0) {
      throw new Error(`archive.jsonl 含有 ${this.archiveReadProblems.length} 条不可迁移记录；已阻止写入，请先备份并修复 ${this.paths.archive}`);
    }
  }

  async tasks(): Promise<Task[]> {
    const latest = new Map<string, JsonObject>();
    for (const obj of await this.rawObjects()) {
      const id = typeof obj.id === "string" ? obj.id : "";
      if (id) latest.set(id, obj);
    }
    return [...latest.values()].filter((obj) => obj.deleted !== true).map(parseTask);
  }

  async get(id: string): Promise<Task | undefined> {
    return (await this.tasks()).find((task) => task.id === id);
  }

  async find(prefix: string): Promise<Task | undefined> {
    const matches = (await this.tasks()).filter((task) => task.id.startsWith(prefix));
    if (matches.length > 1) throw new Error(`id 前缀 ${JSON.stringify(prefix)} 匹配到多个任务：${matches.map((task) => task.id).join(", ")}`);
    return matches[0];
  }

  private async appendUndo(before: JsonObject | null, after: JsonObject | null): Promise<void> {
    const record: UndoRecord = { before, after, ts: utcNow() };
    await appendFile(this.paths.undo, `${jsonLine(record)}\n`, "utf8");
  }

  async save(input: Task, before?: Task, recordUndo = true): Promise<Task> {
    return this.withLock(async (emit) => {
      const originalObjects = await this.rawObjects();
      this.assertTasksWritable();
      const existingObject = originalObjects.filter((obj) => obj.id === input.id && obj.deleted !== true).at(-1);
      const existing = existingObject ? parseTask(existingObject) : undefined;
      if (before && (!existing || existing.modified !== before.modified)) throw new ConcurrentModificationError(input.id);
      let id = input.id || this.idGenerator();
      if (!before && recordUndo) {
        const occupied = new Set(originalObjects.map((obj) => String(obj.id)));
        let attempts = 0;
        while (occupied.has(id) && attempts < 1000) { id = this.idGenerator(); attempts += 1; }
        if (occupied.has(id)) throw new Error("无法生成未占用的任务 ID；请重试或检查随机源");
      }
      const task = parseTask({ ...input, id, entry: input.entry || utcNow(), modified: utcNow() });
      const objects = originalObjects.filter((obj) => obj.id !== task.id);
      objects.push(TaskSchema.parse(task));
      await atomicWrite(this.paths.tasks, objects.map(jsonLine));
      if (recordUndo) await this.appendUndo(before ? TaskSchema.parse(cloneTask(before)) : null, TaskSchema.parse(task));
      if (existing) emit("task.updated", { before: cloneTask(before ?? existing), after: cloneTask(task) });
      else emit("task.created", { task: cloneTask(task) });
      return task;
    });
  }

  async delete(id: string, expectedModified?: string): Promise<void> {
    await this.withLock(async (emit) => {
      const objects = await this.rawObjects();
      this.assertTasksWritable();
      const current = objects.filter((obj) => obj.id === id && obj.deleted !== true).at(-1);
      if (!current) throw new Error(`找不到任务 ${id}`);
      const currentTask = parseTask(current);
      if (expectedModified !== undefined && currentTask.modified !== expectedModified) throw new ConcurrentModificationError(id);
      const deleted = tombstone(id);
      const next = [...objects.filter((obj) => obj.id !== id), deleted];
      await atomicWrite(this.paths.tasks, next.map(jsonLine));
      await this.appendUndo(current, deleted);
      emit("task.deleted", { task: cloneTask(currentTask), tombstone: deleted });
    });
  }

  async claimReminder(taskId: string, reminderId: string, owner: string, now: string, leaseMinutes = 5): Promise<Task | undefined> {
    return this.withLock(async (emit) => {
      const objects = await this.rawObjects();
      this.assertTasksWritable();
      const current = objects.filter((obj) => obj.id === taskId && obj.deleted !== true).at(-1);
      if (!current) return undefined;
      const task = parseTask(current);
      if (task.status !== "todo" && task.status !== "waiting" && task.status !== "meeting") return undefined;
      const reminder = task.reminders.find((item) => item.id === reminderId);
      if (!reminder || reminder.fired || reminder.dead) return undefined;
      const reminderAt = parseCompatibleDateTime(reminder.at);
      const nowAt = parseCompatibleDateTime(now);
      if (!reminderAt || !nowAt || reminderAt.getTime() > nowAt.getTime()) return undefined;
      if (reminder.leaseUntil) {
        const leaseUntil = parseCompatibleDateTime(reminder.leaseUntil);
        if (leaseUntil && leaseUntil.getTime() > nowAt.getTime()) return undefined;
      }
      const before = cloneTask(task);
      const leaseUntil = addLocalMinutes(now, leaseMinutes);
      if (!leaseUntil) return undefined;
      reminder.leaseOwner = owner;
      reminder.leaseUntil = leaseUntil;
      const next = [...objects.filter((obj) => obj.id !== taskId), TaskSchema.parse(task)];
      await atomicWrite(this.paths.tasks, next.map(jsonLine));
      emit("task.updated", { before, after: cloneTask(task) });
      return task;
    });
  }

  async completeReminder(taskId: string, reminderId: string, owner: string, now: string, allFailed: boolean, maxAttempts = 3): Promise<{ fired: boolean; dead: boolean } | undefined> {
    return this.withLock(async (emit) => {
      const objects = await this.rawObjects();
      this.assertTasksWritable();
      const current = objects.filter((obj) => obj.id === taskId && obj.deleted !== true).at(-1);
      if (!current) return undefined;
      const task = parseTask(current);
      const reminder = task.reminders.find((item) => item.id === reminderId);
      if (!reminder || reminder.leaseOwner !== owner) return undefined;
      const before = cloneTask(task);
      reminder.attempts = (reminder.attempts ?? 0) + 1;
      delete reminder.leaseOwner;
      delete reminder.leaseUntil;
      if (allFailed) {
        if (reminder.attempts >= maxAttempts) reminder.dead = true;
        else {
          const nextAt = addLocalMinutes(now, 2 ** reminder.attempts);
          if (!nextAt) { reminder.dead = true; } else reminder.at = nextAt;
        }
      } else reminder.fired = true;
      const next = [...objects.filter((obj) => obj.id !== taskId), TaskSchema.parse(task)];
      await atomicWrite(this.paths.tasks, next.map(jsonLine));
      emit("task.updated", { before, after: cloneTask(task) });
      return { fired: reminder.fired, dead: reminder.dead };
    });
  }

  async undo(): Promise<string> {
    return this.withLock(async (emit) => {
      const lines = (await readFile(this.paths.undo, "utf8")).split(/\r?\n/).filter(Boolean);
      if (lines.length === 0) throw new Error("没有可撤销的操作");
      const record = JSON.parse(lines.at(-1) ?? "") as UndoRecord;
      const objects = await this.rawObjects();
      this.assertTasksWritable();
      if (record.after) {
        const id = String(record.after.id);
        if (record.after.deleted === true) {
          const current = objects.filter((obj) => obj.id === id).at(-1);
          if (!current || current.deleted !== true || current.modified !== record.after.modified) throw new ConcurrentModificationError(id);
          if (!record.before) throw new Error("删除 undo 记录缺少 before");
          const restored: JsonObject = { ...record.before, modified: utcNow() };
          await atomicWrite(this.paths.tasks, [...objects.filter((obj) => obj.id !== id).map(jsonLine), jsonLine(restored)]);
          await atomicWrite(this.paths.undo, lines.slice(0, -1));
          emit("task.restored", { task: cloneTask(parseTask(restored)) });
          return `撤销删除：${String(restored.title ?? "")}`;
        }
        if (!record.before) {
          const current = objects.filter((obj) => obj.id === id && obj.deleted !== true).at(-1);
          if (!current || current.modified !== record.after.modified) throw new ConcurrentModificationError(id);
          const deleted = tombstone(id);
          await atomicWrite(this.paths.tasks, [...objects.filter((obj) => obj.id !== id).map(jsonLine), jsonLine(deleted)]);
          await atomicWrite(this.paths.undo, lines.slice(0, -1));
          emit("task.deleted", { task: cloneTask(parseTask(record.after)), tombstone: deleted });
          return `撤销新增：${String(record.after.title ?? "")}`;
        }
        const current = objects.filter((obj) => obj.id === id && obj.deleted !== true).at(-1);
        if (!current || current.modified !== record.after.modified) throw new ConcurrentModificationError(id);
        let restoredTask = parseTask(record.before);
        if (current) restoredTask = mergeReminderRuntime(restoredTask, parseTask(current));
        restoredTask.modified = utcNow();
        const restored: JsonObject = TaskSchema.parse(restoredTask);
        await atomicWrite(this.paths.tasks, objects.map((obj) => jsonLine(obj.id === id ? restored : obj)));
        await atomicWrite(this.paths.undo, lines.slice(0, -1));
        if (current) emit("task.updated", { before: cloneTask(parseTask(current)), after: cloneTask(parseTask(restored)) });
        return `撤销修改：${String(restored.title ?? "")}`;
      }
      throw new Error("旧版 undo 记录缺少版本信息，已拒绝回滚；请先在 Python 兼容实现中完成该 undo");
    });
  }

  async archived(): Promise<JsonObject[]> {
    const result = await readJsonlDetailed(this.paths.archive);
    const problems = [...result.malformedLines];
    const objects = result.items.flatMap((value) => {
      const object = validObject(value);
      if (!object) problems.push(JSON.stringify(value));
      return object ? [object] : [];
    });
    this.archiveReadProblems = problems;
    return objects;
  }

  async archive(days = 14): Promise<number> {
    return this.withLock(async (emit) => {
      const now = Date.now();
      const rawObjects = await this.rawObjects();
      const latestById = new Map<string, JsonObject>();
      for (const obj of rawObjects) latestById.set(String(obj.id), obj);
      const objects = [...latestById.values()];
      const moved: JsonObject[] = [];
      const keep: JsonObject[] = [];
      for (const obj of objects) {
        const modified = typeof obj.modified === "string" ? Date.parse(obj.modified) : Number.NaN;
        const age = Number.isFinite(modified) ? Math.floor((now - modified) / 86_400_000) : 999;
        const stale = (obj.deleted === true || obj.status === "done" || obj.status === "cancelled") && age >= days;
        (stale ? moved : keep).push(obj);
      }
      this.assertTasksWritable();
      if (moved.length > 0) {
        const existingArchive = await this.archived();
        this.assertArchiveWritable();
        await this.commitArchiveTransaction(keep.map(jsonLine), [...existingArchive.map(jsonLine), ...moved.map(jsonLine)]);
      } else if (objects.length !== rawObjects.length) {
        await atomicWrite(this.paths.tasks, objects.map(jsonLine));
      }
      return moved.length;
    });
  }

  async restore(idOrPrefix: string): Promise<JsonObject> {
    return this.withLock(async (emit) => {
      const objects = await this.rawObjects();
      this.assertTasksWritable();
      const archive = await this.archived();
      this.assertArchiveWritable();
      const exact = archive.find((obj) => obj.id === idOrPrefix);
      const matches = exact ? [exact] : archive.filter((obj) => typeof obj.id === "string" && obj.id.startsWith(idOrPrefix));
      if (matches.length === 0) throw new Error(`归档里找不到任务 ${idOrPrefix}（用 atd archive list 查看）`);
      if (matches.length > 1) throw new Error(`前缀 ${JSON.stringify(idOrPrefix)} 匹配多个归档任务：${matches.map((obj) => String(obj.id)).join(", ")}`);
      const restored: JsonObject = { ...(matches[0] ?? {}), modified: utcNow() };
      if (restored.deleted === true) {
        delete restored.deleted;
        restored.status = "todo";
      }
      const id = String(restored.id);
      await this.commitArchiveTransaction([...objects.filter((obj) => obj.id !== id).map(jsonLine), jsonLine(restored)], archive.filter((obj) => obj.id !== id).map(jsonLine));
      emit("task.restored", { task: cloneTask(parseTask(restored)) });
      return restored;
    });
  }
}
