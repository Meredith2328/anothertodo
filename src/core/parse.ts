import { ReminderSchema, RecurSchema, type Recur, type Reminder } from "../contracts.js";

export type ParsedReminder = Omit<Reminder, "dead"> & { dead?: boolean; relative: boolean };
/** edit 时可以显式清空的字段名 */
export type ParsedClear = "due" | "priority" | "project" | "parent" | "wait" | "tags" | "notes" | "recur" | "reminders";
export type Parsed = {
  title: string;
  due?: string;
  dueHasTime: boolean;
  priority?: string;
  tags: string[];
  /** `-#标签` 只摘掉指定标签，区别于 `-tags` 全清 */
  removeTags: string[];
  project?: string;
  parent?: string;
  wait?: string;
  notes?: string;
  recur?: Recur;
  reminders: ParsedReminder[];
  clears: Set<ParsedClear>;
};

type DateScan = { start: number; end: number; date: string; time?: string };
type TimeScan = { start: number; end: number; time: string };

const WEEKDAY: Record<string, number> = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6 };
const HOLIDAYS: Record<string, [number, number]> = { 元旦: [1, 1], 五一: [5, 1], 十一: [10, 1], 国庆: [10, 1] };
const QUARTER: Record<string, number> = { 半: 30, 一刻: 15, 三刻: 45 };
const URGENCY_PHRASES: Record<string, string[]> = {
  high: ["非常急", "特别急", "特急", "很急", "比较着急", "有点着急", "着急", "紧急", "加急", "急", "urgent", "very urgent", "asap", "high priority", "critical"],
  mid: ["一般般", "一般", "普通", "中等", "还行", "常规", "normal", "medium", "regular"],
  low: ["有空再说", "慢慢来", "不着急", "不用急", "不急", "no rush", "not urgent", "low priority", "someday"],
};

// 预编译紧急度匹配正则：纯字面量，只含上方常量短语，不掺入任何用户输入。
// 英文短语用 \b 词边界（避免 urgent 误匹配 urgently/not urgent），中文短语仍用中文词边界保护。
const URGENCY_RE = /(\bhigh priority\b|\blow priority\b|\bvery urgent\b|\bnot urgent\b|\bcritical\b|\bregular\b|\bno rush\b|\bsomeday\b|\burgent\b|\bnormal\b|\bmedium\b|(?<![\u4e00-\u9fff])比较着急(?![\u4e00-\u9fff])|(?<![\u4e00-\u9fff])有点着急(?![\u4e00-\u9fff])|\basap\b|(?<![\u4e00-\u9fff])有空再说(?![\u4e00-\u9fff])|(?<![\u4e00-\u9fff])非常急(?![\u4e00-\u9fff])|(?<![\u4e00-\u9fff])特别急(?![\u4e00-\u9fff])|(?<![\u4e00-\u9fff])一般般(?![\u4e00-\u9fff])|(?<![\u4e00-\u9fff])慢慢来(?![\u4e00-\u9fff])|(?<![\u4e00-\u9fff])不着急(?![\u4e00-\u9fff])|(?<![\u4e00-\u9fff])不用急(?![\u4e00-\u9fff])|(?<![\u4e00-\u9fff])特急(?![\u4e00-\u9fff])|(?<![\u4e00-\u9fff])很急(?![\u4e00-\u9fff])|(?<![\u4e00-\u9fff])着急(?![\u4e00-\u9fff])|(?<![\u4e00-\u9fff])紧急(?![\u4e00-\u9fff])|(?<![\u4e00-\u9fff])加急(?![\u4e00-\u9fff])|(?<![\u4e00-\u9fff])一般(?![\u4e00-\u9fff])|(?<![\u4e00-\u9fff])普通(?![\u4e00-\u9fff])|(?<![\u4e00-\u9fff])中等(?![\u4e00-\u9fff])|(?<![\u4e00-\u9fff])还行(?![\u4e00-\u9fff])|(?<![\u4e00-\u9fff])常规(?![\u4e00-\u9fff])|(?<![\u4e00-\u9fff])不急(?![\u4e00-\u9fff])|(?<![\u4e00-\u9fff])急(?![\u4e00-\u9fff]))/iu;

const pad = (n: number): string => String(n).padStart(2, "0");
const dateOnly = (year: number, month: number, day: number): string => `${year}-${pad(month)}-${pad(day)}`;
const localDateTime = (date: string, time = "00:00"): string => `${date}T${time}`;
const localDateTimeWithSeconds = (date: string, time = "00:00"): string => `${date}T${time}:00`;
const localNow = (): string => {
  const now = new Date();
  return localDateTime(dateOnly(now.getFullYear(), now.getMonth() + 1, now.getDate()), `${pad(now.getHours())}:${pad(now.getMinutes())}`);
};

const parseDate = (value: string): { year: number; month: number; day: number } => ({ year: Number(value.slice(0, 4)), month: Number(value.slice(5, 7)), day: Number(value.slice(8, 10)) });
const dateMs = (value: string): number => {
  const { year, month, day } = parseDate(value);
  return Date.UTC(year, month - 1, day);
};
const validDate = (year: number, month: number, day: number): string | undefined => {
  if (month < 1 || month > 12) return undefined;
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return undefined;
  return dateOnly(year, month, day);
};
const addDays = (value: string, days: number): string => {
  const next = new Date(dateMs(value) + days * 86_400_000);
  return dateOnly(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
};
const weekday = (value: string): number => (new Date(dateMs(value)).getUTCDay() + 6) % 7;
const daysInMonth = (year: number, month: number): number => new Date(Date.UTC(year, month, 0)).getUTCDate();
const compareLocal = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
const addMinutes = (value: string, minutes: number): string => {
  const [date, clock] = value.split("T");
  const [hour = 0, minute = 0] = clock!.split(":").map(Number);
  const next = new Date(dateMs(date!) + (hour * 60 + minute + minutes) * 60_000);
  return localDateTime(dateOnly(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()), `${pad(next.getUTCHours())}:${pad(next.getUTCMinutes())}`);
};

// 英文相对日期（自 rust-rewrite 同步）：整词匹配，大小写不敏感。
// DATE_RE 加 i 标志安全——其余分支全是中文/数字字面量，无大小写可言。
const EN_WEEKDAY: Record<string, number> = { mon: 0, tue: 1, tues: 1, wed: 2, wednes: 2, thu: 3, thur: 3, thurs: 3, fri: 4, sat: 5, satur: 5, sun: 6 };

const DATE_RE = /(?<iso>\d{4}-\d{1,2}-\d{1,2}(?:[T ]\d{1,2}:\d{2})?)|(?<rel>大后天|后天|明天|今晚|明晚|今天)|(?<en>\bday\s+after\s+tomorrow\b|\bthis\s+weekend\b|\bnext\s+(?:mon|tues?|wed(?:nes)?|thu(?:rs)?|fri|sat(?:ur)?|sun)(?:day)?\b|\btoday\b|\btonight\b|\btomorrow\b)|(?<week>(?<wkpre>下|本)?(?:周|星期|礼拜)(?<wd>[一二三四五六日天]))|(?<weekend>周末)|(?<monthend>(?<mendpre>下)?月底)|(?<monthstart>(?<mstartpre>下)?月初)|(?<holiday>元旦|五一|十一|国庆)|(?<num4>\d{4}[./]\d{1,2}[./]\d{1,2})|(?<num2>(?<![\d.])(?<n2m>\d{1,2})[./-](?<n2d>\d{1,2})(?![\d.]))|(?<numcn>(?<n3m>\d{1,2})月(?<n3d>\d{1,2})日?)/giu;
const TIME_RE = /(?<h12>\d{1,2})(?:[:：](?<m12>\d{1,2}))?\s*(?<apm>a\.?m\.?|p\.?m\.?)|(?<pre>凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|夜里)(?<h1>\d{1,2})(?:[:：](?<m1>\d{1,2})|点(?<q1>半|一刻|三刻)?)?|(?<h2>\d{1,2})[:：](?<m2>\d{2})|(?<h3>\d{1,2})点(?<q3>半|一刻|三刻)?/giu;

const group = (match: RegExpExecArray, key: string): string | undefined => match.groups?.[key];

const resolveDate = (match: RegExpExecArray, today: string): { date: string; time?: string } | undefined => {
  const iso = group(match, "iso");
  if (iso) {
    const normalized = iso.replace(" ", "T");
    const [datePart, timePart] = normalized.split("T");
    const [year, month, day] = datePart!.split("-").map(Number);
    const date = validDate(year!, month!, day!);
    if (!date) return undefined;
    if (!timePart) return { date };
    const [hour, minute] = timePart.split(":").map(Number);
    if (hour! > 23 || minute! > 59) return undefined;
    return { date, time: `${pad(hour!)}:${pad(minute!)}` };
  }
  const rel = group(match, "rel");
  if (rel) return { date: rel === "今天" || rel === "今晚" ? today : addDays(today, rel === "明天" || rel === "明晚" ? 1 : rel === "后天" ? 2 : 3), ...(rel === "今晚" || rel === "明晚" ? { time: "20:00" } : {}) };
  const en = group(match, "en")?.toLowerCase();
  if (en) {
    // tomorrow 默认上午 10 点、tonight 默认晚 8 点（显式时间在 scanTime 阶段覆盖）；
    // next X 永远指下一周及以后，与 Rust 实现一致
    if (en === "today") return { date: today };
    if (en === "tonight") return { date: today, time: "20:00" };
    if (en === "tomorrow") return { date: addDays(today, 1), time: "10:00" };
    if (en === "day after tomorrow") return { date: addDays(today, 2) };
    if (en === "this weekend") return { date: weekday(today) >= 5 ? today : addDays(today, 5 - weekday(today)) };
    const stem = en.replace(/^next\s+/u, "").replace(/day$/u, "");
    const target = EN_WEEKDAY[stem];
    if (target === undefined) return undefined;
    return { date: addDays(today, ((target - weekday(today) + 7) % 7) + 7) };
  }
  const week = group(match, "week");
  if (week) {
    const target = WEEKDAY[group(match, "wd")!];
    if (target === undefined) return undefined;
    const prefix = group(match, "wkpre");
    const base = weekday(today);
    if (prefix === "下") return { date: addDays(today, 7 - base + target) };
    if (prefix === "本") {
      let offset = target - base;
      if (offset < 0) offset += 7;
      return { date: addDays(today, offset) };
    }
    let offset = (target - base + 7) % 7;
    if (offset === 0) offset = 7;
    return { date: addDays(today, offset) };
  }
  if (group(match, "weekend")) return { date: weekday(today) >= 5 ? today : addDays(today, 5 - weekday(today)) };
  if (group(match, "monthend")) {
    const { year, month } = parseDate(today);
    const next = group(match, "mendpre") ? (month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 }) : { year, month };
    return { date: dateOnly(next.year, next.month, daysInMonth(next.year, next.month)) };
  }
  if (group(match, "monthstart")) {
    const { year, month, day } = parseDate(today);
    if (group(match, "mstartpre") || day > 1) {
      const next = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
      return { date: dateOnly(next.year, next.month, 1) };
    }
    return { date: today };
  }
  const holiday = group(match, "holiday");
  if (holiday) {
    const { year } = parseDate(today);
    const [month, day] = HOLIDAYS[holiday]!;
    const candidate = dateOnly(year, month, day);
    return { date: compareLocal(candidate, today) < 0 ? dateOnly(year + 1, month, day) : candidate };
  }
  const num4 = group(match, "num4");
  if (num4) {
    const [year, month, day] = num4.split(/[./]/).map(Number);
    const date = validDate(year!, month!, day!);
    return date ? { date } : undefined;
  }
  const num2 = group(match, "num2");
  if (num2) {
    const { year } = parseDate(today);
    const date = validDate(year, Number(group(match, "n2m")), Number(group(match, "n2d")));
    return date ? { date } : undefined;
  }
  const numcn = group(match, "numcn");
  if (numcn) {
    const { year } = parseDate(today);
    const date = validDate(year, Number(group(match, "n3m")), Number(group(match, "n3d")));
    return date ? { date } : undefined;
  }
  return undefined;
};

export const scanDate = (text: string, today: string): DateScan | undefined => {
  DATE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = DATE_RE.exec(text)) !== null) {
    const resolved = resolveDate(match, today);
    if (resolved) return { start: match.index, end: match.index + match[0].length, ...resolved };
  }
  return undefined;
};

export const scanTime = (text: string): TimeScan | undefined => {
  TIME_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = TIME_RE.exec(text)) !== null) {
    const pre = group(match, "pre");
    const apm = group(match, "apm");
    let hour: number;
    let minute: number;
    if (apm) {
      hour = Number(group(match, "h12"));
      minute = group(match, "m12") ? Number(group(match, "m12")) : 0;
      const isPm = /^p/i.test(apm);
      if (hour === 12) hour = isPm ? 12 : 0;
      else if (isPm) hour += 12;
    } else if (pre) {
      hour = Number(group(match, "h1"));
      minute = group(match, "m1") ? Number(group(match, "m1")) : QUARTER[group(match, "q1") ?? ""] ?? 0;
      if (["中午", "下午", "傍晚", "晚上", "夜里"].includes(pre) && hour < 12) hour += 12;
    } else if (group(match, "h2")) {
      hour = Number(group(match, "h2"));
      minute = Number(group(match, "m2"));
    } else {
      hour = Number(group(match, "h3"));
      minute = QUARTER[group(match, "q3") ?? ""] ?? 0;
    }
    if (hour > 23 || minute > 59) continue;
    return { start: match.index, end: match.index + match[0].length, time: `${pad(hour)}:${pad(minute)}` };
  }
  return undefined;
};

const urgencyKind = (word: string): string | undefined => Object.entries(URGENCY_PHRASES).find(([, words]) => words.includes(word))?.[0];
const phraseTarget = (kind: string, levels: string[]): string => kind === "high" ? levels.at(-1)! : kind === "low" ? levels[0]! : levels.length > 2 ? levels[Math.floor(levels.length / 2)]! : levels[0]!;
const cut = (text: string, start: number, end: number): string => `${text.slice(0, start)} ${text.slice(end)}`.trim();
const ensureReminder = (value: Omit<ParsedReminder, "fired">): ParsedReminder => {
  const { relative, ...persisted } = value;
  return { ...ReminderSchema.parse({ ...persisted, fired: false }), relative };
};

/** `-due` 这类清空指令的写法 → 字段名 */
const CLEAR_ALIASES: Record<string, ParsedClear> = {
  due: "due", date: "due", 日期: "due", 截止: "due",
  priority: "priority", prio: "priority", 优先级: "priority", 档位: "priority",
  project: "project", proj: "project", 项目: "project",
  parent: "parent", 父: "parent", 父任务: "parent",
  wait: "wait", 等待: "wait",
  tag: "tags", tags: "tags", 标签: "tags",
  note: "notes", notes: "notes", 备注: "notes",
  recur: "recur", repeat: "recur", 重复: "recur",
  reminder: "reminders", reminders: "reminders", 提醒: "reminders",
};

const RECUR_CN_WEEKDAY: Record<string, number> = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6 };

const CLEAR_LABELS: Record<ParsedClear, string> = {
  due: "日期", priority: "优先级", project: "项目", parent: "父任务",
  wait: "等待", tags: "标签", notes: "备注", recur: "重复", reminders: "提醒",
};

/**
 * `*每天` / `*每2周` / `*每周三` / `*工作日` / `*weekly:mon` / `*3d`。
 * 认不出来就返回 undefined，让这个 token 退回标题，而不是静默丢掉。
 */
export const parseRecur = (raw: string): Recur | undefined => {
  const text = raw.trim().toLowerCase();
  if (!text) return undefined;
  if (text === "工作日" || text === "每个工作日" || text === "每工作日" || text === "weekday" || text === "weekdays") return RecurSchema.parse({ kind: "weekdays" });
  const cn = text.match(/^每(?<n>\d+)?(?<unit>[天日周月年])(?<wd>[一二三四五六日天])?$/u);
  if (cn?.groups) {
    const interval = cn.groups.n ? Number(cn.groups.n) : 1;
    if (interval < 1) return undefined;
    const unit = cn.groups.unit!;
    if (unit === "天" || unit === "日") return RecurSchema.parse({ kind: "daily", interval });
    if (unit === "月") return RecurSchema.parse({ kind: "monthly", interval });
    if (unit === "年") return RecurSchema.parse({ kind: "yearly", interval });
    const weekday = cn.groups.wd ? RECUR_CN_WEEKDAY[cn.groups.wd] : undefined;
    return RecurSchema.parse({ kind: "weekly", interval, ...(weekday === undefined ? {} : { weekday }) });
  }
  const en = text.match(/^(?:every\s*)?(?<n>\d+)?\s*(?<unit>d|w|m|y|day|days|daily|week|weeks|weekly|month|months|monthly|year|years|yearly)(?::(?<wd>[a-z]{3,9}))?$/u);
  if (en?.groups) {
    const interval = en.groups.n ? Number(en.groups.n) : 1;
    if (interval < 1) return undefined;
    const unit = en.groups.unit!;
    const kind = unit.startsWith("d") ? "daily" : unit.startsWith("w") ? "weekly" : unit.startsWith("m") ? "monthly" : "yearly";
    if (kind !== "weekly") return RecurSchema.parse({ kind, interval });
    const stem = en.groups.wd?.replace(/day$/u, "");
    const weekday = stem === undefined ? undefined : EN_WEEKDAY[stem];
    if (stem !== undefined && weekday === undefined) return undefined;
    return RecurSchema.parse({ kind: "weekly", interval, ...(weekday === undefined ? {} : { weekday }) });
  }
  return undefined;
};

/** 按 recur 规则把日期推到下一次；weekly 带星期时对齐到那一天 */
export const nextOccurrence = (date: string, recur: Recur): string => {
  if (recur.kind === "weekdays") {
    let next = addDays(date, 1);
    while (weekday(next) >= 5) next = addDays(next, 1);
    return next;
  }
  if (recur.kind === "daily") return addDays(date, recur.interval);
  if (recur.kind === "weekly") {
    const base = addDays(date, 7 * recur.interval);
    if (recur.weekday === undefined) return base;
    return addDays(base, (recur.weekday - weekday(base) + 7) % 7);
  }
  const { year, month, day } = parseDate(date);
  if (recur.kind === "monthly") {
    const total = month - 1 + recur.interval;
    const targetYear = year + Math.floor(total / 12);
    const targetMonth = (total % 12) + 1;
    // 31 号遇上短月就压到月末，而不是滚到下个月
    return dateOnly(targetYear, targetMonth, Math.min(day, daysInMonth(targetYear, targetMonth)));
  }
  const targetYear = year + recur.interval;
  return dateOnly(targetYear, month, Math.min(day, daysInMonth(targetYear, month)));
};

export const describeRecur = (recur: Recur): string => {
  if (recur.kind === "weekdays") return "每个工作日";
  const unit = recur.kind === "daily" ? "天" : recur.kind === "weekly" ? "周" : recur.kind === "monthly" ? "个月" : "年";
  const every = recur.interval === 1 ? `每${unit}` : `每${recur.interval}${unit}`;
  if (recur.kind !== "weekly" || recur.weekday === undefined) return every;
  const day = `周${"一二三四五六日"[recur.weekday]}`;
  return recur.interval === 1 ? `每${day}` : `${every}的${day}`;
};

/** 反向输出 recur 的输入写法，供 taskToInput 回填编辑框 */
export const recurToInput = (recur: Recur): string => {
  if (recur.kind === "weekdays") return "*工作日";
  const unit = recur.kind === "daily" ? "天" : recur.kind === "weekly" ? "周" : recur.kind === "monthly" ? "月" : "年";
  const count = recur.interval === 1 ? "" : String(recur.interval);
  return recur.kind === "weekly" && recur.weekday !== undefined ? `*每${count}周${"一二三四五六日"[recur.weekday]}` : `*每${count}${unit}`;
};

export const parse = (text: string, now = localNow(), levels = ["低", "中", "高"]): Parsed => {
  const parsed: Parsed = { title: "", dueHasTime: false, tags: [], removeTags: [], reminders: [], clears: new Set() };
  let source = text.trim();
  if (!source) return parsed;
  const today = now.slice(0, 10);

  // 备注最先剥离：`>>` 之后到行尾都是原文，里面的 # @ 日期都不该再被当成字段
  const notesAt = source.indexOf(">>");
  if (notesAt !== -1) {
    const body = source.slice(notesAt + 2).trim();
    // `>>` 后面什么都不写，就是「把备注清掉」的意思
    if (body) parsed.notes = body; else parsed.clears.add("notes");
    source = source.slice(0, notesAt).trim();
  }

  // 清空指令要在各字段抽取之前拿掉，否则 `-proj` 会被当成标题词
  source = source.replace(/(?:^|\s)-([A-Za-z\u4e00-\u9fff]+)(?=\s|$)/gu, (whole, name: string) => {
    const field = CLEAR_ALIASES[name.toLowerCase()];
    if (!field) return whole;
    parsed.clears.add(field);
    return " ";
  }).trim();
  // `-#标签` 只摘掉一个标签
  source = source.replace(/(?:^|\s)-#([^\s#：:，,]+)(?=\s|$)/gu, (_whole, name: string) => {
    if (!parsed.removeTags.includes(name)) parsed.removeTags.push(name);
    return " ";
  }).trim();

  const recurMatch = source.match(/(?:^|\s)\*([^\s*]+)/u);
  if (recurMatch) {
    const recur = parseRecur(recurMatch[1]!);
    if (recur) { parsed.recur = recur; source = `${source.slice(0, recurMatch.index!)} ${source.slice(recurMatch.index! + recurMatch[0].length)}`.trim(); }
  }

  // 关闭默认提醒的说法要在 @ 提醒循环之前剥掉，否则 @none 会被当成提醒
  // token 卡住循环、落进标题（自 rust-rewrite 同步）
  const remindersDisabled = /@(?:none|off)\b|\bno\s+reminders?\b/iu.test(source);
  if (remindersDisabled) { source = source.replace(/@(?:none|off)\b|\bno\s+reminders?\b/giu, " ").trim(); parsed.clears.add("reminders"); }

  for (const match of source.matchAll(/#([^\s#：:，,]+)/gu)) if (match[1] && !parsed.tags.includes(match[1])) parsed.tags.push(match[1]);
  source = source.replace(/#[^\s#：:，,]+/gu, " ").trim();
  const project = source.match(/(?:proj|project)[:：]([^\s：:，,]+)/u);
  if (project && project[1]) { parsed.project = project[1]; source = `${source.slice(0, project.index!)} ${source.slice(project.index! + project[0].length)}`; }
  const parent = source.match(/(?<![\w])\^([0-9a-zA-Z]{3,})/u);
  if (parent && parent[1]) { parsed.parent = parent[1]; source = `${source.slice(0, parent.index!)} ${source.slice(parent.index! + parent[0].length)}`; }
  const wait = source.match(/~([^\s~]*)/u);
  if (wait) {
    // 最长前缀匹配：在 ~ 之后尝试扫描日期，允许 ~next monday 这类多词英文日期。
    // 从完整子串开始，逐词回退，取第一个从开头完整识别为日期的片段。
    const tail = source.slice(wait.index! + 1);
    let best: DateScan | undefined;
    let bestLen = 0;
    let end = tail.length;
    while (end > 0) {
      const found = scanDate(tail.slice(0, end), today);
      if (found && found.start === 0 && found.end === end) { best = found; bestLen = end; break; }
      const space = tail.slice(0, end).lastIndexOf(" ");
      end = space === -1 ? 0 : space;
    }
    if (best) {
      parsed.wait = best.date;
      const consumed = wait.index! + 1 + bestLen;
      source = `${source.slice(0, wait.index!)} ${source.slice(consumed)}`.trim();
    }
  }

  while (true) {
    const reminderMatch = /@([^\s@]+)/u.exec(source);
    if (!reminderMatch) break;
    let inner = reminderMatch[1]!;
    let hooks: string[] = [];
    const hookMatch = /:([A-Za-z][A-Za-z,]*)$/u.exec(inner);
    if (hookMatch) { hooks = hookMatch[1]!.toLowerCase().split(",").filter(Boolean); inner = inner.slice(0, hookMatch.index); }
    const relative = /^(\d+)([mhd])$/iu.exec(inner);
    let reminder: ParsedReminder | undefined;
    if (relative) {
      const amount = Number(relative[1]);
      const minutes = relative[2]!.toLowerCase() === "m" ? amount : relative[2]!.toLowerCase() === "h" ? amount * 60 : amount * 1440;
      reminder = ensureReminder({ at: addMinutes(now, minutes), hooks: hooks.length ? hooks : ["toast"], relative: true });
    } else {
      const dateFound = scanDate(inner, today);
      if (dateFound && dateFound.start === 0 && dateFound.end === inner.length) {
        let time = dateFound.time;
        if (!time) { const timeFound = scanTime(inner); if (timeFound && timeFound.start === 0 && timeFound.end === inner.length) time = timeFound.time; }
        let at = localDateTime(dateFound.date, time ?? "09:00");
        if (compareLocal(at, now) <= 0) at = addDays(at.slice(0, 10), 1) + at.slice(10);
        reminder = ensureReminder({ at, hooks: hooks.length ? hooks : ["toast"], relative: false });
      } else {
        const timeFound = scanTime(inner);
        if (timeFound && timeFound.start === 0 && timeFound.end === inner.length) reminder = ensureReminder({ at: localDateTime(today, timeFound.time), hooks: hooks.length ? hooks : ["toast"], relative: false });
      }
    }
    if (!reminder) break;
    parsed.reminders.push(reminder);
    source = `${source.slice(0, reminderMatch.index!)} ${source.slice(reminderMatch.index! + reminderMatch[0].length)}`;
  }

  const dateFound = scanDate(source, today);
  let date: string | undefined;
  let time: string | undefined;
  if (dateFound) { date = dateFound.date; time = dateFound.time; source = cut(source, dateFound.start, dateFound.end); }
  const timeFound = scanTime(source);
  if (timeFound) { time = timeFound.time; source = cut(source, timeFound.start, timeFound.end); }
  if (date || time) {
    date ??= today;
    const due = localDateTime(date, time);
    const dueWithSeconds = localDateTimeWithSeconds(date, time);
    parsed.due = time && !dateFound && compareLocal(due, now) <= 0 ? localDateTimeWithSeconds(addDays(date, 1), time) : dueWithSeconds;
    parsed.dueHasTime = time !== undefined;
  }
  for (const reminder of parsed.reminders) if (!reminder.relative) {
    if (date && date !== today) reminder.at = localDateTime(date, reminder.at.slice(11));
    else if (compareLocal(reminder.at, now) <= 0) reminder.at = addDays(reminder.at.slice(0, 10), 1) + reminder.at.slice(10);
  }

  // 默认提醒（自 rust-rewrite 同步）：没写提醒也没关闭、且截止在未来时，
  // 自动补一个 toast——距截止超过 24 小时提前 1 天，否则提前 15 分钟
  if (!parsed.reminders.length && !remindersDisabled && parsed.due && Date.parse(parsed.due) > Date.parse(now)) {
    const advanceMinutes = Date.parse(parsed.due) - Date.parse(now) > 86_400_000 ? 1440 : 15;
    parsed.reminders.push(ensureReminder({ at: addMinutes(parsed.due.slice(0, 16), -advanceMinutes), hooks: ["toast"], relative: false }));
  }

  const urgency = source.match(URGENCY_RE);
  if (urgency && urgency.index !== undefined) { const kind = urgencyKind(urgency[1]!.toLowerCase()); if (kind) { parsed.priority = phraseTarget(kind, levels); source = cut(source, urgency.index, urgency.index + urgency[0].length); } }
  const kept: string[] = [];
  for (const token of source.split(/\s+/u)) { if (!parsed.priority && levels.includes(token)) parsed.priority = token; else if (token) kept.push(token); }
  parsed.title = kept.join(" ").replace(/\s+/gu, " ").trim();
  return parsed;
};

export const preview = (text: string, now = localNow(), levels = ["低", "中", "高"]): string => {
  const p = parse(text, now, levels);
  if (!text.trim()) return "";
  const parts: string[] = [];
  if (p.due) parts.push(`${p.due.slice(0, 10)}${p.dueHasTime ? ` ${p.due.slice(11, 16)}` : ""}`);
  if (p.priority) parts.push(`[${p.priority}]`);
  if (p.project) parts.push(`proj:${p.project}`);
  if (p.tags.length) parts.push(p.tags.map((tag) => `#${tag}`).join(" "));
  if (p.wait) parts.push(`等到${p.wait}`);
  if (p.recur) parts.push(`↻${describeRecur(p.recur)}`);
  for (const reminder of p.reminders) parts.push(`⏰${reminder.at.replace("T", " ")}(${reminder.hooks.join(",")})`);
  if (p.parent) parts.push(`父:${p.parent}`);
  if (p.notes) parts.push(`备注:${p.notes.length > 20 ? `${p.notes.slice(0, 20)}…` : p.notes}`);
  for (const tag of p.removeTags) parts.push(`去#${tag}`);
  for (const field of p.clears) parts.push(`清空${CLEAR_LABELS[field]}`);
  return `→ ${parts[0] ?? "无字段"} | 标题：${p.title || "（标题为空）"}${parts.length > 1 ? `  ${parts.slice(1).join(" ")}` : ""}`;
};
