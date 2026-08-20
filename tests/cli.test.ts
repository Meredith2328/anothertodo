import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execa } from "execa";
import { describe, expect, it } from "vitest";

const runCli = async (dir: string, ...args: string[]) => execa("node", ["--import", "tsx", "src/cli.ts", ...args], { cwd: process.cwd(), env: { ...process.env, ATD_HOME: dir } });

describe("stage 4 CLI end-to-end", () => {
  it("adds, lists, completes, and undoes a task using the compatible data directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-cli-"));
    const added = await runCli(dir, "add", "后天 买牛奶 很急 #采购");
    expect(added.stdout).toContain("已添加");
    const task = JSON.parse((await readFile(join(dir, "tasks.jsonl"), "utf8")).trim()) as { id: string };
    expect((await runCli(dir, "list")).stdout).toContain("买牛奶");
    expect((await runCli(dir, "done", task.id)).stdout).toContain("完成");
    expect((await runCli(dir, "list", "status:done")).stdout).toContain("已完成/已取消");
    expect((await runCli(dir, "undo")).stdout).toContain("撤销修改");
    expect((await runCli(dir, "list")).stdout).toContain("买牛奶");
  });

  it("enforces Python-compatible reopen preconditions through the service", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-cli-reopen-"));
    const added = await runCli(dir, "add", "重开测试");
    expect(added.stdout).toContain("已添加");
    const task = JSON.parse((await readFile(join(dir, "tasks.jsonl"), "utf8")).trim()) as { id: string };
    await expect(runCli(dir, "reopen", task.id)).rejects.toThrow("只有 done/cancelled");
    await runCli(dir, "done", task.id);
    expect((await runCli(dir, "reopen", task.id)).stdout).toContain("重新打开");
  });

  it("masks sensitive config values", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-cli-config-"));
    const result = await runCli(dir, "config", "set", "email.password", "super-secret");
    expect(result.stdout).toContain("email.password = ***");
    expect(result.stdout).not.toContain("super-secret");
    const displayed = await runCli(dir, "config");
    expect(displayed.stdout).toContain('password = "***"');
    expect(displayed.stdout).not.toContain("super-secret");
  });
});
