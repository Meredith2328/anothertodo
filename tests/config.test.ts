import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig, setConfigValue } from "../src/core/config.js";

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
});
