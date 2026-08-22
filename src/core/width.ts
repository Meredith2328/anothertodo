/**
 * 终端显示宽度：CJK、假名、全角标点占两格，组合记号不占格。
 * CLI 表格和 TUI 表格都要用同一套算法，否则中文一多列就对不齐。
 */
export const charWidth = (char: string): number => {
  const code = char.codePointAt(0) ?? 0;
  if (code >= 0x0300 && code <= 0x036f) return 0; // combining marks
  if (code === 0x23f0 // ⏰
    || (code >= 0x1100 && code <= 0x115f) // Hangul Jamo
    || (code >= 0x2e80 && code <= 0xa4cf) // CJK 部首/汉字/假名
    || (code >= 0xac00 && code <= 0xd7a3) // Hangul 音节
    || (code >= 0xf900 && code <= 0xfaff) // CJK 兼容
    || (code >= 0xfe30 && code <= 0xfe6f)
    || (code >= 0xff00 && code <= 0xff60) // 全角
    || (code >= 0xffe0 && code <= 0xffe6)
    || (code >= 0x1f300 && code <= 0x1faff)) return 2; // emoji
  return 1;
};

export const displayWidth = (text: string): number => [...text].reduce((width, char) => width + charWidth(char), 0);

export const padDisplay = (text: string, width: number): string => `${text}${" ".repeat(Math.max(0, width - displayWidth(text)))}`;

export const truncateDisplay = (text: string, width: number): string => {
  if (displayWidth(text) <= width) return text;
  let out = "";
  let used = 0;
  for (const char of text) {
    const w = charWidth(char);
    if (used + w > width) break;
    out += char;
    used += w;
  }
  return out;
};

/** 截断时留一格放省略号，让「这里还有内容」看得出来 */
export const truncateWithEllipsis = (text: string, width: number): string =>
  displayWidth(text) <= width ? text : `${truncateDisplay(text, Math.max(0, width - 1))}…`;
