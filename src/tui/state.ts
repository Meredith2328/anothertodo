export type UiMode =
  | { kind: "list" }
  | { kind: "add" }
  | { kind: "edit"; taskId: string }
  | { kind: "search" }
  | { kind: "command" }
  | { kind: "help" };

export type TuiState = {
  mode: UiMode;
  input: string;
  query: string;
  selectedIndex: number;
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

export const initialTuiState = (sortMode: "levels" | "urgency" = "levels"): TuiState => ({ mode: { kind: "list" }, input: "", query: "", selectedIndex: 0, sortMode, dateFormat: "auto", mutation: { kind: "idle" } });

export type TuiAction =
  | { type: "mode"; mode: UiMode }
  | { type: "input"; value: string }
  | { type: "query"; value: string }
  | { type: "select"; index: number }
  | { type: "flash"; message?: string }
  | { type: "sort"; mode: "levels" | "urgency" }
  | { type: "dateFormat"; format: "auto" | "md" | "full" }
  | { type: "armExit"; at: number }
  | { type: "mutationStart"; id: string }
  | { type: "mutationSuccess"; id: string }
  | { type: "mutationError"; id: string; message: string };

export const tuiReducer = (state: TuiState, action: TuiAction): TuiState => {
  switch (action.type) {
    case "mode": { const next = { ...state, mode: action.mode, input: action.mode.kind === "list" ? "" : state.input }; delete next.exitArmedAt; return next; }
    case "input": return { ...state, input: action.value };
    case "query": return { ...state, query: action.value };
    case "select": return { ...state, selectedIndex: Math.max(0, action.index) };
    case "flash": { if (action.message === undefined) { const next = { ...state }; delete next.flashMessage; return next; } return { ...state, flashMessage: action.message }; }
    case "sort": return { ...state, sortMode: action.mode };
    case "dateFormat": return { ...state, dateFormat: action.format };
    case "armExit": return { ...state, exitArmedAt: action.at, flashMessage: "再次按 Esc 退出" };
    case "mutationStart": return { ...state, mutation: { kind: "running", id: action.id } };
    case "mutationSuccess": return { ...state, mutation: { kind: "success", id: action.id } };
    case "mutationError": return { ...state, mutation: { kind: "error", id: action.id, message: action.message }, flashMessage: action.message };
  }
};
