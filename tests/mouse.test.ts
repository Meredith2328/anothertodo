import { describe, expect, it } from "vitest";

import { footerKeyRanges } from "../src/tui/app.js";
import { splitMouseData } from "../src/tui/mouse.js";

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
