import type { UiMode } from "./state.js";

export type KeyEvent = { input: string; key: { name?: string; ctrl?: boolean; return?: boolean; escape?: boolean; tab?: boolean; up?: boolean; down?: boolean; f1?: boolean; backspace?: boolean } };
export type KeyAction =
  | { type: "text"; value: string }
  | { type: "backspace" }
  | { type: "submit" }
  | { type: "escape" }
  | { type: "quit" }
  | { type: "move"; delta: number }
  | { type: "first" }
  | { type: "last" }
  | { type: "complete" }
  | { type: "command"; value: string }
  | { type: "shortcut"; name: string };

export const mapKey = (mode: UiMode, event: KeyEvent): KeyAction | undefined => {
  const { input, key } = event;
  const is = (name: string, flag?: boolean): boolean => key.name === name || flag === true;
  if (mode.kind !== "list") {
    if (input === "\r" || input === "\n") return { type: "submit" };
    if (input === "\u001b") return { type: "escape" };
    if (input === "\t") return { type: "complete" };
    if (input === "\u007f") return { type: "backspace" };
    if (key.ctrl && key.name === "q") return { type: "quit" };
    if (is("escape", key.escape)) return { type: "escape" };
    if (is("return", key.return) || key.name === "enter") return { type: "submit" };
    if (is("tab", key.tab)) return { type: "complete" };
    if (is("backspace", key.backspace)) return { type: "backspace" };
    if (input) return { type: "text", value: input };
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
