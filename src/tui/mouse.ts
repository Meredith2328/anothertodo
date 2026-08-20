// Ink 没有鼠标支持（上游 issue 多年未做）。这里给 Ink 套一层 stdin 代理：
// 启用终端 SGR 鼠标跟踪（\x1b[?1000h\x1b[?1006h），把鼠标转义序列从数据流里
// 剥出来分发给应用，其余数据按原 chunk 边界转发给 Ink，按键解析不受影响。
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import type { ReadableOptions } from "node:stream";

export type MouseKind = "press" | "release" | "wheel-up" | "wheel-down";
export type MouseEvent = { kind: MouseKind; button: number; x: number; y: number };

const ESC = "\x1b";
const PREFIX = "\x1b[<";

const isDigit = (char: string): boolean => char >= "0" && char <= "9";

// 尾部可能是被截断的鼠标序列前缀（\x1b[、\x1b[<、\x1b[<12;3 …），先扣留。
// 注意：单独的 \x1b（Esc 键）必须立即放行，否则每次按 Esc 都会被扣到下一次
// 按键才送出，表现为“要按两下 Esc 才生效”。终端实际都把转义序列作为单个
// chunk 送达，序列恰好断在 \x1b 之后的情况不存在，这里以 \x1b[ 为最小前缀。
const partialTail = (text: string): string => {
  const start = text.lastIndexOf(ESC);
  if (start < 0) return "";
  const tail = text.slice(start);
  if (!tail.startsWith(`${ESC}[`)) return "";
  for (let index = 2; index < tail.length; index += 1) {
    const char = tail[index] ?? "";
    if (!isDigit(char) && char !== ";" && char !== "<") return "";
  }
  return tail;
};

// 手写解析 SGR 鼠标序列 \x1b[<code;x;yM|m（不用正则，逐字符扫描）
const parseMouseSequence = (sequence: string): MouseEvent | undefined => {
  if (!sequence.startsWith(PREFIX)) return undefined;
  const end = sequence.length - 1;
  const flag = sequence[end];
  if (flag !== "M" && flag !== "m") return undefined;
  const parts: number[] = [];
  let current = -1;
  for (let index = PREFIX.length; index < end; index += 1) {
    const char = sequence[index] ?? "";
    if (isDigit(char)) current = current < 0 ? Number(char) : current * 10 + Number(char);
    else if (char === ";" && current >= 0) { parts.push(current); current = -1; }
    else return undefined;
  }
  // 完整形态：code;x;y → parts = [code, x]，current = y
  if (current < 0 || parts.length !== 2) return undefined;
  const code = parts[0] ?? 0;
  const button = code & 3;
  if (code & 64) {
    return { kind: code & 1 ? "wheel-down" : "wheel-up", button, x: parts[1] ?? 0, y: current };
  }
  return { kind: flag === "M" ? "press" : "release", button, x: parts[1] ?? 0, y: current };
};

// 在 buffer 头部找完整的鼠标序列，返回 [序列, 剩余]；没有完整序列返回 undefined
const takeSequence = (buffer: string): { sequence: string; rest: string } | undefined => {
  if (!buffer.startsWith(PREFIX)) return undefined;
  for (let index = PREFIX.length; index < buffer.length; index += 1) {
    const char = buffer[index] ?? "";
    if (char === "M" || char === "m") {
      return { sequence: buffer.slice(0, index + 1), rest: buffer.slice(index + 1) };
    }
    if (!isDigit(char) && char !== ";") return undefined;
  }
  return undefined;
};

// 把一段数据拆成「转发给 Ink 的普通数据」和「鼠标事件」。跨 chunk 截断的
// 序列通过 pending 状态拼接；pending 只保留可能是序列前缀的尾部。
export const splitMouseData = (
  data: string,
  pending: string,
): { chunks: string[]; events: MouseEvent[]; pending: string } => {
  let buffer = pending + data;
  const chunks: string[] = [];
  const events: MouseEvent[] = [];
  let rest = "";
  while (buffer.length > 0) {
    const index = buffer.indexOf(PREFIX);
    if (index < 0) {
      const tail = partialTail(buffer);
      if (tail) chunks.push(buffer.slice(0, buffer.length - tail.length));
      else chunks.push(buffer);
      rest = tail;
      break;
    }
    if (index > 0) chunks.push(buffer.slice(0, index));
    buffer = buffer.slice(index);
    const taken = takeSequence(buffer);
    if (!taken) {
      // 序列未到齐；尾部超出合理长度就当普通数据放行，防止扣死
      if (buffer.length > 32) { chunks.push(buffer); rest = ""; }
      else rest = buffer;
      break;
    }
    const event = parseMouseSequence(taken.sequence);
    if (event) events.push(event);
    buffer = taken.rest;
  }
  return { chunks, events, pending: rest };
};

// Ink 需要的 stdin 接口：isTTY / setEncoding / ref / unref / setRawMode / readable+read。
// 原始数据由桥接层从真实 stdin 读出、滤掉鼠标后 push 进来。
class ProxyStdin extends Readable {
  readonly isTTY: boolean;
  private readonly source: NodeJS.ReadStream & { fd: number };

  constructor(source: NodeJS.ReadStream & { fd: number }, options?: ReadableOptions) {
    super({ ...options, encoding: "utf8" });
    this.source = source;
    this.isTTY = source.isTTY ?? false;
  }

  override _read(_size: number): void {
    // 数据只由桥接层 push；读空即可
  }

  ref(): this { this.source.ref(); return this; }
  unref(): this { this.source.unref(); return this; }
  setRawMode(mode: boolean): this { this.source.setRawMode(mode); return this; }
}

export type MouseBridge = {
  /** 传给 Ink render 的替代 stdin（已滤除鼠标序列） */
  stream: ProxyStdin;
  /** 订阅鼠标事件；返回退订函数 */
  subscribe(listener: (event: MouseEvent) => void): () => void;
  enable(): void;
  disable(): void;
};

// 模块级总线：TuiApp 直接订阅，createMouseBridge 把事件转发进来（测试环境
// 可直接 emit 模拟鼠标，不依赖真实终端）
const bus = new EventEmitter();
export const emitMouse = (event: MouseEvent): void => { bus.emit("mouse", event); };
export const subscribeMouse = (listener: (event: MouseEvent) => void): (() => void) => {
  bus.on("mouse", listener);
  return () => { bus.removeListener("mouse", listener); };
};

export const createMouseBridge = (stdin: NodeJS.ReadStream & { fd: number }, stdout: NodeJS.WriteStream): MouseBridge => {
  const stream = new ProxyStdin(stdin);
  const events = new EventEmitter();
  let pending = "";
  let enabled = false;

  const onReadable = (): void => {
    let chunk: string | null;
    while ((chunk = stdin.read()) !== null) {
      const { chunks, events: parsed, pending: next } = splitMouseData(chunk, pending);
      pending = next;
      for (const part of chunks) if (part) stream.push(part);
      for (const event of parsed) events.emit("mouse", event);
    }
  };

  const enable = (): void => {
    if (enabled) return;
    enabled = true;
    stdin.setEncoding("utf8");
    stdin.pause();
    stdin.addListener("readable", onReadable);
    stdin.resume();
    // 1000 = 点击/释放 + 滚轮；1006 = SGR 扩展编码（Windows Terminal / xterm 通用）
    stdout.write("\x1b[?1000h\x1b[?1006h");
  };

  const disable = (): void => {
    if (!enabled) return;
    enabled = false;
    stdout.write("\x1b[?1000l\x1b[?1006l");
    stdin.removeListener("readable", onReadable);
  };

  return {
    stream,
    subscribe(listener) {
      const relay = (event: MouseEvent): void => { bus.emit("mouse", event); };
      events.on("mouse", listener);
      events.on("mouse", relay);
      return () => { events.removeListener("mouse", listener); events.removeListener("mouse", relay); };
    },
    enable,
    disable,
  };
};
