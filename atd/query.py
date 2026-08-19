"""过滤查询语法：`due:today status:waiting project:读书 +urgent -低 /关键字 overdue`，空格为 AND。"""
from __future__ import annotations

import re
from datetime import date, datetime, timedelta

from .model import Task
from .parse import scan_date


class QueryError(ValueError):
    pass


def _parse_filter_value(raw: str, today: date) -> object:
    """把 filter 冒号后的值解析成日期/字符串。"""
    v = raw.strip()
    if v == "today":
        return today
    if v == "tomorrow":
        return today + timedelta(days=1)
    if v == "yesterday":
        return today - timedelta(days=1)
    if v in ("week", "thisweek"):
        return ("range", today - timedelta(days=today.weekday()), today + timedelta(days=6 - today.weekday()))
    r = scan_date(v, today)
    if r:
        return r[1]
    return v


def compile_query(q: str, *, today: date | None = None, levels: list[str] | None = None) -> list:
    """把查询字符串编译成谓词列表。"""
    today = today or date.today()
    levels = levels or ["低", "中", "高"]
    preds = []
    tokens = q.split()
    if not tokens:
        return []
    for tok in tokens:
        if tok == "overdue":
            preds.append(("overdue", None))
            continue
        m = re.fullmatch(r"\+([^\s+]+)", tok)
        if m:
            preds.append(("tag", m.group(1)))
            continue
        m = re.fullmatch(r"-([^\s-]+)", tok)
        if m:
            v = m.group(1)
            if v in levels:
                preds.append(("notlevel", v))
            else:
                preds.append(("nottag", v))
            continue
        m = re.fullmatch(r"/(.*)", tok)
        if m:
            preds.append(("kw", m.group(1).lower()))
            continue
        m = re.fullmatch(r"([a-zA-Z]+):(.*)", tok)
        if m:
            key, val = m.group(1).lower(), m.group(2)
            if key == "due":
                sub = None
                if val.startswith("before:"):
                    sub, val = "before", val[7:]
                elif val.startswith("after:"):
                    sub, val = "after", val[6:]
                parsed = _parse_filter_value(val, today)
                preds.append(("due", sub, parsed))
            elif key in ("status", "st"):
                preds.append(("status", val.lower()))
            elif key in ("project", "proj"):
                preds.append(("project", val))
            elif key == "priority":
                preds.append(("level", val))
            elif key == "wait":
                preds.append(("wait", _parse_filter_value(val, today)))
            else:
                raise QueryError(f"不认识的过滤器：{key}")
            continue
        # 裸词 → 关键字匹配
        preds.append(("kw", tok.lower()))
    return preds


def match(task: Task, preds: list, *, today: date | None = None) -> bool:
    today = today or date.today()
    for pred in preds:
        kind = pred[0]
        if kind == "kw":
            if pred[1] not in task.title.lower() and not any(pred[1] in t.lower() for t in task.tags):
                return False
        elif kind == "tag":
            if pred[1] not in task.tags:
                return False
        elif kind == "nottag":
            if pred[1] in task.tags:
                return False
        elif kind == "level":
            if (task.priority or "") != pred[1]:
                return False
        elif kind == "notlevel":
            if (task.priority or "") == pred[1]:
                return False
        elif kind == "status":
            if task.status != pred[1]:
                return False
        elif kind == "project":
            if (task.project or "") != pred[1]:
                return False
        elif kind == "overdue":
            if not task.is_overdue(today):
                return False
        elif kind == "wait":
            v = pred[1]
            if isinstance(v, date):
                if task.wait != v:
                    return False
            elif task.wait is not None:
                return False
        elif kind == "due":
            _, sub, v = pred
            if isinstance(v, tuple) and v and v[0] == "range":
                if task.due is None or not (v[1] <= task.due.date() <= v[2]):
                    return False
            elif isinstance(v, date):
                if task.due is None:
                    return False
                dd = task.due.date()
                if sub == "before":
                    if not dd < v:
                        return False
                elif sub == "after":
                    if not dd > v:
                        return False
                elif dd != v:
                    return False
            else:  # 字符串匹配不到日期就当文本比较（几乎不会发生）
                if (task.due or "") and v != "":
                    return False
    return True


def filter_tasks(tasks: list[Task], q: str, *, today: date | None = None) -> list[Task]:
    preds = compile_query(q, today=today)
    if not preds:
        return list(tasks)
    return [t for t in tasks if match(t, preds, today=today)]
