// 界面外壳：横幅、右上信息栏、预览行、输入框、底部 Footer。
// 这些都是纯展示组件，状态由 app.tsx 传进来。
import React from "react";
import { Box, Text } from "ink";

import type { Task } from "../contracts.js";
import { preview } from "../core/parse.js";
import { ACTIVE_STATES, isOverdue, localDate, localNow } from "../core/task.js";
import { displayWidth } from "../core/width.js";
import type { TuiState } from "./state.js";
import {
  BANNER_COLORS, BANNER_FULL, BANNER_SMALL, C, INPUT_PLACEHOLDER, MODE_LABEL, SKIN,
} from "./theme.js";

const nowLocal = localNow;

/**
 * 横幅按窗口大小选：宽且高用大字，窄用两行小字，矮到放不下任务时干脆不画。
 * 返回的是实际可见的行（BANNER_FULL 末尾的空串 Ink 不渲染，这里直接去掉），
 * 布局计算和鼠标行号都以它为准。
 */
export const bannerLines = (columns: number | undefined, rows: number | undefined): readonly string[] => {
  if (rows !== undefined && rows < 18) return [];
  if (columns !== undefined && columns < 72) return columns < 46 ? [] : BANNER_SMALL;
  if (rows !== undefined && rows < 26) return BANNER_SMALL;
  return BANNER_FULL.filter(Boolean);
};

export const Banner = ({ columns, rows }: { columns: number | undefined; rows: number | undefined }): React.ReactElement | null => {
  const lines = bannerLines(columns, rows);
  if (!lines.length) return null;
  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
      {lines.map((line, index) => (
        <Text key={index} wrap="truncate" color={BANNER_COLORS[index % BANNER_COLORS.length] ?? C.hot}>{line}</Text>
      ))}
    </Box>
  );
};

export const BannerInfo = ({ query, sortMode, tasks, clock, marked = 0 }: {
  query: string;
  sortMode: "levels" | "urgency";
  tasks: Task[];
  clock: Date;
  marked?: number;
}): React.ReactElement => {
  const today = nowLocal().slice(0, 10);
  const overdue = tasks.filter((task) => isOverdue(task, today)).length;
  const dueToday = tasks.filter((task) => (task.status === "todo" || task.status === "meeting") && task.due !== undefined && localDate(task.due) === today).length;
  const active = tasks.filter((task) => ACTIVE_STATES.has(task.status)).length;
  const hhmm = `${String(clock.getHours()).padStart(2, "0")}:${String(clock.getMinutes()).padStart(2, "0")}`;
  return (
    <Box justifyContent="flex-end" paddingLeft={1} paddingRight={1}>
      <Text wrap="truncate">
        {marked ? <Text bold color={C.hot}>{`◉${marked} `}</Text> : null}
        {query ? <Text color={C.dim}>过滤 </Text> : null}
        {query ? <Text color={C.yellow}>{query}</Text> : null}
        {query ? <Text color={C.dim}>{"   "}</Text> : null}
        <Text color={C.accent}>{`${MODE_LABEL[sortMode]}排序`}</Text>
        <Text color={C.dim}>{"   "}</Text>
        <Text bold color={C.overdue}>{`!${overdue}`}</Text>
        <Text color={C.dim}>{"  "}</Text>
        <Text color={C.accent}>●</Text>
        <Text bold color={C.accent}>{String(dueToday)}</Text>
        <Text color={C.dim}>{"  "}</Text>
        <Text color={C.dim}>∑</Text>
        <Text bold color={C.accent}>{String(active)}</Text>
        <Text color={C.dim}>{`   ${hhmm}`}</Text>
      </Text>
    </Box>
  );
};

export const PreviewLine = ({ state, levels }: { state: TuiState; levels: string[] }): React.ReactElement => {
  if (!state.input) {
    if (state.flashMessage) {
      // 完成类消息用绿色，出错用红色，其余是普通提示色
      const tone = /^[✓✔]/u.test(state.flashMessage) ? C.good : state.mutation.kind === "error" ? C.overdue : C.flash;
      return <Text wrap="truncate" color={tone}>{`› ${state.flashMessage}`}</Text>;
    }
    const hint = state.mode.kind === "list"
      ? "清单区：j/k 移动 · d 完成 · l 详情 · 空格多选 · 打字即添加 · : 命令"
      : "输入区：Enter 提交 · Esc 回清单";
    return <Text wrap="truncate"><Text color={C.accent}>› </Text><Text color={C.dimmer}>{hint}</Text></Text>;
  }
  if (state.input.startsWith(":") || state.input.startsWith("/")) {
    return <Text wrap="truncate"><Text color={C.accent}>› </Text><Text color={C.dim}>命令：list &lt;查询&gt; / undo / redo / graph / settings / skin &lt;皮肤&gt; / sync / mode levels|urgency / archive / cancel / meeting / todo / doing / pause / wait &lt;日期&gt; / snooze &lt;分钟&gt; / quit</Text></Text>;
  }
  return (
    <Text wrap="truncate">
      <Text color={C.accent}>› </Text>
      {state.mode.kind === "edit" ? <Text color={C.yellow}>编辑中(回车保存,Esc取消) </Text> : null}
      <Text>{preview(state.input, nowLocal(), levels)}</Text>
    </Text>
  );
};

export const InputBar = ({ state }: { state: TuiState }): React.ReactElement => {
  const active = state.mode.kind !== "list";
  const chars = [...state.input];
  const cursor = Math.max(0, Math.min(chars.length, state.inputCursor));
  // 光标块：覆盖光标处字符；光标在末尾时覆盖一个空格
  const under = active ? (chars[cursor] ?? " ") : " ";
  const before = active ? chars.slice(0, cursor).join("") : state.input;
  const after = active ? chars.slice(cursor + 1).join("") : "";
  return (
    <Box
      borderStyle="single"
      borderTop={false}
      borderLeft={false}
      borderRight={false}
      borderColor={active ? C.accent : C.border}
      paddingLeft={1}
      paddingRight={1}
    >
      <Text wrap="truncate">
        {!active && !state.input ? <Text color={C.dimmer}>{INPUT_PLACEHOLDER}</Text> : null}
        <Text>{before}</Text>
        {active ? <Text inverse bold>{under}</Text> : null}
        <Text>{after}</Text>
      </Text>
    </Box>
  );
};

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
 * 底部按钮条。flat：键帽实底 + 标签浅一档底色拼成一块，按下时反色。
 * raised：用半格方块画出一个有厚度的按钮——上沿是受光的亮边（▄），
 * 下沿是背光的暗边（▀），右侧再落一列投影；按下时亮暗边互换、投影消失、
 * 按钮面变暗，看起来就是被按进去了。
 */
export const FooterBar = ({ pressed }: { pressed?: FooterButton | undefined } = {}): React.ReactElement => {
  const look = SKIN.button;
  if (!raised()) {
    return (
      <Box paddingLeft={1} paddingRight={1}>
        <Text wrap="truncate">
          {FOOTER_KEYS.map((entry) => {
            const down = pressed === entry.name;
            return (
              <React.Fragment key={entry.name}>
                <Text bold color={down ? look.keyBg : look.keyFg} backgroundColor={down ? look.keyFg : look.keyBg}>{` ${entry.key} `}</Text>
                <Text bold color={down ? look.keyFg : look.labelFg} backgroundColor={down ? look.keyBg : look.labelBg}>{` ${entry.label} `}</Text>
                <Text>{" ".repeat(FOOTER_GAP)}</Text>
              </React.Fragment>
            );
          })}
        </Text>
      </Box>
    );
  }
  // 立体按钮参照 Textual 的 Button：三行同一块底色，顶行用 ▔ 画一道受光的亮边，
  // 底行用 ▁ 画一道背光的暗边，中间是居中的文字。按下时亮暗边对调、底色压暗，
  // 看起来就是按钮被按进去了。
  const row = (part: "top" | "face" | "bottom"): React.ReactElement => (
    <Text wrap="truncate">
      {FOOTER_KEYS.map((entry) => {
        const down = pressed === entry.name;
        const width = buttonWidth(entry.label);
        const face = down ? look.pressedBg : look.labelBg;
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
