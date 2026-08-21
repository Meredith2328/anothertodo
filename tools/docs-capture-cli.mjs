// 文档实证采集器：在全新临时 ATD_HOME 里按剧本逐条运行真实 atd CLI，
// 捕获每条命令的 stdout/stderr/退出码，产出：
//   docs/snippets/cli/<id>.txt   —— 终端原始输出（含 $ 命令行回显）
//   tools/docs-out/cli-report.json —— 完整证据（含退出码，供审计）
// 运行：node --import tsx tools/docs-capture-cli.mjs
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const repoRoot = join(import.meta.dirname, "..");
const outDir = join(repoRoot, "docs", "snippets", "cli");
const reportDir = join(repoRoot, "tools", "docs-out");
mkdirSync(outDir, { recursive: true });
mkdirSync(reportDir, { recursive: true });

const home = mkdtempSync(join(tmpdir(), "atd-docs-cli-"));
const remoteDir = join(home, "..", "atd-docs-cli-remote.git");

// atd 的数据目录只看 ATD_HOME；cwd 保持仓库根以便解析 tsx 依赖
const run = (argv) => {
  const result = spawnSync(process.execPath, ["--import", "tsx", join(repoRoot, "src", "cli.ts"), ...argv], {
    cwd: repoRoot,
    encoding: "utf8",
    env: { ...process.env, ATD_HOME: home },
    timeout: 60_000,
  });
  return { argv, stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status };
};

const echo = (argv) => argv.map((value) => (/[\s"]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value)).join(" ");

const runRaw = (argv, cwd = home) => {
  const result = spawnSync(argv[0], argv.slice(1), { cwd, encoding: "utf8", timeout: 60_000 });
  return { argv, stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.status };
};

// ---------------------------------------------------------------- 剧本
// {id} 引用第 N 个已添加任务的 id（从「已添加 xxxxxxxx」输出里自动收集）。
const scenarios = [
  {
    id: "add-multi",
    title: "批量添加",
    runs: [
      { atd: ["add", "后天 14:00 例会 #meeting", "明天 买牛奶 不急 #生活", "今晚 20:30 健身 @20:00", "下周一 交季度报告 非常急 #工作 proj:q3", "大后天 取快递 低", "8月30日 写学习总结 #学习"] },
    ],
  },
  { id: "preview-basic", title: "预览：日期+紧急度+提醒", runs: [{ atd: ["preview", "后天 买牛奶 很急 @18:30"] }] },
  { id: "preview-en-dates", title: "预览：英文相对日期", runs: [
    { atd: ["preview", "tomorrow buy milk"] },
    { atd: ["preview", "next monday submit report"] },
    { atd: ["preview", "tonight 21:00 gym"] },
    { atd: ["preview", "day after tomorrow pick up parcel"] },
    { atd: ["preview", "this weekend retro #work"] },
  ] },
  { id: "default-reminder", title: "默认提醒：没写 @ 也会自动补 toast", runs: [
    { atd: ["add", "后天 还书"] },
    { atd: ["show", "{id6}"] },
  ] },
  { id: "no-reminder", title: "关闭默认提醒：@none / no reminder", runs: [
    { atd: ["preview", "下周五 交报告 @none"] },
    { atd: ["preview", "next friday submit report no reminders"] },
  ] },
  { id: "preview-combo", title: "预览：全字段组合", runs: [{ atd: ["preview", "下周五 18:30 交季度报告 非常急 #工作 proj:q3 ^{id0} @30m"] }] },
  { id: "list-all", title: "列出全部（默认档位排序）", runs: [{ atd: ["list"] }] },
  { id: "list-keyword", title: "关键词查询", runs: [{ atd: ["list", "报告"] }] },
  { id: "list-tag", title: "标签查询 +工作", runs: [{ atd: ["list", "+工作"] }] },
  { id: "list-notag", title: "排除标签 -生活（注意 -- 分隔符）", runs: [{ atd: ["list", "--", "-生活"] }] },
  { id: "list-substr", title: "/子串匹配", runs: [{ atd: ["list", "/奶"] }] },
  { id: "list-overdue", title: "overdue 逾期过滤", runs: [{ atd: ["add", "昨天 交水电费 不急"], }, { atd: ["list", "overdue"] }] },
  { id: "list-due", title: "due:before: 明天之前到期", runs: [{ atd: ["list", "due:before:明天"] }] },
  { id: "list-proj-prio", title: "组合过滤 proj: priority:", runs: [{ atd: ["list", "proj:q3", "priority:高"] }] },
  { id: "list-status-done-empty", title: "status:done（当前没有已完成任务）", runs: [{ atd: ["list", "status:done"] }] },
  { id: "list-urgency", title: "urgency 加权排序模式", runs: [{ atd: ["list", "-m", "urgency"] }] },
  { id: "done", title: "完成任务（id 前缀即可）", runs: [{ atd: ["done", "{id0}"] }] },
  { id: "edit", title: "编辑任务", runs: [{ atd: ["edit", "{id1}", "明天 18:00 买牛奶和酸奶 #生活 @17:30"] }] },
  { id: "wait", title: "设为等待", runs: [{ atd: ["wait", "{id4}"] }] },
  { id: "show", title: "查看任务详情", runs: [{ atd: ["show", "{id2}"] }] },
  { id: "snooze", title: "推迟提醒 30 分钟并验证", runs: [{ atd: ["snooze", "{id2}", "30m"] }, { atd: ["show", "{id2}"] }] },
  { id: "undo-snooze", title: "撤销刚才的 snooze", runs: [{ atd: ["undo"] }, { atd: ["show", "{id2}"] }] },
  { id: "reopen", title: "重新打开已完成任务", runs: [{ atd: ["reopen", "{id0}"] }] },
  { id: "rm", title: "删除任务（软删除）", runs: [{ atd: ["rm", "{id1}"] }] },
  { id: "undo-delete", title: "撤销删除", runs: [{ atd: ["undo"] }] },
  { id: "archive-flow", title: "归档已完成任务 / 归档列表 / 恢复", runs: [{ atd: ["done", "{id5}"] }, { atd: ["archive", "0"] }, { atd: ["archive-list"] }, { atd: ["restore", "{id5}"] }, { atd: ["list", "status:done"] }] },
  { id: "sync-status", title: "同步状态（尚未配置远程）", runs: [{ atd: ["sync-status"] }] },
  {
    id: "sync-remote",
    title: "配置远程后同步",
    prepare: async () => {
      runRaw(["git", "init", "--bare", remoteDir]);
      runRaw(["git", "remote", "add", "origin", remoteDir]);
    },
    runs: [{ atd: ["sync"] }, { atd: ["sync"] }],
  },
  { id: "hooks", title: "查看可用 hook", runs: [{ atd: ["hooks"] }] },
  { id: "config-show", title: "查看配置（敏感值自动打码）", runs: [{ atd: ["config"] }] },
  { id: "config-set", title: "修改配置", runs: [{ atd: ["config", "set", "priority.mode", "urgency"] }, { atd: ["config", "set", "agenda.date_format", "full"] }] },
  { id: "watch-once", title: "提醒守护进程单次检查", runs: [{ atd: ["watch", "--once"] }] },
  { id: "error-show-missing", title: "错误处理：任务不存在", runs: [{ atd: ["show", "deadbeef"] }] },
  { id: "error-empty-title", title: "错误处理：空标题", runs: [{ atd: ["add", "   "] }] },
];

// ---------------------------------------------------------------- 执行
const ids = [];
const report = [];
const replaceRefs = (value) => value.replace(/\{id(\d+)\}/gu, (_, index) => {
  const id = ids[Number(index)];
  if (!id) throw new Error(`引用了不存在的任务 id${index}`);
  return id;
});

for (const scenario of scenarios) {
  if (scenario.prepare) await scenario.prepare();
  let transcript = "";
  const entries = [];
  for (const run_ of scenario.runs) {
    const argv = run_.atd.map(replaceRefs);
    transcript += `$ atd ${echo(argv)}\n`;
    const outcome = run(argv);
    transcript += `${outcome.stdout}${outcome.stderr}`;
    if (!transcript.endsWith("\n")) transcript += "\n";
    for (const match of outcome.stdout.matchAll(/已添加 ([0-9a-f]{8})/gu)) ids.push(match[1]);
    entries.push({ ...outcome, argv });
  }
  writeFileSync(join(outDir, `${scenario.id}.txt`), transcript, "utf8");
  report.push({ id: scenario.id, title: scenario.title, entries });
}

writeFileSync(join(reportDir, "cli-report.json"), JSON.stringify({ home, scenarios: report }, null, 2), "utf8");
rmSync(home, { recursive: true, force: true });
rmSync(remoteDir, { recursive: true, force: true });

const failed = report.flatMap((entry) => entry.entries).filter((entry) => entry.exitCode !== 0);
console.log(`完成 ${report.length} 个场景；非零退出 ${failed.length} 条（预期内的错误演示除外）：`);
for (const entry of failed) console.log(`  exit=${entry.exitCode}  atd ${entry.argv.join(" ")}`);
