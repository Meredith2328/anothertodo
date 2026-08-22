// 界面外壳：横幅、右上信息栏、预览行、输入框、底部 Footer。
// 这些都是纯展示组件，状态由 app.tsx 传进来。
import React from "react";
import { Box, Text } from "ink";

import type { Task } from "../contracts.js";
import { preview } from "../core/parse.js";
import { isOverdue, localDate, localNow } from "../core/task.js";
import { displayWidth } from "../core/width.js";
import type { TuiState } from "./state.js";
import {
  BANNER_COLORS, BANNER_FULL, BANNER_SMALL, C, INPUT_PLACEHOLDER, MODE_LABEL,
} from "./theme.js";

const nowLocal = localNow;

export const Banner = ({ columns }: { columns: number | undefined }): React.ReactElement => {
  const lines = columns === undefined || columns >= 72 ? BANNER_FULL : BANNER_SMALL;
  return (
    <Box flexDirection="column" paddingLeft={1} paddingRight={1}>
      {lines.map((line, index) => (
        <Text key={index} color={BANNER_COLORS[index % BANNER_COLORS.length] ?? C.hot}>{line}</Text>
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
  const active = tasks.filter((task) => task.status === "todo" || task.status === "waiting" || task.status === "meeting").length;
  const hhmm = `${String(clock.getHours()).padStart(2, "0")}:${String(clock.getMinutes()).padStart(2, "0")}`;
  return (
    <Box justifyContent="flex-end" paddingLeft={1} paddingRight={1}>
      <Text>
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
    if (state.flashMessage) return <Text color={C.flash}>{`› ${state.flashMessage}`}</Text>;
    const hint = state.mode.kind === "list"
      ? "清单区：j/k 移动 · d 完成 · l 详情 · 空格多选 · 打字即添加 · : 命令"
      : "输入区：Enter 提交 · Esc 回清单";
    return <Text><Text color={C.accent}>› </Text><Text color={C.dimmer}>{hint}</Text></Text>;
  }
  if (state.input.startsWith(":") || state.input.startsWith("/")) {
    return <Text><Text color={C.accent}>› </Text><Text color={C.dim}>命令：list &lt;查询&gt; / undo / sync / mode levels|urgency / archive / cancel / meeting / todo / wait &lt;日期&gt; / snooze &lt;分钟&gt; / quit</Text></Text>;
  }
  return (
    <Text>
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
      <Text>
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
  { name: "quit" as const, key: "q", label: "退出" },
];
// 每个 Footer 键的屏幕列区间（1 起，含键帽与标签）。布局：Box paddingLeft=1
// 占第 1 列；每项 = 键帽 ` x `(3 列) + 空格(1) + 标签(width 列) + 3 空格。
export const footerKeyRanges = (): Array<{ name: "help" | "input" | "done" | "quit"; start: number; end: number }> => {
  const ranges: Array<{ name: "help" | "input" | "done" | "quit"; start: number; end: number }> = [];
  let column = 2; // paddingLeft 1 → 内容从第 2 列开始
  for (const entry of FOOTER_KEYS) {
    const entryWidth = 3 + 1 + displayWidth(entry.label) + 3;
    ranges.push({ name: entry.name, start: column, end: column + entryWidth - 1 });
    column += entryWidth;
  }
  return ranges;
};

export const FooterBar = (): React.ReactElement => (
  <Box paddingLeft={1} paddingRight={1}>
    <Text>
      {FOOTER_KEYS.map((entry) => (
        <React.Fragment key={entry.name}>
          <Text bold color="black" backgroundColor={C.dim}>{` ${entry.key} `}</Text>
          <Text color={C.dim}>{` ${entry.label}   `}</Text>
        </React.Fragment>
      ))}
    </Text>
  </Box>
);
