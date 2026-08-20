import type { Tombstone } from "../contracts.js";

export type SyncRecord = Record<string, unknown> & { id: string; modified?: string; deleted?: true };

const recordsById = (records: readonly SyncRecord[]): Map<string, SyncRecord> => {
  const result = new Map<string, SyncRecord>();
  for (const record of records) result.set(record.id, record);
  return result;
};
const modifiedMs = (record: SyncRecord): number => typeof record.modified === "string" ? Date.parse(record.modified) : Number.NEGATIVE_INFINITY;

export const mergeUnion = (ours: readonly SyncRecord[], theirs: readonly SyncRecord[]): SyncRecord[] => {
  const result = recordsById(ours);
  for (const remote of recordsById(theirs).values()) {
    const local = result.get(remote.id);
    if (!local) { result.set(remote.id, remote); continue; }
    if (local.deleted === true && remote.deleted !== true) continue;
    if (remote.deleted === true && local.deleted !== true) { result.set(remote.id, remote); continue; }
    if (modifiedMs(remote) > modifiedMs(local)) result.set(remote.id, remote);
  }
  return [...result.values()];
};

export const mergeJsonl = (ours: string, theirs: string): string => {
  const parse = (text: string): SyncRecord[] => text.split(/\r?\n/).filter(Boolean).flatMap((line) => {
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      return typeof value.id === "string" ? [value as SyncRecord] : [];
    } catch { return []; }
  });
  const merged = mergeUnion(parse(ours), parse(theirs));
  return merged.length ? `${merged.map((record) => JSON.stringify(record)).join("\n")}\n` : "";
};

export const mergeConflictText = (text: string): string => {
  const ours: string[] = [];
  const theirs: string[] = [];
  let side: "ours" | "theirs" = "ours";
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("<<<<<<<")) { side = "ours"; continue; }
    if (line.startsWith("=======")) { side = "theirs"; continue; }
    if (line.startsWith(">>>>>>>")) { side = "ours"; continue; }
    (side === "ours" ? ours : theirs).push(line);
  }
  return mergeJsonl(ours.join("\n"), theirs.join("\n"));
};

export const isTombstone = (value: SyncRecord): value is SyncRecord & Tombstone => value.deleted === true;
