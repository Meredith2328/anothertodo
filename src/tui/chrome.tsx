// 界面外壳：顶栏（横幅 + 项目页签 + 统计）、提示行、输入框、底部按钮条。
// 这些都是纯展示组件，状态由 app.tsx 传进来。
import React from "react";
import { Box, Text } from "ink";

import type { Config, Task } from "../contracts.js";
import { preview } from "../core/parse.js";
import { ACTIVE_STATES, isOverdue, localDate, localNow } from "../core/task.js";
import { VIEW_ORDER, VIEW_LABEL, wallNow, type AgendaView, type ViewWindow } from "../core/views.js";
import { displayWidth } from "../core/width.js";
import type { TuiState } from "./state.js";
import {
  BANNER_COLORS, BANNER_FULL, BANNER_LINE, BANNER_SMALL, C, INPUT_PLACEHOLDER, MODE_LABEL, SKIN,
} from "./theme.js";

const nowLocal = localNow;

/** 卡片式清单最宽用多少列：太宽的终端上一行文字拉满反而难读，像网页一样限宽居中 */
export const MAX_CONTENT_WIDTH = 110;
export const contentWidth = (columns: number | undefined): number => Math.min(columns ?? 100, MAX_CONTENT_WIDTH);
/** 限宽后左边留出的列数，让内容居中 */
export const contentLeft = (columns: number | undefined): number => columns === undefined ? 0 : Math.max(0, Math.floor((columns - contentWidth(columns)) / 2));

type BannerMode = Config["ui"]["banner"];

/**
 * 横幅按配置和窗口大小选：line 一行标题（默认）；small / full 在放得下时用像素字，
 * 窗口太矮或太窄时自动降级。返回的是实际可见的行，布局计算和鼠标行号都以它为准；
 * 一行标题模式下返回 [BANNER_LINE]，它和统计信息画在同一行。
 */
export const bannerLines = (columns: number | undefined, rows: number | undefined, mode: BannerMode = "line"): readonly string[] => {
  if (mode === "line") return [BANNER_LINE];
  if (rows !== undefined && rows < 18) return [BANNER_LINE];
  if (mode === "small" || (columns !== undefined && columns < 72) || (rows !== undefined && rows < 26)) {
    return columns !== undefined && columns < 46 ? [BANNER_LINE] : BANNER_SMALL;
  }
  return BANNER_FULL.filter(Boolean);
};

/** 像素字横幅实际占的行数；一行标题模式下标题画在顶栏里，这里算 0 */
export const bannerRows = (columns: number | undefined, rows: number | undefined, mode: BannerMode = "line"): number => {
  const lines = bannerLines(columns, rows, mode);
  return lines.length === 1 && lines[0] === BANNER_LINE ? 0 : lines.length;
};

export const Banner = ({ columns, rows, mode }: { columns: number | undefined; rows: number | undefined; mode: BannerMode }): React.ReactElement | null => {
  const lines = bannerLines(columns, rows, mode);
  if (lines.length === 1 && lines[0] === BANNER_LINE) return null;
  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
      {lines.map((line, index) => (
        <Text key={index} wrap="truncate" color={BANNER_COLORS[index % BANNER_COLORS.length] ?? C.hot}>{line}</Text>
      ))}
    </Box>
  );
};

/**
 * 顶栏：左边标题（一行横幅模式）或项目页签，右边是三个数字和时间。
 * 数字用文字说明，不用 ! ● ∑ 这类要猜的符号。
 */
export const TopBar = ({ query, sortMode, tasks, clock, marked = 0, projects, project, showTitle, columns, timezone = "Asia/Shanghai" }: {
  timezone?: string | undefined;
  query: string;
  sortMode: "levels" | "urgency";
  tasks: Task[];
  clock: Date;
  marked?: number;
  projects: string[];
  project: string | undefined;
  showTitle: boolean;
  columns: number | undefined;
}): React.ReactElement => {
  const today = wallNow(clock, timezone).slice(0, 10);
  const overdue = tasks.filter((task) => isOverdue(task, today)).length;
  const dueToday = tasks.filter((task) => (task.status === "todo" || task.status === "meeting") && task.due !== undefined && localDate(task.due) === today).length;
  const active = tasks.filter((task) => ACTIVE_STATES.has(task.status)).length;
  const hhmm = wallNow(clock, timezone).slice(11, 16);
  const narrow = columns !== undefined && columns < 70;
  const tabs = projects.length ? ["全部", ...projects] : [];
  return (
    <Box justifyContent="space-between" paddingLeft={1} paddingRight={1} width={contentWidth(columns)} marginLeft={contentLeft(columns)}>
      <Text wrap="truncate">
        {showTitle ? <Text bold color={C.accent}>{BANNER_LINE}</Text> : null}
        {showTitle && tabs.length ? <Text color={C.dimmer}>{"   "}</Text> : null}
        {tabs.map((name) => {
          const current = name === "全部" ? project === undefined : project === name;
          return (
            <React.Fragment key={name}>
              <Text bold={current} color={current ? C.accent : C.dim} {...(current ? { underline: true } : {})}>{name}</Text>
              <Text>{"  "}</Text>
            </React.Fragment>
          );
        })}
      </Text>
      <Text wrap="truncate">
        {marked ? <Text bold color={C.hot}>{`已选 ${marked}   `}</Text> : null}
        {query ? <Text color={C.yellow}>{`过滤 ${query}   `}</Text> : null}
        {sortMode === "urgency" ? <Text color={C.accent}>{`${MODE_LABEL[sortMode]} 排序   `}</Text> : null}
        {narrow ? null : <Text color={C.dim}>今天 </Text>}
        <Text bold color={dueToday ? C.accent : C.dim}>{String(dueToday)}</Text>
        <Text color={C.dim}>{narrow ? " · " : " · 逾期 "}</Text>
        <Text bold color={overdue ? C.overdue : C.dim}>{String(overdue)}</Text>
        <Text color={C.dim}>{narrow ? " · " : " · 进行中 "}</Text>
        <Text bold color={C.dim}>{String(active)}</Text>
        <Text color={C.dimmer}>{`   ${hhmm}`}</Text>
      </Text>
    </Box>
  );
};

const viewTab = (view: AgendaView, index: number, columns: number | undefined): string => `${index + 3} ${view === "hour" && columns !== undefined && columns < 70 ? "一小时" : VIEW_LABEL[view]}  `;
export const viewKeyRanges = (columns: number | undefined): Array<{ key: string; start: number; end: number }> => {
  let cursor = contentLeft(columns) + 2;
  return VIEW_ORDER.map((view, index) => {
    const width = displayWidth(viewTab(view, index, columns));
    const range = { key: String(index + 3), start: cursor, end: cursor + width - 3 };
    cursor += width;
    return range;
  });
};
export const ViewBar = ({ view, showUnscheduled, counts, window, columns }: {
  view: AgendaView; showUnscheduled: boolean; counts: { unscheduled: number; outside: number }; window: ViewWindow | undefined; columns: number | undefined;
}): React.ReactElement => {
  const range = !window || view === "all" ? "完整清单" : view === "hour"
    ? `${window.now.slice(11, 16)}–${window.hourEnd.slice(0, 10) === window.today ? "" : window.hourEnd.slice(5, 10) + " "}${window.hourEnd.slice(11, 16)} · 含在做、逾期和今天未定时事项`
    : `今天至 ${window.recentEnd.slice(5, 10)} · 含在做和逾期`;
  return <Box flexDirection="column" width={contentWidth(columns)} marginLeft={contentLeft(columns)} paddingLeft={1} paddingRight={1}>
    <Text wrap="truncate">{VIEW_ORDER.map((item, index) => <Text key={item} bold={view === item} underline={view === item} color={view === item ? C.accent : C.dim}>{viewTab(item, index, columns)}</Text>)}<Text color={C.dimmer}>f 切换</Text></Text>
    <Text wrap="truncate"><Text color={counts.unscheduled ? C.yellow : C.dim}>{`未安排 ${counts.unscheduled}${view === "all" ? " 项" : showUnscheduled ? " 项 · b 收起" : " 项 · b 展开"}`}</Text><Text color={C.dimmer}>{`  ${range}${counts.outside ? ` · 范围外 ${counts.outside} 项（3 全部）` : ""}`}</Text></Text>
  </Box>;
};

/** 提示行：正在输入时显示解析预览，否则显示最近一条操作反馈（toast）或上下文提示 */
export const PreviewLine = ({ state, levels, toast, columns }: { state: TuiState; levels: string[]; toast?: string | undefined; columns: number | undefined }): React.ReactElement => {
  const width = contentWidth(columns);
  const left = contentLeft(columns);
  const line = (node: React.ReactNode): React.ReactElement => <Box paddingLeft={2} paddingRight={2} width={width} marginLeft={left}>{node}</Box>;
  if (!state.input) {
    if (toast) {
      // 完成类消息用绿色，出错用红色，其余是普通提示色
      const tone = /^[✓✔]/u.test(toast) ? C.good : state.mutation.kind === "error" ? C.overdue : C.flash;
      return line(<Text wrap="truncate" color={tone}>{`› ${toast}`}</Text>);
    }
    const hint = state.mode.kind === "list"
      ? "清单区：j/k 移动 · d 完成 · l 详情 · 空格多选 · 打字即添加 · : 命令 · ? 帮助"
      : "输入区：Enter 提交 · Ctrl+V 切视图 · Esc 回清单";
    return line(<Text wrap="truncate"><Text color={C.accent}>› </Text><Text color={C.dimmer}>{hint}</Text></Text>);
  }
  if (state.input.startsWith(":") || state.input.startsWith("/")) {
    return line(<Text wrap="truncate"><Text color={C.accent}>› </Text><Text color={C.dim}>命令：list &lt;查询&gt; / undo / redo / history / graph / settings / skin &lt;皮肤&gt; / sync / mode levels|urgency / archive / cancel / meeting / todo / doing / pause / wait &lt;日期&gt; / snooze &lt;分钟&gt; / quit</Text></Text>);
  }
  return line(
    <Text wrap="truncate">
      <Text color={C.accent}>› </Text>
      {state.mode.kind === "edit" ? <Text color={C.yellow}>编辑中(回车保存,Esc取消) </Text> : null}
      <Text>{preview(state.input, nowLocal(), levels)}</Text>
    </Text>,
  );
};

/**
 * 输入框：像网页表单一样是一个带边框的框；聚焦时边框换主色，空着时显示「＋ 添加任务」占位。
 * 舒适密度下占 3 行（上下边框 + 一行文字），紧凑密度只留下边线，占 2 行。
 */
export const InputBar = ({ state, columns, compact }: { state: TuiState; columns: number | undefined; compact: boolean }): React.ReactElement => {
  const active = state.mode.kind !== "list";
  const chars = [...state.input];
  const cursor = Math.max(0, Math.min(chars.length, state.inputCursor));
  // 光标块：覆盖光标处字符；光标在末尾时覆盖一个空格
  const under = active ? (chars[cursor] ?? " ") : " ";
  const before = active ? chars.slice(0, cursor).join("") : state.input;
  const after = active ? chars.slice(cursor + 1).join("") : "";
  const border = compact
    ? { borderStyle: "single" as const, borderTop: false, borderLeft: false, borderRight: false }
    : { borderStyle: SKIN.border };
  return (
    <Box {...border} borderColor={active ? C.accent : C.border} paddingLeft={1} paddingRight={1} width={contentWidth(columns)} marginLeft={contentLeft(columns)}>
      <Text wrap="truncate">
        {!active && !state.input ? <Text color={C.dimmer}>{INPUT_PLACEHOLDER}</Text> : null}
        <Text>{before}</Text>
        {active ? <Text inverse bold>{under}</Text> : null}
        <Text>{after}</Text>
      </Text>
    </Box>
  );
};

/** 输入框占几行：舒适密度带完整边框 3 行，紧凑密度只有下边线 2 行 */
export const inputHeight = (compact: boolean): number => compact ? 2 : 3;

const FOOTER_KEYS = [
  { name: "help" as const, key: "?", label: "帮助" },
  { name: "input" as const, key: "i", label: "输入" },
  { name: "done" as const, key: "d", label: "完成" },
  { name: "settings" as const, key: ",", label: "设置" },
  { name: "quit" as const, key: "q", label: "退出" },
];
export type FooterButton = (typeof FOOTER_KEYS)[number]["name"];
// 按钮之间留的空白列数；空白不响应点击，免得点在两个按钮中间误触
const FOOTER_GAP = 2;
// 平面按钮 = 键帽 ` x `(3 列) + 标签 ` 帮助 `(标签宽 + 2 列)；立体按钮左右各多留一格，更像一颗真按钮
const buttonWidth = (label: string): number => 3 + displayWidth(label) + 2 + (raised() ? 2 : 0);
// 每个 Footer 按钮的屏幕列区间（1 起，只含按钮本体）。Box paddingLeft=1 占第 1 列。
export const footerKeyRanges = (): Array<{ name: FooterButton; start: number; end: number }> => {
  const ranges: Array<{ name: FooterButton; start: number; end: number }> = [];
  let column = 2; // paddingLeft 1 → 内容从第 2 列开始
  for (const entry of FOOTER_KEYS) {
    const width = buttonWidth(entry.label);
    ranges.push({ name: entry.name, start: column, end: column + width - 1 });
    column += width + FOOTER_GAP;
  }
  return ranges;
};

// 窗口太矮时立体按钮退回平面样式，把行数留给任务；由 app 每帧按终端高度设置
let tight = false;
export const setTightLayout = (value: boolean): void => { tight = value; };
const raised = (): boolean => SKIN.button.style === "raised" && !tight;

/** 底部按钮条占几行：平面按钮 1 行，立体按钮 3 行（上沿 / 按钮面 / 下沿投影） */
export const footerHeight = (): number => raised() ? 3 : 1;

/**
 * 底部按钮条。flat：键帽实底 + 标签浅一档底色拼成一块，按下时反色；鼠标悬停时标签底色提亮。
 * raised：三行同一块底色，顶行用 ▔ 画一道受光的亮边，底行用 ▁ 画一道背光的暗边，
 * 中间是居中的文字。按下时亮暗边对调、底色压暗，看起来就是按钮被按进去了。
 */
export const FooterBar = ({ pressed, hovered }: { pressed?: FooterButton | undefined; hovered?: FooterButton | undefined } = {}): React.ReactElement => {
  const look = SKIN.button;
  if (!raised()) {
    return (
      <Box paddingLeft={1} paddingRight={1}>
        <Text wrap="truncate">
          {FOOTER_KEYS.map((entry) => {
            const down = pressed === entry.name;
            const hover = !down && hovered === entry.name;
            return (
              <React.Fragment key={entry.name}>
                <Text bold color={down ? look.keyBg : look.keyFg} backgroundColor={down ? look.keyFg : look.keyBg}>{` ${entry.key} `}</Text>
                <Text bold color={down ? look.keyFg : look.labelFg} backgroundColor={down ? look.keyBg : hover ? look.highlight : look.labelBg}>{` ${entry.label} `}</Text>
                <Text>{" ".repeat(FOOTER_GAP)}</Text>
              </React.Fragment>
            );
          })}
        </Text>
      </Box>
    );
  }
  const row = (part: "top" | "face" | "bottom"): React.ReactElement => (
    <Text wrap="truncate">
      {FOOTER_KEYS.map((entry) => {
        const down = pressed === entry.name;
        const hover = !down && hovered === entry.name;
        const width = buttonWidth(entry.label);
        const face = down ? look.pressedBg : hover ? look.highlight : look.labelBg;
        const gap = " ".repeat(FOOTER_GAP);
        if (part !== "face") {
          const edge = part === "top" ? (down ? look.shadow : look.highlight) : (down ? look.highlight : look.shadow);
          return <React.Fragment key={entry.name}><Text color={edge} backgroundColor={face}>{(part === "top" ? "▔" : "▁").repeat(width)}</Text><Text>{gap}</Text></React.Fragment>;
        }
        return (
          <React.Fragment key={entry.name}>
            <Text bold color={look.keyBg} backgroundColor={face}>{`  ${entry.key} `}</Text>
            <Text bold color={down ? look.highlight : look.labelFg} backgroundColor={face}>{` ${entry.label}  `}</Text>
            <Text>{gap}</Text>
          </React.Fragment>
        );
      })}
    </Text>
  );
  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
      {row("top")}
      {row("face")}
      {row("bottom")}
    </Box>
  );
};
