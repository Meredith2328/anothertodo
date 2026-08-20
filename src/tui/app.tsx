import React, { useCallback, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { randomUUID } from "node:crypto";
import { Box, Text, useApp, useInput } from "ink";

import { ApplicationService } from "../app/service.js";
import { groups, renderLine } from "../core/agenda.js";
import type { Config, Task } from "../contracts.js";
import { preview } from "../core/parse.js";
import { localNow } from "../core/task.js";
import { taskToInput } from "../core/task-ops.js";
import { Store } from "../storage/store.js";
import { initialTuiState, tuiReducer } from "./state.js";
import { mapKey } from "./keymap.js";

export type TuiTestSignals = {
  onReady?: () => void;
  onDataReady?: () => void;
  onActionComplete?: (sequence: number) => void;
  onMutationComplete?: (state: { kind: "success" | "error"; id: string; message?: string }) => void;
};
export type TuiProps = { store: Store; testSignals?: TuiTestSignals };
const nowLocal = localNow;
const flatten = (items: ReturnType<typeof groups>): Task[] => items.flatMap((group) => group.tasks);
const completeInput = (input: string, tasks: Task[]): string => {
  const tag = /#([^\s#]*)$/u.exec(input);
  if (tag) {
    const prefix = tag[1] ?? "";
    const candidate = [...new Set(tasks.flatMap((task) => task.tags))].find((value) => value.startsWith(prefix));
    if (candidate) return `${input.slice(0, tag.index)}#${candidate} `;
  }
  const project = /(?:proj|project):([^\s:]*)$/u.exec(input);
  if (project) {
    const prefix = project[1] ?? "";
    const candidate = [...new Set(tasks.map((task) => task.project).filter((value): value is string => Boolean(value)))].find((value) => value.startsWith(prefix));
    if (candidate) return `${input.slice(0, project.index)}proj:${candidate} `;
  }
  return input;
};

export const TuiApp = ({ store, testSignals }: TuiProps): React.ReactElement => {
  const { exit } = useApp();
  const service = useMemo(() => new ApplicationService(store), [store]);
  const [config, setConfig] = useState<Config>();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [dataRevision, setDataRevision] = useState(0);
  const [state, dispatch] = useReducer(tuiReducer, undefined, () => initialTuiState());
  const [actionSequence, setActionSequence] = useState(0);
  const visibleGroups = useMemo(() => config ? groups(tasks, config, state.sortMode, nowLocal(), state.query).filter((group) => group.tasks.length > 0) : [], [config, state.query, state.sortMode, tasks]);
  const visible = useMemo(() => flatten(visibleGroups), [visibleGroups]);
  const selected = visible[state.selectedIndex];
  const stateRef = useRef(state);
  const configRef = useRef(config);
  const selectedRef = useRef(selected);
  stateRef.current = state;
  configRef.current = config;
  selectedRef.current = selected;

  const refresh = useCallback(async () => {
    const nextConfig = await service.config();
    const nextTasks = await service.tasks();
    setConfig(nextConfig);
    setTasks(nextTasks);
    setDataRevision((revision) => revision + 1);
  }, [service]);
  useEffect(() => { void refresh().catch((error: unknown) => dispatch({ type: "flash", message: error instanceof Error ? error.message : String(error) })); }, [refresh]);
  useEffect(() => { const timer = setInterval(() => { void refresh().catch((error: unknown) => dispatch({ type: "flash", message: error instanceof Error ? error.message : String(error) })); }, 30_000); return () => clearInterval(timer); }, [refresh]);
  useEffect(() => { testSignals?.onReady?.(); }, [testSignals]);
  useEffect(() => { if (dataRevision > 0) testSignals?.onDataReady?.(); }, [dataRevision, testSignals]);
  useEffect(() => { if (actionSequence > 0) testSignals?.onActionComplete?.(actionSequence); }, [actionSequence, testSignals]);
  useEffect(() => { if (state.mutation.kind === "success" || state.mutation.kind === "error") testSignals?.onMutationComplete?.(state.mutation); }, [state.mutation, testSignals]);
  useEffect(() => { if (visible.length > 0 && state.selectedIndex >= visible.length) dispatch({ type: "select", index: visible.length - 1 }); }, [state.selectedIndex, visible.length]);

  const submit = useCallback(async () => {
    const currentState = stateRef.current;
    const currentConfig = configRef.current;
    const currentSelected = selectedRef.current;
    if (!currentConfig) return;
    const mutationId = randomUUID();
    dispatch({ type: "mutationStart", id: mutationId });
    try {
      if (currentState.mode.kind === "add") {
        await service.add(currentState.input, nowLocal());
      } else if (currentState.mode.kind === "edit" && currentSelected) {
        await service.edit(currentSelected.id, currentState.input, nowLocal());
      } else if (currentState.mode.kind === "search") dispatch({ type: "query", value: currentState.input.replace(/^\//u, "") });
      else if (currentState.mode.kind === "command") {
        const command = currentState.input.replace(/^:/u, "").trim();
        if (command === "undo") dispatch({ type: "flash", message: await service.undo() });
        else if (command === "sync") dispatch({ type: "flash", message: await service.sync() });
        else if (command === "mode urgency") dispatch({ type: "sort", mode: "urgency" });
        else if (command === "mode levels") dispatch({ type: "sort", mode: "levels" });
        else if (command === "list") dispatch({ type: "query", value: "" });
        else if (command.startsWith("list ")) dispatch({ type: "query", value: command.slice(5) });
        else if (command.startsWith("archive")) { const days = command.split(/\s+/u)[1]; dispatch({ type: "flash", message: `归档了 ${await service.archive(days ? Number(days) : 14)} 行` }); }
        else if (command === "quit") { exit(); return; }
        else dispatch({ type: "flash", message: `未知命令：${command}` });
      }
      dispatch({ type: "mode", mode: { kind: "list" } });
      dispatch({ type: "input", value: "" });
      await refresh();
      dispatch({ type: "mutationSuccess", id: mutationId });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dispatch({ type: "mutationError", id: mutationId, message });
    }
  }, [exit, refresh, service]);

  const runMutation = useCallback((operation: () => Promise<unknown>): void => {
    const mutationId = randomUUID();
    dispatch({ type: "mutationStart", id: mutationId });
    void (async () => {
      try {
        const result = await operation();
        if (typeof result === "string") dispatch({ type: "flash", message: result });
        await refresh();
        dispatch({ type: "mutationSuccess", id: mutationId });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        dispatch({ type: "mutationError", id: mutationId, message });
      }
    })();
  }, [refresh]);

  useInput((input, key) => {
    const currentState = stateRef.current;
    const currentSelected = selectedRef.current;
    const action = mapKey(currentState.mode, { input, key });
    if (!action) return;
    setActionSequence((sequence) => sequence + 1);
    if (action.type === "quit") { exit(); return; }
    if (action.type === "text") { dispatch({ type: "mode", mode: { kind: "add" } }); dispatch({ type: "input", value: currentState.mode.kind === "list" ? action.value : currentState.input + action.value }); return; }
    if (action.type === "backspace") { dispatch({ type: "input", value: currentState.input.slice(0, -1) }); return; }
    if (action.type === "complete") { dispatch({ type: "input", value: completeInput(currentState.input, tasks) }); return; }
    if (action.type === "submit") { void submit(); return; }
    if (action.type === "escape") { if (currentState.mode.kind === "list") { if (currentState.exitArmedAt && Date.now() - currentState.exitArmedAt < 1000) { exit(); return; } dispatch({ type: "armExit", at: Date.now() }); } else { dispatch({ type: "mode", mode: { kind: "list" } }); dispatch({ type: "input", value: "" }); } return; }
    if (action.type === "move") { dispatch({ type: "select", index: currentState.selectedIndex + action.delta }); return; }
    if (action.type === "first") { dispatch({ type: "select", index: 0 }); return; }
    if (action.type === "last") { dispatch({ type: "select", index: Math.max(0, visible.length - 1) }); return; }
    if (action.type === "command") { dispatch({ type: "mode", mode: { kind: "command" } }); dispatch({ type: "input", value: action.value }); return; }
    if (action.type === "shortcut") {
      if (action.name === "search") { dispatch({ type: "mode", mode: { kind: "search" } }); dispatch({ type: "input", value: "/" }); return; }
      if (action.name === "help") { dispatch({ type: "mode", mode: { kind: "help" } }); return; }
      if (action.name === "1") { dispatch({ type: "sort", mode: "levels" }); return; }
      if (action.name === "2") { dispatch({ type: "sort", mode: "urgency" }); return; }
      if (action.name === "r") { runMutation(() => refresh()); return; }
      if (action.name === "t") { dispatch({ type: "dateFormat", format: currentState.dateFormat === "auto" ? "md" : currentState.dateFormat === "md" ? "full" : "auto" }); return; }
      if (action.name === "undo") { runMutation(() => service.undo()); return; }
      if (action.name === "sync") { runMutation(() => service.sync()); return; }
      if (action.name === "i") { dispatch({ type: "mode", mode: { kind: "add" } }); return; }
      if (action.name === "e" && currentSelected) { dispatch({ type: "mode", mode: { kind: "edit", taskId: currentSelected.id } }); dispatch({ type: "input", value: taskToInput(currentSelected) }); return; }
      if (action.name === "d" && currentSelected) { runMutation(() => service.setStatus(currentSelected.id, "done")); return; }
      if (action.name === "w" && currentSelected) { runMutation(() => service.deferUntilTomorrow(currentSelected.id)); return; }
      if (action.name === "x" && currentSelected) { runMutation(() => service.remove(currentSelected.id)); return; }
      if (action.name === "u") { runMutation(() => service.undo()); return; }
      if (action.name === "enter" && currentSelected) { runMutation(() => service.setStatus(currentSelected.id, currentSelected.status === "done" ? "todo" : "done")); }
    }
  });

  if (state.mode.kind === "help") return <Box flexDirection="column"><Text>atd 快捷键</Text><Text>j/k/↑/↓ 移动，g/G 首尾，Enter 完成/重开</Text><Text>i 添加，e 编辑，d 完成，w 等待到明天，x 删除，u/Ctrl+Z 撤销</Text><Text>1/2 排序，t 日期格式，r 刷新，Tab 标签/项目补全</Text><Text>/ 或 Ctrl+F 搜索，: 命令，Ctrl+S 同步，? / F1 帮助</Text><Text>Esc 取消/双击退出，Q/Ctrl+Q 退出</Text></Box>;
  const displayConfig = config ? { ...config, agenda: { ...config.agenda, date_format: state.dateFormat } } : undefined;
  const mutationLabel = state.mutation.kind === "running" ? "mutation:running" : state.mutation.kind === "success" ? "mutation:success" : state.mutation.kind === "error" ? "mutation:error" : "";
  return <Box flexDirection="column"><Text bold>atd — anothertodo ({state.sortMode})</Text>{visible.length === 0 ? <Text dimColor>（没有任务）</Text> : visibleGroups.map((group) => <React.Fragment key={group.name}><Text dimColor>== {group.name} ({group.tasks.length}) ==</Text>{group.tasks.map((task) => { const index = visible.findIndex((item) => item.id === task.id); return <Text key={task.id} inverse={index === state.selectedIndex}>{index === state.selectedIndex ? "❯ " : "  "}{displayConfig ? renderLine(task, displayConfig, nowLocal().slice(0, 10), state.sortMode, nowLocal()) : task.title}</Text>; })}</React.Fragment>)}{(state.mode.kind === "add" || state.mode.kind === "edit") && config ? <Text color="cyan">{preview(state.input, nowLocal(), [...config.priority.levels])}</Text> : null}<Text color="yellow">{state.flashMessage ?? ""}</Text><Text dimColor>{mutationLabel}</Text><Text>{state.mode.kind === "list" ? "输入 i 添加，? 帮助，Q 退出" : `${state.mode.kind}> ${state.input}`}</Text></Box>;
};
