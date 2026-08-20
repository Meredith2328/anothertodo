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

export const setConfigValue = async (key: string, value: string, dir = dataDir()): Promise<void> => {
  await ensureDataDir(dir);
  await withDataLock(dir, async () => {
    const parts = key.split(".");
    if (parts.length !== 2 || !parts[0] || !parts[1]) throw new Error("config set 目前只支持两段 key，如 priority.mode");
    const [section, leaf] = parts as [string, string];
    const newLine = /^-?\d+(?:\.\d+)?$|^(true|false)$/u.test(value) || value.startsWith("[") || value.startsWith("{") ? `${leaf} = ${value}` : `${leaf} = ${JSON.stringify(value)}`;
    const path = configPath(dir);
    let text = await readFile(path, "utf8");
    const sectionRe = new RegExp(`(^\\[${section.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\]\\s*$)`, "mu");
    const sectionMatch = sectionRe.exec(text);
    if (!sectionMatch || sectionMatch.index === undefined) {
      text += `\n[${section}]\n${newLine}\n`;
    } else {
      const start = sectionMatch.index + sectionMatch[0].length;
      const nextSection = text.slice(start).search(/\n\[/u);
      const end = nextSection < 0 ? text.length : start + nextSection;
      let block = text.slice(start, end);
      const leafRe = new RegExp(`^([ \\t]*)${leaf.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*=.*$`, "mu");
      if (leafRe.test(block)) block = block.replace(leafRe, `$1${newLine}`);
      else block = `${block.replace(/\s*$/u, "")}\n${newLine}\n`;
      text = `${text.slice(0, start)}${block}${text.slice(end)}`;
    }
    await atomicWriteText(path, text);
  });
};
