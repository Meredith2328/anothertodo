import { readFile } from "node:fs/promises";

import { parseJsonl } from "../core/task.js";

export type JsonlReadResult = { items: unknown[]; malformedLines: string[] };

export const readJsonlDetailed = async (path: string): Promise<JsonlReadResult> => {
  let text = "";
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { items: [], malformedLines: [] };
    throw error;
  }
  const malformedLines: string[] = [];
  const items = parseJsonl(text, (line) => {
    malformedLines.push(line);
    console.error(`atd: 无法解析 JSONL 行：${line.slice(0, 60)}`);
  });
  return { items, malformedLines };
};

export const readJsonl = async (path: string): Promise<unknown[]> => {
  return (await readJsonlDetailed(path)).items;
};
