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

describe("hover and pressed state", () => {
  it("tracks the hovered target and dedupes repeats", () => {
    const state = initialTuiState();
    expect(state.hover).toEqual({ kind: "none" });
    const onRow = tuiReducer(state, { type: "hover", target: { kind: "task", index: 3 } });
    expect(onRow.hover).toEqual({ kind: "task", index: 3 });
    // 悬浮每移动一格都会派发；同一目标必须返回同一对象，否则每次移动都白重渲染
    expect(tuiReducer(onRow, { type: "hover", target: { kind: "task", index: 3 } })).toBe(onRow);
    const onFooter = tuiReducer(onRow, { type: "hover", target: { kind: "footer", name: "done" } });
    expect(onFooter.hover).toEqual({ kind: "footer", name: "done" });
    expect(tuiReducer(onFooter, { type: "hover", target: { kind: "footer", name: "done" } })).toBe(onFooter);
    // 换按钮要认出来，不能被 kind 相同糊过去
    expect(tuiReducer(onFooter, { type: "hover", target: { kind: "footer", name: "quit" } }).hover)
      .toEqual({ kind: "footer", name: "quit" });
  });

  it("sets and clears the pressed footer button", () => {
    const state = initialTuiState();
    expect(state.pressedFooter).toBeUndefined();
    const pressed = tuiReducer(state, { type: "pressFooter", name: "help" });
    expect(pressed.pressedFooter).toBe("help");
    expect(tuiReducer(pressed, { type: "pressFooter" }).pressedFooter).toBeUndefined();
  });

  it("keeps hover purely visual: selection and marks stay put", () => {
    let state = initialTuiState();
    state = tuiReducer(state, { type: "select", index: 2 });
    state = tuiReducer(state, { type: "toggleMark", id: "abc" });
    const hovered = tuiReducer(state, { type: "hover", target: { kind: "task", index: 7 } });
    expect(hovered.selectedIndex).toBe(2);
    expect(hovered.marked).toEqual(["abc"]);
    expect(hovered.mode).toEqual(state.mode);
  });
});
