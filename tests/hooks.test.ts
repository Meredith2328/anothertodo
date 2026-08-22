import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import nodemailer, { type Transporter } from "nodemailer";

import { createEmailHook, sendWindowsToast, windowsToastArgs, windowsToastEnvironment } from "../src/reminders/hooks.js";
import { parseTask } from "../src/core/task.js";

/** 把真实 nodemailer 接进 hook，但走 streamTransport：编译真邮件、不连任何服务器 */
const captureRealMail = (): { factory: Parameters<typeof createEmailHook>[1]; raw: () => string } => {
  let raw = "";
  const factory: Parameters<typeof createEmailHook>[1] = () => {
    const transport = nodemailer.createTransport({ streamTransport: true, buffer: true, newline: "unix" });
    return {
      sendMail: async (mail: Parameters<Transporter["sendMail"]>[0]) => {
        const info = await transport.sendMail(mail);
        raw = String((info as { message?: unknown }).message ?? "");
        return info;
      },
    } as unknown as Transporter;
  };
  return { factory, raw: () => raw };
};

const headerBlock = (raw: string): string => raw.split(/\n\n/u)[0] ?? "";
const subjectLines = (head: string): string[] => head.split("\n").filter((line) => /^Subject:/u.test(line));

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

  // 上面那个测试注入了假 transport，真实 nodemailer 一行都没跑到。这个测试让
  // 真库编译一封完整邮件（streamTransport，不连服务器），这样升 nodemailer 大版本时
  // createTransport / sendMail 的签名或行为真变了会在这里挂，而不是等用户配了邮件才发现。
  it("compiles a real message through the installed nodemailer", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-email-real-"));
    await writeFile(join(dir, "config.toml"), "[email]\nhost = \"smtp.example.invalid\"\nfrom = \"me@example.invalid\"\nto = \"you@example.invalid\"\n", "utf8");
    const task = parseTask({ id: "00000132", title: "买牛奶", status: "todo", entry: "", modified: "" });
    const { factory, raw } = captureRealMail();
    await createEmailHook(dir, factory).send({ task, message: "该买牛奶了" });
    const head = headerBlock(raw());
    expect(head).toContain("To: you@example.invalid");
    expect(head).toContain("From: me@example.invalid");
    // 中文标题会被 RFC 2047 编码，所以只断言 Subject 头存在且唯一
    expect(subjectLines(head)).toHaveLength(1);
    expect(raw()).toContain("MIME-Version: 1.0");
  });

  // 任务标题可能经 git sync 或手改 JSONL 带上 CRLF，而它会拼进邮件 subject。
  // nodemailer 把 subject 做 RFC 2047 编码，CRLF 连同后面伪造的头一起被裹进
  // encoded-word，不会变成独立邮件头——这里把这个前提钉死，换库或换版本时能兜住。
  it("does not let a CRLF task title inject a mail header", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-email-crlf-"));
    await writeFile(join(dir, "config.toml"), "[email]\nhost = \"smtp.example.invalid\"\nfrom = \"me@example.invalid\"\nto = \"you@example.invalid\"\n", "utf8");
    const task = parseTask({ id: "00000133", title: "正常标题\r\nBcc: attacker@evil.example", status: "todo", entry: "", modified: "" });
    expect(task.title).toContain("\r\n");
    const { factory, raw } = captureRealMail();
    await createEmailHook(dir, factory).send({ task, message: "正文" });
    const head = headerBlock(raw());
    expect(/^Bcc:/mu.test(head)).toBe(false);
    expect(subjectLines(head)).toHaveLength(1);
  });
});
