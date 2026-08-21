// 界面常量：与 Python 版 atd/tui.py 的配色、横幅与帮助文案保持一致。

import type { GroupKey } from "../core/agenda.js";

export const C = {
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
  bg: "#10101a",
  select: "#26264a",
} as const;

export const MODE_LABEL: Record<"levels" | "urgency", string> = { levels: "档位", urgency: "urgency" };

// 按分组 key 上色，而不是按显示出来的名字——名字会随界面语言变
export const GROUP_COLOR: Record<GroupKey, string> = {
  overdue: C.overdue,
  today: C.accent,
  upcoming: C.future,
  later: C.dim,
  waiting: C.tag,
  nodate: C.dim,
  finished: C.dimmer,
  hidden: C.dimmer,
};

export const STATUS_COLOR: Record<string, string> = {
  waiting: C.tag,
  meeting: C.proj,
  done: C.dimmer,
  cancelled: C.dimmer,
};

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

export const BANNER_COLORS = [
  "#ff6188", "#56d4dd", "#fc9867", "#a9dc76", "#c678dd",
  "#ff6188", "#56d4dd", "#fc9867", "#a9dc76", "#c678dd",
  "#ff6188", "#56d4dd",
];

export const DATE_FORMAT_LABEL: Record<"auto" | "md" | "full", string> = {
  auto: "相对日期",
  md: "月/日",
  full: "完整日期",
};

export const INPUT_PLACEHOLDER = "添加：后天 买牛奶 很急 @18:30   ·   : 命令   ·   / 搜索   ·   Tab 补全";

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
    ["空格 / Ctrl+A", "打勾多选 / 全选本屏；有勾时 d x c w o s 批量执行"],
    ["u / r", "撤销上一步 / 重载配置刷新"],
    ["1 / 2", "档位排序 / urgency 排序"],
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
    ["Ctrl+Z / Ctrl+S / Ctrl+F", "撤销 / 同步 / 搜索"],
    ["q / Q / 双击 Esc", "退出（Ctrl+Q 也可）"],
  ]],
];

// 完整帮助的总行数（边框 2 + 标题 1 + 每节 1 行节名 + 条目），用于判断能否整页放下
export const FULL_HELP_LINES =
  3 + HELP_SECTIONS.reduce((lines, [, entries]) => lines + 1 + entries.length, 0);

// 紧凑帮助（终端高度不足以放下完整版时使用）：几行讲完全部高频操作，
// 加边框和标题后任何常规终端都放得下。
export const COMPACT_HELP_ROWS: ReadonlyArray<readonly [string, string]> = [
  ["清单区", "j/k ↑↓ 移动 · PgUp/PgDn 翻页 · g/G 首末 · l 详情"],
  ["", "d 完成 · x 删除 · c 取消 · o 重开 · e 编辑 · w 等待 · s 推迟提醒"],
  ["", "空格 打勾多选 · Ctrl+A 全选 · u 撤销 · 1/2 排序 · t 日期列"],
  ["输入区", "直接打字添加 · Enter 提交 · Tab 补全 #标签/proj:"],
  ["", ": 命令(list/undo/sync/mode/archive/cancel/meeting) · / 搜索"],
  ["通用", "? 帮助 · Ctrl+Z 撤销 · Ctrl+S 同步 · Ctrl+F 搜索"],
  ["退出", "q / Q / Ctrl+Q / 双击 Esc；打 d/x/q 开头标题先按 i"],
];

// 紧凑帮助总行数（边框 2 + 标题 1 + 条目）
export const COMPACT_HELP_LINES = 3 + COMPACT_HELP_ROWS.length;

export const WELCOME_ROWS: ReadonlyArray<readonly [string, string]> = [
  ["直接打字", "添加任务：`后天 买牛奶 很急 @18:30`，回车即存"],
  ["j / k", "在任务列表上下移动光标"],
  ["d", "完成选中的任务"],
  [": 命令", "如 `:mode urgency` 切换排序、`:undo` 撤销"],
  ["? / F1", "随时打开完整快捷键帮助"],
  ["q / 双击 Esc", "退出"],
];
