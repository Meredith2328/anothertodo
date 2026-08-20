import { describe, expect, it } from "vitest";

import { mapKey } from "../src/tui/keymap.js";
import { initialTuiState, tuiReducer } from "../src/tui/state.js";

describe("stage 7 TUI state and key boundaries", () => {
  it("keeps mutation characters as text outside list mode", () => {
    for (const input of ["d", "x", "e", "u"]) expect(mapKey({ kind: "add" }, { input, key: {} })).toEqual({ type: "text", value: input });
    expect(mapKey({ kind: "list" }, { input: "d", key: {} })).toEqual({ type: "shortcut", name: "d" });
  });

  it("keeps navigation and mode transitions reducer-driven", () => {
    const state = initialTuiState();
    const input = tuiReducer(state, { type: "mode", mode: { kind: "add" } });
    expect(input.mode.kind).toBe("add");
    expect(tuiReducer(input, { type: "input", value: "文字 d" }).input).toBe("文字 d");
    expect(tuiReducer(input, { type: "mode", mode: { kind: "list" } }).input).toBe("");
  });

  it("restricts Tab to input modes", () => {
    expect(mapKey({ kind: "list" }, { input: "", key: { tab: true } })).toBeUndefined();
    expect(mapKey({ kind: "add" }, { input: "", key: { tab: true } })).toEqual({ type: "complete" });
  });
});
