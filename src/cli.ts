#!/usr/bin/env node
import { Command } from "commander";
import { pathToFileURL } from "node:url";

import { ApplicationService } from "./app/service.js";
import { groups, nestTasks, renderLine } from "./core/agenda.js";
import { configPath, dataDir, getConfigValue, loadConfig, setConfigValue } from "./core/config.js";
import { t } from "./core/i18n.js";
import { describeRecur, parse, preview, scanDate } from "./core/parse.js";
import { filterTasks } from "./core/query.js";
import { collectStats, exportTasks, projectSummary, tagSummary } from "./core/report.js";
import { displayWidth, padDisplay } from "./core/width.js";
import { Store } from "./storage/store.js";
import { setupRemote, syncDirectory, syncStatus } from "./sync/sync.js";
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
  program.name("atd").description("anothertodo：一行输入的命令行待办工具。不带参数直接运行会打开 TUI。")
    .addHelpText("after", `
一行输入语法（add / edit / preview 都认）：
  日期      明天 后天 下周三 8月20日 2026-09-01 tomorrow next friday
  时间      9:30 晚上8点 下午2点半 2:30pm
  优先级    低 中 高，或「很急」「不着急」「urgent」「no rush」这类说法
  标签      #标签      项目  proj:项目名
  提醒      @30m @2h @明天 @9:00，@名字 指定 hook；@none 关掉默认提醒
  等待      ~下周一    子任务  ^父任务id
  重复      *每天 *每2周 *每周三 *每月 *工作日 *weekly:mon
  备注      >>之后到行尾整段算备注
  清空      -due -proj -标签 -备注 -重复 -提醒，-#标签 只摘一个标签

查询语法（list）：
  due:today due:tomorrow due:week due:before:2026-09-01 due:none
  wait:week wait:any status:waiting project:读书 parent:<id> has:notes
  +高 / -低 挑档位，#标签 / -#标签 挑标签，/关键字 搜标题项目备注
  取反除了 -，也可以写 !高，省得和命令行选项打架

示例：
  atd add "明天 下午3点 写周报 高 #工作 proj:季度 >>带上上周数据"
  atd add "倒垃圾 *每天 晚上8点"
  atd list due:week -低
  atd edit a1b2 "-due -#临时"
`);
  program.showHelpAfterError();

  // 三个吃「一行输入」的命令都要放过未知选项：输入里可能以 `-due` 这类
  // 清空指令开头，commander 默认会把它当命令行选项拒掉
  program.command("add").description("新增任务，可一次给多条输入").argument("<inputs...>", "一行输入，例如「明天 下午3点 写周报 高 #工作」").allowUnknownOption().action(async (inputs: string[]) => {
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
      if (!group.tasks.length) { if (group.key === "hidden") console.log(group.name); continue; }
      console.log(`== ${group.name} ==`);
      for (const { task, depth } of nestTasks(group.tasks)) console.log(`  ${task.id.padEnd(8)} ${renderLine(task, cfg, now.slice(0, 10), selectedMode, now, depth)}`);
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

  program.command("rm").alias("delete").description("彻底删除任务（想留记录请用 cancel）").argument("<ids...>").action(async (ids: string[]) => {
    const application = service();
    await forEachId(ids, async (id) => {
      const current = await application.store.find(id);
      if (!current) throw new Error(`找不到任务：${id}`);
      const children = await application.children(current.id);
      await application.remove(id);
      console.log(`已删除 ${current.title}`);
      if (children.length) console.log(`  ⚠ 它还有 ${children.length} 个子任务，现在成了没有父任务的孤儿：${children.map((child) => child.title).join("、")}`);
    });
  });

  program.command("edit").description("按一行输入改任务；没写的字段保持原样，要清空用 -due 这类指令").argument("<id>").argument("<input...>", "一行输入，可含 -due / -proj 等清空指令").allowUnknownOption().action(async (id: string, input: string[]) => {
    const current = await service().edit(id, input.join(" "), nowLocal());
    console.log(`已更新 ${current.title}`);
  });

  program.command("show").description("看一条任务的全部字段").argument("<id>").option("--json", "输出原始 JSON").action(async (id: string, options: { json?: boolean }) => {
    const current = await store().find(id);
    if (!current) throw new Error(`找不到任务：${id}`);
    if (options.json === true) { console.log(JSON.stringify(current, null, 2)); return; }
    const application = service();
    const children = await application.children(current.id);
    const parent = current.parent === undefined ? undefined : await store().find(current.parent);
    const rows: Array<[string, string]> = [
      [t("field.id"), current.id], [t("field.title"), current.title], [t("field.status"), current.status],
      [t("field.due"), current.due ? current.due.replace("T", " ").slice(0, 16) : t("value.none")],
      [t("field.priority"), current.priority ?? t("value.none")], [t("field.project"), current.project ?? t("value.none")],
      [t("field.tags"), current.tags.length ? current.tags.map((tag) => `#${tag}`).join(" ") : t("value.none")],
      [t("field.wait"), current.wait ?? t("value.none")],
      [t("field.recur"), current.recur ? describeRecur(current.recur) : t("value.none")],
      [t("field.parent"), current.parent === undefined ? t("value.none") : `${current.parent}${parent ? ` ${parent.title}` : t("value.missing")}`],
      [t("field.subtasks"), children.length ? children.map((child) => `${child.id} ${child.title}`).join("、") : t("value.none")],
      [t("field.entry"), current.entry.replace("T", " ").slice(0, 16)],
      [t("field.end"), current.end ? current.end.replace("T", " ").slice(0, 16) : t("value.none")],
    ];
    const labelWidth = Math.max(...rows.map(([label]) => displayWidth(label)));
    for (const [label, value] of rows) console.log(`${padDisplay(label, labelWidth)}  ${value}`);
    if (current.reminders.length) {
      console.log(`${t("field.reminders")}${t("punct.colon")}`);
      for (const reminder of current.reminders) {
        const state = reminder.dead ? t("reminder.dead") : reminder.fired ? t("reminder.sent") : t("reminder.pending");
        console.log(`  ${reminder.at.replace("T", " ")}  ${reminder.hooks.join(",")}  ${state}${reminder.attempts ? t("reminder.retries", { n: reminder.attempts }) : ""}`);
      }
    }
    if (current.notes.trim()) { console.log(`${t("field.notes")}${t("punct.colon")}`); for (const line of current.notes.split(/\r?\n/)) console.log(`  ${line}`); }
  });
  program.command("undo").description("撤销上一次改动").action(async () => console.log(await service().undo()));
  program.command("archive").description("把久已完成的任务搬进归档；也可 archive list / archive restore <id>").argument("[action]", "天数（缺省 14）、list、restore").argument("[id]").action(async (action?: string, id?: string) => {
    if (action === "list" || action === "ls") { for (const item of await store().archived()) console.log(`${String(item.id).padEnd(8)} ${String(item.title ?? item.status ?? "已删除")}`); return; }
    if ((action === "restore" || action === "unarchive") && id) { console.log(`已恢复 ${String((await service().restore(id)).title ?? "")}`); return; }
    const days = action ? Number(action) : 14;
    if (!Number.isInteger(days) || days < 0) throw new Error(`无效归档天数：${action}`);
    console.log(`归档了 ${await service().archive(days)} 行`);
  });
  program.command("archive-list").description("列出归档里的任务").action(async () => { for (const item of await store().archived()) console.log(`${String(item.id).padEnd(8)} ${String(item.title ?? item.status ?? "已删除")}`); });
  program.command("restore").description("把归档里的任务恢复回来").argument("<id>").action(async (id: string) => console.log(`已恢复 ${String((await service().restore(id)).title ?? "")}`));
  program.command("reopen").description("把 done / cancelled 的任务重新打开").argument("<ids...>").action(async (ids: string[]) => {
    const application = service();
    await forEachId(ids, async (id) => { const current = await application.reopen(id); console.log(`↩ 重新打开 ${current.title}`); });
  });
  program.command("preview").description("只解析不保存，看看一行输入会被理解成什么").argument("<input...>").allowUnknownOption().action(async (input: string[]) => { const cfg = await loadConfig(); console.log(preview(input.join(" "), nowLocal(), [...cfg.priority.levels])); });

  const summaryTable = (label: string, rows: ReturnType<typeof projectSummary>): void => {
    if (!rows.length) { console.log("（还没有任务）"); return; }
    const width = Math.max(displayWidth(label), ...rows.map((row) => displayWidth(row.name)));
    console.log(`${padDisplay(label, width)}  未完成  已完成  逾期`);
    for (const row of rows) console.log(`${padDisplay(row.name, width)}  ${String(row.open).padStart(6)}  ${String(row.done).padStart(6)}  ${String(row.overdue).padStart(4)}`);
  };

  program.command("projects").description("按项目汇总任务数").action(async () => summaryTable("项目", projectSummary(await store().tasks(), nowLocal().slice(0, 10))));
  program.command("tags").description("按标签汇总任务数").action(async () => summaryTable("标签", tagSummary(await store().tasks(), nowLocal().slice(0, 10))));

  program.command("stats").description("看看整体状况：各状态数量、逾期、最近完成、最紧急的几条").action(async () => {
    const cfg = await loadConfig();
    const stats = collectStats(await store().tasks(), cfg, nowLocal());
    console.log(`任务总数 ${stats.total}（${stats.byStatus.map((row) => `${row.status} ${row.count}`).join("，") || "无"}）`);
    console.log(`逾期 ${stats.overdue}，今天到期 ${stats.dueToday}，${cfg.agenda.week_days} 天内到期 ${stats.dueThisWeek}，等待未到 ${stats.hiddenByWait}`);
    console.log(`重复任务 ${stats.recurring}，有备注 ${stats.withNotes}，子任务 ${stats.subtasks}`);
    console.log(`待发提醒 ${stats.pendingReminders}${stats.deadReminders ? `，已放弃 ${stats.deadReminders}（提醒重试超限）` : ""}`);
    console.log(`近 7 天完成 ${stats.completedLast7Days}，近 30 天完成 ${stats.completedLast30Days}`);
    if (stats.oldestOpenDays !== undefined) console.log(`最久没动的未完成任务已经放了 ${stats.oldestOpenDays} 天`);
    if (stats.topUrgent.length) {
      console.log("最紧急的几条：");
      for (const item of stats.topUrgent) console.log(`  ${item.id.padEnd(8)} U=${item.score.toFixed(1).padStart(5)}  ${item.title}`);
    }
  });

  program.command("export").description("导出任务，方便备份或贴到别处").argument("[query...]", "可选查询条件，缺省导出全部").option("-f, --format <format>", "json、csv 或 markdown", "json").option("-o, --output <file>", "写到文件，缺省打印到标准输出").allowUnknownOption().action(async (query: string[], options: { format: string; output?: string }) => {
    const format = options.format.toLowerCase();
    if (format !== "json" && format !== "csv" && format !== "markdown" && format !== "md") throw new Error(`不支持的格式：${options.format}（可选 json / csv / markdown）`);
    const cfg = await loadConfig();
    const all = await store().tasks();
    const selected = query.length ? filterTasks(all, query.join(" "), nowLocal().slice(0, 10), [...cfg.priority.levels]) : all;
    const text = exportTasks(selected, format === "md" ? "markdown" : format);
    if (options.output === undefined) { console.log(text); return; }
    await (await import("node:fs/promises")).writeFile(options.output, `${text}\n`, "utf8");
    console.log(`已导出 ${selected.length} 条到 ${options.output}`);
  });

  program.command("sync").description("和 Git 远端同步任务；--setup <url> 用来第一次配远程").option("--setup <url>", "配置或改写 origin 远程地址").action(async (options: { setup?: string }) => {
    if (options.setup !== undefined) { console.log(await setupRemote(dataDir(), options.setup)); return; }
    console.log(await service().sync());
  });
  program.command("sync-status").description("看同步状态：分支、远程、未提交变更、领先落后").action(async () => console.log(await syncStatus(dataDir())));
  program.command("watch").description("提醒守护：--once 只跑一轮，--install/--uninstall 管开机自启").option("--once", "只检查一轮就退出").option("--install", "安装开机自启").option("--uninstall", "卸载开机自启").action(async (options: { once?: boolean; install?: boolean; uninstall?: boolean }) => { if (options.install) { await installAutostart(); console.log("已安装 watcher 自启"); return; } if (options.uninstall) { await uninstallAutostart(); console.log("已卸载 watcher 自启"); return; } const database = store(); if (options.once) { const summary = await checkOnceDetailed(database, false, undefined, database.paths.dir); console.log(`提醒处理：${summary.processed}，发送：${summary.sent}，重试：${summary.retried}，dead-letter：${summary.dead}`); } else await runForever(database); });
  program.command("snooze").description("把任务最近一个待发提醒往后推").argument("<id>").argument("<minutes>", "30、10m 或 1h").action(async (id: string, value: string) => { const parsed = value.match(/^(\d+)([mh])?$/iu); if (!parsed) throw new Error("时间格式：30 / 10m / 1h"); const minutes = Number(parsed[1]) * (parsed[2]?.toLowerCase() === "h" ? 60 : 1); await service().snooze(id, minutes); console.log(`已推迟 ${minutes} 分钟`); });
  program.command("hooks").description("列出可用的提醒 hook").action(async () => { console.log(`内置 hook：toast, email`); console.log(`用户 hook：${(await hookNames(dataDir())).filter((name) => !["toast", "email"].includes(name)).join("、") || "（无）"}`); });
  program.command("config").description("看或改配置；config set 支持任意层级 key").argument("[action]", "缺省打印全部；可用 path / get / set").argument("[key]").argument("[value]").action(async (action?: string, key?: string, value?: string) => {
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
