// 设置页的条目：每项对应 config.toml 里的一个 key，列出可选值，左右键循环切换。
// 这里只放「有限个选项」的配置；邮件账号这类自由文本仍然走 atd config set。
import type { Config } from "../contracts.js";

export type SettingItem = {
  key: string;
  label: string;
  hint: string;
  options: Array<{ value: string; label: string }>;
  current: (config: Config) => string;
};

const bool = [{ value: "true", label: "开" }, { value: "false", label: "关" }];

export const settingItems = (skins: Array<{ name: string; description: string }>): SettingItem[] => [
  { key: "ui.skin", label: "皮肤", hint: "换完立即生效；atd skin template <名字> 可以做自己的皮肤", options: skins.map((skin) => ({ value: skin.name, label: skin.name })), current: (config) => config.ui.skin },
  { key: "ui.mouse", label: "鼠标点击", hint: "关掉后终端原生的拖选复制可以用", options: bool, current: (config) => String(config.ui.mouse) },
  { key: "ui.animations", label: "完成动画", hint: "完成任务时标题上划过一道删除线", options: bool, current: (config) => String(config.ui.animations) },
  { key: "deps.blocked", label: "被挡住的后续任务", hint: "前置没做完时：淡字显示，或不上主屏（依赖图里仍能看到）", options: [{ value: "dim", label: "淡字显示" }, { value: "hide", label: "不上主屏" }], current: (config) => config.deps.blocked },
  { key: "priority.mode", label: "默认排序", hint: "1 / 2 键可临时切换", options: [{ value: "levels", label: "按档位" }, { value: "urgency", label: "按 urgency 打分" }], current: (config) => config.priority.mode },
  { key: "agenda.tie_break", label: "同级排序", hint: "日期和优先级都一样时谁在前；按标题时中文按拼音排", options: [{ value: "entry", label: "先加的在前" }, { value: "entry_desc", label: "后加的在前" }, { value: "title", label: "按标题" }], current: (config) => config.agenda.tie_break },
  { key: "agenda.date_format", label: "日期列", hint: "t 键也能切", options: [{ value: "auto", label: "相对日期" }, { value: "md", label: "月/日" }, { value: "full", label: "完整日期" }], current: (config) => config.agenda.date_format },
  { key: "agenda.week_days", label: "「接下来」的范围", hint: "多少天内到期算接下来，更远的归到「更远」", options: ["3", "7", "14", "30"].map((value) => ({ value, label: `${value} 天` })), current: (config) => String(config.agenda.week_days) },
  { key: "ui.lang", label: "界面语言", hint: "只影响界面文字，输入语法两种语言都一样", options: [{ value: "auto", label: "跟随系统" }, { value: "zh", label: "中文" }, { value: "en", label: "English" }], current: (config) => config.ui.lang },
  { key: "watch.interval_seconds", label: "提醒巡检间隔", hint: "后台 watcher 多久检查一次到期提醒，重启 watcher 后生效", options: ["15", "30", "60", "120"].map((value) => ({ value, label: `${value} 秒` })), current: (config) => String(config.watch.interval_seconds) },
];

/** 当前值往前 / 往后挪一格；当前值不在选项里（比如手改成了别的数）就从第一项开始 */
export const cycleSetting = (item: SettingItem, config: Config, delta: number): string => {
  const index = item.options.findIndex((option) => option.value === item.current(config));
  const next = index < 0 ? 0 : (index + delta + item.options.length) % item.options.length;
  return item.options[next]!.value;
};
