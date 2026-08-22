export type UiMode =
  | { kind: "list" }
  | { kind: "add" }
  | { kind: "edit"; taskId: string }
  | { kind: "search" }
  | { kind: "command" }
  | { kind: "help" }
  | { kind: "welcome" }
  | { kind: "detail"; taskId: string }
  /** 不可撤销的操作先问一句；prompt 是问句，pending 是待执行动作的名字 */
  | { kind: "confirm"; prompt: string; pending: "delete" };

export type TuiState = {
  mode: UiMode;
  input: string;
  /** 输入框光标位置（字符索引，0..input.length） */
  inputCursor: number;
  query: string;
  selectedIndex: number;
  /** 多选打勾的任务 id；有勾时批量操作作用于它们，没有则作用于光标所在那条 */
  marked: string[];
  flashMessage?: string;
  sortMode: "levels" | "urgency";
  dateFormat: "auto" | "md" | "full";
  exitArmedAt?: number;
  mutation: MutationState;
  /** 鼠标悬停位置（纯视觉） */
  hover: HoverTarget;
  /** 正被按住的 Footer 按钮名，给「按下去」的反馈用 */
  pressedFooter?: string;
};

export type MutationState =
  | { kind: "idle" }
  | { kind: "running"; id: string }
  | { kind: "success"; id: string }
  | { kind: "error"; id: string; message: string };

/**
 * 鼠标当前悬停在哪。纯视觉状态，不参与任何业务判断。
 * - footer：悬停在底部某个按钮上（name 对应 footerKeyRanges）
 * - task：悬停在某个任务行上（index 与 selectedIndex 同一套编号）
 * pressed 记「按下但还没松手」的按钮，用来做按下去的反馈。
 */
export type HoverTarget =
  | { kind: "none" }
  | { kind: "footer"; name: string }
  | { kind: "task"; index: number };

export const initialTuiState = (sortMode: "levels" | "urgency" = "levels"): TuiState => ({ mode: { kind: "list" }, input: "", inputCursor: 0, query: "", selectedIndex: 0, marked: [], sortMode, dateFormat: "auto", mutation: { kind: "idle" }, hover: { kind: "none" } });

export type TuiAction =
  | { type: "mode"; mode: UiMode }
  | { type: "input"; value: string; cursor?: number }
  | { type: "cursorMove"; delta: number }
  | { type: "query"; value: string }
  | { type: "select"; index: number }
  | { type: "toggleMark"; id: string }
  | { type: "setMarks"; ids: string[] }
  | { type: "flash"; message?: string }
  | { type: "sort"; mode: "levels" | "urgency" }
  | { type: "dateFormat"; format: "auto" | "md" | "full" }
  | { type: "armExit"; at: number }
  | { type: "hover"; target: HoverTarget }
  | { type: "pressFooter"; name?: string }
  | { type: "mutationStart"; id: string }
  | { type: "mutationSuccess"; id: string }
  | { type: "mutationError"; id: string; message: string };

export const tuiReducer = (state: TuiState, action: TuiAction): TuiState => {
  switch (action.type) {
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
    case "select": return { ...state, selectedIndex: Math.max(0, action.index) };
    case "toggleMark": return { ...state, marked: state.marked.includes(action.id) ? state.marked.filter((id) => id !== action.id) : [...state.marked, action.id] };
    case "setMarks": return { ...state, marked: [...action.ids] };
    case "flash": { if (action.message === undefined) { const next = { ...state }; delete next.flashMessage; return next; } return { ...state, flashMessage: action.message }; }
    case "sort": return { ...state, sortMode: action.mode };
    case "dateFormat": return { ...state, dateFormat: action.format };
    case "armExit": return { ...state, exitArmedAt: action.at, flashMessage: "再按一次 Esc 退出（Q 也可）" };
    case "hover": {
      // 悬浮每移动一格都会触发，同一个目标就原样返回，避免无谓重渲染
      const current = state.hover;
      const same = current.kind === action.target.kind
        && (current.kind !== "footer" || current.name === (action.target as { name: string }).name)
        && (current.kind !== "task" || current.index === (action.target as { index: number }).index);
      return same ? state : { ...state, hover: action.target };
    }
    case "pressFooter": {
      if (action.name === undefined) { const next = { ...state }; delete next.pressedFooter; return next; }
      return { ...state, pressedFooter: action.name };
    }
    case "mutationStart": return { ...state, mutation: { kind: "running", id: action.id } };
    case "mutationSuccess": return { ...state, mutation: { kind: "success", id: action.id } };
    case "mutationError": return { ...state, mutation: { kind: "error", id: action.id, message: action.message }, flashMessage: action.message };
  }
};
