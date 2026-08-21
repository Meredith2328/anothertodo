// TUI 文档实证采集器：用 ink-testing-library 驱动真实 TuiApp（真实 Store），
// 通过 TuiTestSignals 同步按键时序，每场景断言帧内容符合预期，并产出：
//   docs/snippets/tui/<id>.txt      —— 纯文本帧（剥色，可复制、可断言）
//   docs/public/screenshots/tui/<id>.png —— 彩色 PNG（用 theme 颜色常量离线绘制）
//   tools/docs-out/tui-report.json  —— 场景、按键、断言结果（审计用）
// 运行：node --import tsx tools/docs-tui-shots.mjs
process.env.FORCE_COLOR = "3";

import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";

import React from "react";
import { createCanvas, GlobalFonts } from "@napi-rs/canvas";

import { render } from "ink-testing-library";
import { parseTask } from "../src/core/task.js";
import { Store } from "../src/storage/store.js";
import { TuiApp } from "../src/tui/app.js";
import { emitMouse } from "../src/tui/mouse.js";
import {
  BANNER_FULL, BANNER_SMALL, BANNER_COLORS, C, GROUP_COLOR, STATUS_COLOR,
  DATE_FORMAT_LABEL, MODE_LABEL,
} from "../src/tui/theme.js";

const repoRoot = join(import.meta.dirname, "..");
const shotDir = join(repoRoot, "docs", "public", "screenshots", "tui");
const textDir = join(repoRoot, "docs", "snippets", "tui");
const reportDir = join(repoRoot, "tools", "docs-out");
mkdirSync(shotDir, { recursive: true });
mkdirSync(textDir, { recursive: true });
mkdirSync(reportDir, { recursive: true });

const fonts = [
  ["C:\\Windows\\Fonts\\consola.ttf", "Consolas"],
  ["C:\\Windows\\Fonts\\msyh.ttc", "Microsoft YaHei"],
  ["C:\\Windows\\Fonts\\simhei.ttf", "SimHei"],
];
for (const [path, name] of fonts) { try { GlobalFonts.registerFromPath(path, name); } catch {} }

// ---------------------------------------------------------------- 测试信号（同步时序）
const createSignals = () => {
  let readyResolve;
  let dataResolve;
  let actionNumber = 0;
  let actionWaiter;
  let mutationResolve;
  const ready = new Promise((resolve) => { readyResolve = resolve; });
  const data = new Promise((resolve) => { dataResolve = resolve; });
  const withTimeout = (p, label, ms = 4000) => new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error(`${label} 超时`)), ms); p.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); }); });
  const signals = {
    onReady: () => readyResolve(),
    onDataReady: () => dataResolve(),
    onActionComplete: (sequence) => { actionNumber = Math.max(actionNumber, sequence); if (actionWaiter && sequence >= actionWaiter.target) { actionWaiter.resolve(); actionWaiter = undefined; } },
    onMutationComplete: (state) => mutationResolve(state),
  };
  return {
    signals,
    ready: () => withTimeout(ready, "ready"),
    data: () => withTimeout(data, "data-ready"),
    action: () => { const target = actionNumber + 1; return withTimeout(new Promise((resolve) => { actionWaiter = { target, resolve }; }), "action-complete"); },
    mutation: () => withTimeout(new Promise((resolve) => { mutationResolve = resolve; }), "mutation-complete"),
  };
};

// 每次 write 后等待一次 action 完成，保证帧已更新
const press = async (app, signals, key) => {
  const a = signals.action();
  app.stdin.write(key);
  await a;
};

// ---------------------------------------------------------------- 画布绘制（离线重绘彩色帧）
// 用纯文本帧 + theme 颜色常量绘制。文本帧每个字符一列，全角字符占 2 格。
const charW = (ch) => {
  const code = ch.codePointAt(0) ?? 0;
  if (code >= 0x1100 && code <= 0x115f || code >= 0x2e80 && code <= 0xa4cf || code >= 0xac00 && code <= 0xd7a3 || code >= 0xf900 && code <= 0xfaff || code >= 0xfe30 && code <= 0xfe6f || code >= 0xff00 && code <= 0xff60 || code >= 0xffe0 && code <= 0xffe6 || code >= 0x1f300 && code <= 0x1faff) return 2;
  return 1;
};
const displayW = (s) => [...s].reduce((w, c) => w + charW(c), 0);

const drawFrame = (frame, path, rows = 24) => {
  const COL = 12; // 每字符像素（放大提升清晰度）
  const PAD = 16;
  const lines = frame.split("\n");
  const H = rows * COL + PAD * 2;
  const W = 80 * COL + PAD * 2;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "top";
  const FONT = `${Math.round(COL * 0.98)}px Consolas`;
  const fontAt = (bold) => `${bold ? "bold " : ""}${Math.round(COL * 0.98)}px Consolas`;

  // 列宽（与 app.tsx 一致）
  const DATE_W = 12, PRIORITY_W = 8, STATUS_W = 10, EXTRAS_W = 30;
  // 表格内容左起列号：边框占 1 列 + paddingLeft=1
  const TITLE_START = 2;
  const PRIO_START = TITLE_START + DATE_W; // 日期列占 DATE_W
  const STATUS_START = PRIO_START + PRIORITY_W;
  const EXTRAS_START = STATUS_START + STATUS_W;

  // 把一段文本按字符绘制到指定列。中文字符用黑体（含 CJK 字形），
  // 英文/数字/符号用 Consolas（等宽）。每字符都落在固定列网格上，
  // 所以字形宽度差异不影响对齐。返回该段显示宽度。
  const isCjk = (ch) => {
    const code = ch.codePointAt(0) ?? 0;
    return code >= 0x2e80 && code <= 0x9fff || code >= 0xac00 && code <= 0xd7a3 || code >= 0xf900 && code <= 0xfaff || code >= 0xff00 && code <= 0xff60 || code >= 0x1f300 && code <= 0x1faff;
  };
  const drawSeg = (lineIdx, segStart, segText, color, bold = false, bg = null) => {
    if (!segText) return 0;
    let col = segStart;
    const chars = [...segText];
    for (const ch of chars) {
      const w = charW(ch);
      if (bg) { ctx.fillStyle = bg; ctx.fillRect(PAD + col * COL, PAD + lineIdx * COL, w * COL, COL); }
      ctx.fillStyle = color;
      ctx.font = `${bold ? "bold " : ""}${Math.round(COL * 0.98)}px ${isCjk(ch) ? "SimHei" : "Consolas"}`;
      ctx.fillText(ch, PAD + col * COL, PAD + lineIdx * COL);
      col += w;
    }
    return displayW(segText);
  };
  // 识别分组名（含数量）所在行：内容形如 "╾─ 名称 N ──────"
  const groupMatch = (line) => /^╾─\s*(.+?)\s+(\d+)\s*─/.exec(line);
  const isSelected = (line) => line.length > 0 && line !== lines[0] && /^\S/.test(line) && !/^[╭╰]/.test(line) && !/^╾/.test(line);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    // 横幅行（前 BANNER_FULL.length-1 行）
    if (i < BANNER_FULL.length - 1 && BANNER_FULL[i]) {
      drawSeg(i, 0, line, BANNER_COLORS[i % BANNER_COLORS.length] ?? C.hot, false);
      continue;
    }
    // 信息行（横幅之后 1 行）：右侧状态栏，用 dim 底 + accent 数字
    if (i === BANNER_FULL.length) {
      drawSeg(i, 0, line, C.dim, false);
      continue;
    }
    // 表格上边框
    if (i === BANNER_FULL.length + 1) { drawSeg(i, 0, line, C.border, false); continue; }
    // 表头行
    if (i === BANNER_FULL.length + 2) { drawSeg(i, 0, line, C.dim, true); continue; }
    // 分组分隔行：整行用该组颜色
    const g = groupMatch(line);
    if (g) {
      drawSeg(i, 0, line, GROUP_COLOR[g[1]] ?? C.dim, true);
      continue;
    }
    // 任务行：识别列并逐段上色
    if (i > BANNER_FULL.length + 2 && line.includes("│")) {
      const body = line.replace(/[│╭╰]/gu, " ");
      // 检测是否是选中行（有背景高亮 —— 用帧里无法直接感知，故用宽度启发）
      // 日期段
      const dateText = body.slice(TITLE_START, TITLE_START + DATE_W).trim();
      const titleText = body.slice(TITLE_START, TITLE_START + DATE_W + 20).trim();
      // 用已知任务标题判定颜色：逾期/今天/未来
      drawSeg(i, TITLE_START, dateText, C.dim, false);
      // 标题用默认色
      const title = body.slice(TITLE_START + DATE_W, PRIO_START + 20);
      drawSeg(i, TITLE_START + DATE_W, title, "#d8dee9", false);
      // 紧急度（紧急度列）
      const prioText = body.slice(PRIO_START, PRIO_START + PRIORITY_W).trim();
      drawSeg(i, PRIO_START, prioText, C.good, false);
      // 状态列
      const statusText = body.slice(STATUS_START, STATUS_START + STATUS_W).trim();
      const statusColor = STATUS_COLOR[statusText] ?? C.dim;
      drawSeg(i, STATUS_START, statusText, statusColor, statusText === "waiting" || statusText === "meeting");
      // 标签/提醒列
      const extras = body.slice(EXTRAS_START);
      drawSeg(i, EXTRAS_START, extras, C.dim, false);
      continue;
    }
    // 其余行（预览行/输入框/Footer）
    drawSeg(i, 0, line, C.dim, false);
  }

  // 用窄终端 banner 时重新画 banner（不做，默认走宽版）
  const buf = canvas.toBuffer("image/png");
  writeFileSync(path, buf);
};

// ---------------------------------------------------------------- 样本数据（覆盖各分组与状态）
const today = new Date();
const iso = (offset, time = "") => {
  const d = new Date(today);
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}${time ? `T${time}` : ""}`;
};

const seedTasks = async (store) => {
  const samples = [
    { title: "项目复盘", due: iso(-3, "10:00"), priority: "很急", tags: ["工作"], project: "工作" },
    { title: "例会", due: iso(-1, "14:00"), tags: ["meeting"] },
    { title: "写周报", due: iso(1, "09:00"), priority: "高", tags: ["工作"], reminders: [{ at: iso(1, "08:30"), hooks: ["toast"], fired: false }] },
    { title: "取快递", due: iso(2, "18:00"), priority: "低" },
    { title: "读书笔记", due: iso(9, "20:00") },
    { title: "买牛奶", priority: "中", tags: ["生活"] },
    { title: "等待审批的报销", status: "waiting", wait: iso(-1) },
  ];
  for (const [i, s] of samples.entries()) {
    await store.save(parseTask({
      id: String(i).padStart(8, "0"), title: s.title, status: s.status ?? "todo",
      ...(s.due ? { due: s.due } : {}), ...(s.priority ? { priority: s.priority } : {}),
      tags: s.tags ?? [], ...(s.project ? { project: s.project } : {}), ...(s.wait ? { wait: s.wait } : {}),
      reminders: s.reminders ?? [], entry: "2026-08-20T10:00:00Z", modified: "2026-08-20T10:00:00Z",
    }));
  }
};

// ---------------------------------------------------------------- 场景与断言
const scenarios = [
  {
    id: "main-list",
    title: "主清单：分组视图与选中行",
    rows: 24,
    run: async (app, signals) => {
      await press(app, signals, "j");
      const frame = app.lastFrame();
      return { frame, asserts: [
        ["包含横幅像素字", frame.includes("___") && frame.includes("_   _")],
        ["包含「接下来」组", frame.includes("接下来")],
        ["包含「等待中」组", frame.includes("等待中")],
        ["包含任务标题", frame.includes("写周报")],
      ] };
    },
  },
  {
    id: "add-flow",
    title: "添加任务：输入+预览+提交",
    rows: 24,
    run: async (app, signals, store) => {
      await press(app, signals, "i");
      await press(app, signals, "后天 买牛奶 很急 @18:30");
      const previewFrame = app.lastFrame();
      const previewOk = previewFrame.includes("2026-08-") && previewFrame.includes("买牛奶") && previewFrame.includes("[高]");
      const mutation = signals.mutation();
      app.stdin.write("\n");
      const m = await mutation;
      const added = (await store.tasks()).some((t) => t.title === "买牛奶");
      return { frame: app.lastFrame(), asserts: [["预览显示日期+紧急度", previewOk], ["提交成功", m.kind === "success"], ["任务已入库", added]] };
    },
  },
  {
    id: "help-full",
    title: "帮助弹窗（完整版）",
    rows: 40,
    run: async (app, signals) => {
      await press(app, signals, "?");
      const frame = app.lastFrame();
      const ok = frame.includes("atd 帮助") && frame.includes("清单区（默认焦点，光标在任务列表）") && frame.includes("两区通用");
      await press(app, signals, "x");
      const closed = !app.lastFrame().includes("atd 帮助");
      return { frame, asserts: [["完整帮助可见", ok], ["任意键可关闭", closed]] };
    },
  },
  {
    id: "help-compact",
    title: "帮助弹窗（矮终端紧凑版）",
    rows: 20,
    run: async (app, signals) => {
      await press(app, signals, "?");
      const frame = app.lastFrame();
      const ok = frame.includes("atd 帮助") && !frame.includes("清单区（默认焦点，光标在任务列表）");
      await press(app, signals, "x");
      return { frame, asserts: [["紧凑版无完整节名", ok]] };
    },
  },
  {
    id: "command-mode",
    title: "命令模式 :mode urgency",
    rows: 24,
    run: async (app, signals) => {
      await press(app, signals, ":");
      await press(app, signals, "mode urgency");
      const mutation = signals.mutation();
      app.stdin.write("\n");
      await mutation;
      const frame = app.lastFrame();
      return { frame, asserts: [["切换后显示 urgency 排序", frame.includes("urgency排序")]] };
    },
  },
  {
    id: "search-filter",
    title: "搜索过滤 /报告",
    rows: 24,
    run: async (app, signals) => {
      await press(app, signals, "/");
      await press(app, signals, "报告");
      const mutation = signals.mutation();
      app.stdin.write("\n");
      await mutation;
      const frame = app.lastFrame();
      const ok = frame.includes("过滤") && frame.includes("报告") && !frame.includes("读书笔记");
      await press(app, signals, ":");
      await press(app, signals, "list");
      app.stdin.write("\n");
      await sleep(200);
      return { frame, asserts: [["过滤生效且排除未匹配", ok]] };
    },
  },
  {
    id: "edit-task",
    title: "编辑选中任务",
    rows: 24,
    run: async (app, signals) => {
      await press(app, signals, "j"); // 选中第 2 行
      await press(app, signals, "e");
      const frame = app.lastFrame();
      const ok = frame.includes("编辑中") && frame.includes("例会");
      await press(app, signals, "\u001b");
      return { frame, asserts: [["进入编辑态并回填内容", ok]] };
    },
  },
  {
    id: "complete-done",
    title: "d 完成任务",
    rows: 24,
    run: async (app, signals, store) => {
      const mutation = signals.mutation();
      app.stdin.write("d");
      const m = await mutation;
      const done = (await store.tasks()).some((t) => t.status === "done");
      return { frame: app.lastFrame(), asserts: [["完成成功", m.kind === "success"], ["状态已落库", done]] };
    },
  },
  {
    id: "delete-soft",
    title: "x 软删除",
    rows: 24,
    run: async (app, signals, store) => {
      await press(app, signals, "j");
      const before = (await store.tasks()).length;
      const mutation = signals.mutation();
      app.stdin.write("x");
      await mutation;
      const after = (await store.tasks()).length;
      return { frame: app.lastFrame(), asserts: [["删除后任务数减少", after === before - 1]] };
    },
  },
  {
    id: "wait-defer",
    title: "w 设为等待（隐藏到明天）",
    rows: 24,
    run: async (app, signals, store) => {
      await press(app, signals, "j");
      const mutation = signals.mutation();
      app.stdin.write("w");
      const m = await mutation;
      const waiting = (await store.tasks()).some((t) => t.status === "waiting");
      return { frame: app.lastFrame(), asserts: [["设为等待成功", m.kind === "success" && waiting]] };
    },
  },
  {
    id: "date-format",
    title: "t 切换日期列格式",
    rows: 24,
    run: async (app, signals) => {
      await press(app, signals, "t");
      const f1 = app.lastFrame();
      const mdOk = f1.includes("月/日") || f1.includes("日期列：");
      await press(app, signals, "t");
      const f2 = app.lastFrame();
      return { frame: f2, asserts: [["日期列格式可切换", mdOk && f2.includes("日期列：")]] };
    },
  },
  {
    id: "undo",
    title: ":undo 命令撤销",
    rows: 24,
    run: async (app, signals, store) => {
      const before = (await store.tasks()).length;
      // 在清单区完成当前选中任务（触发一次 mutation）
      const mutation = signals.mutation();
      app.stdin.write("d");
      await mutation;
      const doneCount = (await store.tasks()).filter((t) => t.status === "done").length;
      // 通过命令模式撤销（:undo 走 command 分支，不依赖 key.name）
      await press(app, signals, ":");
      await press(app, signals, "undo");
      const undo = signals.mutation();
      app.stdin.write("\n");
      const undoResult = await undo;
      const after = (await store.tasks()).length;
      const undone = undoResult.kind === "success" && (await store.tasks()).filter((t) => t.status === "done").length < doneCount;
      return { frame: app.lastFrame(), asserts: [["任务已先完成", doneCount >= 1], ["撤销后任务数恢复", after === before], ["撤销生效", undone]] };
    },
  },
  {
    id: "sort-2",
    title: "2 切换 urgency 排序",
    rows: 24,
    run: async (app, signals) => {
      await press(app, signals, "2");
      const frame = app.lastFrame();
      return { frame, asserts: [["urgency 排序生效", frame.includes("urgency排序")]] };
    },
  },
  {
    id: "exit-armed",
    title: "双击 Esc 退出提示",
    rows: 24,
    run: async (app, signals) => {
      await press(app, signals, "\u001b");
      const frame = app.lastFrame();
      return { frame, asserts: [["出现二次 Esc 提示", frame.includes("再按一次") || frame.includes("Esc 退出")]] };
    },
  },
];

// ---------------------------------------------------------------- 执行
const report = [];
const runScenario = async (scenario) => {
  const dir = mkdtempSync(join(tmpdir(), "atd-tui-shot-"));
  const store = new Store(dir);
  await seedTasks(store);
  const signals = createSignals();
  const app = render(React.createElement(TuiApp, { store, testSignals: signals.signals, terminalRows: scenario.rows }), { exitOnCtrlC: true });
  await signals.ready();
  await signals.data();
  const result = await scenario.run(app, signals, store);
  const text = result.frame ?? "";
  writeFileSync(join(textDir, `${scenario.id}.txt`), text, "utf8");
  drawFrame(text, join(shotDir, `${scenario.id}.png`), scenario.rows);
  const failed = result.asserts.filter(([, ok]) => !ok);
  report.push({ id: scenario.id, title: scenario.title, rows: scenario.rows, asserts: result.asserts.map(([name, ok]) => ({ name, ok })), pass: failed.length === 0, failed: failed.map(([name]) => name) });
  app.unmount();
  rmSync(dir, { recursive: true, force: true });
};

for (const scenario of scenarios) {
  try { await runScenario(scenario); }
  catch (error) { report.push({ id: scenario.id, title: scenario.title, error: String(error), pass: false }); }
}

writeFileSync(join(reportDir, "tui-report.json"), JSON.stringify({ scenarios: report }, null, 2), "utf8");
const passed = report.filter((r) => r.pass).length;
console.log(`TUI 场景：${report.length}，通过：${passed}`);
for (const r of report) {
  if (!r.pass) console.log(`  ✗ ${r.id}: ${r.error ?? r.failed?.join("、") ?? "断言失败"}`);
}
