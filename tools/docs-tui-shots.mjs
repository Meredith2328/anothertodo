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
  ["C:\\Windows\\Fonts\\consolab.ttf", "Consolas"],
  ["C:\\Windows\\Fonts\\msyh.ttc", "Microsoft YaHei"],
  ["C:\\Windows\\Fonts\\simhei.ttf", "SimHei"],
  ["C:\\Windows\\Fonts\\simsun.ttc", "SimSun"],
  // Consolas 没有 ↳ ↻ ◈ ✎ 这些字形，缺了会画成豆腐块，用 Segoe UI Symbol 兜底
  ["C:\\Windows\\Fonts\\seguisym.ttf", "Segoe UI Symbol"],
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

// ---------------------------------------------------------------- 画布绘制
// 关键做法：不再"离线重绘"，而是把 Ink 真实输出的 ANSI 帧解析成
// 「每个格子一个字符 + 一个颜色」，再按等宽网格逐格画。
//
// 之前的版本用 ctx.fillText 画整段文字、靠字体自然排布定位，同时用正则猜每
// 行是什么（分组行？任务行？）。两者都会崩：canvas 里 SimSun 的实际字宽和
// 假定的 COL 不一致，于是整行越画越偏；正则猜错就把分组名和任务标题叠在一起。
// 现在对齐由「列号 × COL」保证，颜色直接来自帧里的 24-bit SGR 序列，
// 不需要猜，也不会和 theme 脱节。
const charW = (ch) => {
  const code = ch.codePointAt(0) ?? 0;
  if (code >= 0x1100 && code <= 0x115f || code >= 0x2e80 && code <= 0xa4cf || code >= 0xac00 && code <= 0xd7a3 || code >= 0xf900 && code <= 0xfaff || code >= 0xfe30 && code <= 0xfe6f || code >= 0xff00 && code <= 0xff60 || code >= 0xffe0 && code <= 0xffe6 || code >= 0x1f300 && code <= 0x1faff) return 2;
  return 1;
};
const displayW = (s) => [...s].reduce((w, c) => w + charW(c), 0);

const DEFAULT_FG = "#d8dee9";
// ANSI 16 色回落（Ink 大多输出 24-bit，这里兜底）
const BASIC = ["#3b4048", "#ff6188", "#a9dc76", "#ffd866", "#78dce8", "#ab9df2", "#56d4dd", "#d8dee9"];

/**
 * 把带 ANSI 的一帧解析成逐行的 cell 数组。
 * 每个 cell = { ch, fg, bg, bold, width }，宽字符后面跟一个 width:0 的占位，
 * 这样「列号」和终端里的物理列严格对应。
 */
const parseAnsiFrame = (frame) => {
  const rows = [];
  for (const rawLine of frame.split("\n")) {
    const cells = [];
    let fg = DEFAULT_FG;
    let bg = null;
    let bold = false;
    let i = 0;
    while (i < rawLine.length) {
      if (rawLine[i] === "\u001b" && rawLine[i + 1] === "[") {
        const end = rawLine.indexOf("m", i);
        if (end === -1) break;
        const params = rawLine.slice(i + 2, end).split(";").map(Number);
        for (let p = 0; p < params.length; p += 1) {
          const code = params[p];
          if (code === 0) { fg = DEFAULT_FG; bg = null; bold = false; }
          else if (code === 1) bold = true;
          else if (code === 22) bold = false;
          else if (code === 39) fg = DEFAULT_FG;
          else if (code === 49) bg = null;
          else if (code === 38 && params[p + 1] === 2) { fg = `rgb(${params[p + 2]},${params[p + 3]},${params[p + 4]})`; p += 4; }
          else if (code === 48 && params[p + 1] === 2) { bg = `rgb(${params[p + 2]},${params[p + 3]},${params[p + 4]})`; p += 4; }
          else if (code >= 30 && code <= 37) fg = BASIC[code - 30];
          else if (code >= 90 && code <= 97) fg = BASIC[code - 90];
          else if (code >= 40 && code <= 47) bg = BASIC[code - 40];
        }
        i = end + 1;
        continue;
      }
      const ch = String.fromCodePoint(rawLine.codePointAt(i));
      const w = charW(ch);
      cells.push({ ch, fg, bg, bold, width: w });
      // 宽字符占两列：补一个零宽占位，保持列号与物理列一致
      if (w === 2) cells.push({ ch: "", fg, bg, bold, width: 0 });
      i += ch.length;
    }
    rows.push(cells);
  }
  return rows;
};

const drawFrame = (frame, path, rows = 24) => {
  // 关键比例：真实终端里 CJK 正好是 ASCII 的两倍宽。所以以 ASCII 为基准格宽 COL，
  // CJK 占 2*COL，字号按格宽推导——ASCII 字号约等于 COL/0.6（Consolas 的宽高比），
  // CJK 字号约等于 2*COL（方块字满格）。这样两种字符在同一网格上严格对齐。
  const COL = 11;                       // 一个 ASCII 字符的像素宽
  const LINE = Math.round(COL * 2.05);  // 行高
  const PAD = 18;
  const ASCII_PX = Math.round(COL / 0.55);  // Consolas 在该字号下 advance ≈ 0.55em
  const CJK_PX = COL * 2;                   // 方块字满两格
  const grid = parseAnsiFrame(frame);
  const cols = Math.max(100, ...grid.map((line) => line.length));
  const W = cols * COL + PAD * 2;
  const H = Math.max(rows, grid.length) * LINE + PAD * 2;
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "middle";

  // 先铺所有背景块（选中行高亮），再画字，避免后画的背景盖住前面的字
  for (let r = 0; r < grid.length; r += 1) {
    for (let c = 0; c < grid[r].length; c += 1) {
      const cell = grid[r][c];
      if (!cell.bg) continue;
      ctx.fillStyle = cell.bg;
      ctx.fillRect(PAD + c * COL, PAD + r * LINE, COL * Math.max(1, cell.width), LINE);
    }
  }

  // 制表符 / 方框绘制字符（U+2500–U+259F）：占 1 格。Consolas 的横线在小字号下
  // 会断开，Segoe UI Symbol 的连得更实，所以这一段也交给它，但仍按窄字符定位。
  const isBox = (ch) => /[\u2500-\u257f\u2580-\u259f]/u.test(ch);
  // Consolas 缺字形的窄符号（↳ ↻ ◈ ✎ ● ∑ 等），一并回落到 Segoe UI Symbol。
  const isSymbol = (ch) => /[\u2190-\u21ff\u2200-\u22ff\u2300-\u23ff\u25a0-\u25ff\u2600-\u27bf\u2b00-\u2bff]/u.test(ch);

  // 逐格画字：x 由列号算出，对齐由数学保证，不依赖字体度量
  for (let r = 0; r < grid.length; r += 1) {
    const y = PAD + r * LINE + LINE / 2;
    for (let c = 0; c < grid[r].length; c += 1) {
      const cell = grid[r][c];
      if (!cell.ch || cell.ch === " ") continue;
      const wide = cell.width === 2;
      const box = isBox(cell.ch);
      const sym = isSymbol(cell.ch);
      // 方框与缺字形符号走 Segoe UI Symbol；CJK 走 SimSun；其余 ASCII 走 Consolas
      const font = box || sym ? "Segoe UI Symbol" : (wide ? "SimSun" : "Consolas");
      const px = wide && !box && !sym ? CJK_PX : ASCII_PX;
      ctx.font = `${cell.bold ? "bold " : ""}${px}px ${font}`;
      ctx.fillStyle = cell.fg;
      // 每个字符居中于它自己占的格子（宽字符是两格，所以中心在 +COL）
      const x = PAD + c * COL + (wide ? COL : COL / 2);
      ctx.textAlign = "center";
      ctx.fillText(cell.ch, x, y);
    }
  }

  writeFileSync(path, canvas.toBuffer("image/png"));
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
    { id: "00000000", title: "项目复盘", due: iso(-3, "10:00"), priority: "很急", tags: ["工作"], project: "工作" },
    { id: "00000001", title: "例会", due: iso(-1, "14:00"), tags: ["meeting"], status: "meeting" },
    { id: "00000002", title: "写周报", due: iso(1, "09:00"), priority: "高", tags: ["工作"], notes: "带上上周的数据和这周的排期", reminders: [{ at: iso(1, "08:30"), hooks: ["toast"], fired: false }] },
    { id: "00000003", title: "取快递", due: iso(2, "18:00"), priority: "低" },
    { id: "00000004", title: "读书笔记", due: iso(9, "20:00") },
    { id: "00000005", title: "倒垃圾", priority: "中", tags: ["生活"], recur: { kind: "daily", interval: 1 }, notes: "厨房那袋先扔" },
    { id: "00000006", title: "等待审批的报销", status: "waiting", wait: iso(-1) },
    { id: "00000007", title: "装修" },
    { id: "00000008", title: "买瓷砖", parent: "00000007", tags: ["采购"] },
  ];
  for (const s of samples) {
    await store.save(parseTask({
      id: s.id, title: s.title, status: s.status ?? "todo",
      ...(s.due ? { due: s.due } : {}), ...(s.priority ? { priority: s.priority } : {}),
      tags: s.tags ?? [], ...(s.project ? { project: s.project } : {}), ...(s.wait ? { wait: s.wait } : {}),
      ...(s.parent ? { parent: s.parent } : {}), ...(s.notes ? { notes: s.notes } : {}), ...(s.recur ? { recur: s.recur } : {}),
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
    title: "搜索过滤 /周报",
    rows: 24,
    run: async (app, signals) => {
      await press(app, signals, "/");
      await press(app, signals, "周报");
      const mutation = signals.mutation();
      app.stdin.write("\n");
      await mutation;
      const frame = app.lastFrame();
      const ok = frame.includes("过滤") && frame.includes("周报") && !frame.includes("读书笔记");
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
    title: "x 删除：先弹确认框",
    rows: 24,
    run: async (app, signals, store) => {
      await press(app, signals, "j");
      const before = (await store.tasks()).length;
      // 0.2.1 起 x 不再直接删除，先弹确认框；这一帧就是要展示那个确认框
      await press(app, signals, "x");
      const frame = app.lastFrame();
      const asked = frame.includes("请确认") && frame.includes("删除");
      const intact = (await store.tasks()).length === before;
      // 按 y 真正执行删除
      const mutation = signals.mutation();
      app.stdin.write("y");
      await mutation;
      const after = (await store.tasks()).length;
      return { frame, asserts: [
        ["弹出确认框", asked],
        ["未确认前不删除", intact],
        ["确认后任务数减少", after === before - 1],
      ] };
    },
  },
  {
    id: "detail-overlay",
    title: "l 详情浮层：备注、提醒、子任务",
    rows: 30,
    run: async (app, signals) => {
      // 选到「写周报」（带备注和提醒的那条）
      await press(app, signals, "g");
      for (let i = 0; i < 2; i += 1) await press(app, signals, "j");
      await press(app, signals, "l");
      const frame = app.lastFrame();
      return { frame, asserts: [
        ["显示备注正文", frame.includes("带上上周")],
        ["显示提醒投递状态", frame.includes("待发送")],
        ["显示浮层操作提示", frame.includes("其他键关闭")],
      ] };
    },
  },
  {
    id: "multi-select",
    title: "空格多选 + 批量操作",
    rows: 24,
    run: async (app, signals) => {
      await press(app, signals, "g");
      await press(app, signals, " ");
      await press(app, signals, " ");
      const frame = app.lastFrame();
      return { frame, asserts: [
        ["顶栏显示已选数量", frame.includes("◉2")],
        ["行首出现勾选标记", frame.includes("◉ ")],
      ] };
    },
  },
  {
    id: "subtasks",
    title: "子任务缩进显示",
    rows: 24,
    run: async (app, signals) => {
      const frame = app.lastFrame();
      return { frame, asserts: [
        ["子任务缩进标记", frame.includes("↳")],
        ["父任务在其上方", frame.indexOf("装修") < frame.indexOf("↳")],
      ] };
    },
  },
  {
    id: "recur-marks",
    title: "重复规则与备注标记",
    rows: 24,
    run: async (app, signals) => {
      const frame = app.lastFrame();
      return { frame, asserts: [
        ["显示重复规则", frame.includes("↻每天")],
        ["显示有备注标记", frame.includes("✎")],
      ] };
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
    title: "Ctrl+Z 撤销",
    rows: 24,
    run: async (app, signals, store) => {
      const before = (await store.tasks()).length;
      // 在清单区完成当前选中任务（触发一次 mutation）
      const mutation = signals.mutation();
      app.stdin.write("d");
      await mutation;
      const doneCount = (await store.tasks()).filter((t) => t.status === "done").length;
      // Ctrl+Z（\x1a）在清单区触发 undo（回归：修复前 key.name 缺失导致失效）
      const undo = signals.mutation();
      app.stdin.write("\x1a");
      const undoResult = await undo;
      const after = (await store.tasks()).length;
      const undone = undoResult.kind === "success" && (await store.tasks()).filter((t) => t.status === "done").length < doneCount;
      return { frame: app.lastFrame(), asserts: [["任务已先完成", doneCount >= 1], ["Ctrl+Z 撤销后任务数恢复", after === before], ["撤销生效", undone]] };
    },
  },
  {
    id: "ctrl-search",
    title: "Ctrl+F 搜索过滤",
    rows: 24,
    run: async (app, signals) => {
      // Ctrl+F（\x13 不是；Ctrl+F 是 \x06）在清单区触发搜索
      const action = signals.action();
      app.stdin.write("\x06");
      await action;
      const frame = app.lastFrame();
      // 进入搜索输入态：输入框前缀 /
      const entered = frame.includes("/");
      await press(app, signals, "周报");
      const mutation = signals.mutation();
      app.stdin.write("\n");
      await mutation;
      const filtered = app.lastFrame();
      const ok = filtered.includes("过滤") && filtered.includes("周报") && !filtered.includes("读书笔记");
      return { frame: filtered, asserts: [["Ctrl+F 进入搜索态", entered], ["过滤生效且排除未匹配", ok]] };
    },
  },
  {
    id: "ctrl-sync",
    title: "Ctrl+S 同步",
    rows: 24,
    run: async (app, signals, store) => {
      // Ctrl+S（\x13）在清单区触发同步
      const mutation = signals.mutation();
      app.stdin.write("\x13");
      const result = await mutation;
      return { frame: app.lastFrame(), asserts: [["Ctrl+S 触发同步", result.kind === "success"]] };
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
/**
 * ink-testing-library 的 lastFrame() 会吃掉横幅首行（BANNER_FULL[0]，那行只有
 * 一个 `_` 和空格），于是截图里横幅顶端像被裁了一刀。真实终端里这行是在的，
 * 所以采集后按 theme 里的定义补回去，让截图和实际观感一致。
 */
const restoreBannerTop = (frame) => {
  const first = BANNER_FULL[0];
  const second = BANNER_FULL[1];
  if (!first || !second) return frame;
  const lines = frame.split("\n");
  const plain = (s) => s.replace(/\u001b\[[0-9;]*m/gu, "");
  // Ink 给横幅加了 paddingLeft=1，所以帧里的缩进比 theme 定义多一格；
  // 按 trim 后的内容判断，并沿用帧里实际的缩进量补首行
  const head = plain(lines[0] ?? "");
  if (head.trim() !== second.trim()) return frame;
  const indent = " ".repeat(head.length - head.trimStart().length - (second.length - second.trimStart().length));
  const color = (lines[0] ?? "").match(/^\u001b\[[0-9;]*m/u)?.[0] ?? "";
  const restored = `${indent}${first}`;
  lines.unshift(color ? `${color}${restored}\u001b[39m` : restored);
  return lines.join("\n");
};

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
  const text = restoreBannerTop(result.frame ?? "");
  // .txt 是给文档直接贴的，剥掉 ANSI；PNG 用带色原帧，颜色才来自真实渲染
  writeFileSync(join(textDir, `${scenario.id}.txt`), text.replace(/\u001b\[[0-9;]*m/gu, ""), "utf8");
  drawFrame(text, join(shotDir, `${scenario.id}.png`), scenario.rows);
  const failed = result.asserts.filter(([, ok]) => !ok);
  report.push({ id: scenario.id, title: scenario.title, rows: scenario.rows, asserts: result.asserts.map(([name, ok]) => ({ name, ok })), pass: failed.length === 0, failed: failed.map(([name]) => name) });
  app.unmount();
  rmSync(dir, { recursive: true, force: true });
};

// 每个场景单独限时：某个场景在等一个永不到来的信号时（比如按键语义变了），
// 只让它自己失败，不要把整个采集器挂死——0.2.1 把 x 改成先弹确认框，
// 旧的 delete-soft 场景就是这样把整次采集卡住的。
const withDeadline = (promise, label, ms = 20_000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`${label} 超过 ${ms}ms 未结束（按键语义可能变了）`)), ms);
  promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
});

for (const scenario of scenarios) {
  try { await withDeadline(runScenario(scenario), scenario.id); }
  catch (error) { report.push({ id: scenario.id, title: scenario.title, error: String(error), pass: false }); }
}

writeFileSync(join(reportDir, "tui-report.json"), JSON.stringify({ scenarios: report }, null, 2), "utf8");
const passed = report.filter((r) => r.pass).length;
console.log(`TUI 场景：${report.length}，通过：${passed}`);
for (const r of report) {
  if (!r.pass) console.log(`  ✗ ${r.id}: ${r.error ?? r.failed?.join("、") ?? "断言失败"}`);
}
