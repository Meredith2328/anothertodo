import { ReminderSchema, type Reminder } from "../contracts.js";

export type ParsedReminder = Omit<Reminder, "dead"> & { dead?: boolean; relative: boolean };
export type Parsed = {
  title: string;
  due?: string;
  dueHasTime: boolean;
  priority?: string;
  tags: string[];
  project?: string;
  parent?: string;
  wait?: string;
  reminders: ParsedReminder[];
};

type DateScan = { start: number; end: number; date: string; time?: string };
type TimeScan = { start: number; end: number; time: string };

const WEEKDAY: Record<string, number> = { 一: 0, 二: 1, 三: 2, 四: 3, 五: 4, 六: 5, 日: 6, 天: 6 };
const HOLIDAYS: Record<string, [number, number]> = { 元旦: [1, 1], 五一: [5, 1], 十一: [10, 1], 国庆: [10, 1] };
const QUARTER: Record<string, number> = { 半: 30, 一刻: 15, 三刻: 45 };
const URGENCY_PHRASES: Record<string, string[]> = {
  high: ["非常急", "特别急", "特急", "很急", "比较着急", "有点着急", "着急", "紧急", "加急", "急"],
  mid: ["一般般", "一般", "普通", "中等", "还行", "常规"],
  low: ["有空再说", "慢慢来", "不着急", "不用急", "不急"],
};

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
const TIME_RE = /(?<pre>凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|夜里)(?<h1>\d{1,2})(?:[:：](?<m1>\d{1,2})|点(?<q1>半|一刻|三刻)?)?|(?<h2>\d{1,2})[:：](?<m2>\d{2})|(?<h3>\d{1,2})点(?<q3>半|一刻|三刻)?/gu;

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
    let hour: number;
    let minute: number;
    if (pre) {
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

export const parse = (text: string, now = localNow(), levels = ["低", "中", "高"]): Parsed => {
  const parsed: Parsed = { title: "", dueHasTime: false, tags: [], reminders: [] };
  let source = text.trim();
  if (!source) return parsed;
  const today = now.slice(0, 10);

  // 关闭默认提醒的说法要在 @ 提醒循环之前剥掉，否则 @none 会被当成提醒
  // token 卡住循环、落进标题（自 rust-rewrite 同步）
  const remindersDisabled = /@(?:none|off)\b|\bno\s+reminders?\b/iu.test(source);
  if (remindersDisabled) source = source.replace(/@(?:none|off)\b|\bno\s+reminders?\b/giu, " ").trim();

  for (const match of source.matchAll(/#([^\s#：:，,]+)/gu)) if (match[1] && !parsed.tags.includes(match[1])) parsed.tags.push(match[1]);
  source = source.replace(/#[^\s#：:，,]+/gu, " ").trim();
  const project = source.match(/(?:proj|project)[:：]([^\s：:，,]+)/u);
  if (project && project[1]) { parsed.project = project[1]; source = `${source.slice(0, project.index!)} ${source.slice(project.index! + project[0].length)}`; }
  const parent = source.match(/(?<![\w])\^([0-9a-zA-Z]{3,})/u);
  if (parent && parent[1]) { parsed.parent = parent[1]; source = `${source.slice(0, parent.index!)} ${source.slice(parent.index! + parent[0].length)}`; }
  const wait = source.match(/~([^\s~]+)/u);
  if (wait) { const found = scanDate(wait[1]!, today); if (found && found.start === 0 && found.end === wait[1]!.length) { parsed.wait = found.date; source = `${source.slice(0, wait.index!)} ${source.slice(wait.index! + wait[0].length)}`; } }

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

  const phrases = Object.values(URGENCY_PHRASES).flat().sort((a, b) => b.length - a.length).map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const urgency = new RegExp(`(?<![\\u4e00-\\u9fff])(${phrases.join("|")})(?![\\u4e00-\\u9fff])`, "u").exec(source);
  if (urgency) { const kind = urgencyKind(urgency[1]!); if (kind) { parsed.priority = phraseTarget(kind, levels); source = cut(source, urgency.index, urgency.index + urgency[0].length); } }
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
  for (const reminder of p.reminders) parts.push(`⏰${reminder.at.replace("T", " ")}(${reminder.hooks.join(",")})`);
  if (p.parent) parts.push(`父:${p.parent}`);
  return `→ ${parts[0] ?? "无字段"} | 标题：${p.title || "（标题为空）"}${parts.length > 1 ? `  ${parts.slice(1).join(" ")}` : ""}`;
};
