import { describe, expect, it } from "vitest";
import { PassThrough } from "node:stream";

import { footerKeyRanges } from "../src/tui/app.js";
import { createMouseBridge, splitMouseData, subscribeMouse, type MouseEvent } from "../src/tui/mouse.js";

describe("footer key hit ranges", () => {
  it("lays out the four buttons contiguously from column 2", () => {
    const ranges = footerKeyRanges();
    expect(ranges.map((range) => range.name)).toEqual(["help", "input", "done", "quit"]);
    expect(ranges[0]?.start).toBe(2);
    for (let index = 1; index < ranges.length; index += 1) {
      expect(ranges[index]?.start).toBe((ranges[index - 1]?.end ?? 0) + 1);
    }
  });

  it("covers representative click points (key cap and label tail)", () => {
    const ranges = footerKeyRanges();
    const hitAt = (x: number): string | undefined => ranges.find((range) => x >= range.start && x <= range.end)?.name;
    expect(hitAt(2)).toBe("help"); // ? 键帽
    expect(hitAt(12)).toBe("help"); // 帮助 标签尾（两个全角字宽 4 列）
    expect(hitAt(13)).toBe("input");
    expect(hitAt(24)).toBe("done");
    expect(hitAt(35)).toBe("quit"); // q 键帽
    expect(hitAt(45)).toBe("quit"); // 退出 标签尾
    expect(hitAt(46)).toBeUndefined();
  });
});

describe("mouse SGR sequence parsing", () => {
  it("extracts a press event and forwards the rest", () => {
    const result = splitMouseData("a\x1b[<0;10;5Mb", "");
    expect(result.events).toEqual([{ kind: "press", button: 0, x: 10, y: 5 }]);
    expect(result.chunks).toEqual(["a", "b"]);
    expect(result.pending).toBe("");
  });

  it("extracts release (m suffix) and wheel events (64 flag)", () => {
    expect(splitMouseData("\x1b[<0;3;4m", "").events).toEqual([{ kind: "release", button: 0, x: 3, y: 4 }]);
    // 64 = 滚轮标志；64|1 = 向下滚，64 = 向上滚
    expect(splitMouseData("\x1b[<64;1;1M", "").events).toEqual([{ kind: "wheel-up", button: 0, x: 1, y: 1 }]);
    expect(splitMouseData("\x1b[<65;1;1M", "").events).toEqual([{ kind: "wheel-down", button: 1, x: 1, y: 1 }]);
  });

  it("reassembles sequences split across chunks", () => {
    const first = splitMouseData("x\x1b[<0;12", "");
    expect(first.chunks).toEqual(["x"]);
    expect(first.pending).toBe("\x1b[<0;12");
    const second = splitMouseData(";6M", first.pending);
    expect(second.events).toEqual([{ kind: "press", button: 0, x: 12, y: 6 }]);
    expect(second.chunks).toEqual([]);
  });

  it("forwards a lone escape key immediately (single-Esc semantics)", () => {
    // Esc 键就是单独的 \x1b；扣留它会导致“要按两下 Esc”
    const esc = splitMouseData("\x1b", "");
    expect(esc.chunks).toEqual(["\x1b"]);
    expect(esc.pending).toBe("");
    // Alt 组合（\x1b + 字符）也作为整体放行
    const alt = splitMouseData("q", "\x1b");
    expect(alt.chunks).toEqual(["\x1bq"]);
    expect(alt.pending).toBe("");
  });

  it("passes through non-mouse escapes untouched", () => {
    expect(splitMouseData("\x1bOAj", "").chunks).toEqual(["\x1bOAj"]);
    expect(splitMouseData("\x1b[B", "").chunks).toEqual(["\x1b[B"]);
  });
});

// 这一组必须走真实桥接层，不能用 emitMouse。TuiApp 通过 subscribeMouse（模块
// 总线）收事件，而桥接层曾经只在调用方调了 bridge.subscribe() 时才把事件中继
// 到总线——cli.ts 从没调过，于是真实终端里点击、滚轮全都没反应，而所有测试都
// 直接 emitMouse 打总线，一路绿灯没暴露。这里从「写入 stdin 的字节」验到
// 「TuiApp 侧收到事件」，把整条链路钉住。
describe("mouse bridge end-to-end (no emitMouse shortcut)", () => {
  const makeBridge = () => {
    const stdin = new PassThrough() as unknown as NodeJS.ReadStream & { fd: number };
    Object.assign(stdin, {
      isTTY: true,
      setRawMode: () => stdin,
      ref: () => stdin,
      unref: () => stdin,
    });
    const written: string[] = [];
    const stdout = { write: (value: string) => { written.push(value); return true; } } as unknown as NodeJS.WriteStream;
    return { stdin, stdout, written, bridge: createMouseBridge(stdin, stdout) };
  };

  it("delivers a real SGR click to subscribeMouse listeners", async () => {
    const { stdin, bridge } = makeBridge();
    const seen: MouseEvent[] = [];
    const stop = subscribeMouse((event) => seen.push(event));
    bridge.enable();
    // Footer 上点 "? 帮助" 键帽
    stdin.write("\x1b[<0;6;24M");
    await new Promise((resolve) => setTimeout(resolve, 20));
    bridge.disable();
    stop();
    expect(seen).toEqual([{ kind: "press", button: 0, x: 6, y: 24 }]);
  });

  it("delivers wheel events and keeps normal keys flowing to Ink", async () => {
    const { stdin, bridge } = makeBridge();
    const seen: MouseEvent[] = [];
    const stop = subscribeMouse((event) => seen.push(event));
    const forwarded: string[] = [];
    bridge.stream.on("data", (chunk: string) => forwarded.push(String(chunk)));
    bridge.enable();
    stdin.write("j\x1b[<64;1;1Mk");
    await new Promise((resolve) => setTimeout(resolve, 20));
    bridge.disable();
    stop();
    expect(seen).toEqual([{ kind: "wheel-up", button: 0, x: 1, y: 1 }]);
    // 鼠标序列被剥掉，按键原样送给 Ink
    expect(forwarded.join("")).toBe("jk");
  });

  it("enables and disables SGR tracking on the terminal", () => {
    const { bridge, written } = makeBridge();
    bridge.enable();
    expect(written.join("")).toContain("\x1b[?1000h");
    expect(written.join("")).toContain("\x1b[?1006h");
    bridge.disable();
    expect(written.join("")).toContain("\x1b[?1000l");
  });
});
