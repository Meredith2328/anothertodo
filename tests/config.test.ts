import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { getConfigValue, loadConfig, setConfigValue } from "../src/core/config.js";

describe("configuration atomicity", () => {
  it("serializes concurrent config writes under the shared data lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-config-"));
    await loadConfig(dir);
    await Promise.all([
      setConfigValue("priority.mode", "urgency", dir),
      setConfigValue("agenda.week_days", "14", dir),
      setConfigValue("watch.interval_seconds", "60", dir),
      setConfigValue("priority.levels", '["Terra", "Sol"]', dir),
    ]);
    const config = await loadConfig(dir);
    expect(config.priority.mode).toBe("urgency");
    expect(config.priority.levels).toEqual(["Terra", "Sol"]);
    expect(config.agenda.week_days).toBe(14);
    expect(config.watch.interval_seconds).toBe(60);
    expect(await readFile(join(dir, "config.toml"), "utf8")).not.toContain("undefined");
  });

  it("reaches nested keys and keeps comments in place", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-config-"));
    await loadConfig(dir);
    // README 把紧急度系数说成可调，之前两段 key 的限制让它根本设不了
    await setConfigValue("priority.urgency.overdue", "20", dir);
    await setConfigValue("priority.urgency.age_per_day", "0.1", dir);
    const config = await loadConfig(dir);
    expect(config.priority.urgency.overdue).toBe(20);
    expect(config.priority.urgency.age_per_day).toBe(0.1);
    expect(await getConfigValue("priority.urgency.overdue", dir)).toBe(20);
    expect(await readFile(join(dir, "config.toml"), "utf8")).toContain("# atd 配置文件");
  });

  it("refuses unknown keys and bad values before touching the file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-config-"));
    await loadConfig(dir);
    await expect(setConfigValue("priorty.mode", "urgency", dir)).rejects.toThrow("没有这个 key");
    await expect(setConfigValue("priority.mode", "nonsense", dir)).rejects.toThrow("不接受这个值");
    await expect(setConfigValue("mode", "urgency", dir)).rejects.toThrow("至少要两段");
    await expect(getConfigValue("priority.nope", dir)).rejects.toThrow("没有这个 key");
    // 被拒的写入不能留下痕迹
    const config = await loadConfig(dir);
    expect(config.priority.mode).toBe("levels");
    expect(await readFile(join(dir, "config.toml"), "utf8")).not.toContain("priorty");
  });
});
