import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEmailHook, sendWindowsToast, windowsToastArgs, windowsToastEnvironment } from "../src/reminders/hooks.js";
import { parseTask } from "../src/core/task.js";

describe("Windows toast adapter", () => {
  it("uses the WinRT ToastNotification API rather than stdout", () => {
    const args = windowsToastArgs();
    expect(args).toContain("-WindowStyle");
    expect(args.at(-1)).toContain("ToastNotificationManager");
    expect(args.at(-1)).toContain("ToastNotification");
    expect(args.at(-1)).not.toContain("Write-Output");
    expect(windowsToastEnvironment("含 <xml> & 引号").ATD_TOAST_PAYLOAD).toBeTruthy();
  });

  it("turns a PowerShell failure into a failed hook result", async () => {
    await expect(sendWindowsToast("测试", async () => ({ exitCode: 1, stderr: "WinRT unavailable" }))).rejects.toThrow("WinRT unavailable");
  });

  it("loads email configuration from the hook's explicit data directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-email-"));
    await writeFile(join(dir, "config.toml"), "[email]\nhost = \"smtp.custom\"\nto = \"to@example.invalid\"\n", "utf8");
    const task = parseTask({ id: "00000131", title: "邮件", status: "todo", entry: "", modified: "" });
    let options: Record<string, unknown> | undefined;
    const factory = ((value: Record<string, unknown>) => { options = value; return { sendMail: async () => undefined }; }) as unknown as Parameters<typeof createEmailHook>[1];
    await createEmailHook(dir, factory).send({ task, message: "test" });
    expect(options?.host).toBe("smtp.custom");
    expect(options?.to).toBeUndefined();
  });
});
