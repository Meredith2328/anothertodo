import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import lockfile from "proper-lockfile";

import { DomainEventBus, type DomainEvents } from "../core/events.js";
import { atomicWrite, recoverArchiveTransaction } from "../storage/store.js";
import { pathsFor } from "../storage/paths.js";
import { gitOrThrow, gitRunner, type GitRunner } from "./git.js";
import { mergeConflictText } from "./merge.js";

const exists = async (path: string): Promise<boolean> => {
  try { await stat(path); return true; } catch { return false; }
};

export const ensureRepo = async (dir: string, runner: GitRunner = gitRunner): Promise<void> => {
  await mkdir(dir, { recursive: true });
  if (!(await exists(join(dir, ".git")))) await gitOrThrow(runner, ["init"], dir);
  // Keep local privacy rules in Git's per-repository exclude file so the
  // whitelist commit never creates an untracked .gitignore that can block rebase.
  const ignore = join(dir, ".git", "info", "exclude");
  await mkdir(join(dir, ".git", "info"), { recursive: true });
  const tasks = join(dir, "tasks.jsonl");
  if (!(await exists(tasks))) await writeFile(tasks, "", "utf8");
  const required = [".lock", ".archive.txn.json", "undo.jsonl", "archive.jsonl", "config.toml", "hooks/", ""]; 
  let current = "";
  if (await exists(ignore)) current = await readFile(ignore, "utf8");
  const lines = new Set(current.split(/\r?\n/));
  for (const line of required) if (line && !lines.has(line)) lines.add(line);
  const next = `${[...lines].filter(Boolean).join("\n")}\n`;
  if (next !== current) await writeFile(ignore, next, "utf8");
};

const gitIdentityError = (): Error => new Error(
  "Git 未配置提交身份。请先执行：\n  git config --global user.name \"Your Name\"\n  git config --global user.email \"you@example.com\"",
);

const ensureGitIdentity = async (dir: string, runner: GitRunner): Promise<void> => {
  const name = await runner.run(["config", "--get", "user.name"], { cwd: dir });
  const email = await runner.run(["config", "--get", "user.email"], { cwd: dir });
  const envName = process.env.GIT_AUTHOR_NAME || process.env.GIT_COMMITTER_NAME;
  const envEmail = process.env.GIT_AUTHOR_EMAIL || process.env.GIT_COMMITTER_EMAIL;
  if ((!name.stdout.trim() && !envName) || (!email.stdout.trim() && !envEmail)) throw gitIdentityError();
};

const sensitiveTracked = ["config.toml", "archive.jsonl", "undo.jsonl", ".archive.txn.json", "hooks"];
const assertSensitiveUntracked = async (dir: string, runner: GitRunner): Promise<void> => {
  const tracked = await gitOrThrow(runner, ["ls-files", "--", ...sensitiveTracked], dir);
  if (tracked.stdout.trim()) throw new Error(`为保护隐私，sync 拒绝提交已被 Git 跟踪的敏感路径：${tracked.stdout.trim()}\n请先备份并执行 git rm --cached <path>，再重试。`);
};

const commitAll = async (dir: string, runner: GitRunner): Promise<boolean> => {
  await assertSensitiveUntracked(dir, runner);
  const staged = await gitOrThrow(runner, ["diff", "--cached", "--name-only"], dir);
  const extraStaged = staged.stdout.split(/\r?\n/).map((value) => value.trim()).filter((file) => file && file !== "tasks.jsonl");
  if (extraStaged.length > 0) throw new Error(`sync 拒绝修改用户暂存区；请先提交或取消暂存非任务文件：${extraStaged.join(", ")}`);
  await gitOrThrow(runner, ["add", "--", "tasks.jsonl"], dir);
  const diff = await runner.run(["diff", "--cached", "--quiet"], { cwd: dir });
  if (diff.exitCode === 0) return false;
  await gitOrThrow(runner, ["commit", "-m", "atd: sync"], dir);
  return true;
};

const currentBranch = async (dir: string, runner: GitRunner): Promise<string> => {
  const result = await gitOrThrow(runner, ["rev-parse", "--abbrev-ref", "HEAD"], dir);
  return result.stdout.trim() || "master";
};

type RemoteTarget = { name: string; ref: string; hasUpstream: boolean };
const remoteTarget = async (dir: string, branch: string, runner: GitRunner): Promise<RemoteTarget | undefined> => {
  const upstream = await runner.run(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"], { cwd: dir });
  if (upstream.exitCode === 0 && upstream.stdout.trim()) {
    const ref = upstream.stdout.trim();
    const slash = ref.indexOf("/");
    return { name: slash > 0 ? ref.slice(0, slash) : ref, ref, hasUpstream: true };
  }
  const remotes = (await runner.run(["remote"], { cwd: dir })).stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);
  const name = remotes.includes("origin") ? "origin" : remotes[0];
  return name ? { name, ref: `${name}/${branch}`, hasUpstream: false } : undefined;
};

const conflictFiles = async (dir: string, runner: GitRunner): Promise<string[]> => {
  const status = await gitOrThrow(runner, ["status", "--porcelain"], dir);
  return status.stdout.split(/\r?\n/).filter(Boolean).map((line) => line.slice(3).trim().replaceAll('"', ""));
};

const resolveRebaseConflicts = async (dir: string, runner: GitRunner): Promise<void> => {
  const files = await conflictFiles(dir, runner);
  if (files.length === 0) {
    await runner.run(["rebase", "--abort"], { cwd: dir });
    throw new Error("rebase 失败但没有可解析的冲突文件，已回滚");
  }
  for (const file of files) {
    if (file === "tasks.jsonl") {
      const path = join(dir, file);
      const merged = mergeConflictText(await readFile(path, "utf8"));
      await atomicWrite(path, merged.trimEnd() ? merged.trimEnd().split(/\r?\n/) : []);
    } else {
      const ours = await runner.run(["checkout", "--ours", "--", file], { cwd: dir });
      if (ours.exitCode !== 0) {
        await runner.run(["rebase", "--abort"], { cwd: dir });
        throw new Error(`无法保留本地冲突文件 ${file}，已回滚`);
      }
    }
    await gitOrThrow(runner, ["add", "--", file], dir);
  }
  const continued = await runner.run(["rebase", "--continue"], { cwd: dir, env: { ...process.env, GIT_EDITOR: "true" } });
  if (continued.exitCode !== 0) {
    await runner.run(["rebase", "--abort"], { cwd: dir });
    throw new Error(`rebase continue 失败，已回滚：${continued.stderr || continued.stdout}`);
  }
};

const rebaseOnto = async (dir: string, ref: string, runner: GitRunner): Promise<void> => {
  const result = await runner.run(["rebase", ref], { cwd: dir });
  if (result.exitCode !== 0) await resolveRebaseConflicts(dir, runner);
};

const pushWithRecovery = async (dir: string, target: RemoteTarget, branch: string, canPush: boolean, runner: GitRunner): Promise<void> => {
  if (!canPush) return;
  const pushed = await runner.run(target.hasUpstream ? ["push"] : ["push", "-u", target.name, branch], { cwd: dir });
  if (pushed.exitCode === 0) return;
  await gitOrThrow(runner, ["fetch", target.name], dir);
  const refreshed = await runner.run(["rev-parse", "--verify", target.ref], { cwd: dir });
  if (refreshed.exitCode !== 0) throw new Error(`push 失败且远端 ${target.ref} 不存在：${pushed.stderr || pushed.stdout}`);
  await rebaseOnto(dir, target.ref, runner);
  await gitOrThrow(runner, ["push", "-u", target.name, branch], dir);
};

export const syncDirectory = async (dir: string, canPush = true, runner: GitRunner = gitRunner, events = new DomainEventBus()): Promise<string> => {
  await ensureRepo(dir, runner);
  const pendingEvents: Array<() => void> = [];
  const emit = <K extends keyof DomainEvents>(event: K, payload: DomainEvents[K]): void => { pendingEvents.push(() => events.emit(event, payload)); };
  const release = await lockfile.lock(dir, { lockfilePath: join(dir, ".lock"), retries: { retries: 5, minTimeout: 20, maxTimeout: 200 } });
  try {
    await recoverArchiveTransaction(pathsFor(dir));
    await ensureGitIdentity(dir, runner);
    await commitAll(dir, runner);
    const branch = await currentBranch(dir, runner);
    const target = await remoteTarget(dir, branch, runner);
    if (!target) {
      const message = "没有配置远程仓库：本地已 commit（git remote add origin <url> 后即可同步）";
      emit("sync.completed", { summary: { changedTaskIds: [], message } });
      return message;
    }
    await gitOrThrow(runner, ["fetch", target.name], dir);
    const remoteExists = await runner.run(["rev-parse", "--verify", target.ref], { cwd: dir });
    if (remoteExists.exitCode !== 0) {
      await pushWithRecovery(dir, target, branch, canPush, runner);
      const message = canPush ? `远程为空：已推送并建立 ${branch} 分支` : `远程没有 ${branch} 分支`;
      emit("sync.completed", { summary: { changedTaskIds: [], message } });
      return message;
    }
    const behind = await gitOrThrow(runner, ["rev-list", "--count", `HEAD..${target.ref}`], dir);
    if (behind.stdout.trim() !== "0") await rebaseOnto(dir, target.ref, runner);
    await pushWithRecovery(dir, target, branch, canPush, runner);
    const message = "同步完成（远端新变更已合并）";
    emit("sync.completed", { summary: { changedTaskIds: [], message } });
    return message;
  } catch (error) {
    const normalized = error instanceof Error ? error : new Error(String(error));
    emit("sync.failed", { error: normalized });
    throw normalized;
  } finally {
    await release();
    for (const publish of pendingEvents) publish();
  }
};

export const syncStatus = async (dir: string, runner: GitRunner = gitRunner): Promise<string> => {
  await ensureRepo(dir, runner);
  const status = await gitOrThrow(runner, ["status", "--porcelain"], dir);
  const remote = await runner.run(["remote"], { cwd: dir });
  return `${remote.stdout.trim() ? "远程：" : "无远程，"}待提交变更 ${status.stdout.split(/\r?\n/).filter(Boolean).length} 项`;
};
