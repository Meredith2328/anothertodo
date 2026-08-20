import { join } from "node:path";

import { dataDir } from "../core/config.js";

export type Paths = Readonly<{ dir: string; tasks: string; undo: string; archive: string; archiveJournal: string; lock: string }>;

export const pathsFor = (dir = dataDir()): Paths => ({
  dir,
  tasks: join(dir, "tasks.jsonl"),
  undo: join(dir, "undo.jsonl"),
  archive: join(dir, "archive.jsonl"),
  archiveJournal: join(dir, ".archive.txn.json"),
  lock: join(dir, ".lock"),
});
