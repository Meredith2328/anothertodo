/**
 * 界面文案的中英双语表。
 *
 * 只有「给人看的字」进这里；任务数据、查询语法、配置 key 一律不翻译，
 * 否则同一份 ~/.atd 在不同语言下会解析出不同结果。
 */
export type Lang = "zh" | "en";

/**
 * 环境语言探测。认不出来时回落到中文——绝大多数现有用户是中文环境，
 * 猜错方向的代价（界面突然变英文）比保守留中文大得多。
 */
export const detectLang = (env: NodeJS.ProcessEnv = process.env): Lang => {
  const raw = env.ATD_LANG || env.LC_ALL || env.LC_MESSAGES || env.LANG || "";
  if (/^en\b|^en[_-]/iu.test(raw)) return "en";
  return "zh";
};

let current: Lang = detectLang();

/** config.ui.lang 为 auto 时用环境探测的结果 */
export const setLang = (lang: Lang | "auto"): void => { current = lang === "auto" ? detectLang() : lang; };
export const getLang = (): Lang => current;

type Catalog = Record<string, readonly [zh: string, en: string]>;

const MESSAGES: Catalog = {
  // 议程分组
  "group.overdue": ["逾期", "Overdue"],
  "group.today": ["今天", "Today"],
  "group.upcoming": ["接下来", "Upcoming"],
  "group.later": ["更远", "Later"],
  "group.waiting": ["等待中", "Waiting"],
  "group.nodate": ["无日期", "No date"],
  "group.finished": ["已完成/已取消", "Done / cancelled"],
  "group.hidden": ["隐藏(等待未到) {count} 项", "{count} hidden (waiting)"],

  // 日期列
  "date.today": ["今天", "today"],
  "date.tomorrow": ["明天", "tomorrow"],
  "date.dayAfter": ["后天", "in 2d"],
  "date.yesterday": ["昨天", "yesterday"],
  "date.overdueDays": ["超{days}天", "{days}d late"],
  "date.weekday": ["周{name}", "{name}"],

  // 重复规则
  "recur.weekdays": ["每个工作日", "every weekday"],
  "recur.daily": ["每天", "daily"],
  "recur.weekly": ["每周", "weekly"],
  "recur.monthly": ["每月", "monthly"],
  "recur.yearly": ["每年", "yearly"],
  "recur.everyNDays": ["每{n}天", "every {n} days"],
  "recur.everyNWeeks": ["每{n}周", "every {n} weeks"],
  "recur.everyNMonths": ["每{n}个月", "every {n} months"],
  "recur.everyNYears": ["每{n}年", "every {n} years"],
  "recur.weeklyOn": ["每周{day}", "every {day}"],
  "recur.everyNWeeksOn": ["每{n}周的周{day}", "every {n} weeks on {day}"],

  // 通用字段名
  "field.id": ["id", "id"],
  "field.title": ["标题", "Title"],
  "field.status": ["状态", "Status"],
  "field.due": ["截止", "Due"],
  "field.priority": ["优先级", "Priority"],
  "field.project": ["项目", "Project"],
  "field.tags": ["标签", "Tags"],
  "field.wait": ["等待到", "Wait until"],
  "field.recur": ["重复", "Repeat"],
  "field.parent": ["父任务", "Parent"],
  "field.subtasks": ["子任务", "Subtasks"],
  "field.entry": ["创建", "Created"],
  "field.end": ["完成", "Finished"],
  "field.reminders": ["提醒", "Reminders"],
  "field.notes": ["备注", "Notes"],
  "value.none": ["—", "—"],

  // 提醒投递状态
  "reminder.pending": ["待发送", "pending"],
  "reminder.sent": ["已发送", "sent"],
  "reminder.dead": ["已放弃", "given up"],
  "reminder.retries": ["（重试 {n} 次）", " (retried {n}x)"],

  // 中英标点不同，冒号也得跟着走
  "punct.colon": ["：", ":"],
  "value.missing": ["（已不存在）", " (gone)"],
};

const WEEKDAY_NAMES: Record<Lang, readonly string[]> = {
  zh: ["一", "二", "三", "四", "五", "六", "日"],
  en: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
};

export const weekdayName = (index: number, lang = current): string => WEEKDAY_NAMES[lang][index] ?? String(index);

/** `{name}` 占位符替换；缺 key 时把 key 本身返回，宁可露出来也不要静默显示空字符串 */
export const t = (key: string, params: Record<string, string | number> = {}, lang = current): string => {
  const entry = MESSAGES[key];
  if (!entry) return key;
  const template = lang === "en" ? entry[1] : entry[0];
  return template.replace(/\{(\w+)\}/gu, (whole, name: string) => name in params ? String(params[name]) : whole);
};
