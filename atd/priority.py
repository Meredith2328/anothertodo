"""优先级双模式：档位（levels）与加权评分（urgency）。"""
from __future__ import annotations

from datetime import date, datetime, timedelta

from . import config
from .model import Task


def level_rank(task: Task, levels: list[str]) -> int:
    """档位序号，越大越优先；无档位视为最低。"""
    try:
        return levels.index(task.priority)
    except ValueError:
        return -1


def urgency(task: Task, *, cfg: dict | None = None, now: datetime | None = None) -> float:
    """TaskWarrior 式加权评分，系数取自 config 的 priority.urgency 段。"""
    cfg = cfg or config.load()
    u = cfg["priority"]["urgency"]
    now = now or datetime.now()
    today = now.date()
    score = 0.0
    if task.due is not None:
        dd = task.due.date()
        if task.status == "todo":
            if dd < today:
                overdue_days = min((today - dd).days, 7)
                score += u["overdue"] * overdue_days / 7.0
            elif dd == today:
                score += u["due_today"]
            else:
                ahead = (dd - today).days
                if ahead <= 7:
                    score += u["due_week_decay"] * (1 - ahead / 7.0)
    levels = config.levels(cfg)
    if task.priority and task.priority in levels:
        score += u["per_level"] * (levels.index(task.priority) + 1) / len(levels)
    if task.entry:
        try:
            entry = datetime.fromisoformat(task.entry)
            if entry.tzinfo is not None:
                entry = entry.astimezone().replace(tzinfo=None)
            age_days = max((now - entry).days, 0)
            score += min(age_days * u["age_per_day"], u["age_cap"])
        except ValueError:
            pass
    if task.status == "waiting":
        score -= u["waiting_penalty"]
    return round(score, 3)


def sort_key(task: Task, *, mode: str, cfg: dict | None = None, levels: list[str] | None = None,
             now: datetime | None = None) -> tuple:
    """统一排序键：逾期最先、今天次之；档位模式按日期升序再按档位，
    urgency 模式按分数降序再按日期。"""
    cfg = cfg or config.load()
    levels = levels or config.levels(cfg)
    now = now or datetime.now()
    today = now.date()
    if task.due is not None:
        dd = task.due.date()
        if task.status == "todo" and dd < today:
            bucket = 0  # 逾期（日期升序 = 超得最久的在前）
        elif dd == today:
            bucket = 1
        else:
            bucket = 2
        due_ord = (dd - date(2000, 1, 1)).days
    else:
        bucket, due_ord = 3, 99999
    if mode == "urgency":
        return (bucket, -urgency(task, cfg=cfg, now=now), due_ord, task.title)
    return (bucket, due_ord, -level_rank(task, levels), task.title)


def sort_tasks(tasks: list[Task], *, mode: str | None = None, cfg: dict | None = None,
               now: datetime | None = None) -> list[Task]:
    cfg = cfg or config.load()
    mode = mode or config.priority_mode(cfg)
    levels = config.levels(cfg)
    return sorted(tasks, key=lambda t: sort_key(t, mode=mode, cfg=cfg, levels=levels, now=now))
