// 界面常量：配色、横幅与帮助文案。
//
// 配色来自当前皮肤（见 skins.ts）。这里导出的 C / GROUP_COLOR / STATUS_COLOR /
// BANNER_COLORS / SKIN 都是「当前皮肤」的可变视图，applySkin 原地改写它们，
// 所以各组件照旧 import 使用即可，不用层层传 props。

import type { GroupKey } from "../core/agenda.js";

export type Palette = {
  accent: string; hot: string; warn: string; good: string; overdue: string; future: string;
  yellow: string; tag: string; proj: string; dim: string; dimmer: string; border: string;
  flash: string; select: string;
};
export type BorderStyle = "round" | "single" | "double" | "bold" | "classic";
export type ButtonLook = {
  /** flat：一行色块；raised：三行立体按钮，按下时凹进去 */
  style: "flat" | "raised";
  keyFg: string; keyBg: string; labelFg: string; labelBg: string;
  /** raised 用：受光的上沿、背光的下沿与投影、按下时的按钮面 */
  highlight: string; shadow: string; pressedBg: string;
};

export const C: Palette = {
  accent: "#56d4dd", // 青：主色/横幅/今天
  hot: "#ff6188", // 粉红：最高档/重点
  warn: "#fc9867", // 橙：次高档
  good: "#a9dc76", // 绿：低档/正常
  overdue: "#ff6b6b", // 红：逾期
  future: "#98c379", // 绿：临近
  yellow: "#ffd866", // 黄：提醒
  tag: "#c678dd", // 紫：标签/等待
  proj: "#61afef", // 蓝：项目/会议
  dim: "#888888",
  dimmer: "#5f5f5f",
  border: "#3b3b58",
  flash: "#ffd866",
  select: "#26264a",
};

export const SKIN: { name: string; border: BorderStyle; button: ButtonLook } = {
  name: "classic",
  border: "round",
  button: { style: "flat", keyFg: "black", keyBg: C.accent, labelFg: "white", labelBg: "#4a4a6a", highlight: "#7a7aa8", shadow: "#16161f", pressedBg: "#26264a" },
};

export const MODE_LABEL: Record<"levels" | "urgency", string> = { levels: "档位", urgency: "urgency" };

// 按分组 key 上色，而不是按显示出来的名字——名字会随界面语言变
export const GROUP_COLOR: Record<GroupKey, string> = {} as Record<GroupKey, string>;
export const STATUS_COLOR: Record<string, string> = {};
export const BANNER_COLORS: string[] = [];

/** 分组和状态的颜色都从调色板派生，皮肤只需要给调色板 */
export const applyPalette = (palette: Palette, banner: string[]): void => {
  Object.assign(C, palette);
  Object.assign(GROUP_COLOR, {
    doing: C.yellow, overdue: C.overdue, today: C.accent, upcoming: C.future, later: C.dim,
    waiting: C.tag, paused: C.dim, nodate: C.dim, finished: C.dimmer, blocked: C.dimmer,
  } satisfies Record<GroupKey, string>);
  for (const key of Object.keys(STATUS_COLOR)) delete STATUS_COLOR[key];
  Object.assign(STATUS_COLOR, { doing: C.yellow, waiting: C.tag, paused: C.dim, meeting: C.proj, done: C.dimmer, cancelled: C.dimmer });
  BANNER_COLORS.splice(0, BANNER_COLORS.length, ...banner);
};
applyPalette({ ...C }, ["#ff6188", "#56d4dd", "#fc9867", "#a9dc76", "#c678dd"]);

// "ANOTHER TODO" 像素字（figlet standard 字体，6 行高）。逐行渐变色，
// 终端过窄（<72 列）时退化为紧凑小字。
export const BANNER_FULL = [
  "    _    _   _  ___ _____ _   _ _____ ____    _____ ___  ____   ___  ",
  "   / \\  | \\ | |/ _ \\_   _| | | | ____|  _ \\  |_   _/ _ \\|  _ \\ / _ \\ ",
  "  / _ \\ |  \\| | | | || | | |_| |  _| | |_) |   | || | | | | | | | | |",
  " / ___ \\| |\\  | |_| || | |  _  | |___|  _ <    | || |_| | |_| | |_| |",
  "/_/   \\_\\_| \\_|\\___/ |_| |_| |_|_____|_| \\_\\   |_| \\___/|____/ \\___/ ",
  "",
];

// 紧凑模式：4 列宽小字，ANOTHER TODO 可读版
export const BANNER_SMALL = [
  "██ █▄█ ███ ███ █▄█ ███ █▄█ ███ ███ ██▄ ███",
  "█▄ █ █ █ █  █  █ █ █▄  █▄   █  █ █ █ █ █ █",
];

export const DATE_FORMAT_LABEL: Record<"auto" | "md" | "full", string> = {
  auto: "相对日期",
  md: "月/日",
  full: "完整日期",
};

export const INPUT_PLACEHOLDER = "＋ 添加任务，比如：明天 下午两点到三点 开会 很急";
/** 一行横幅：ui.banner = line 时顶栏左侧的标题 */
export const BANNER_LINE = "ANOTHER TODO";

// 帮助按“区域”组织：清单区（默认焦点）/ 输入区 / 两区通用
export const HELP_SECTIONS: ReadonlyArray<readonly [string, ReadonlyArray<readonly [string, string]>]> = [
  ["清单区（默认焦点，光标在任务列表）", [
    ["j k ↑ ↓", "移动选择"],
    ["PgUp / PgDn", "上下翻一页"],
    ["g / G", "跳到最上 / 最下"],
    ["l / →", "看详情（备注、提醒、父子任务）"],
    ["d / x", "完成 / 删除（删除会先问一句）"],
    ["c / o", "取消任务 / 重新打开 done、cancelled"],
    ["e", "编辑选中任务"],
    ["w / s", "等待到明天 / 提醒推迟 10 分钟"],
    ["n / p", "放进「在做」/「暂停」（再按一次退回待办）"],
    ["a / D", "选后续任务（它做完才露出来；列表里 n 新建一条）/ 依赖图"],
    [",", "设置：皮肤、鼠标点击、完成动画、排序等"],
    ["空格 / Ctrl+A", "打勾多选 / 全选本屏；有勾时 d x c w o s 批量执行"],
    ["u / U / r", "撤销 / 重做 / 重载配置和皮肤文件（:history 看最近几步）"],
    ["1 / 2 / Tab", "档位排序 / urgency 排序 / 切项目页"],
    ["3 / 4 / 5", "全部 / 近期 / 接下来一小时；f 循环切换，b 未安排，6 展开已完成"],
    ["t", "日期列格式：相对 / 月日 / 完整"],
    ["直接打字", "跳进输入区添加；若首字是快捷键（如 d），先按 i"],
  ]],
  ["输入区（光标在输入框，打字即内容）", [
    ["Enter", "提交：添加 / 命令 / 搜索 / 编辑保存"],
    ["Tab", "补全 #标签 和 proj:项目"],
    ["Esc", "清空输入并回到清单区"],
    [": xx", "命令模式（在清单区按 : 也会进这里）"],
    ["/ xx", "搜索过滤（同上）"],
  ]],
  ["区域切换", [
    ["清单 → 输入", "直接打字（非快捷键首字）· i 进输入区 · : · / · e(编辑)"],
    ["输入 → 清单", "Enter 提交后自动 · Esc 清空 · 空输入回车"],
    ["想打 d/x/q 等开头的标题", "清单区先按 i 进输入区，再打字"],
    ["默认焦点", "在清单区（无需 Tab；Tab 是输入区补全）"],
  ]],
  ["两区通用", [
    ["? / F1", "本帮助（任意键关闭）"],
    ["Ctrl+Z / Ctrl+Y", "撤销 / 重做"],
    ["Ctrl+V", "切视图，保留正在输入的内容"],
    ["Ctrl+S / Ctrl+F", "同步 / 搜索"],
    ["q / Q / 双击 Esc", "退出（Ctrl+Q 也可）"],
  ]],
];

// 完整帮助的总行数（边框 2 + 上下留白 2 + 标题 1 + 每节 1 行节名 + 条目），用于判断能否整页放下
export const FULL_HELP_LINES =
  5 + HELP_SECTIONS.reduce((lines, [, entries]) => lines + 1 + entries.length, 0);

// 紧凑帮助（终端高度不足以放下完整版时使用）：几行讲完全部高频操作，
// 加边框和标题后任何常规终端都放得下。
export const COMPACT_HELP_ROWS: ReadonlyArray<readonly [string, string]> = [
  ["清单区", "j/k ↑↓ 移动 · PgUp/PgDn 翻页 · g/G 首末 · l 详情"],
  ["", "d 完成 · x 删除 · c 取消 · o 重开 · e 编辑 · w 等待 · s 推迟提醒"],
  ["", "n 在做 · p 暂停 · a 选后续任务 · D 依赖图 · Tab 项目页 · , 设置"],
  ["", "空格 打勾多选 · Ctrl+A 全选 · u 撤销 · U 重做 · 1/2 排序 · t 日期列"],
  ["视图", "3 全部 · 4 近期 · 5 一小时 · f 切换 · b 未安排 · 6 已完成 · Ctrl+V 保留输入切换"],
  ["输入区", "直接打字添加 · Enter 提交 · Tab 补全 #标签/proj:"],
  ["", ": 命令(list/undo/redo/history/graph/skin/sync/mode/archive/cancel/doing/pause) · / 搜索"],
  ["通用", "? 帮助 · Ctrl+Z 撤销 · Ctrl+Y 重做 · Ctrl+S 同步 · Ctrl+F 搜索"],
  ["退出", "q / Q / Ctrl+Q / 双击 Esc；打 d/x/q 开头标题先按 i"],
];

// 紧凑帮助总行数（边框 2 + 上下留白 2 + 标题 1 + 条目）
export const COMPACT_HELP_LINES = 5 + COMPACT_HELP_ROWS.length;

export const WELCOME_ROWS: ReadonlyArray<readonly [string, string]> = [
  ["直接打字", "添加任务：`后天 买牛奶 很急 @18:30`，回车即存"],
  ["j / k", "在任务列表上下移动光标"],
  ["d", "完成选中的任务"],
  [": 命令", "如 `:mode urgency` 切换排序、`:undo` 撤销"],
  ["? / F1", "随时打开完整快捷键帮助"],
  ["q / 双击 Esc", "退出"],
];
