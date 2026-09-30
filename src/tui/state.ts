export type UiMode =
  | { kind: "list" }
  | { kind: "add" }
  | { kind: "edit"; taskId: string }
  | { kind: "search" }
  | { kind: "command" }
  | { kind: "help" }
  | { kind: "welcome" }
  | { kind: "detail"; taskId: string }
  /** 依赖图页：整屏画出任务之间的前置关系 */
  | { kind: "graph" }
  /** 设置页：上下选一项，左右 / 回车改值，改完立即写回 config.toml */
  | { kind: "settings" }
  /** 不可撤销的操作先问一句；prompt 是问句，pending 是待执行动作的名字 */
  | { kind: "confirm"; prompt: string; pending: "delete" }
  /** 后续任务选择列表：给 taskId 勾选「它做完之后才露出来」的任务 */
  | { kind: "deps"; taskId: string }
  /** 操作历史：列出最近几步，选一步回退到那之前 */
  | { kind: "history" };

import type { AgendaView } from "../core/views.js";

export type TuiState = {
  view: AgendaView;
  showUnscheduled: boolean;
  mode: UiMode;
  input: string;
  /** 输入框光标位置（字符索引，0..input.length） */
  inputCursor: number;
  query: string;
  /** Tab 切出来的项目页；undefined 是「全部」 */
  project?: string;
  selectedIndex: number;
  /** 多选打勾的任务 id；有勾时批量操作作用于它们，没有则作用于光标所在那条 */
  marked: string[];
  flashMessage?: string;
  sortMode: "levels" | "urgency";
  dateFormat: "auto" | "md" | "full";
  exitArmedAt?: number;
  mutation: MutationState;
};

export type MutationState =
  | { kind: "idle" }
  | { kind: "running"; id: string }
  | { kind: "success"; id: string }
  | { kind: "error"; id: string; message: string };

export const initialTuiState = (sortMode: "levels" | "urgency" = "levels"): TuiState => ({ view: "all", showUnscheduled: false, mode: { kind: "list" }, input: "", inputCursor: 0, query: "", selectedIndex: 0, marked: [], sortMode, dateFormat: "auto", mutation: { kind: "idle" } });

export type TuiAction =
  | { type: "view"; view: AgendaView; showUnscheduled?: boolean }
  | { type: "mode"; mode: UiMode }
  | { type: "input"; value: string; cursor?: number }
  | { type: "cursorMove"; delta: number }
  | { type: "query"; value: string }
  | { type: "project"; value: string | undefined }
  | { type: "select"; index: number }
  | { type: "toggleMark"; id: string }
  | { type: "setMarks"; ids: string[] }
  | { type: "flash"; message?: string }
  | { type: "sort"; mode: "levels" | "urgency" }
  | { type: "dateFormat"; format: "auto" | "md" | "full" }
  | { type: "armExit"; at: number }
  | { type: "mutationStart"; id: string }
  | { type: "mutationSuccess"; id: string }
  | { type: "mutationError"; id: string; message: string };

export const tuiReducer = (state: TuiState, action: TuiAction): TuiState => {
  switch (action.type) {
    case "view": return { ...state, view: action.view, showUnscheduled: action.showUnscheduled ?? state.showUnscheduled };
    case "mode": {
      // detail/confirm 是覆盖在清单之上的浮层，进出时不该清掉正在编辑的输入
      const keepsInput = action.mode.kind !== "list";
      const next = { ...state, mode: action.mode, input: keepsInput ? state.input : "", inputCursor: keepsInput ? state.inputCursor : 0 };
      delete next.exitArmedAt;
      return next;
    }
    case "input": {
      const cursor = action.cursor === undefined ? [...action.value].length : Math.max(0, Math.min([...action.value].length, action.cursor));
      return { ...state, input: action.value, inputCursor: cursor };
    }
    case "cursorMove": {
      const length = [...state.input].length;
      return { ...state, inputCursor: Math.max(0, Math.min(length, state.inputCursor + action.delta)) };
    }
    case "query": return { ...state, query: action.value };
    case "project": { const next = { ...state, selectedIndex: 0 }; if (action.value === undefined) delete next.project; else next.project = action.value; return next; }
    case "select": return { ...state, selectedIndex: Math.max(0, action.index) };
    case "toggleMark": return { ...state, marked: state.marked.includes(action.id) ? state.marked.filter((id) => id !== action.id) : [...state.marked, action.id] };
    case "setMarks": return { ...state, marked: [...action.ids] };
    case "flash": { if (action.message === undefined) { const next = { ...state }; delete next.flashMessage; return next; } return { ...state, flashMessage: action.message }; }
    case "sort": return { ...state, sortMode: action.mode };
    case "dateFormat": return { ...state, dateFormat: action.format };
    case "armExit": return { ...state, exitArmedAt: action.at, flashMessage: "再按一次 Esc 退出（q 也可）" };
    case "mutationStart": return { ...state, mutation: { kind: "running", id: action.id } };
    case "mutationSuccess": return { ...state, mutation: { kind: "success", id: action.id } };
    case "mutationError": return { ...state, mutation: { kind: "error", id: action.id, message: action.message }, flashMessage: action.message };
  }
};
