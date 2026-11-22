import type { Tombstone } from "../contracts.js";

export type SyncRecord = Record<string, unknown> & { id: string; modified?: string; deleted?: true };

const recordsById = (records: readonly SyncRecord[]): Map<string, SyncRecord> => {
  const result = new Map<string, SyncRecord>();
  for (const record of records) result.set(record.id, record);
  return result;
};
const modifiedMs = (record: SyncRecord): number => {
  if (typeof record.modified !== "string") return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(record.modified);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
};

const canonicalJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
};

const shouldReplace = (local: SyncRecord, remote: SyncRecord): boolean => {
  if (local.deleted === true && remote.deleted !== true) return false;
  if (remote.deleted === true && local.deleted !== true) return true;
  const localMs = modifiedMs(local);
  const remoteMs = modifiedMs(remote);
  if (remoteMs !== localMs) return remoteMs > localMs;
  return canonicalJson(remote) > canonicalJson(local);
};

export const mergeUnion = (ours: readonly SyncRecord[], theirs: readonly SyncRecord[]): SyncRecord[] => {
  const result = recordsById(ours);
  for (const remote of recordsById(theirs).values()) {
    const local = result.get(remote.id);
    if (!local || shouldReplace(local, remote)) {
      result.set(remote.id, remote);
    }
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
  let side: "ours" | "base" | "theirs" = "ours";
  for (const line of text.split(/\r?\n/)) {
    if (line.startsWith("<<<<<<<")) { side = "ours"; continue; }
    if (line.startsWith("|||||||")) { side = "base"; continue; }
    if (line.startsWith("=======")) { side = "theirs"; continue; }
    if (line.startsWith(">>>>>>>")) { side = "ours"; continue; }
    if (side === "base") continue;
    (side === "ours" ? ours : theirs).push(line);
  }
  return mergeJsonl(ours.join("\n"), theirs.join("\n"));
};

export const isTombstone = (value: SyncRecord): value is SyncRecord & Tombstone => value.deleted === true;
