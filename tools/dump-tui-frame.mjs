// 本地目检用：渲染几帧 TUI（无 ANSI 颜色），检查布局对齐。tsx 运行。
import { setTimeout as sleep } from "node:timers/promises";
import React from "react";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render } from "ink-testing-library";
import { parseTask } from "../src/core/task.js";
import { Store } from "../src/storage/store.js";
import { TuiApp } from "../src/tui/app.js";

const dir = mkdtempSync(join(tmpdir(), "atd-frame-"));
const store = new Store(dir);
const today = new Date();
const iso = (offset) => {
  const d = new Date(today);
  d.setDate(d.getDate() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const samples = [
  { id: "00000000", title: "项目复盘", due: `${iso(-3)}T10:00`, priority: "很急", tags: ["工作"], project: "工作" },
  { id: "00000001", title: "例会", due: `${iso(-1)}T14:00`, tags: ["meeting"], status: "meeting" },
  { id: "00000002", title: "写周报", due: `${iso(1)}T09:00`, priority: "高", tags: ["工作"], reminders: [{ at: `${iso(1)}T08:30`, hooks: ["toast"], fired: false }], notes: "带上上周的数据和这周的排期" },
  { id: "00000003", title: "取快递", due: `${iso(2)}T18:00`, priority: "低", parent: "00000002" },
  { id: "00000004", title: "读书笔记", due: `${iso(9)}T20:00` },
  { id: "00000005", title: "倒垃圾", priority: "中", tags: ["生活"], recur: { kind: "daily", interval: 1 } },
  { id: "00000006", title: "等待审批的报销", status: "waiting", wait: iso(3) },
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
const app = render(React.createElement(TuiApp, { store, terminalRows: 30 }));
await sleep(400);

const frame = async (label, keys) => {
  for (const key of keys) { app.stdin.write(key); await sleep(150); }
  console.log(`\n===== ${label} =====`);
  console.log(app.lastFrame());
};

await frame("清单（含子任务缩进、重复标记、备注标记）", ["j"]);
await frame("多选两条", [" ", " "]);
await frame("删除确认", ["x"]);
await frame("详情浮层", ["\u001b", "g", "j", "j", "l"]);
app.unmount();
