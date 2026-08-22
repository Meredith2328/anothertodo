import type { UiMode } from "./state.js";

export type KeyEvent = {
  input: string;
  // Ink 的 useInput 传给回调的 key 只含布尔字段，没有 name/up/down/f1；
  // Ctrl+字母 通过 input（小写字母）+ key.ctrl 区分，方向键用 upArrow/downArrow 等。
  key: {
    name?: string;
    ctrl?: boolean;
    shift?: boolean;
    meta?: boolean;
    return?: boolean;
    escape?: boolean;
    tab?: boolean;
    upArrow?: boolean;
    downArrow?: boolean;
    leftArrow?: boolean;
    rightArrow?: boolean;
    pageDown?: boolean;
    pageUp?: boolean;
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
  | { type: "page"; delta: number }
  | { type: "first" }
  | { type: "last" }
  | { type: "complete" }
  | { type: "confirmYes" }
  | { type: "command"; value: string }
  | { type: "shortcut"; name: string };

/** 清单区被快捷键占掉的字母；打这些字母开头的标题要先按 i 进输入区 */
const LIST_SHORTCUT_LETTERS = "dxewur12tivsoc";

// Ink 的 parseKeypress 把 \b 命名为 backspace、\x7f 命名为 delete，
// 但两个键在主流终端上的语义都是「退格」（Windows Terminal 退格发 \x7f，
// macOS delete 键也发 \x7f），所以统一映射为 backspace。
const isBackspace = (input: string, key: KeyEvent["key"]): boolean =>
  input === "\b" || input === "\x7f" || key.backspace === true || key.delete === true;

export const mapKey = (mode: UiMode, event: KeyEvent): KeyAction | undefined => {
  const { input, key } = event;
  const is = (name: string, flag?: boolean): boolean => key.name === name || flag === true;
  // 确认框只认「是 / 否」，误触别的键不该悄悄放过或误删
  if (mode.kind === "confirm") {
    if (input === "y" || input === "Y" || is("return", key.return) || input === "\r" || input === "\n") return { type: "confirmYes" };
    if (key.ctrl && (input === "q" || input === "c")) return { type: "quit" };
    return { type: "escape" };
  }
  // 详情浮层：上下翻看任务，其余键退回清单
  if (mode.kind === "detail") {
    if (key.upArrow === true || input === "k") return { type: "move", delta: -1 };
    if (key.downArrow === true || input === "j") return { type: "move", delta: 1 };
    if (key.ctrl && (input === "q" || input === "c")) return { type: "quit" };
    if (input === "e") return { type: "shortcut", name: "e" };
    return { type: "escape" };
  }
  if (mode.kind !== "list") {
    if (input === "\r" || input === "\n") return { type: "submit" };
    if (input === "\u001b") return { type: "escape" };
    if (input === "\t") return { type: "complete" };
    if (isBackspace(input, key)) return { type: "backspace" };
    if (key.leftArrow === true) return { type: "cursorLeft" };
    if (key.rightArrow === true) return { type: "cursorRight" };
    if (key.ctrl && input === "q") return { type: "quit" };
    if (is("escape", key.escape)) return { type: "escape" };
    if (is("return", key.return) || key.name === "enter") return { type: "submit" };
    if (is("tab", key.tab)) return { type: "complete" };
    if (is("backspace", key.backspace) || is("delete", key.delete)) return { type: "backspace" };
    // Ctrl+字母 由 key.ctrl + input（小写字母）标识，其余组合键不进输入
    if (key.ctrl) return undefined;
    // 控制字符（\x01-\x1a 之外 Ink 已处理；这里拦掉剩余控制符）不进输入
    if (input && input > "\u001f") return { type: "text", value: input };
    if (input && input !== "\x7f" && input <= "\u001a") return { type: "text", value: input };
    return undefined;
  }
  if (input === "\r" || input === "\n") return { type: "shortcut", name: "enter" };
  if (input === "\u001b") return { type: "escape" };
  // Ctrl 组合键：Ink 的 key 无 name 字段，字母经 input（小写）+ key.ctrl 标识
  if (key.ctrl) {
    if (input === "q" || input === "c") return { type: "quit" };
    if (input === "z") return { type: "shortcut", name: "undo" };
    if (input === "s") return { type: "shortcut", name: "sync" };
    if (input === "f") return { type: "shortcut", name: "search" };
    if (input === "a") return { type: "shortcut", name: "markAll" };
    return undefined;
  }
  // q/Q 都退出（Footer 上就是「q 退出」；打 q 开头的标题先按 i 进输入区）
  if (input === "q" || input === "Q") return { type: "quit" };
  if (is("escape", key.escape)) return { type: "escape" };
  if (key.pageUp === true) return { type: "page", delta: -1 };
  if (key.pageDown === true) return { type: "page", delta: 1 };
  if (key.upArrow === true || input === "k") return { type: "move", delta: -1 };
  if (key.downArrow === true || input === "j") return { type: "move", delta: 1 };
  // 空格打勾多选：标题不会以空格开头，占用它不影响「打字即添加」
  if (input === " ") return { type: "shortcut", name: "mark" };
  // → 和 l 看详情，← 关掉详情，和 vim 的层级移动直觉一致
  if (key.rightArrow === true || input === "l") return { type: "shortcut", name: "v" };
  if (input === "g") return { type: "first" };
  if (input === "G") return { type: "last" };
  if (is("return", key.return) || key.name === "enter") return { type: "shortcut", name: "enter" };
  if (input === "/") return { type: "shortcut", name: "search" };
  if (input === ":") return { type: "command", value: ":" };
  if (input === "?") return { type: "shortcut", name: "help" };
  if (key.f1 === true) return { type: "shortcut", name: "help" };
  if (input && LIST_SHORTCUT_LETTERS.includes(input)) return { type: "shortcut", name: input };
  if (input) return { type: "text", value: input };
  return undefined;
};
