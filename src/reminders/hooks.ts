import { readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";

import { execa } from "execa";
import nodemailer, { type Transporter } from "nodemailer";

import type { Task } from "../contracts.js";
import { dataDir, loadConfig } from "../core/config.js";

export type NotificationInput = { task: Task; message: string };
export interface NotificationHook { readonly name: string; send(input: NotificationInput): Promise<void>; }
export type HookResult = { name: string; ok: boolean; error?: string };
type MailTransportOptions = { host: string; port: number; secure: boolean; auth?: { user: string; pass: string } };
type MailTransportFactory = (options: MailTransportOptions) => Transporter;

type ProcessResult = { exitCode: number; stdout?: string; stderr?: string };
type ProcessRunner = (command: string, args: string[], options: { env: NodeJS.ProcessEnv }) => Promise<ProcessResult>;

const runProcess: ProcessRunner = async (command, args, options) => {
  const result = await execa(command, args, { ...options, reject: false });
  return { exitCode: result.exitCode ?? 1, stdout: result.stdout, stderr: result.stderr };
};

const WINDOWS_TOAST_SCRIPT = `$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$shortcutSource = @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;

public static class AtdToastShortcut {
    [ComImport, Guid("00021401-0000-0000-C000-000000000046")]
    private class ShellLink { }
    [ComImport, Guid("000214F9-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IShellLinkW {
        int GetPath(StringBuilder path, int max, IntPtr findData, uint flags);
        int GetIDList(out IntPtr idList); int SetIDList(IntPtr idList);
        int GetDescription(StringBuilder description, int max); int SetDescription(string description);
        int GetWorkingDirectory(StringBuilder directory, int max); int SetWorkingDirectory(string directory);
        int GetArguments(StringBuilder arguments, int max); int SetArguments(string arguments);
        int GetHotkey(out short hotkey); int SetHotkey(short hotkey);
        int GetShowCmd(out int showCmd); int SetShowCmd(int showCmd);
        int GetIconLocation(StringBuilder path, int max, out int index); int SetIconLocation(string path, int index);
        int SetRelativePath(string path, uint reserved); int Resolve(IntPtr hwnd, uint flags); int SetPath(string path);
    }
    [ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IPropertyStore {
        int GetCount(out uint count); int GetAt(uint index, out PropertyKey key); int GetValue(ref PropertyKey key, out PropVariant value);
        int SetValue(ref PropertyKey key, ref PropVariant value); int Commit();
    }
    [StructLayout(LayoutKind.Sequential, Pack = 4)] private struct PropertyKey { public Guid FormatId; public uint PropertyId; }
    [StructLayout(LayoutKind.Explicit)] private struct PropVariant {
        [FieldOffset(0)] public ushort VariantType;
        [FieldOffset(8)] public IntPtr Pointer;
    }
    public static void Install(string shortcutPath, string target, string arguments, string appId) {
        var link = (IShellLinkW)new ShellLink();
        Marshal.ThrowExceptionForHR(link.SetPath(target));
        Marshal.ThrowExceptionForHR(link.SetArguments(arguments));
        var properties = (IPropertyStore)link;
        var key = new PropertyKey { FormatId = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), PropertyId = 5 };
        var value = new PropVariant { VariantType = 31, Pointer = Marshal.StringToCoTaskMemUni(appId) };
        try { Marshal.ThrowExceptionForHR(properties.SetValue(ref key, ref value)); Marshal.ThrowExceptionForHR(properties.Commit()); }
        finally { Marshal.FreeCoTaskMem(value.Pointer); }
        ((IPersistFile)link).Save(shortcutPath, true);
    }
}
'@
if (-not ('AtdToastShortcut' -as [type])) { Add-Type -TypeDefinition $shortcutSource }
$appId = 'anothertodo.atd'
$shortcutDir = Join-Path $env:APPDATA 'Microsoft\\Windows\\Start Menu\\Programs'
New-Item -ItemType Directory -Force -Path $shortcutDir | Out-Null
$shortcutPath = Join-Path $shortcutDir 'anothertodo.lnk'
$powershellPath = (Get-Command powershell.exe).Source
[AtdToastShortcut]::Install($shortcutPath, $powershellPath, '-NoProfile -WindowStyle Hidden', $appId)
$payload = [System.Text.Encoding]::UTF8.GetString([System.Convert]::FromBase64String($env:ATD_TOAST_PAYLOAD)) | ConvertFrom-Json
$escape = { param([string]$value) [System.Security.SecurityElement]::Escape($value) }
$title = & $escape ([string]$payload.title)
$message = & $escape ([string]$payload.message)
$xmlText = "<toast><visual><binding template='ToastGeneric'><text>$title</text><text>$message</text></binding></visual></toast>"
$xmlType = [System.Type]::GetType('Windows.Data.Xml.Dom.XmlDocument, Windows, ContentType=WindowsRuntime')
if ($null -eq $xmlType) { throw 'Windows.Data.Xml.Dom.XmlDocument WinRT type unavailable' }
$xml = [System.Activator]::CreateInstance($xmlType)
$xml.LoadXml($xmlText)
$toastType = [System.Type]::GetType('Windows.UI.Notifications.ToastNotification, Windows, ContentType=WindowsRuntime')
if ($null -eq $toastType) { throw 'Windows.UI.Notifications.ToastNotification WinRT type unavailable' }
$toast = [System.Activator]::CreateInstance($toastType, [object[]]@($xml))
$managerType = [System.Type]::GetType('Windows.UI.Notifications.ToastNotificationManager, Windows, ContentType=WindowsRuntime')
if ($null -eq $managerType) { throw 'Windows.UI.Notifications.ToastNotificationManager WinRT type unavailable' }
$method = $managerType.GetMethod('CreateToastNotifier', [System.Type[]]@([string]))
if ($null -eq $method) { throw 'CreateToastNotifier WinRT method unavailable' }
$notifier = $method.Invoke($null, [object[]]@($appId))
$notifier.Show($toast)
`;

export const windowsToastArgs = (): string[] => ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-Command", WINDOWS_TOAST_SCRIPT];
export const windowsToastEnvironment = (message: string): NodeJS.ProcessEnv => ({
  ...process.env,
  ATD_TOAST_PAYLOAD: Buffer.from(JSON.stringify({ title: "atd 提醒", message }), "utf8").toString("base64"),
});

export const sendWindowsToast = async (message: string, runner: ProcessRunner = runProcess): Promise<void> => {
  const result = await runner("powershell", windowsToastArgs(), { env: windowsToastEnvironment(message) });
  if (result.exitCode !== 0) throw new Error(`Windows toast 失败：${result.stderr || result.stdout || `exit ${result.exitCode}`}`);
};

const toastWindows: NotificationHook = {
  name: "toast",
  async send({ message }) { await sendWindowsToast(message); },
};
const toastMacos: NotificationHook = {
  name: "toast",
  async send({ message }) { const result = await execa("osascript", ["-e", `display notification ${JSON.stringify(message)} with title "atd 提醒"`], { reject: false }); if (result.exitCode !== 0) throw new Error(`macOS toast 失败：${result.stderr || result.stdout || `exit ${result.exitCode}`}`); },
};
const toastLinux: NotificationHook = {
  name: "toast",
  async send({ message }) { const result = await execa("notify-send", ["atd 提醒", message], { reject: false }); if (result.exitCode !== 0) throw new Error(result.stderr || "notify-send 失败"); },
};

export const toastHook = (): NotificationHook => process.platform === "win32" ? toastWindows : process.platform === "darwin" ? toastMacos : toastLinux;

export const createEmailHook = (dir = dataDir(), transportFactory: MailTransportFactory = (options) => nodemailer.createTransport(options as never)): NotificationHook => ({
  name: "email",
  async send({ task, message }) {
    const config = await loadConfig(dir);
    const password = process.env.ATD_EMAIL_PASSWORD ?? config.email.password;
    if (!config.email.host || !config.email.to) throw new Error("email hook 未配置 host/to");
    const transportOptions: MailTransportOptions = { host: config.email.host, port: config.email.port, secure: config.email.ssl, ...(config.email.user ? { auth: { user: config.email.user, pass: password } } : {}) };
    const transporter = transportFactory(transportOptions);
    await transporter.sendMail({ from: config.email.from || config.email.user, to: config.email.to, subject: `atd 提醒：${task.title}`, text: message });
  },
});
export const emailHook: NotificationHook = createEmailHook();

const supportedExtensions = new Set([".js", ".cmd", ".bat", ".ps1", ".py", ".exe"]);
export const discoverUserHooks = async (dir = dataDir()): Promise<string[]> => {
  try { return (await readdir(join(dir, "hooks"))).filter((name) => supportedExtensions.has(extname(name).toLowerCase())).map((name) => basename(name, extname(name))); }
  catch { return []; }
};

export const runUserHook = async (name: string, input: NotificationInput, dir = dataDir(), timeout = 15_000): Promise<void> => {
  const hookDir = join(dir, "hooks");
  const names = (await discoverUserHooks(dir)).filter((candidate) => candidate === name);
  if (!names.length) throw new Error(`找不到用户 hook：${name}`);
  const files = await readdir(hookDir);
  const file = files.find((candidate) => basename(candidate, extname(candidate)) === name && supportedExtensions.has(extname(candidate).toLowerCase()));
  if (!file) throw new Error(`找不到用户 hook：${name}`);
  const path = join(hookDir, file);
  const ext = extname(file).toLowerCase();
  const command = ext === ".py" ? "python" : ext === ".js" ? process.execPath : ext === ".ps1" ? "powershell" : path;
  const args = ext === ".py" || ext === ".js" ? [path] : ext === ".ps1" ? ["-NoProfile", "-NonInteractive", "-File", path] : [];
  const result = await execa(command, args, { input: JSON.stringify(input), timeout, reject: false });
  if (result.timedOut) throw new Error(`用户 hook 超时：${name}`);
  if (result.exitCode !== 0) throw new Error(`用户 hook 失败：${name} ${result.stderr || result.stdout}`);
};

export const hookNames = async (dir = dataDir()): Promise<string[]> => ["toast", "email", ...(await discoverUserHooks(dir))];

export const fireHook = async (name: string, input: NotificationInput, dir = dataDir()): Promise<HookResult> => {
  try {
    if (name === "toast") await toastHook().send(input);
    else if (name === "email") await createEmailHook(dir).send(input);
    else await runUserHook(name, input, dir);
    return { name, ok: true };
  } catch (error) {
    return { name, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};
