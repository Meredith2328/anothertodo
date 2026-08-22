import { describe, expect, it } from "vitest";

import { mapKey, type KeyEvent } from "../src/tui/keymap.js";
import type { UiMode } from "../src/tui/state.js";

// Ink 的 useInput 传给回调的 key 只含布尔字段（没有 name/up/down/f1），
// Ctrl+字母 通过 input（小写字母）+ key.ctrl 标识，方向键用 upArrow/downArrow。
// 这里的 key 必须按真实 Ink 形状构造，否则会掩盖 Ctrl+Z/S/F、↑/↓ 匹配不上的缺陷。
const press = (input: string, key: KeyEvent["key"] = {}): KeyEvent => ({ input, key });
const list: UiMode = { kind: "list" };
const add: UiMode = { kind: "add" };

// 快捷键契约来自 fixtures/tui-shortcuts.md（冻结迁移契约，勿随意改动预期）
describe("tui-shortcuts frozen contract", () => {
  it("navigation keys in list mode", () => {
    expect(mapKey(list, press("j"))).toEqual({ type: "move", delta: 1 });
    expect(mapKey(list, press("k"))).toEqual({ type: "move", delta: -1 });
    expect(mapKey(list, press("", { upArrow: true }))).toEqual({ type: "move", delta: -1 });
    expect(mapKey(list, press("", { downArrow: true }))).toEqual({ type: "move", delta: 1 });
    expect(mapKey(list, press("g"))).toEqual({ type: "first" });
    expect(mapKey(list, press("G"))).toEqual({ type: "last" });
    expect(mapKey(list, press("\r"))).toEqual({ type: "shortcut", name: "enter" });
  });

  it("mutation and view shortcuts in list mode", () => {
    for (const [key, name] of [["d", "d"], ["x", "x"], ["e", "e"], ["w", "w"], ["u", "u"], ["r", "r"], ["1", "1"], ["2", "2"], ["t", "t"], ["i", "i"]] as const) {
      expect(mapKey(list, press(key))).toEqual({ type: "shortcut", name });
    }
  });

  it("help / search / command / exit keys in list mode", () => {
    expect(mapKey(list, press("?"))).toEqual({ type: "shortcut", name: "help" });
    expect(mapKey(list, press("", { f1: true }))).toEqual({ type: "shortcut", name: "help" });
    expect(mapKey(list, press("f", { ctrl: true }))).toEqual({ type: "shortcut", name: "search" });
    expect(mapKey(list, press("/"))).toEqual({ type: "shortcut", name: "search" });
    expect(mapKey(list, press(":"))).toEqual({ type: "command", value: ":" });
    expect(mapKey(list, press("s", { ctrl: true }))).toEqual({ type: "shortcut", name: "sync" });
    expect(mapKey(list, press("z", { ctrl: true }))).toEqual({ type: "shortcut", name: "undo" });
    expect(mapKey(list, press("q"))).toEqual({ type: "quit" });
    expect(mapKey(list, press("Q"))).toEqual({ type: "quit" });
    expect(mapKey(list, press("q", { ctrl: true }))).toEqual({ type: "quit" });
  });

  it("esc arms exit in list mode and returns to list from input modes", () => {
    expect(mapKey(list, press("\u001b"))).toEqual({ type: "escape" });
    expect(mapKey(list, press("", { escape: true }))).toEqual({ type: "escape" });
    expect(mapKey(add, press("\u001b"))).toEqual({ type: "escape" });
  });

  it("backspace works for both \\b and \\x7f (Windows Terminal sends \\x7f)", () => {
    expect(mapKey(add, press("\b"))).toEqual({ type: "backspace" });
    expect(mapKey(add, press("\x7f"))).toEqual({ type: "backspace" });
    expect(mapKey(add, press("", { backspace: true }))).toEqual({ type: "backspace" });
    expect(mapKey(add, press("", { delete: true }))).toEqual({ type: "backspace" });
  });

  it("cursor movement in input modes", () => {
    expect(mapKey(add, press("", { leftArrow: true }))).toEqual({ type: "cursorLeft" });
    expect(mapKey(add, press("", { rightArrow: true }))).toEqual({ type: "cursorRight" });
  });

  it("ordinary characters are text in input modes (d/x/e/u must not trigger shortcuts)", () => {
    expect(mapKey(add, press("d"))).toEqual({ type: "text", value: "d" });
    expect(mapKey(add, press("x"))).toEqual({ type: "text", value: "x" });
    expect(mapKey(add, press("e"))).toEqual({ type: "text", value: "e" });
    expect(mapKey(add, press("u"))).toEqual({ type: "text", value: "u" });
    expect(mapKey(add, press("买牛奶"))).toEqual({ type: "text", value: "买牛奶" });
    // 输入模式下 q 是普通文本（退出只在清单区触发，见契约）
    expect(mapKey(add, press("q"))).toEqual({ type: "text", value: "q" });
    // 大写 Q 在输入模式也是文本（退出只从清单区触发）
    expect(mapKey(add, press("Q"))).toEqual({ type: "text", value: "Q" });
  });

  it("type-to-add in list mode: non-shortcut characters jump into the input", () => {
    expect(mapKey(list, press("买"))).toEqual({ type: "text", value: "买" });
    expect(mapKey(list, press("z"))).toEqual({ type: "text", value: "z" });
    // 小写 q 在清单区是退出（Footer 标签就是「q 退出」）；打 q 开头的标题先按 i
    expect(mapKey(list, press("q"))).toEqual({ type: "quit" });
  });

  it("submit and tab completion in input modes", () => {
    expect(mapKey(add, press("\r"))).toEqual({ type: "submit" });
    expect(mapKey(add, press("", { return: true }))).toEqual({ type: "submit" });
    expect(mapKey(add, press("\t"))).toEqual({ type: "complete" });
    expect(mapKey(add, press("", { tab: true }))).toEqual({ type: "complete" });
  });
});

describe("keys added after the frozen contract", () => {
  it("pages with PgUp / PgDn", () => {
    expect(mapKey(list, press("", { pageUp: true }))).toEqual({ type: "page", delta: -1 });
    expect(mapKey(list, press("", { pageDown: true }))).toEqual({ type: "page", delta: 1 });
  });

  it("marks with space and select-all with Ctrl+A", () => {
    expect(mapKey(list, press(" "))).toEqual({ type: "shortcut", name: "mark" });
    expect(mapKey(list, press("a", { ctrl: true }))).toEqual({ type: "shortcut", name: "markAll" });
    // 输入区里空格还是空格，不能变成多选
    expect(mapKey(add, press(" "))).toEqual({ type: "text", value: " " });
  });

  it("opens the detail view with l or right arrow", () => {
    expect(mapKey(list, press("l"))).toEqual({ type: "shortcut", name: "v" });
    expect(mapKey(list, press("", { rightArrow: true }))).toEqual({ type: "shortcut", name: "v" });
    expect(mapKey(list, press("v"))).toEqual({ type: "shortcut", name: "v" });
  });

  it("maps the new status and reminder shortcuts", () => {
    for (const [key, name] of [["c", "c"], ["o", "o"], ["s", "s"]] as const) {
      expect(mapKey(list, press(key))).toEqual({ type: "shortcut", name });
      // 输入区里它们必须还是普通文本
      expect(mapKey(add, press(key))).toEqual({ type: "text", value: key });
    }
  });

  it("only accepts yes or cancel inside a confirm dialog", () => {
    const confirm: UiMode = { kind: "confirm", prompt: "删除？", pending: "delete" };
    expect(mapKey(confirm, press("y"))).toEqual({ type: "confirmYes" });
    expect(mapKey(confirm, press("Y"))).toEqual({ type: "confirmYes" });
    expect(mapKey(confirm, press("\r"))).toEqual({ type: "confirmYes" });
    // 任何别的键都当取消，不能把误触当成确认
    expect(mapKey(confirm, press("d"))).toEqual({ type: "escape" });
    expect(mapKey(confirm, press("n"))).toEqual({ type: "escape" });
    expect(mapKey(confirm, press("", { escape: true }))).toEqual({ type: "escape" });
  });

  it("lets the detail view scroll and edit, and closes on anything else", () => {
    const detail: UiMode = { kind: "detail", taskId: "abc" };
    expect(mapKey(detail, press("j"))).toEqual({ type: "move", delta: 1 });
    expect(mapKey(detail, press("k"))).toEqual({ type: "move", delta: -1 });
    expect(mapKey(detail, press("e"))).toEqual({ type: "shortcut", name: "e" });
    expect(mapKey(detail, press("", { escape: true }))).toEqual({ type: "escape" });
    expect(mapKey(detail, press("z"))).toEqual({ type: "escape" });
  });
});
