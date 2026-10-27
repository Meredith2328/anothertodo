import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadConfig } from "../src/core/config.js";
import { cycleSetting, settingItems } from "../src/tui/settings.js";
import { tableColumns } from "../src/tui/rows.js";
import { BUILTIN_SKINS, applySkin, listSkins, resolveSkin, writeSkinTemplate } from "../src/tui/skins.js";
import { C, SKIN } from "../src/tui/theme.js";

describe("skins", () => {
  it("ships classic plus a raised-button skin and several palettes", () => {
    expect(BUILTIN_SKINS.map((skin) => skin.name)).toEqual(["classic", "raised", "dracula", "nord", "gruvbox", "catppuccin", "paper", "mono"]);
    expect(BUILTIN_SKINS.find((skin) => skin.name === "raised")?.button.style).toBe("raised");
  });

  it("writes a commented template that round-trips, and partial user skins extend a base", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-skin-"));
    const path = await writeSkinTemplate("mine", dir, "nord");
    const text = await readFile(path, "utf8");
    expect(text).toContain("extends = \"nord\"");
    expect(text).toContain("# 主色");
    expect((await resolveSkin("mine", dir)).palette).toEqual((await resolveSkin("nord", dir)).palette);
    await writeFile(path, "extends = \"dracula\"\n[palette]\naccent = \"#123456\"\n[button]\nstyle = \"raised\"\n", "utf8");
    const mine = await resolveSkin("mine", dir);
    expect(mine.palette.accent).toBe("#123456");
    expect(mine.palette.hot).toBe(BUILTIN_SKINS.find((skin) => skin.name === "dracula")!.palette.hot);
    expect(mine.button.style).toBe("raised");
    expect((await listSkins(dir)).find((skin) => skin.name === "mine")?.custom).toBe(true);
    await expect(writeSkinTemplate("mine", dir)).rejects.toThrow("已经有");
  });

  it("rejects bad colors and unknown skins with a readable message", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-skin-"));
    await writeSkinTemplate("bad", dir);
    await writeFile(join(dir, "skins", "bad.toml"), "[palette]\naccent = \"#12\"\n", "utf8");
    await expect(resolveSkin("bad", dir)).rejects.toThrow("palette.accent");
    await expect(resolveSkin("nope", dir)).rejects.toThrow("没有叫 nope 的皮肤");
  });

  it("applies a skin to the shared palette used by every component", async () => {
    applySkin(BUILTIN_SKINS.find((skin) => skin.name === "gruvbox")!);
    expect(C.accent).toBe("#8ec07c");
    expect(SKIN.button.style).toBe("raised");
    applySkin(BUILTIN_SKINS[0]!);
    expect(C.accent).toBe("#56d4dd");
  });
});

describe("responsive table and settings", () => {
  it("drops secondary columns as the terminal narrows and always fills the inner width exactly", () => {
    for (const columns of [40, 50, 60, 80, 90, 100, 140]) {
      const cols = tableColumns(columns);
      expect(cols.date + cols.title + cols.priority + cols.status + cols.extras).toBe(columns - 4);
    }
    expect(tableColumns(140).extras).toBeGreaterThan(0);
    expect(tableColumns(60).extras).toBe(0);
    expect(tableColumns(40).priority).toBe(0);
  });

  it("cycles setting values in both directions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-set-"));
    const config = await loadConfig(dir);
    const items = settingItems(BUILTIN_SKINS);
    const mouse = items.find((item) => item.key === "ui.mouse")!;
    expect(cycleSetting(mouse, config, 1)).toBe("false");
    const skin = items.find((item) => item.key === "ui.skin")!;
    expect(cycleSetting(skin, config, 1)).toBe("raised");
    expect(cycleSetting(skin, config, -1)).toBe("mono");
  });
});
