"""任务数据模型与 JSONL 序列化。"""
from __future__ import annotations

import json
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timezone

# 内置状态；config 里可加自定义状态名（小写）
DEFAULT_STATES = ["todo", "waiting", "done", "cancelled", "meeting"]
ACTIVE_STATES = {"todo", "waiting", "meeting"}
OPEN_STATES = {"todo"}  # 出现在 agenda 主体里的状态


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def new_id() -> str:
    return uuid.uuid4().hex[:8]


def parse_dt(s: str | None) -> datetime | None:
    if not s:
        return None
    return datetime.fromisoformat(s)


@dataclass
class Task:
    id: str
    title: str = ""
    status: str = "todo"
    due: datetime | None = None
    priority: str | None = None  # 档位名（levels 之一）
    tags: list[str] = field(default_factory=list)
    project: str | None = None
    parent: str | None = None
    wait: date | None = None
    notes: str = ""
    reminders: list[dict] = field(default_factory=list)  # {at, hooks[], fired, attempts}
    entry: str = ""  # ISO(UTC)
    modified: str = ""  # ISO(UTC)，同步合并时以它为准
    end: str | None = None

    # ---------- 视图辅助 ----------
    @property
    def due_date(self) -> date | None:
        return self.due.date() if self.due else None

    def is_overdue(self, today: date) -> bool:
        return self.status == "todo" and self.due_date is not None and self.due_date < today

    def hidden_by_wait(self, today: date) -> bool:
        return self.wait is not None and self.wait > today

    def modified_dt(self) -> datetime:
        return parse_dt(self.modified) or datetime.min.replace(tzinfo=timezone.utc)

    # ---------- 序列化 ----------
    def to_dict(self) -> dict:
        d = {
            "id": self.id,
            "title": self.title,
            "status": self.status,
        }
        if self.due is not None:
            d["due"] = self.due.isoformat()
        if self.priority:
            d["priority"] = self.priority
        if self.tags:
            d["tags"] = self.tags
        if self.project:
            d["project"] = self.project
        if self.parent:
            d["parent"] = self.parent
        if self.wait is not None:
            d["wait"] = self.wait.isoformat()
        if self.notes:
            d["notes"] = self.notes
        if self.reminders:
            d["reminders"] = self.reminders
        d["entry"] = self.entry
        d["modified"] = self.modified
        if self.end:
            d["end"] = self.end
        return d

    def to_line(self) -> str:
        return json.dumps(self.to_dict(), ensure_ascii=False)

    @classmethod
    def from_dict(cls, d: dict) -> "Task":
        return cls(
            id=d["id"],
            title=d.get("title", ""),
            status=d.get("status", "todo"),
            due=parse_dt(d.get("due")),
            priority=d.get("priority"),
            tags=list(d.get("tags", [])),
            project=d.get("project"),
            parent=d.get("parent"),
            wait=date.fromisoformat(d["wait"]) if d.get("wait") else None,
            notes=d.get("notes", ""),
            reminders=list(d.get("reminders", [])),
            entry=d.get("entry", ""),
            modified=d.get("modified", ""),
            end=d.get("end"),
        )


def tombstone(task_id: str) -> dict:
    return {"id": task_id, "deleted": True, "modified": utcnow().isoformat(timespec="seconds")}


def line_payload(obj: dict) -> dict:
    """一行 JSON 的统一形态：要么 tombstone（deleted=true），要么任务。"""
    return obj


def load_jsonl(text: str) -> list[dict]:
    out = []
    for ln in text.splitlines():
        ln = ln.strip()
        if not ln or ln.startswith(("<<<<<<<", "=======", ">>>>>>>")):
            # git 冲突标记行不是 JSON，静默跳过（sync 合并的中间态）
            continue
        try:
            out.append(json.loads(ln))
        except json.JSONDecodeError:
            import sys
            print(f"atd: 跳过无法解析的行：{ln[:60]}", file=sys.stderr)
    return out
