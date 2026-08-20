import { describe, expect, it } from "vitest";

import { mapKey, type KeyEvent } from "../src/tui/keymap.js";
import type { UiMode } from "../src/tui/state.js";

const press = (input: string, key: KeyEvent["key"] = {}): KeyEvent => ({ input, key });
const list: UiMode = { kind: "list" };
const add: UiMode = { kind: "add" };

// 快捷键契约来自 fixtures/tui-shortcuts.md（冻结迁移契约，勿随意改动预期）
describe("tui-shortcuts frozen contract", () => {
  it("navigation keys in list mode", () => {
    expect(mapKey(list, press("j"))).toEqual({ type: "move", delta: 1 });
    expect(mapKey(list, press("k"))).toEqual({ type: "move", delta: -1 });
    expect(mapKey(list, press("", { up: true }))).toEqual({ type: "move", delta: -1 });
    expect(mapKey(list, press("", { down: true }))).toEqual({ type: "move", delta: 1 });
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
    expect(mapKey(list, press("", { ctrl: true, name: "f" }))).toEqual({ type: "shortcut", name: "search" });
    expect(mapKey(list, press("/"))).toEqual({ type: "shortcut", name: "search" });
    expect(mapKey(list, press(":"))).toEqual({ type: "command", value: ":" });
    expect(mapKey(list, press("", { ctrl: true, name: "s" }))).toEqual({ type: "shortcut", name: "sync" });
    expect(mapKey(list, press("", { ctrl: true, name: "z" }))).toEqual({ type: "shortcut", name: "undo" });
    expect(mapKey(list, press("Q"))).toEqual({ type: "quit" });
    expect(mapKey(list, press("", { ctrl: true, name: "q" }))).toEqual({ type: "quit" });
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
    // 输入模式下 q 是普通文本（退出是大写 Q / Ctrl+Q，见契约）
    expect(mapKey(add, press("q"))).toEqual({ type: "text", value: "q" });
    // 大写 Q 在输入模式也是文本（退出只从清单区触发）
    expect(mapKey(add, press("Q"))).toEqual({ type: "text", value: "Q" });
  });

  it("type-to-add in list mode: non-shortcut characters jump into the input", () => {
    expect(mapKey(list, press("买"))).toEqual({ type: "text", value: "买" });
    expect(mapKey(list, press("z"))).toEqual({ type: "text", value: "z" });
    // 小写 q 在清单区也是打字（与 Python 版 QUICK 集一致；退出用大写 Q）
    expect(mapKey(list, press("q"))).toEqual({ type: "text", value: "q" });
  });

  it("submit and tab completion in input modes", () => {
    expect(mapKey(add, press("\r"))).toEqual({ type: "submit" });
    expect(mapKey(add, press("", { return: true }))).toEqual({ type: "submit" });
    expect(mapKey(add, press("\t"))).toEqual({ type: "complete" });
    expect(mapKey(add, press("", { tab: true }))).toEqual({ type: "complete" });
  });
});
