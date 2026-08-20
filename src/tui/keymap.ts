import type { UiMode } from "./state.js";

export type KeyEvent = {
  input: string;
  key: {
    name?: string;
    ctrl?: boolean;
    return?: boolean;
    escape?: boolean;
    tab?: boolean;
    up?: boolean;
    down?: boolean;
    leftArrow?: boolean;
    rightArrow?: boolean;
    f1?: boolean;
    backspace?: boolean;
    delete?: boolean;
  };
};
export type KeyAction =
  | { type: "text"; value: string }
  | { type: "backspace" }
  | { type: "cursorLeft" }
  | { type: "cursorRight" }
  | { type: "submit" }
  | { type: "escape" }
  | { type: "quit" }
  | { type: "move"; delta: number }
  | { type: "first" }
  | { type: "last" }
  | { type: "complete" }
  | { type: "command"; value: string }
  | { type: "shortcut"; name: string };

// Ink 的 parseKeypress 把 \b 命名为 backspace、\x7f 命名为 delete，
// 但两个键在主流终端上的语义都是「退格」（Windows Terminal 退格发 \x7f，
// macOS delete 键也发 \x7f），所以统一映射为 backspace。
const isBackspace = (input: string, key: KeyEvent["key"]): boolean =>
  input === "\b" || input === "\x7f" || key.backspace === true || key.delete === true;

export const mapKey = (mode: UiMode, event: KeyEvent): KeyAction | undefined => {
  const { input, key } = event;
  const is = (name: string, flag?: boolean): boolean => key.name === name || flag === true;
  if (mode.kind !== "list") {
    if (input === "\r" || input === "\n") return { type: "submit" };
    if (input === "\u001b") return { type: "escape" };
    if (input === "\t") return { type: "complete" };
    if (isBackspace(input, key)) return { type: "backspace" };
    if (key.leftArrow === true) return { type: "cursorLeft" };
    if (key.rightArrow === true) return { type: "cursorRight" };
    if (key.ctrl && key.name === "q") return { type: "quit" };
    if (is("escape", key.escape)) return { type: "escape" };
    if (is("return", key.return) || key.name === "enter") return { type: "submit" };
    if (is("tab", key.tab)) return { type: "complete" };
    if (is("backspace", key.backspace) || is("delete", key.delete)) return { type: "backspace" };
    // 控制字符（\x01-\x1a 之外 Ink 已处理；这里拦掉剩余控制符）不进输入
    if (input && input > "\u001f") return { type: "text", value: input };
    if (input && input !== "\x7f" && input <= "\u001a" && !key.ctrl) return { type: "text", value: input };
    return undefined;
  }
  if (input === "\r" || input === "\n") return { type: "shortcut", name: "enter" };
  if (input === "\u001b") return { type: "escape" };
  if (key.ctrl && (key.name === "q" || key.name === "c")) return { type: "quit" };
  if (key.ctrl && key.name === "z") return { type: "shortcut", name: "undo" };
  if (key.ctrl && key.name === "s") return { type: "shortcut", name: "sync" };
  if (input === "Q") return { type: "quit" };
  if (is("escape", key.escape)) return { type: "escape" };
  if (is("up", key.up) || input === "k") return { type: "move", delta: -1 };
  if (is("down", key.down) || input === "j") return { type: "move", delta: 1 };
  if (input === "g") return { type: "first" };
  if (input === "G") return { type: "last" };
  if (is("return", key.return) || key.name === "enter") return { type: "shortcut", name: "enter" };
  if (input === "/" || (key.ctrl && key.name === "f")) return { type: "shortcut", name: "search" };
  if (input === ":") return { type: "command", value: ":" };
  if (input === "?") return { type: "shortcut", name: "help" };
  if (is("f1", key.f1)) return { type: "shortcut", name: "help" };
  if (input && "dxewur12ti".includes(input)) return { type: "shortcut", name: input };
  if (input) return { type: "text", value: input };
  return undefined;
};
