"""单行模糊输入解析。

用法核心：parse("后天 晚上8点 买牛奶 很急 #学习 @18:30:toast,email")，
各字段被识别并从文本中摘出，剩余词作为标题。
所有函数都可注入 now，保证测试可复现。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta
from calendar import monthrange

WEEKDAY = {"一": 0, "二": 1, "三": 2, "四": 3, "五": 4, "六": 5, "日": 6, "天": 6}

# 短语 -> 档位档位（高/中/低 对应 levels 的尾/中/首）；匹配时按长度降序
URGENCY_P邮件ASES = {
    "high": ["非常急", "特别急", "特急", "很急", "比较着急", "有点着急", "着急", "紧急", "加急", "急"],
    "mid": ["一般般", "一般", "普通", "中等", "还行", "常规"],
    "low": ["有空再说", "慢慢来", "不着急", "不用急", "不急"],
}

HOLIDAYS = {"元旦": (1, 1), "五一": (5, 1), "十一": (10, 1), "国庆": (10, 1)}

_DATE_RE = re.compile(
    r"""
      (?P<iso>\d{4}-\d{1,2}-\d{1,2}(?:[T ]\d{1,2}:\d{2})?)
    | (?P<rel>大后天|后天|明天|今晚|明晚|今天)
    | (?P<week>(?P<wkpre>下|本)?(?:周|星期|礼拜)(?P<wd>[一二三四五六日天]))
    | (?P<weekend>周末)
    | (?P<monthend>(?P<mendpre>下)?月底)
    | (?P<monthstart>(?P<mstartpre>下)?月初)
    | (?P<holiday>元旦|五一|十一|国庆)
    | (?P<num4>\d{4}[./]\d{1,2}[./]\d{1,2})
    | (?P<num2>(?<![\d.])(?P<n2m>\d{1,2})[./-](?P<n2d>\d{1,2})(?![\d.]))
    | (?P<numcn>(?P<n3m>\d{1,2})月(?P<n3d>\d{1,2})日?)
    """,
    re.VERBOSE,
)

_TIME_RE = re.compile(
    r"(?P<pre>凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|夜里)"
    r"(?P<h1>\d{1,2})(?:[:：](?P<m1>\d{1,2})|点(?P<q1>半|一刻|三刻)?)?"
    r"|(?P<h2>\d{1,2})[:：](?P<m2>\d{2})"
    r"|(?P<h3>\d{1,2})点(?P<q3>半|一刻|三刻)?"
)

_QUARTER = {"半": 30, "一刻": 15, "三刻": 45}


@dataclass
class Reminder:
    at: datetime
    hooks: list[str] = field(default_factory=list)
    relative: bool = False  # @30m 这类相对提醒，不随日期锚点移动

    def to_dict(self) -> dict:
        return {"at": self.at.isoformat(timespec="minutes"), "hooks": list(self.hooks), "fired": False}


@dataclass
class Parsed:
    title: str = ""
    due: datetime | None = None
    due_has_time: bool = False
    priority: str | None = None
    tags: list[str] = field(default_factory=list)
    project: str | None = None
    parent: str | None = None
    wait: date | None = None
    reminders: list[Reminder] = field(default_factory=list)


# ---------------------------------------------------------------- 日期

def _next_weekday(base: date, target: int) -> date:
    return base + timedelta(days=(target - base.weekday()) % 7)


def _this_week(base: date, target: int) -> date:
    monday = base - timedelta(days=base.weekday())
    cand = monday + timedelta(days=target)
    if cand < base:
        cand += timedelta(days=7)
    return cand


def _next_week(base: date, target: int) -> date:
    return (base - timedelta(days=base.weekday())) + timedelta(days=7 + target)


def _resolve_date(m: re.Match, today: date) -> tuple[date, time | None] | None:
    g = m.groupdict()
    default_t: time | None = None
    if g["iso"]:
        s = g["iso"].replace(" ", "T")
        if "T" in s:
            d, t = s.split("T")
            y, mo, dd = map(int, d.split("-"))
            hh, mi = map(int, t.split(":"))
            try:
                return date(y, mo, dd), time(hh, mi)
            except ValueError:
                return None
        y, mo, dd = map(int, s.split("-"))
        try:
            return date(y, mo, dd), None
        except ValueError:
            return None
    if g["rel"]:
        return {
            "今天": today,
            "今晚": today,
            "明天": today + timedelta(days=1),
            "明晚": today + timedelta(days=1),
            "后天": today + timedelta(days=2),
            "大后天": today + timedelta(days=3),
        }[g["rel"]], (time(20, 0) if g["rel"] in ("今晚", "明晚") else None)
    if g["week"]:
        target = WEEKDAY[g["wd"]]
        pre = g["wkpre"]
        if pre == "下":
            return _next_week(today, target), None
        if pre == "本":
            return _this_week(today, target), None
        cand = _next_weekday(today, target)
        if cand == today:
            cand += timedelta(days=7)  # "周二"在周二说 → 下周二
        return cand, None
    if g["weekend"]:
        if today.weekday() >= 5:
            return today, None
        return today + timedelta(days=(5 - today.weekday())), None
    if g["monthend"]:
        mo_is_next = bool(g["mendpre"])
        if today.month == 12:
            y, mo = (today.year + 1, 1) if mo_is_next else (today.year, 12)
        else:
            y, mo = (today.year, today.month + 1) if mo_is_next else (today.year, today.month)
        return date(y, mo, monthrange(y, mo)[1]), None
    if g["monthstart"]:
        if g["mstartpre"]:
            y, mo = (today.year + 1, 1) if today.month == 12 else (today.year, today.month + 1)
        else:
            y, mo = (today.year, today.month) if today.day <= 1 else (
                (today.year + 1, 1) if today.month == 12 else (today.year, today.month + 1)
            )
        return date(y, mo, 1), None
    if g["holiday"]:
        mo, dd = HOLIDAYS[g["holiday"]]
        cand = date(today.year, mo, dd)
        if cand < today:
            cand = date(today.year + 1, mo, dd)
        return cand, None
    if g["num4"]:
        y, mo, dd = (int(x) for x in re.split(r"[./]", g["num4"]))
        try:
            return date(y, mo, dd), None
        except ValueError:
            return None
    if g["num2"]:
        mo, dd = int(g["n2m"]), int(g["n2d"])
        if not (1 <= mo <= 12 and 1 <= dd <= monthrange(2000, mo)[1]):
            return None
        try:
            return date(today.year, mo, dd), None
        except ValueError:
            return None
    if g["numcn"]:
        mo, dd = int(g["n3m"]), int(g["n3d"])
        if not (1 <= mo <= 12):
            return None
        try:
            return date(today.year, mo, dd), None
        except ValueError:
            return None
    return None


def scan_date(text: str, today: date) -> tuple[tuple[int, int], date, time | None] | None:
    """在 text 里找第一个可解析的日期短语，返回 (span, date, 默认时间)。"""
    for m in _DATE_RE.finditer(text):
        r = _resolve_date(m, today)
        if r is not None:
            return m.span(), r[0], r[1]
    return None


def scan_time(text: str) -> tuple[tuple[int, int], time] | None:
    for m in _TIME_RE.finditer(text):
        g = m.groupdict()
        if g["pre"]:
            h, mi = int(g["h1"]), 0
            if g["m1"]:
                mi = int(g["m1"])
            elif g["q1"]:
                mi = _QUARTER[g["q1"]]
            pre = g["pre"]
            if pre in ("中午",):
                if h < 12:
                    h += 12
            elif pre in ("下午", "傍晚"):
                if h < 12:
                    h += 12
            elif pre in ("晚上", "夜里"):
                if h < 12:
                    h += 12
            if h > 23 or mi > 59:
                continue
            return m.span(), time(h, mi)
        if g["h2"]:
            h, mi = int(g["h2"]), int(g["m2"])
            if h > 23 or mi > 59:
                continue
            return m.span(), time(h, mi)
        if g["h3"]:
            h = int(g["h3"])
            mi = _QUARTER.get(g["q3"], 0) if g["q3"] else 0
            if h > 23:
                continue
            return m.span(), time(h, mi)
    return None


# ---------------------------------------------------------------- 紧急度

def _urgency_regex(levels: list[str]) -> re.Pattern | None:
    phrases: list[tuple[str, str]] = []
    for kind, words in URGENCY_P邮件ASES.items():
        phrases += [(w, kind) for w in words]
    ordered = sorted((re.escape(w) for w, _ in phrases), key=len, reverse=True)
    if not ordered:
        return None
    # 词边界：前后不能是汉字（"急性"里的"急"不算紧急度）
    return re.compile(r"(?<![\u4e00-\u9fff])(" + "|".join(ordered) + r")(?![\u4e00-\u9fff])")


def _urgency_kind(word: str) -> str | None:
    for k, words in URGENCY_P邮件ASES.items():
        if word in words:
            return k
    return None


def _phrase_target(kind: str, levels: list[str]) -> str:
    if kind == "high":
        return levels[-1]
    if kind == "low":
        return levels[0]
    return levels[len(levels) // 2] if len(levels) > 2 else levels[0]


# ---------------------------------------------------------------- 主入口

def parse(text: str, *, now: datetime | None = None, levels: list[str] | None = None) -> Parsed:
    now = now or datetime.now()
    today = now.date()
    levels = list(levels) if levels else ["低", "中", "高"]
    p = Parsed()
    s = text.strip()
    if not s:
        return p

    def cut(span: tuple[int, int]) -> None:
        nonlocal s
        s = (s[: span[0]] + " " + s[span[1]:]).strip()

    # --- 显式语法 ---
    for m in re.finditer(r"#([^\s#：:，,]+)", s):
        tag = m.group(1)
        if tag and tag not in p.tags:
            p.tags.append(tag)
    s = re.sub(r"#[^\s#：:，,]+", " ", s).strip()

    m = re.search(r"(?:proj|project)[:：]([^\s：:，,]+)", s)
    if m:
        p.project = m.group(1)
        s = s[: m.start()] + " " + s[m.end():]

    m = re.search(r"(?<![\w])\^([0-9a-zA-Z]{3,})", s)
    if m:
        p.parent = m.group(1)
        s = s[: m.start()] + " " + s[m.end():]

    m = re.search(r"~([^\s~]+)", s)
    if m:
        r = scan_date(m.group(1), today)
        if r:
            p.wait = r[1]
            s = s[: m.start()] + " " + s[m.end():]

    # --- 提醒 @...（可多个）---
    def _reminder(inner: str) -> Reminder | None:
        hooks: list[str] = []
        hm = re.search(r":([A-Za-z][A-Za-z,]*)$", inner)
        if hm:
            hooks = [h for h in hm.group(1).lower().split(",") if h]
            inner = inner[: hm.start()]
        rm = re.fullmatch(r"(\d+)([mhd])", inner, re.IGNORECASE)
        if rm:
            n, unit = int(rm.group(1)), rm.group(2).lower()
            if unit == "m":
                delta = timedelta(minutes=n)
            elif unit == "h":
                delta = timedelta(hours=n)
            else:
                delta = timedelta(days=n)
            return Reminder(at=now + delta, hooks=hooks or ["toast"], relative=True)
        dm = scan_date(inner, today)
        if dm and inner[dm[0][0]: dm[0][1]] == inner:
            d, t = dm[1], dm[2]
            if t is None:
                tm = scan_time(inner)
                if tm and inner[tm[0][0]: tm[0][1]] == inner:
                    t = tm[1]
            at = datetime.combine(d, t or time(9, 0))
            if at <= now:
                at += timedelta(days=1)
            return Reminder(at=at, hooks=hooks or ["toast"])
        tm = scan_time(inner)
        if tm and inner[tm[0][0]: tm[0][1]] == inner:
            # 纯时间：先锚定今天；若行里有未来日期，后面会挪到那天
            return Reminder(at=datetime.combine(today, tm[1]), hooks=hooks or ["toast"])
        return None

    while True:
        m = re.search(r"@([^\s@]+)", s)
        if not m:
            break
        r = _reminder(m.group(1))
        if r is None:
            break
        p.reminders.append(r)
        s = s[: m.start()] + " " + s[m.end():]

    # --- 日期 + 时间 ---
    dm = scan_date(s, today)
    d: date | None = None
    t: time | None = None
    if dm:
        span, d, t = dm
        cut(span)
    tm = scan_time(s)
    if tm:
        t = tm[1]
        cut(tm[0])
    if d is not None or t is not None:
        d = d or today
        p.due = datetime.combine(d, t or time(0, 0))
        p.due_has_time = t is not None
        if t is not None and p.due <= now and dm is None:
            # 只给了时间且已过点 → 顺延到明天
            p.due += timedelta(days=1)

    # 纯时间的提醒（@18:30）锚定到任务日期；无任务日期且已过点则顺延到明天
    for r in p.reminders:
        if not r.relative:
            if d is not None and d != today:
                r.at = datetime.combine(d, r.at.time())
            elif r.at <= now:
                r.at += timedelta(days=1)

    # --- 紧急度短语 ---
    ure = _urgency_regex(levels)
    if ure:
        m = ure.search(s)
        if m:
            kind = _urgency_kind(m.group(1) or m.group(0))
            if kind:
                p.priority = _phrase_target(kind, levels)
                cut(m.span())

    # --- 档位名整词匹配（如 Sol / 高） ---
    tokens = s.split()
    kept = []
    for tok in tokens:
        if p.priority is None and tok in levels:
            p.priority = tok
            continue
        kept.append(tok)
    s = " ".join(kept)

    p.title = re.sub(r"\s+", " ", s).strip()
    return p


# ---------------------------------------------------------------- 预览与反向序列化

def _fmt_day(d: date, today: date) -> str:
    names = "一二三四五六日"
    wd = names[d.weekday()]
    if d == today:
        return f"今天({wd})"
    if d == today + timedelta(days=1):
        return f"明天({wd})"
    if d == today + timedelta(days=2):
        return f"后天({wd})"
    return f"{d.month}月{d.day}日({wd})"


def preview(text: str, *, now: datetime | None = None, levels: list[str] | None = None) -> str:
    """TUI 输入框下方的实时解析预览。"""
    p = parse(text, now=now, levels=levels)
    if not text.strip():
        return ""
    parts = []
    if p.due:
        ts = p.due.strftime("%H:%M") if p.due_has_time else ""
        parts.append(_fmt_day(p.due.date(), (now or datetime.now()).date()) + (" " + ts if ts else ""))
    if p.priority:
        parts.append(f"[{p.priority}]")
    if p.project:
        parts.append(f"proj:{p.project}")
    if p.tags:
        parts.append(" ".join("#" + t for t in p.tags))
    if p.wait:
        parts.append(f"等到{_fmt_day(p.wait, (now or datetime.now()).date())}")
    for r in p.reminders:
        parts.append(f"⏰{r.at.strftime('%m-%d %H:%M')}({','.join(r.hooks)})")
    if p.parent:
        parts.append(f"父:{p.parent}")
    head = parts[0] if parts else "无字段"
    title = p.title or "（标题为空）"
    return f"→ {head} | 标题：{title}" + ("  " + " ".join(parts[1:]) if len(parts) > 1 else "")


def task_to_input(task, levels: list[str]) -> str:
    """把已有任务序列化回输入行，供 TUI 编辑。"""
    parts = [task.title]
    if task.priority:
        parts.append(task.priority)
    if task.project:
        parts.append(f"proj:{task.project}")
    parts += ["#" + t for t in task.tags]
    if task.parent:
        parts.append("^" + task.parent)
    if task.wait:
        parts.append("~" + task.wait.isoformat())
    if task.due:
        parts.append(task.due.strftime("%Y-%m-%d"))
        if task.due.time() != time(0, 0):
            parts.append(task.due.strftime("%H:%M"))
    for r in task.reminders or []:
        hooks = r.get("hooks") or ["toast"]
        parts.append("@" + r["at"][:16].replace("T", " ") + ":" + ",".join(hooks))
    return " ".join(p for p in parts if p)
