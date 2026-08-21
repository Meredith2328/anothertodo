import { homedir } from "node:os";
import { join } from "node:path";
import { readFile, mkdir, writeFile } from "node:fs/promises";

import * as TOML from "@iarna/toml";

import { ConfigSchema, type Config } from "../contracts.js";
import { atomicWriteText, withDataLock } from "../storage/lock.js";

export const DEFAULT_CONFIG_TEXT = `# atd 配置文件。手工编辑保存即可，下次操作生效。

[priority]
mode = "levels"
levels = ["低", "中", "高"]

[priority.urgency]
overdue = 12.0
due_today = 8.0
due_week_decay = 8.0
per_level = 3.0
age_per_day = 0.05
age_cap = 2.0
waiting_penalty = 3.0

[agenda]
week_days = 7
date_format = "auto"

[watch]
interval_seconds = 30

[email]
host = ""
port = 465
ssl = true
user = ""
password = ""
from = ""
to = ""
`;

const defaultConfig = (): Config => ConfigSchema.parse({
  priority: { mode: "levels", levels: ["低", "中", "高"], urgency: { overdue: 12, due_today: 8, due_week_decay: 8, per_level: 3, age_per_day: 0.05, age_cap: 2, waiting_penalty: 3 } },
  agenda: { week_days: 7, date_format: "auto" },
  watch: { interval_seconds: 30 },
  email: { host: "", port: 465, ssl: true, user: "", password: "", from: "", to: "" },
});

export const dataDir = (): string => process.env.ATD_HOME || join(homedir(), ".atd");
export const configPath = (dir = dataDir()): string => join(dir, "config.toml");

const deepMerge = (base: Record<string, unknown>, override: Record<string, unknown>): Record<string, unknown> => {
  for (const [key, value] of Object.entries(override)) {
    const current = base[key];
    if (typeof current === "object" && current !== null && typeof value === "object" && value !== null && !Array.isArray(value)) {
      base[key] = deepMerge({ ...(current as Record<string, unknown>) }, value as Record<string, unknown>);
    } else {
      base[key] = value;
    }
  }
  return base;
};

export const ensureDataDir = async (dir = dataDir()): Promise<string> => {
  await mkdir(join(dir, "hooks"), { recursive: true });
  const path = configPath(dir);
  try {
    await readFile(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    await atomicWriteText(path, DEFAULT_CONFIG_TEXT);
  }
  return dir;
};

export const loadConfig = async (dir = dataDir()): Promise<Config> => {
  await ensureDataDir(dir);
  const raw = await readFile(configPath(dir), "utf8");
  let user: Record<string, unknown>;
  try {
    user = TOML.parse(raw) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`配置文件解析失败：${String(error)}\n请检查 ${configPath(dir)}`);
  }
  return ConfigSchema.parse(deepMerge(defaultConfig() as unknown as Record<string, unknown>, user));
};

export const configLevels = (config: Config): string[] => [...config.priority.levels];
export const priorityMode = (config: Config): "levels" | "urgency" => config.priority.mode;

/** 按点路径取值，用于 config get 和 config set 的 key 校验 */
const valueAtPath = (source: Record<string, unknown>, path: string[]): unknown => {
  let current: unknown = source;
  for (const part of path) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
};

export const getConfigValue = async (key: string, dir = dataDir()): Promise<unknown> => {
  const path = key.split(".").filter(Boolean);
  if (!path.length) throw new Error("用法：atd config get priority.urgency.overdue");
  const value = valueAtPath(await loadConfig(dir) as unknown as Record<string, unknown>, path);
  if (value === undefined) throw new Error(`配置里没有这个 key：${key}`);
  return value;
};

const escapeRe = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

/**
 * 直接改 TOML 文本而不是重新序列化，为的是保住用户的注释和排版。
 * TOML 里 `a.b.c` 天然就是「表 a.b 的键 c」，所以按最后一个点切开即可，
 * 这样 priority.urgency.overdue 这类三段 key 也能设置。
 */
export const setConfigValue = async (key: string, value: string, dir = dataDir()): Promise<void> => {
  await ensureDataDir(dir);
  const parts = key.split(".").filter(Boolean);
  if (parts.length < 2) throw new Error("config set 的 key 至少要两段，如 priority.mode 或 priority.urgency.overdue");
  const leaf = parts.at(-1)!;
  const section = parts.slice(0, -1).join(".");
  // 先照着默认配置查一遍，把 priorty.mode 这类拼错的 key 拦在写入之前，
  // 否则它会安静地多出一个永远不生效的段落
  if (valueAtPath(defaultConfig() as unknown as Record<string, unknown>, parts) === undefined) throw new Error(`配置里没有这个 key：${key}`);
  await withDataLock(dir, async () => {
    const newLine = /^-?\d+(?:\.\d+)?$|^(true|false)$/u.test(value) || value.startsWith("[") || value.startsWith("{") ? `${leaf} = ${value}` : `${leaf} = ${JSON.stringify(value)}`;
    const path = configPath(dir);
    let text = await readFile(path, "utf8");
    const sectionRe = new RegExp(`(^\\[${escapeRe(section)}\\]\\s*$)`, "mu");
    const sectionMatch = sectionRe.exec(text);
    if (!sectionMatch || sectionMatch.index === undefined) {
      text += `\n[${section}]\n${newLine}\n`;
    } else {
      const start = sectionMatch.index + sectionMatch[0].length;
      const nextSection = text.slice(start).search(/\n\[/u);
      const end = nextSection < 0 ? text.length : start + nextSection;
      let block = text.slice(start, end);
      const leafRe = new RegExp(`^([ \\t]*)${escapeRe(leaf)}\\s*=.*$`, "mu");
      if (leafRe.test(block)) block = block.replace(leafRe, `$1${newLine}`);
      else block = `${block.replace(/\s*$/u, "")}\n${newLine}\n`;
      text = `${text.slice(0, start)}${block}${text.slice(end)}`;
    }
    // 写之前先按 schema 试一遍：值类型不对就当场报错，别留个坏配置让下次启动才炸
    let candidate: Record<string, unknown>;
    try {
      candidate = TOML.parse(text) as Record<string, unknown>;
    } catch (error) {
      throw new Error(`这个值会让配置文件语法出错：${String(error)}`);
    }
    const checked = ConfigSchema.safeParse(deepMerge(defaultConfig() as unknown as Record<string, unknown>, candidate));
    if (!checked.success) throw new Error(`${key} 不接受这个值：${checked.error.issues.map((issue) => issue.message).join("；")}`);
    await atomicWriteText(path, text);
  });
};
