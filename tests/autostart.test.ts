import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { installAutostart, linuxServicePath, linuxServiceText, macosPlistText, uninstallAutostart, windowsArgs, windowsDeleteArgs } from "../src/reminders/autostart.js";

describe("cross-platform watcher registration", () => {
  it("generates platform-specific registration commands without executing them", () => {
    expect(windowsArgs("C:\\Program Files\\node\\node.exe", "C:\\Users\\A B\\atd.mjs")).toEqual(["/Create", "/TN", "anothertodo-atd-watch", "/TR", '"C:\\Program Files\\node\\node.exe" "C:\\Users\\A B\\atd.mjs" --watch-daemon', "/SC", "ONLOGON", "/F"]);
    expect(windowsDeleteArgs()).toContain("/Delete");
    expect(macosPlistText("C:\\A&B\\node", "C:\\Users\\A B\\cli.mjs")).toContain("C:\\A&amp;B\\node");
    expect(linuxServiceText("/opt/Node Runtime/node", "/home/a b/cli.mjs")).toContain('ExecStart="/opt/Node Runtime/node" "/home/a b/cli.mjs" --watch-daemon');
  });

  it("runs a complete Linux registration lifecycle in an isolated home", async () => {
    const home = await mkdtemp(join(tmpdir(), "atd-autostart-"));
    const calls: string[] = [];
    const runner = async (command: string, args: string[]) => { calls.push(`${command} ${args.join(" ")}`); return { exitCode: 0 }; };
    await installAutostart("linux", runner, home);
    expect(await readFile(linuxServicePath(home), "utf8")).toContain("ExecStart=");
    await uninstallAutostart("linux", runner, home);
    await expect(stat(linuxServicePath(home))).rejects.toMatchObject({ code: "ENOENT" });
    expect(calls).toEqual(expect.arrayContaining([expect.stringContaining("systemctl --user enable --now"), expect.stringContaining("systemctl --user disable --now")]));
  });

  it("rolls back files and reports install/uninstall failures", async () => {
    const home = await mkdtemp(join(tmpdir(), "atd-autostart-fail-"));
    const failingInstall = async (command: string, args: string[]) => command === "systemctl" && args.includes("enable") ? { exitCode: 1, stderr: "systemd unavailable" } : { exitCode: 0 };
    await expect(installAutostart("linux", failingInstall, home)).rejects.toThrow("systemd unavailable");
    await expect(stat(linuxServicePath(home))).rejects.toMatchObject({ code: "ENOENT" });
    const failingUninstall = async () => ({ exitCode: 1, stderr: "cannot disable" });
    await expect(uninstallAutostart("linux", failingUninstall, home)).rejects.toThrow("cannot disable");
  });
});
