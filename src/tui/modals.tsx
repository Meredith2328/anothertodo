// 四个浮层：帮助、上手引导、任务详情、删除确认。
//
// Ink 从上往下渲染，没有「垂直居中」布局，所以 ModalPage 按终端剩余高度在
// 弹窗上方垫空行。整帧必须严格等于终端行数（ModalShell 的 height:rows +
// 底部 Footer）——一旦溢出，矮终端里整帧上卷，上一帧的残留会留在屏幕顶部。
import React from "react";
import { Box, Text } from "ink";

import type { Task } from "../contracts.js";
import { t } from "../core/i18n.js";
import { describeRecur } from "../core/parse.js";
import { truncateWithEllipsis } from "../core/width.js";
import { FooterBar } from "./chrome.js";
import {
  C, COMPACT_HELP_LINES, COMPACT_HELP_ROWS, FULL_HELP_LINES, HELP_SECTIONS, WELCOME_ROWS,
} from "./theme.js";

export const ModalShell = ({ rows, children }: {
  rows?: number | undefined;
  children: React.ReactNode;
}): React.ReactElement => (
  <Box flexDirection="column" {...(rows !== undefined ? { height: rows } : {})}>
    <Box flexDirection="column" flexGrow={1}>{children}</Box>
    <FooterBar />
  </Box>
);

const ModalPage = ({ rows, contentLines, children }: {
  rows?: number | undefined;
  contentLines: number;
  children: React.ReactNode;
}): React.ReactElement => {
  // 减 1 给 ModalShell 底部的 Footer 行
  const pad = rows === undefined ? 0 : Math.max(0, Math.floor((rows - 1 - contentLines) / 2));
  return (
    <Box flexDirection="column">
      {Array.from({ length: pad }, (_, index) => <Text key={index}> </Text>)}
      {children}
    </Box>
  );
};

const HelpRows = ({ entries, keysWidth }: {
  entries: ReadonlyArray<readonly [string, string]>;
  keysWidth: number;
}): React.ReactElement => (
  <>
    {entries.map(([keys, description], index) => (
      <Box key={`${index}-${keys}`} flexDirection="row">
        <Box width={keysWidth}><Text color={C.accent}>{keys}</Text></Box>
        <Box flexGrow={1} flexShrink={1}><Text>{description}</Text></Box>
      </Box>
    ))}
  </>
);

export const HelpModal = ({ rows }: { rows?: number | undefined }): React.ReactElement => {
  // 终端放得下完整版（留 2 行余量）就用完整版；矮终端自动切紧凑版，
  // 保证弹窗永远完整可见。高度未知（测试/管道）时保持完整版。
  const full = rows === undefined || rows >= FULL_HELP_LINES + 2;
  return (
    <ModalPage rows={rows} contentLines={full ? FULL_HELP_LINES : COMPACT_HELP_LINES}>
      <Box flexDirection="column" alignItems="center">
        <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingLeft={2} paddingRight={2}>
          <Text><Text bold color={C.accent}>atd 帮助</Text><Text color={C.dim}>   （按任意键关闭）</Text></Text>
          {full ? HELP_SECTIONS.map(([section, entries]) => (
            <React.Fragment key={section}>
              <Text bold color={C.warn}>{section}</Text>
              <HelpRows entries={entries} keysWidth={34} />
            </React.Fragment>
          )) : <HelpRows entries={COMPACT_HELP_ROWS} keysWidth={10} />}
        </Box>
      </Box>
    </ModalPage>
  );
};

const WELCOME_LINES = 3 + WELCOME_ROWS.length;

export const WelcomeModal = ({ rows }: { rows?: number | undefined }): React.ReactElement => (
  <ModalPage rows={rows} contentLines={WELCOME_LINES}>
    <Box flexDirection="column" alignItems="center">
      <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingLeft={2} paddingRight={2}>
        <Text><Text bold color={C.accent}>👋 atd 上手三分钟</Text><Text color={C.dim}>   （按任意键开始）</Text></Text>
        <HelpRows entries={WELCOME_ROWS} keysWidth={34} />
      </Box>
    </Box>
  </ModalPage>
);

const DetailRow = ({ label, value }: { label: string; value: string }): React.ReactElement => (
  <Box flexDirection="row">
    <Box width={10}><Text color={C.dim}>{label}</Text></Box>
    <Box flexGrow={1} flexShrink={1}><Text wrap="wrap">{value}</Text></Box>
  </Box>
);

/** notes 一直只存不显示；详情浮层就是给它一个真正能看到的地方 */
export const DetailModal = ({ task, children: subtasks, parent, rows, columns }: {
  task: Task;
  children: Task[];
  parent: Task | undefined;
  rows?: number | undefined;
  columns?: number | undefined;
}): React.ReactElement => {
  const noteLines = task.notes.trim() ? task.notes.split(/\r?\n/) : [];
  const fields: Array<[string, string]> = [
    [t("field.status"), task.status],
    [t("field.due"), task.due ? task.due.replace("T", " ").slice(0, 16) : t("value.none")],
    [t("field.priority"), task.priority ?? t("value.none")],
    [t("field.project"), task.project ?? t("value.none")],
    [t("field.tags"), task.tags.length ? task.tags.map((tag) => `#${tag}`).join(" ") : t("value.none")],
    [t("field.wait"), task.wait ?? t("value.none")],
    [t("field.recur"), task.recur ? describeRecur(task.recur) : t("value.none")],
  ];
  if (parent) fields.push([t("field.parent"), `${parent.id} ${parent.title}`]);
  if (subtasks.length) fields.push([t("field.subtasks"), subtasks.map((child) => `${child.status === "done" ? "✓" : "·"} ${child.title}`).join("  ")]);
  fields.push([t("field.entry"), task.entry.replace("T", " ").slice(0, 16)]);
  if (task.end) fields.push([t("field.end"), task.end.replace("T", " ").slice(0, 16)]);
  const reminderLines = task.reminders.map((reminder) => `${reminder.at.replace("T", " ")}  ${reminder.hooks.join(",")}  ${reminder.dead ? t("reminder.dead") : reminder.fired ? t("reminder.sent") : t("reminder.pending")}`);
  const contentLines = 4 + fields.length + (reminderLines.length ? reminderLines.length + 1 : 0) + (noteLines.length ? noteLines.length + 1 : 0);
  const width = Math.min(Math.max(40, (columns ?? 80) - 8), 100);
  return (
    <ModalPage rows={rows} contentLines={contentLines}>
      <Box flexDirection="column" alignItems="center">
        <Box flexDirection="column" borderStyle="round" borderColor={C.accent} paddingLeft={2} paddingRight={2} width={width}>
          <Text><Text bold color={C.accent}>{truncateWithEllipsis(task.title, width - 16)}</Text><Text color={C.dimmer}>{`  ${task.id}`}</Text></Text>
          {fields.map(([label, value]) => <DetailRow key={label} label={label} value={value} />)}
          {reminderLines.length ? <Text bold color={C.warn}>{t("field.reminders")}</Text> : null}
          {reminderLines.map((line) => <Text key={line} color={C.yellow}>{`  ${line}`}</Text>)}
          {noteLines.length ? <Text bold color={C.warn}>{t("field.notes")}</Text> : null}
          {noteLines.map((line, index) => <Text key={`${index}-${line}`} wrap="wrap">{`  ${line}`}</Text>)}
          <Text color={C.dim}>j/k 看上下一条 · e 编辑 · 其他键关闭</Text>
        </Box>
      </Box>
    </ModalPage>
  );
};

export const ConfirmModal = ({ prompt, rows }: { prompt: string; rows?: number | undefined }): React.ReactElement => (
  <ModalPage rows={rows} contentLines={4}>
    <Box flexDirection="column" alignItems="center">
      <Box flexDirection="column" borderStyle="round" borderColor={C.overdue} paddingLeft={2} paddingRight={2}>
        <Text bold color={C.overdue}>请确认</Text>
        <Text wrap="wrap">{prompt}</Text>
        <Text color={C.dim}>y 或 Enter 确认 · 其他任意键取消</Text>
      </Box>
    </Box>
  </ModalPage>
);
