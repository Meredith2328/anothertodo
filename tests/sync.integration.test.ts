import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { execa } from "execa";
import { describe, expect, it } from "vitest";

import { parseTask } from "../src/core/task.js";
import { Store } from "../src/storage/store.js";
import { syncDirectory } from "../src/sync/sync.js";
import type { GitRunner } from "../src/sync/git.js";
import { DomainEventBus } from "../src/core/events.js";

const git = async (cwd: string, args: string[]): Promise<string> => {
  const result = await execa("git", args, { cwd, reject: false });
  if (result.exitCode !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
};
const configureIdentity = async (cwd: string): Promise<void> => {
  await git(cwd, ["config", "user.name", "atd integration"]);
  await git(cwd, ["config", "user.email", "atd-integration@example.invalid"]);
};

describe("stage 5 Git integration", () => {
  it("syncs with a non-origin bare remote and pushes twice", async () => {
    const remote = await mkdtemp(join(tmpdir(), "atd-remote-"));
    const local = await mkdtemp(join(tmpdir(), "atd-local-"));
    await git(remote, ["init", "--bare"]);
    await git(local, ["init"]);
    await configureIdentity(local);
    await git(local, ["remote", "add", "upstream", remote]);
    await writeFile(join(local, "config.toml"), "[email]\npassword = \"secret\"\n", "utf8");
    await mkdir(join(local, "hooks"), { recursive: true });
    await writeFile(join(local, "hooks", "secret.js"), "secret", "utf8");
    const store = new Store(local);
    await store.save(parseTask({ id: "00000101", title: "第一次", status: "todo", entry: "2026-08-20T10:00:00Z", modified: "2026-08-20T10:00:00Z" }));
    await writeFile(join(local, ".archive.txn.json"), JSON.stringify({ tasks: [JSON.stringify({ id: "00000101", title: "第一次", status: "todo", entry: "2026-08-20T10:00:00Z", modified: "2026-08-20T10:00:00Z" })], archive: [] }), "utf8");
    const events = new DomainEventBus();
    let lockHeldDuringEvent = true;
    events.on("sync.completed", () => { lockHeldDuringEvent = existsSync(join(local, ".lock")); });
    expect(await syncDirectory(local, true, undefined, events)).toContain("远程为空");
    expect(lockHeldDuringEvent).toBe(false);
    await expect(stat(join(local, ".archive.txn.json"))).rejects.toMatchObject({ code: "ENOENT" });
    expect((await git(local, ["ls-files"])).trim()).toBe("tasks.jsonl");
    await store.save(parseTask({ id: "00000102", title: "第二次", status: "todo", entry: "2026-08-20T10:01:00Z", modified: "2026-08-20T10:01:00Z" }));
    expect(await syncDirectory(local)).toContain("同步完成");
    expect(await git(remote, ["show-ref"])).toContain("refs/heads/");
  }, 30_000);

  it("fails before commit with actionable identity instructions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-no-identity-"));
    const runner: GitRunner = {
      async run(args) {
        if (args[0] === "config") return { exitCode: 1, stdout: "", stderr: "missing" };
        if (args[0] === "init") return { exitCode: 0, stdout: "", stderr: "" };
        return { exitCode: 0, stdout: "", stderr: "" };
      },
    };
    await expect(syncDirectory(dir, true, runner)).rejects.toThrow("git config --global user.name");
  });

  it("preserves an extra staged file by refusing sync", async () => {
    const dir = await mkdtemp(join(tmpdir(), "atd-staged-"));
    await git(dir, ["init"]);
    await configureIdentity(dir);
    await writeFile(join(dir, "README.md"), "user staged work", "utf8");
    await git(dir, ["add", "README.md"]);
    await expect(syncDirectory(dir, true)).rejects.toThrow("拒绝修改用户暂存区");
    expect((await git(dir, ["diff", "--cached", "--name-only"])).trim()).toBe("README.md");
  });

  it("merges concurrent additions from two cloned working directories", async () => {
    const remote = await mkdtemp(join(tmpdir(), "atd-remote-"));
    const local = await mkdtemp(join(tmpdir(), "atd-local-"));
    const clone = await mkdtemp(join(tmpdir(), "atd-clone-"));
    await git(remote, ["init", "--bare"]);
    await git(local, ["init"]);
    await configureIdentity(local);
    await git(local, ["remote", "add", "upstream", remote]);
    const localStore = new Store(local);
    await localStore.save(parseTask({ id: "00000121", title: "共同基础", status: "todo", entry: "2026-08-20T10:00:00Z", modified: "2026-08-20T10:00:00Z" }));
    await syncDirectory(local);
    await git(clone, ["clone", remote, "."]);
    await configureIdentity(clone);
    const cloneStore = new Store(clone);
    await localStore.save(parseTask({ id: "00000122", title: "本地新增", status: "todo", entry: "2026-08-20T10:01:00Z", modified: "2026-08-20T10:01:00Z" }));
    await cloneStore.save(parseTask({ id: "00000123", title: "远端新增", status: "todo", entry: "2026-08-20T10:02:00Z", modified: "2026-08-20T10:02:00Z" }));
    await syncDirectory(clone);
    await syncDirectory(local);
    expect((await localStore.tasks()).map((task) => task.title).sort()).toEqual(["共同基础", "本地新增", "远端新增"]);
  }, 30_000);
});
