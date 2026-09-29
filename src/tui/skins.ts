// 皮肤：一套调色板 + 边框样式 + 底部按钮外观 + 横幅渐变色。
//
// 内置皮肤写在下面；用户皮肤放在 ~/.atd/skins/<名字>.toml，用 `atd skin template <名字>`
// 生成一份带注释的模板，改完 `atd skin use <名字>` 或在 TUI 里 `:skin <名字>` 切换。
// 用户皮肤可以写 `extends = "nord"`，只覆盖想改的几项。
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

import * as TOML from "@iarna/toml";
import { z } from "zod";

import { applyPalette, SKIN, type BorderStyle, type ButtonLook, type Palette } from "./theme.js";

export type Skin = { name: string; description: string; border: BorderStyle; palette: Palette; button: ButtonLook; banner: string[] };

const classicPalette: Palette = {
  accent: "#56d4dd", hot: "#ff6188", warn: "#fc9867", good: "#a9dc76", overdue: "#ff6b6b", future: "#98c379",
  yellow: "#ffd866", tag: "#c678dd", proj: "#61afef", dim: "#888888", dimmer: "#5f5f5f", border: "#3b3b58",
  flash: "#ffd866", select: "#26264a",
};
const classicBanner = ["#ff6188", "#56d4dd", "#fc9867", "#a9dc76", "#c678dd"];

export const BUILTIN_SKINS: Skin[] = [
  {
    name: "classic", description: "默认：深色 Monokai 风，平面色块按钮", border: "round", palette: classicPalette, banner: classicBanner,
    button: { style: "flat", keyFg: "#10101a", keyBg: "#56d4dd", labelFg: "#f0f0f5", labelBg: "#4a4a6a", highlight: "#7a7aa8", shadow: "#0a0a12", pressedBg: "#26264a" },
  },
  {
    name: "raised", description: "默认配色 + 立体按钮：上亮下暗像 Textual 按钮，点下去会凹进去", border: "round", palette: classicPalette, banner: classicBanner,
    button: { style: "raised", keyFg: "#10101a", keyBg: "#56d4dd", labelFg: "#f0f0f5", labelBg: "#3e3e5e", highlight: "#8c8cc4", shadow: "#16161f", pressedBg: "#2a2a40" },
  },
  {
    name: "dracula", description: "Dracula：紫粉高对比深色", border: "round",
    palette: { accent: "#bd93f9", hot: "#ff79c6", warn: "#ffb86c", good: "#50fa7b", overdue: "#ff5555", future: "#50fa7b", yellow: "#f1fa8c", tag: "#ff79c6", proj: "#8be9fd", dim: "#6272a4", dimmer: "#4d5578", border: "#44475a", flash: "#f1fa8c", select: "#383a4a" },
    banner: ["#ff79c6", "#bd93f9", "#8be9fd", "#50fa7b", "#f1fa8c"],
    button: { style: "flat", keyFg: "#282a36", keyBg: "#bd93f9", labelFg: "#f8f8f2", labelBg: "#44475a", highlight: "#7970a9", shadow: "#191a21", pressedBg: "#343746" },
  },
  {
    name: "nord", description: "Nord：冷静的北欧蓝灰", border: "single",
    palette: { accent: "#88c0d0", hot: "#b48ead", warn: "#d08770", good: "#a3be8c", overdue: "#bf616a", future: "#a3be8c", yellow: "#ebcb8b", tag: "#b48ead", proj: "#81a1c1", dim: "#7b88a1", dimmer: "#4c566a", border: "#434c5e", flash: "#ebcb8b", select: "#3b4252" },
    banner: ["#8fbcbb", "#88c0d0", "#81a1c1", "#5e81ac", "#b48ead"],
    button: { style: "flat", keyFg: "#2e3440", keyBg: "#88c0d0", labelFg: "#eceff4", labelBg: "#434c5e", highlight: "#616e88", shadow: "#242933", pressedBg: "#3b4252" },
  },
  {
    name: "gruvbox", description: "Gruvbox：暖色复古，立体按钮", border: "round",
    palette: { accent: "#8ec07c", hot: "#d3869b", warn: "#fe8019", good: "#b8bb26", overdue: "#fb4934", future: "#b8bb26", yellow: "#fabd2f", tag: "#d3869b", proj: "#83a598", dim: "#928374", dimmer: "#665c54", border: "#504945", flash: "#fabd2f", select: "#3c3836" },
    banner: ["#fb4934", "#fe8019", "#fabd2f", "#b8bb26", "#8ec07c"],
    button: { style: "raised", keyFg: "#282828", keyBg: "#fabd2f", labelFg: "#ebdbb2", labelBg: "#504945", highlight: "#a89984", shadow: "#1d2021", pressedBg: "#3c3836" },
  },
  {
    name: "catppuccin", description: "Catppuccin Mocha：柔和的马卡龙色", border: "round",
    palette: { accent: "#cba6f7", hot: "#f5c2e7", warn: "#fab387", good: "#a6e3a1", overdue: "#f38ba8", future: "#94e2d5", yellow: "#f9e2af", tag: "#f5c2e7", proj: "#89b4fa", dim: "#7f849c", dimmer: "#585b70", border: "#45475a", flash: "#f9e2af", select: "#313244" },
    banner: ["#f5c2e7", "#cba6f7", "#89b4fa", "#94e2d5", "#a6e3a1"],
    button: { style: "flat", keyFg: "#1e1e2e", keyBg: "#cba6f7", labelFg: "#cdd6f4", labelBg: "#45475a", highlight: "#6c7086", shadow: "#11111b", pressedBg: "#313244" },
  },
  {
    name: "paper", description: "浅色终端用：白底深字，经典立体按钮", border: "single",
    palette: { accent: "#0077aa", hot: "#c2185b", warn: "#d35400", good: "#2e7d32", overdue: "#c62828", future: "#2e7d32", yellow: "#9a6700", tag: "#7b1fa2", proj: "#1565c0", dim: "#6b6b6b", dimmer: "#9e9e9e", border: "#bdbdbd", flash: "#9a6700", select: "#dbe9f5" },
    banner: ["#0077aa", "#1565c0", "#7b1fa2", "#c2185b", "#d35400"],
    button: { style: "raised", keyFg: "#ffffff", keyBg: "#0077aa", labelFg: "#212121", labelBg: "#dcdcdc", highlight: "#ffffff", shadow: "#8a8a8a", pressedBg: "#c4c4c4" },
  },
  {
    name: "mono", description: "单色极简：只用灰阶，不花哨", border: "single",
    palette: { accent: "#e0e0e0", hot: "#ffffff", warn: "#d0d0d0", good: "#bdbdbd", overdue: "#ffffff", future: "#bdbdbd", yellow: "#d0d0d0", tag: "#a8a8a8", proj: "#a8a8a8", dim: "#808080", dimmer: "#585858", border: "#484848", flash: "#ffffff", select: "#303030" },
    banner: ["#ffffff", "#d0d0d0", "#a8a8a8", "#808080", "#a8a8a8"],
    button: { style: "flat", keyFg: "#111111", keyBg: "#e0e0e0", labelFg: "#e0e0e0", labelBg: "#3a3a3a", highlight: "#8a8a8a", shadow: "#101010", pressedBg: "#262626" },
  },
];

// 颜色写 #rrggbb，或 black / white / red 这类终端色名
const Color = z.string().regex(/^#[0-9a-fA-F]{6}$|^[a-zA-Z]+$/u, "颜色要写成 #rrggbb 或 black/white 这类色名");
const PaletteSchema = z.object({
  accent: Color, hot: Color, warn: Color, good: Color, overdue: Color, future: Color, yellow: Color, tag: Color,
  proj: Color, dim: Color, dimmer: Color, border: Color, flash: Color, select: Color,
}).strict();
const ButtonSchema = z.object({
  style: z.enum(["flat", "raised"]), keyFg: Color, keyBg: Color, labelFg: Color, labelBg: Color, highlight: Color, shadow: Color, pressedBg: Color,
}).strict();
const UserSkinSchema = z.object({
  extends: z.string().optional(),
  description: z.string().optional(),
  border: z.enum(["round", "single", "double", "bold", "classic"]).optional(),
  banner: z.array(Color).min(1).optional(),
  palette: PaletteSchema.partial().optional(),
  button: ButtonSchema.partial().optional(),
}).strict();

/** 部分覆盖时去掉没写的键，免得 undefined 把底层皮肤的值盖掉 */
const defined = <T extends object>(value: Partial<T> | undefined): Partial<T> =>
  Object.fromEntries(Object.entries(value ?? {}).filter(([, item]) => item !== undefined)) as Partial<T>;

export const skinsDir = (dataDir: string): string => join(dataDir, "skins");
const builtin = (name: string): Skin | undefined => BUILTIN_SKINS.find((skin) => skin.name === name);

const userSkinNames = async (dataDir: string): Promise<string[]> => {
  try { return (await readdir(skinsDir(dataDir))).filter((file) => file.endsWith(".toml")).map((file) => file.slice(0, -5)).sort(); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
};

export const listSkins = async (dataDir: string): Promise<Array<{ name: string; description: string; custom: boolean }>> => {
  const custom = await userSkinNames(dataDir);
  return [
    ...BUILTIN_SKINS.filter((skin) => !custom.includes(skin.name)).map((skin) => ({ name: skin.name, description: skin.description, custom: false })),
    ...await Promise.all(custom.map(async (name) => ({ name, description: (await resolveSkin(name, dataDir)).description, custom: true }))),
  ];
};

/** 同名时用户皮肤优先，这样可以直接改写内置皮肤 */
export const resolveSkin = async (name: string, dataDir: string, seen: string[] = []): Promise<Skin> => {
  if (seen.includes(name)) throw new Error(`皮肤 extends 成环：${[...seen, name].join(" → ")}`);
  let raw: string;
  try { raw = await readFile(join(skinsDir(dataDir), `${name}.toml`), "utf8"); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const found = builtin(name);
    if (!found) throw new Error(`没有叫 ${name} 的皮肤（atd skin list 看有哪些）`);
    return found;
  }
  let parsed: z.infer<typeof UserSkinSchema>;
  try {
    const result = UserSkinSchema.safeParse(TOML.parse(raw));
    if (!result.success) throw new Error(result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("；"));
    parsed = result.data;
  } catch (error) {
    throw new Error(`皮肤文件 ${join(skinsDir(dataDir), `${name}.toml`)} 有问题：${error instanceof Error ? error.message : String(error)}`);
  }
  const baseName = parsed.extends ?? "classic";
  const base = baseName === name ? builtin(name) : await resolveSkin(baseName, dataDir, [...seen, name]);
  if (!base) throw new Error(`没有叫 ${baseName} 的皮肤可以 extends`);
  return {
    name, description: parsed.description ?? `自定义（基于 ${base.name}）`, border: parsed.border ?? base.border,
    palette: { ...base.palette, ...defined(parsed.palette) } as Palette, button: { ...base.button, ...defined(parsed.button) } as ButtonLook, banner: parsed.banner ?? base.banner,
  };
};

export const applySkin = (skin: Skin): void => {
  applyPalette(skin.palette, skin.banner);
  SKIN.name = skin.name;
  SKIN.border = skin.border;
  SKIN.button = { ...skin.button };
};

/** 读配置里的皮肤并生效；找不到或写错时退回 classic 并把原因交给调用方提示 */
export const loadSkin = async (name: string, dataDir: string): Promise<string | undefined> => {
  try { applySkin(await resolveSkin(name, dataDir)); return undefined; }
  catch (error) { applySkin(BUILTIN_SKINS[0]!); return error instanceof Error ? error.message : String(error); }
};

const PALETTE_NOTES: Record<keyof Palette, string> = {
  accent: "主色：横幅、今天、选中框、输入框", hot: "最高档优先级", warn: "次高档优先级", good: "低档优先级",
  overdue: "逾期", future: "临近两天的日期、「接下来」分组", yellow: "提醒时间、「在做」分组", tag: "标签、「等待」分组",
  proj: "项目、会议", dim: "次要文字", dimmer: "更淡的文字（已完成、被前置挡住的任务）", border: "表格边框",
  flash: "底部提示消息", select: "选中行的底色",
};
const BUTTON_NOTES: Record<keyof ButtonLook, string> = {
  style: "flat 平面色块；raised 立体按钮（占 3 行，上亮下暗像 Textual 按钮，点下去凹进去）", keyFg: "键帽文字", keyBg: "键帽底色",
  labelFg: "按钮文字", labelBg: "按钮底色", highlight: "raised：按钮上沿的受光亮边", shadow: "raised：按钮下沿的背光暗边",
  pressedBg: "按下瞬间的按钮底色",
};

/** 把一个皮肤完整展开成带注释的 TOML，用户在这基础上改 */
export const skinTemplate = (base: Skin, name: string): string => [
  `# atd 皮肤：${name}`,
  `# 放在 ~/.atd/skins/${name}.toml；改完执行 atd skin use ${name}，或在 TUI 里输入 :skin ${name}`,
  "# 颜色写 #rrggbb。不想改的项可以直接删掉，会沿用 extends 指定的皮肤。",
  "",
  `extends = ${JSON.stringify(base.name)}`,
  `description = ${JSON.stringify(`我的皮肤（基于 ${base.name}）`)}`,
  "# 边框：round 圆角 / single 直角 / double 双线 / bold 粗线 / classic ASCII",
  `border = ${JSON.stringify(base.border)}`,
  "# 横幅 ANOTHER TODO 每行的颜色，循环使用",
  `banner = [${base.banner.map((color) => JSON.stringify(color)).join(", ")}]`,
  "",
  "[palette]",
  ...(Object.keys(PALETTE_NOTES) as Array<keyof Palette>).map((key) => `${key} = ${JSON.stringify(base.palette[key]).padEnd(10)} # ${PALETTE_NOTES[key]}`),
  "",
  "[button]",
  ...(Object.keys(BUTTON_NOTES) as Array<keyof ButtonLook>).map((key) => `${key} = ${JSON.stringify(base.button[key]).padEnd(10)} # ${BUTTON_NOTES[key]}`),
  "",
].join("\n");

export const writeSkinTemplate = async (name: string, dataDir: string, from = "classic"): Promise<string> => {
  if (!/^[\w-]+$/u.test(name)) throw new Error("皮肤名只能用字母、数字、下划线和连字符");
  const path = join(skinsDir(dataDir), `${name}.toml`);
  await mkdir(skinsDir(dataDir), { recursive: true });
  try { await writeFile(path, skinTemplate(await resolveSkin(from, dataDir), name), { encoding: "utf8", flag: "wx" }); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`已经有 ${path} 了，直接编辑它就行`); throw error; }
  return path;
};
