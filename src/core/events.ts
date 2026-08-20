import { EventEmitter } from "node:events";

import type { Config, Task, Tombstone } from "../contracts.js";

export type SyncSummary = { changedTaskIds: string[]; message?: string };
export type DomainEvents = {
  "task.created": { task: Task };
  "task.updated": { before: Task; after: Task };
  "task.deleted": { task: Task; tombstone: Tombstone };
  "task.restored": { task: Task };
  "reminder.due": { task: Task; reminderIndex: number; missed: boolean };
  "reminder.fired": { taskId: string; reminderIndex: number };
  "config.reloaded": { config: Config };
  "sync.completed": { summary: SyncSummary };
  "sync.failed": { error: Error };
};

type Listener<T> = (payload: T) => void | Promise<void>;

/** Post-commit notifications only; subscriber failures never roll back storage. */
export class DomainEventBus {
  private readonly emitter = new EventEmitter();
  private readonly onSubscriberError: (error: unknown) => void;

  constructor(onSubscriberError: (error: unknown) => void = () => undefined) {
    this.onSubscriberError = onSubscriberError;
  }

  on<K extends keyof DomainEvents>(event: K, listener: Listener<DomainEvents[K]>): () => void {
    const wrapped = (payload: DomainEvents[K]): void => {
      try {
        const result = listener(structuredClone(payload));
        if (result && typeof (result as Promise<void>).catch === "function") void (result as Promise<void>).catch((error: unknown) => this.onSubscriberError(error));
      } catch (error) {
        this.onSubscriberError(error);
      }
    };
    this.emitter.on(event, wrapped);
    return () => this.emitter.off(event, wrapped);
  }

  emit<K extends keyof DomainEvents>(event: K, payload: DomainEvents[K]): void {
    this.emitter.emit(event, structuredClone(payload));
  }
}
