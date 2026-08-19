"""JSONL 存储：一行一任务，原子写，文件锁，undo 日志，归档。"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

from . import config
from .model import Task, load_jsonl, tombstone, utcnow, new_id

try:
    import msvcrt

    def _lock(f):
        msvcrt.locking(f.fileno(), msvcrt.LK_LOCK, 1)

    def _unlock(f):
        msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)

except ImportError:  # 非 Windows 兜底
    import fcntl

    def _lock(f):
        fcntl.flock(f.fileno(), fcntl.LOCK_EX)

    def _unlock(f):
        fcntl.flock(f.fileno(), fcntl.LOCK_UN)


class Store:
    def __init__(self, data_dir: Path | None = None):
        self.dir = Path(data_dir) if data_dir else config.data_dir()
        self.dir.mkdir(parents=True, exist_ok=True)
        self.tasks_file = self.dir / "tasks.jsonl"
        self.undo_file = self.dir / "undo.jsonl"
        self.archive_file = self.dir / "archive.jsonl"
        for f in (self.tasks_file, self.undo_file):
            f.touch(exist_ok=True)
        self._lockfile = self.dir / ".lock"

    # ---------- 锁 ----------
    @contextmanager
    def _locked(self):
        with open(self._lockfile, "a+") as lf:
            _lock(lf)
            try:
                yield
            finally:
                _unlock(lf)

    # ---------- 原子写 ----------
    def _atomic_write(self, path: Path, lines: list[str]) -> None:
        fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=".jsonl")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                f.write("\n".join(lines))
                if lines:
                    f.write("\n")
            os.replace(tmp, path)
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)

    # ---------- 读 ----------
    def _read_objs(self) -> list[dict]:
        text = self.tasks_file.read_text(encoding="utf-8")
        return load_jsonl(text)

    def tasks(self) -> list[Task]:
        """活跃任务（未删除的）。同 id 多行时取最后一行。"""
        latest: dict[str, dict] = {}
        for obj in self._read_objs():
            latest[obj["id"]] = obj
        out = []
        for obj in latest.values():
            if obj.get("deleted"):
                continue
            out.append(Task.from_dict(obj))
        return out

    def get(self, task_id: str) -> Task | None:
        for t in self.tasks():
            if t.id == task_id:
                return t
        return None

    def find(self, prefix: str) -> Task | None:
        """按 id 前缀找任务；唯一匹配才返回，多个则抛异常。"""
        matches = [t for t in self.tasks() if t.id.startswith(prefix)]
        if not matches:
            return None
        if len(matches) > 1:
            ids = ", ".join(t.id for t in matches)
            raise SystemExit(f"id 前缀 {prefix!r} 匹配到多个任务：{ids}")
        return matches[0]

    # ---------- 写 ----------
    def _append_undo(self, before: dict | None, after: dict | None) -> None:
        rec = {"before": before, "after": after, "ts": utcnow().isoformat(timespec="seconds")}
        with open(self.undo_file, "a", encoding="utf-8") as f:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    def save(self, task: Task, before: Task | None = None, *, record_undo: bool = True) -> Task:
        """新增或更新一个任务（整行替换），写 undo 日志。"""
        with self._locked():
            objs = self._read_objs()
            task.modified = utcnow().isoformat(timespec="seconds")
            if not task.entry:
                task.entry = task.modified
            if not task.id:
                task.id = new_id()
            new_line = task.to_line()
            # A damaged/manual JSONL file can contain several versions of one
            # task. ``tasks()`` exposes the last one, so replacing the first
            # record used to make edits appear to succeed but leave the visible
            # task unchanged. Saving is also an opportunity to canonicalize it.
            objs = [obj for obj in objs if obj.get("id") != task.id]
            objs.append(json.loads(new_line))
            self._atomic_write(self.tasks_file, [json.dumps(o, ensure_ascii=False) for o in objs])
            if record_undo:
                self._append_undo(before.to_dict() if before else None, task.to_dict())
        return task

    def delete(self, task_id: str) -> None:
        with self._locked():
            objs = self._read_objs()
            cur = None
            for obj in objs:
                if obj.get("id") == task_id and not obj.get("deleted"):
                    cur = obj
            if cur is None:
                raise SystemExit(f"找不到任务 {task_id}")
            ts = utcnow().isoformat(timespec="seconds")
            new_objs = [obj for obj in objs if obj.get("id") != task_id]
            new_objs.append(tombstone(task_id))
            self._atomic_write(self.tasks_file, [json.dumps(o, ensure_ascii=False) for o in new_objs])
            self._append_undo(cur, None)

    # ---------- undo ----------
    def undo(self) -> str:
        """回滚最近一次操作，返回描述。"""
        with self._locked():
            lines = [ln for ln in self.undo_file.read_text(encoding="utf-8").splitlines() if ln.strip()]
            if not lines:
                raise SystemExit("没有可撤销的操作")
            raw = lines[-1]
            rec = json.loads(raw)
            objs = self._read_objs()
            before, after = rec.get("before"), rec.get("after")
            if after is not None:
                tid = after["id"]
                if before is None:  # 之前是新增 -> 撤销即删除
                    new_objs = [o for o in objs if o.get("id") != tid] + [tombstone(tid)]
                    desc = f"撤销新增：{after.get('title','')}"
                else:  # 之前是修改 -> 恢复旧值
                    before = dict(before)
                    before["modified"] = utcnow().isoformat(timespec="seconds")
                    new_objs = [before if o.get("id") == tid else o for o in objs]
                    desc = f"撤销修改：{before.get('title','')}"
            else:  # 之前是删除 -> 恢复任务
                tid = rec.get("before", {}).get("id")
                restored = dict(rec["before"])
                restored["modified"] = utcnow().isoformat(timespec="seconds")
                new_objs = [restored if o.get("id") == tid else o for o in objs]
                desc = f"撤销删除：{restored.get('title','')}"
            self._atomic_write(self.tasks_file, [json.dumps(o, ensure_ascii=False) for o in new_objs])
            self._atomic_write(self.undo_file, lines[:-1])
        return desc

    # ---------- 归档 ----------
    def archive(self, days: int = 14) -> int:
        """done / 删除超过 N 天的行移入 archive.jsonl。返回移动行数。"""
        with self._locked():
            objs = self._read_objs()
            now = utcnow()
            keep, moved = [], []
            for obj in objs:
                mod = obj.get("modified", "")
                try:
                    age_days = (now - datetime.fromisoformat(mod)).days if mod else 999
                except ValueError:
                    age_days = 999
                stale = (obj.get("deleted") or obj.get("status") in ("done", "cancelled")) and age_days >= days
                if stale:
                    moved.append(obj)
                else:
                    keep.append(obj)
            if moved:
                with open(self.archive_file, "a", encoding="utf-8") as f:
                    for obj in moved:
                        f.write(json.dumps(obj, ensure_ascii=False) + "\n")
                self._atomic_write(self.tasks_file, [json.dumps(o, ensure_ascii=False) for o in keep])
            return len(moved)

    def archived(self) -> list[dict]:
        """archive.jsonl 里全部历史任务（含 deleted 墓碑）。"""
        if not self.archive_file.exists():
            return []
        return load_jsonl(self.archive_file.read_text(encoding="utf-8"))

    def restore(self, task_id: str) -> dict:
        """把归档的任务恢复到 tasks.jsonl。已 deleted 的恢复为 todo；其余保持原状态。"""
        with self._locked():
            objs = self._read_objs()
            archive_objs = self.archived()
            found = None
            for obj in archive_objs:
                if obj.get("id") == task_id:
                    found = obj
                    break
            if found is None:
                # 支持前缀：唯一匹配才恢复
                matches = [o for o in archive_objs if o.get("id", "").startswith(task_id)]
                if len(matches) == 1:
                    found = matches[0]
                elif len(matches) > 1:
                    ids = ", ".join(o["id"] for o in matches)
                    raise SystemExit(f"前缀 {task_id!r} 匹配多个归档任务：{ids}")
            if found is None:
                raise SystemExit(f"归档里找不到任务 {task_id}（用 atd archive list 查看）")
            restored = dict(found)
            restored["modified"] = utcnow().isoformat(timespec="seconds")
            if restored.get("deleted"):
                restored.pop("deleted", None)
                restored["status"] = "todo"
            # 从归档移除，加回 tasks.jsonl（同 id 已存在则替换）
            archive_objs = [o for o in archive_objs if o.get("id") != restored["id"]]
            replaced = False
            for i, o in enumerate(objs):
                if o.get("id") == restored["id"]:
                    objs[i] = restored
                    replaced = True
                    break
            if not replaced:
                objs.append(restored)
            self._atomic_write(self.tasks_file, [json.dumps(o, ensure_ascii=False) for o in objs])
            self._atomic_write(self.archive_file,
                               [json.dumps(o, ensure_ascii=False) for o in archive_objs])
            return restored
