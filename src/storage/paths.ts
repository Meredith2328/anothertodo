import { join } from "node:path";

import { dataDir } from "../core/config.js";

export type Paths = Readonly<{ dir: string; tasks: string; undo: string; redo: string; archive: string; archiveJournal: string; lock: string; inbox: string }>;

export const pathsFor = (dir = dataDir()): Paths => ({
  dir,
  tasks: join(dir, "tasks.jsonl"),
  undo: join(dir, "undo.jsonl"),
  redo: join(dir, "redo.jsonl"),
  archive: join(dir, "archive.jsonl"),
  archiveJournal: join(dir, ".archive.txn.json"),
  lock: join(dir, ".lock"),
  // watcher 发出的提醒也记一份在这里，开着的 TUI 看到新行就在屏幕上提示
  inbox: join(dir, "inbox.jsonl"),
});
