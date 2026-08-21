#!/usr/bin/env node
import { Command } from "commander";
import { pathToFileURL } from "node:url";

import { ApplicationService } from "./app/service.js";
import { groups, renderLine } from "./core/agenda.js";
import { configPath, dataDir, getConfigValue, loadConfig, setConfigValue } from "./core/config.js";
import { parse, preview, scanDate } from "./core/parse.js";
import { Store } from "./storage/store.js";
import { syncDirectory, syncStatus } from "./sync/sync.js";
import { checkOnceDetailed, runForever, snooze } from "./reminders/watcher.js";
import { installAutostart, uninstallAutostart } from "./reminders/autostart.js";
import { hookNames } from "./reminders/hooks.js";

const store = (): Store => new Store(dataDir());
const service = (): ApplicationService => new ApplicationService(store());
/** 批量操作里每条的错误已经单独打印过，这里只负责让进程以非零码收尾 */
class SilentFailure extends Error {
  constructor() { super(""); }
}
const redactConfig = (text: string): string => text.split(/\r?\n/).map((line) => /(?:password|token|secret)\s*=/iu.test(line) ? line.replace(/(=\s*).*/u, "$1\"***\"") : line).join("\n");
const nowLocal = (): string => {
  const now = new Date();
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
};
export const buildProgram = (): Command => {
  const program = new Command();
  program.name("atd").description("anothertodo Node.js CLI").showHelpAfterError();

  // 三个吃「一行输入」的命令都要放过未知选项：输入里可能以 `-due` 这类
  // 清空指令开头，commander 默认会把它当命令行选项拒掉
  program.command("add").argument("<inputs...>").allowUnknownOption().action(async (inputs: string[]) => {
    const application = service();
    for (const input of inputs) {
      const task = await application.add(input, nowLocal());
      console.log(`已添加 ${task.id}  ${task.title}`);
    }
  });

  // allowUnknownOption：让 `-低` `-#标签` 这类负向查询 token 落到 query 里，
  // 而不是被 commander 当成未知选项直接报错（commander 会把它们追加到操作数后面，
  // 查询谓词之间是 AND 关系，顺序被打乱不影响结果）
  program.command("list").description("按查询条件列出任务议程").argument("[query...]", "查询条件，如 due:today +高 -#临时 /关键字").option("-m, --mode <mode>", "排序口径：levels 或 urgency").allowUnknownOption().action(async (query: string[], options: { mode?: "levels" | "urgency" }) => {
    const cfg = await loadConfig();
    const now = nowLocal();
    const selectedMode = options.mode ?? cfg.priority.mode;
    const agenda = groups(await store().tasks(), cfg, selectedMode, now, query.join(" "));
    const visible = agenda.filter((group) => group.tasks.length > 0);
    if (!visible.length) { console.log("（没有匹配的任务）"); return; }
    for (const group of agenda) {
      if (!group.tasks.length) { if (group.name.startsWith("隐藏")) console.log(group.name); continue; }
      console.log(`== ${group.name} ==`);
      for (const task of group.tasks) console.log(`  ${task.id.padEnd(8)} ${renderLine(task, cfg, now.slice(0, 10), selectedMode, now)}`);
    }
  });

  // 批量操作里一条失败不该带走其余的：逐条报告，最后统一以非零码退出
  const forEachId = async (ids: string[], run: (id: string) => Promise<void>): Promise<void> => {
    let failed = 0;
    for (const id of ids) {
      try { await run(id); }
      catch (error) { failed += 1; console.error(error instanceof Error ? error.message : String(error)); }
    }
    if (failed) throw new SilentFailure();
  };

  program.command("done").description("完成任务；重复任务会自动派生下一次").argument("<ids...>").option("--with-subtasks", "连同还开着的子任务一起完成").action(async (ids: string[], options: { withSubtasks?: boolean }) => {
    const application = service();
    await forEachId(ids, async (id) => {
      const result = await application.complete(id, { cascade: options.withSubtasks === true });
      console.log(`✓ 完成 ${result.task.title}`);
      for (const child of result.cascaded) console.log(`  ↳ 顺带完成子任务 ${child.title}`);
      if (result.next) console.log(`  ↻ 下一次：${result.next.id} ${result.next.due ? result.next.due.slice(0, 10) : "无日期"}`);
      if (result.openChildren.length) console.log(`  ⚠ 还有 ${result.openChildren.length} 个子任务没完成：${result.openChildren.map((child) => child.title).join("、")}（加 --with-subtasks 一起完成）`);
    });
  });

  const statusCommand = (name: string, status: "cancelled" | "meeting" | "todo", description: string, label: string): void => {
    program.command(name).description(description).argument("<ids...>").action(async (ids: string[]) => {
      const application = service();
      await forEachId(ids, async (id) => { const current = await application.setStatus(id, status); console.log(`${label} ${current.title}`); });
    });
  };
  statusCommand("cancel", "cancelled", "取消任务（保留记录，不同于删除）", "✗ 已取消");
  statusCommand("meeting", "meeting", "标记为会议，过了时间同样计入逾期", "已标记为会议");
  statusCommand("todo", "todo", "退回待办状态，并清掉等待日期", "↩ 已退回待办");

  program.command("wait").description("设为等待；--until 指定等到哪天，缺省是明天").argument("<ids...>").option("-u, --until <date>", "等到哪天，支持 2026-09-01 / 下周一 / next monday").action(async (ids: string[], options: { until?: string }) => {
    const application = service();
    let date: string | undefined;
    if (options.until !== undefined) {
      const scanned = scanDate(options.until, nowLocal().slice(0, 10));
      if (!scanned) throw new Error(`看不懂这个日期：${options.until}`);
      date = scanned.date;
    }
    await forEachId(ids, async (id) => {
      const current = date === undefined ? await application.setStatus(id, "waiting") : await application.deferUntil(id, date);
      console.log(`已设为等待 ${current.title}${current.wait ? `（等到 ${current.wait}）` : ""}`);
    });
  });

  program.command("rm").alias("delete").argument("<ids...>").action(async (ids: string[]) => {
    const application = service();
    for (const id of ids) { const current = await application.store.find(id); if (!current) throw new Error(`找不到任务：${id}`); await application.remove(id); console.log(`已删除 ${current.title}`); }
  });

  program.command("edit").argument("<id>").argument("<input...>").allowUnknownOption().action(async (id: string, input: string[]) => {
    const current = await service().edit(id, input.join(" "), nowLocal());
    console.log(`已更新 ${current.title}`);
  });

  program.command("show").argument("<id>").action(async (id: string) => {
    const current = await store().find(id);
    if (!current) throw new Error(`找不到任务：${id}`);
    console.log(JSON.stringify(current, null, 2));
  });
  program.command("undo").action(async () => console.log(await service().undo()));
  program.command("archive").argument("[action]").argument("[id]").action(async (action?: string, id?: string) => {
    if (action === "list" || action === "ls") { for (const item of await store().archived()) console.log(`${String(item.id).padEnd(8)} ${String(item.title ?? item.status ?? "已删除")}`); return; }
    if ((action === "restore" || action === "unarchive") && id) { console.log(`已恢复 ${String((await service().restore(id)).title ?? "")}`); return; }
    const days = action ? Number(action) : 14;
    if (!Number.isInteger(days) || days < 0) throw new Error(`无效归档天数：${action}`);
    console.log(`归档了 ${await service().archive(days)} 行`);
  });
  program.command("archive-list").action(async () => { for (const item of await store().archived()) console.log(`${String(item.id).padEnd(8)} ${String(item.title ?? item.status ?? "已删除")}`); });
  program.command("restore").argument("<id>").action(async (id: string) => console.log(`已恢复 ${String((await service().restore(id)).title ?? "")}`));
  program.command("reopen").argument("<ids...>").action(async (ids: string[]) => {
    const application = service();
    for (const id of ids) { const current = await application.reopen(id); console.log(`↩ 重新打开 ${current.title}`); }
  });
  program.command("preview").argument("<input...>").allowUnknownOption().action(async (input: string[]) => { const cfg = await loadConfig(); console.log(preview(input.join(" "), nowLocal(), [...cfg.priority.levels])); });
  program.command("sync").action(async () => console.log(await service().sync()));
  program.command("sync-status").action(async () => console.log(await syncStatus(dataDir())));
  program.command("watch").option("--once").option("--install").option("--uninstall").action(async (options: { once?: boolean; install?: boolean; uninstall?: boolean }) => { if (options.install) { await installAutostart(); console.log("已安装 watcher 自启"); return; } if (options.uninstall) { await uninstallAutostart(); console.log("已卸载 watcher 自启"); return; } const database = store(); if (options.once) { const summary = await checkOnceDetailed(database, false, undefined, database.paths.dir); console.log(`提醒处理：${summary.processed}，发送：${summary.sent}，重试：${summary.retried}，dead-letter：${summary.dead}`); } else await runForever(database); });
  program.command("snooze").argument("<id>").argument("<minutes>").action(async (id: string, value: string) => { const match = /^(\d+)([mh])?$/iu.exec(value); if (!match) throw new Error("时间格式：30 / 10m / 1h"); await service().snooze(id, Number(match[1]) * (match[2]?.toLowerCase() === "h" ? 60 : 1)); });
  program.command("hooks").action(async () => { console.log(`内置 hook：toast, email`); console.log(`用户 hook：${(await hookNames(dataDir())).filter((name) => !["toast", "email"].includes(name)).join("、") || "（无）"}`); });
  program.command("config").argument("[action]").argument("[key]").argument("[value]").action(async (action?: string, key?: string, value?: string) => {
    if (action === "path") { console.log(dataDir()); return; }
    if (action === "get" && key) { const current = await getConfigValue(key); console.log(/(?:password|token|secret)/iu.test(key) ? "***" : typeof current === "object" ? JSON.stringify(current) : String(current)); return; }
    if (action === "set" && key && value !== undefined) { await setConfigValue(key, value); const masked = /(?:password|token|secret)/iu.test(key) ? "***" : value; console.log(`已设置 ${key} = ${masked}`); return; }
    if (!action) { console.log(`配置文件：${configPath()}`); console.log(redactConfig(await (await import("node:fs/promises")).readFile(configPath(), "utf8"))); return; }
    throw new Error("用法：atd config | atd config path | atd config get priority.mode | atd config set priority.urgency.overdue 15");
  });
  return program;
};

export const main = async (argv = process.argv.slice(2)): Promise<number> => {
  const program = buildProgram();
  if (argv.includes("--watch-daemon")) { await runForever(store()); return 0; }
  if (!argv.length) {
    const [{ render }, React, { TuiApp }, { createMouseBridge }] = await Promise.all([import("ink"), import("react"), import("./tui/app.js"), import("./tui/mouse.js")]);
    const interactive = process.stdin.isTTY === true;
    const bridge = interactive ? createMouseBridge(process.stdin as NodeJS.ReadStream & { fd: number }, process.stdout) : undefined;
    // 备用屏幕：TUI 独占整屏，退出后恢复终端原内容；鼠标坐标也与
    // 渲染行号精确对齐（每帧从 1,1 重绘）
    if (interactive) process.stdout.write("\x1b[?1049h");
    try {
      const instance = render(
        React.createElement(TuiApp, { store: store(), welcome: true }),
        bridge ? { stdin: bridge.stream as unknown as NodeJS.ReadStream, exitOnCtrlC: true } : { exitOnCtrlC: true },
      );
      bridge?.enable();
      await instance.waitUntilExit();
    } finally {
      bridge?.disable();
      if (interactive) process.stdout.write("\x1b[?1049l");
    }
    return 0;
  }
  try { await program.parseAsync(["node", "atd", ...argv]); return 0; }
  catch (error) {
    if (error instanceof SilentFailure) return 1;
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
};

// SEA 单文件入口通过 ATD_SEA 标记跳过直跑判断；try/catch 兜底 __filename 缺失等环境差异
const invokedDirectly = (() => {
  if ((globalThis as { ATD_SEA?: boolean }).ATD_SEA) return false;
  const entry = process.argv[1];
  if (!entry) return false;
  try { return import.meta.url === pathToFileURL(entry).href; } catch { return false; }
})();
if (invokedDirectly) main().then((code) => { process.exitCode = code; }, (error: unknown) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
