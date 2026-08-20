import { homedir } from "node:os";
import { join } from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";

import { execa } from "execa";

export type CommandRunner = (command: string, args: string[]) => Promise<{ exitCode: number; stderr?: string; stdout?: string }>;
const defaultRunner: CommandRunner = async (command, args) => {
  const result = await execa(command, args, { reject: false });
  return { exitCode: result.exitCode ?? 1, stderr: result.stderr, stdout: result.stdout };
};

export const taskName = "anothertodo-atd-watch";
const windowsQuote = (value: string): string => `"${value.replaceAll('"', '\\"')}"`;
const xmlEscape = (value: string): string => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
const systemdQuote = (value: string): string => `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
export const windowsArgs = (nodePath = process.execPath, entry = process.argv[1] ?? ""): string[] => ["/Create", "/TN", taskName, "/TR", `${windowsQuote(nodePath)} ${windowsQuote(entry)} --watch-daemon`, "/SC", "ONLOGON", "/F"];
export const windowsDeleteArgs = (): string[] => ["/Delete", "/TN", taskName, "/F"];
export const macosPlistPath = (home = homedir()): string => join(home, "Library", "LaunchAgents", "com.anothertodo.atd.plist");
export const linuxServicePath = (home = homedir()): string => join(home, ".config", "systemd", "user", "anothertodo-atd-watch.service");
export const linuxServiceText = (nodePath = process.execPath, entry = process.argv[1] ?? ""): string => `[Unit]\nDescription=anothertodo reminder watcher\nAfter=default.target\n\n[Service]\nExecStart=${systemdQuote(nodePath)} ${systemdQuote(entry)} --watch-daemon\nRestart=on-failure\n\n[Install]\nWantedBy=default.target\n`;
export const macosPlistText = (nodePath = process.execPath, entry = process.argv[1] ?? ""): string => `<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict><key>Label</key><string>com.anothertodo.atd</string><key>ProgramArguments</key><array><string>${xmlEscape(nodePath)}</string><string>${xmlEscape(entry)}</string><string>--watch-daemon</string></array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/></dict></plist>\n`;

const ensureSuccess = async (runner: CommandRunner, command: string, args: string[]): Promise<void> => {
  const result = await runner(command, args);
  if (result.exitCode !== 0) throw new Error(`${command} ${args.join(" ")} 失败：${result.stderr || result.stdout || ""}`);
};

export const installAutostart = async (platform = process.platform, runner: CommandRunner = defaultRunner, home = homedir()): Promise<void> => {
  if (platform === "win32") { await ensureSuccess(runner, "schtasks", windowsArgs()); return; }
  if (platform === "darwin") {
    const path = macosPlistPath(home);
    await mkdir(join(home, "Library", "LaunchAgents"), { recursive: true });
    await writeFile(path, macosPlistText(), "utf8");
    try { await ensureSuccess(runner, "launchctl", ["load", path]); }
    catch (error) { await rm(path, { force: true }); throw error; }
    return;
  }
  if (platform === "linux") {
    const path = linuxServicePath(home);
    await mkdir(join(home, ".config", "systemd", "user"), { recursive: true });
    await writeFile(path, linuxServiceText(), "utf8");
    try {
      await ensureSuccess(runner, "systemctl", ["--user", "daemon-reload"]);
      await ensureSuccess(runner, "systemctl", ["--user", "enable", "--now", taskName + ".service"]);
    } catch (error) { await rm(path, { force: true }); await runner("systemctl", ["--user", "daemon-reload"]); throw error; }
    return;
  }
  throw new Error(`不支持的平台：${platform}`);
};

export const uninstallAutostart = async (platform = process.platform, runner: CommandRunner = defaultRunner, home = homedir()): Promise<void> => {
  if (platform === "win32") { await ensureSuccess(runner, "schtasks", windowsDeleteArgs()); return; }
  if (platform === "darwin") {
    const path = macosPlistPath(home);
    await ensureSuccess(runner, "launchctl", ["unload", path]);
    await rm(path, { force: true });
    return;
  }
  if (platform === "linux") {
    await ensureSuccess(runner, "systemctl", ["--user", "disable", "--now", taskName + ".service"]);
    await rm(linuxServicePath(home), { force: true });
    await ensureSuccess(runner, "systemctl", ["--user", "daemon-reload"]);
    return;
  }
  throw new Error(`不支持的平台：${platform}`);
};
