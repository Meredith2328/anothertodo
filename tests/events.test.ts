import { describe, expect, it } from "vitest";

import { DomainEventBus } from "../src/core/events.js";
import { parseTask } from "../src/core/task.js";
import { Store } from "../src/storage/store.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { existsSync } from "node:fs";

describe("post-commit domain events", () => {
  it("isolates subscriber failures and emits immutable snapshots", () => {
    const errors: unknown[] = [];
    const bus = new DomainEventBus((error) => errors.push(error));
    const seen: string[] = [];
    bus.on("task.created", (payload) => { payload.task.title = "first listener mutation"; throw new Error("subscriber failed"); });
    bus.on("task.created", (payload) => { seen.push(payload.task.title); payload.task.title = "listener mutation"; });
    const task = { id: "00000091", title: "原始", status: "todo" as const, tags: [], notes: "", reminders: [], entry: "2026-08-20T10:00:00Z", modified: "2026-08-20T10:00:00Z" };
    bus.emit("task.created", { task });
    expect(seen).toEqual(["原始"]);
    expect(task.title).toBe("原始");
    expect(errors).toHaveLength(1);
  });

  it("publishes Store events only after the JSONL write succeeds", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-events-"));
    const bus = new DomainEventBus();
    const events: string[] = [];
    let lockExistsDuringEvent = true;
    bus.on("task.created", ({ task }) => { events.push(`created:${task.id}`); });
    bus.on("task.deleted", ({ task }) => { events.push(`deleted:${task.id}`); });
    const store = new Store(dir, bus);
    bus.on("task.created", () => { lockExistsDuringEvent = existsSync(store.paths.lock); });
    const task = parseTask({ id: "00000092", title: "事件任务", status: "todo", entry: "2026-08-20T10:00:00Z", modified: "2026-08-20T10:00:00Z" });
    await store.save(task);
    await store.delete(task.id);
    expect(events).toEqual(["created:00000092", "deleted:00000092"]);
    expect(lockExistsDuringEvent).toBe(false);
  });
});
