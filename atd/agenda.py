"""agenda 视图编排：逾期/今天/接下来/等待/无日期 分组 + 行渲染。"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from . import config
from .model import Task
from .priority import sort_tasks


@dataclass
class Group:
    name: str
    style: str  # rich/textual 样式名
    tasks: list[Task]


def _waiting_visible(t: Task, today: date) -> bool:
    return t.status == "waiting" and not t.hidden_by_wait(today)


def groups(tasks: list[Task], *, cfg: dict | None = None, mode: str | None = None,
           now: datetime | None = None, query: str = "") -> list[Group]:
    from .query import compile_query, match

    cfg = cfg or config.load()
    now = now or datetime.now()
    today = now.date()
    preds: list = []
    if query:
        preds = compile_query(query, today=today)
        tasks = [t for t in tasks if match(t, preds, today=today)]
    # 只有显式按状态查 done/cancelled 时才显示终态任务（默认议程不含它们）
    show_finished = any(p[0] == "status" and p[1] in ("done", "cancelled") for p in preds)
    horizon = today + timedelta(days=cfg["agenda"].get("week_days", 7))

    def sort(ts: list[Task]) -> list[Task]:
        return sort_tasks(ts, mode=mode, cfg=cfg, now=now)

    overdue = sort([t for t in tasks if t.is_overdue(today)])
    todays = sort([t for t in tasks
                   if t.status in ("todo", "meeting") and t.due_date == today])
    upcoming = sort([t for t in tasks
                     if t.status in ("todo", "meeting") and t.due_date is not None
                     and today < t.due_date <= horizon])
    later = sort([t for t in tasks
                  if t.status in ("todo", "meeting") and t.due_date is not None
                  and t.due_date > horizon])
    waiting = sort([t for t in tasks if _waiting_visible(t, today)])
    # waiting 且 wait 未到的默认隐藏，其他状态（无日期 todo）兜底组
    waiting_hidden = [t for t in tasks if t.status == "waiting" and t.hidden_by_wait(today)]
    nodate = sort([t for t in tasks
                   if t.status == "todo" and t.due_date is None and t.wait is None])
    out = []
    if overdue:
        out.append(Group("逾期", "bold red", overdue))
    if todays:
        out.append(Group("今天", "bold cyan", todays))
    if upcoming:
        out.append(Group("接下来", "green", upcoming))
    if later:
        out.append(Group("更远", "dim", later))
    if waiting:
        out.append(Group("等待中", "magenta", waiting))
    if nodate:
        out.append(Group("无日期", "dim", nodate))
    if show_finished:
        finished = sort([t for t in tasks if t.status in ("done", "cancelled")])
        if finished:
            out.append(Group("已完成/已取消", "dim strike", finished))
    out.append(Group(f"隐藏(等待未到) {len(waiting_hidden)} 项", "dim", []))
    # 最后一个组仅作计数提示，不渲染任务
    return out


DATE_FORMATS = ("auto", "md", "full")
DATE_FORMAT_LABEL = {"auto": "相对日期", "md": "月/日", "full": "完整日期"}


def format_date(t: Task, today: date, date_format: str | None = None) -> str:
    """日期列显示。date_format：
    - auto（默认）：今天/明天/后天/昨天/超N天，7 天内周X，更远 m/d
    - md：一律 8/21（含逾期 8/17）
    - full：一律 2026-08-21
    """
    if t.due_date is None:
        return " " * 10
    d = t.due_date
    if date_format == "md":
        return f"{d.month}/{d.day}"
    if date_format == "full":
        return f"{d.year}-{d.month:02d}-{d.day:02d}"
    delta = (d - today).days
    if delta == 0:
        s = "今天"
    elif delta == 1:
        s = "明天"
    elif delta == 2:
        s = "后天"
    elif delta == -1:
        s = "昨天"
    elif delta < 0:
        s = f"超{abs(delta)}天"
    elif 0 < delta <= 7:
        s = "周" + "一二三四五六日"[d.weekday()]
    else:
        s = f"{d.month}/{d.day}"
    return s


def render_line(t: Task, *, cfg: dict | None = None, today: date | None = None,
                mode: str | None = None) -> str:
    """渲染一行：日期 TODO 紧急度 状态 标签。CLI/TUI 共用。"""
    cfg = cfg or config.load()
    today = today or date.today()
    from .priority import urgency as urg
    date_s = format_date(t, today, cfg["agenda"].get("date_format", "auto")).ljust(5)
    title = t.title
    pri = (t.priority or "").ljust(4)
    status = t.status if t.status != "todo" else ""
    if status:
        status = f"[{status}]"
    tags = " ".join("#" + x for x in t.tags)
    bits = [date_s, title, pri, status, tags]
    line = "  ".join(b for b in bits if b.strip())
    if mode == "urgency":
        line += f"  U={urg(t, cfg=cfg):.1f}"
    return line
