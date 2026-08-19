import json
import os
import sys
from datetime import date, datetime, timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from atd.model import Task, new_id, utcnow  # noqa: E402
from atd.priority import urgency, sort_tasks  # noqa: E402
from atd.storage import Store  # noqa: E402
from atd.query import filter_tasks  # noqa: E402

CFG = {
    "priority": {
        "mode": "levels",
        "levels": ["低", "中", "高"],
        "urgency": {
            "overdue": 12.0, "due_today": 8.0, "due_week_decay": 8.0,
            "per_level": 3.0, "age_per_day": 0.05, "age_cap": 2.0,
            "waiting_penalty": 3.0,
        },
    },
    "agenda": {"week_days": 7},
    "watch": {"interval_seconds": 30},
    "email": {},
}


def mk(**kw):
    base = dict(id=new_id(), title=kw.pop("title", "t"),
                entry=utcnow().isoformat(timespec="seconds"),
                modified=utcnow().isoformat(timespec="seconds"))
    base.update(kw)
    return Task(**base)


TODAY = date(2026, 8, 18)
NOW = datetime(2026, 8, 18, 14, 0)


class TestUrgency:
    def test_overdue_beats_normal(self):
        over = mk(title="over", due=datetime(2026, 8, 15, 9))
        future = mk(title="future", due=datetime(2026, 8, 25, 9), priority="高")
        assert urgency(over, cfg=CFG, now=NOW) > 0
        assert sort_tasks([future, over], mode="urgency", cfg=CFG, now=NOW)[0] is over

    def test_due_today(self):
        today = mk(title="today", due=datetime(2026, 8, 18, 18))
        assert urgency(today, cfg=CFG, now=NOW) == CFG["priority"]["urgency"]["due_today"]

    def test_week_decay(self):
        d3 = mk(title="d3", due=datetime(2026, 8, 21, 9))
        # 3 天后：8.0 * (1 - 3/7)，保留 3 位小数
        assert urgency(d3, cfg=CFG, now=NOW) == pytest.approx(8.0 * (1 - 3 / 7), abs=1e-3)

    def test_waiting_penalty(self):
        w = mk(title="w", status="waiting", priority="高")
        n = mk(title="n", priority="高")
        assert urgency(w, cfg=CFG, now=NOW) == urgency(n, cfg=CFG, now=NOW) - 3.0


class TestSortLevels:
    def test_date_first_then_level(self):
        a = mk(title="明天低", due=datetime(2026, 8, 19, 9), priority="低")
        b = mk(title="明天高", due=datetime(2026, 8, 19, 10), priority="高")
        c = mk(title="后天高", due=datetime(2026, 8, 20, 9), priority="高")
        out = sort_tasks([c, a, b], mode="levels", cfg=CFG, now=NOW)
        assert [t.title for t in out] == ["明天高", "明天低", "后天高"]


class TestQuery:
    def test_filters(self):
        tasks = [
            mk(title="读书笔记", due=datetime(2026, 8, 17, 10), tags=["会议"], project="读书"),
            mk(title="整理笔记", due=datetime(2026, 8, 19, 10), priority="高"),
            mk(title="修车", status="waiting", wait=date(2026, 8, 21)),
        ]
        assert [t.title for t in filter_tasks(tasks, "overdue", today=TODAY)] == ["读书笔记"]
        assert [t.title for t in filter_tasks(tasks, "due:tomorrow", today=TODAY)] == ["整理笔记"]
        assert [t.title for t in filter_tasks(tasks, "+会议", today=TODAY)] == ["读书笔记"]
        assert [t.title for t in filter_tasks(tasks, "project:读书", today=TODAY)] == ["读书笔记"]
        assert [t.title for t in filter_tasks(tasks, "status:waiting", today=TODAY)] == ["修车"]
        assert [t.title for t in filter_tasks(tasks, "/整理", today=TODAY)] == ["整理笔记"]
        assert [t.title for t in filter_tasks(tasks, "-高", today=TODAY)] == ["读书笔记", "修车"]


@pytest.fixture()
def store(tmp_path):
    return Store(tmp_path)


class TestStore:
    def test_add_get_delete_undo(self, store):
        t = mk(title="买牛奶")
        store.save(t)
        assert store.get(t.id).title == "买牛奶"
        store.delete(t.id)
        assert store.get(t.id) is None
        desc = store.undo()
        assert "撤销删除" in desc
        assert store.get(t.id).title == "买牛奶"

    def test_undo_modify(self, store):
        t = mk(title="旧标题")
        store.save(t)
        before = Task.from_dict(t.to_dict())
        t.title = "新标题"
        store.save(t, before=before)
        assert store.get(t.id).title == "新标题"
        store.undo()
        assert store.get(t.id).title == "旧标题"

    def test_prefix_find(self, store):
        t = mk(title="x")
        store.save(t)
        assert store.find(t.id[:4]).id == t.id

    def test_reminder_persist(self, store):
        t = mk(title="带提醒", reminders=[{"at": "2026-08-18T18:00", "hooks": ["toast"], "fired": False}])
        store.save(t)
        got = store.get(t.id)
        assert got.reminders[0]["hooks"] == ["toast"]

    def test_archive_roundtrip(self, store):
        from datetime import datetime as dt, timedelta as td
        import json
        old = mk(title="老任务", status="done")
        store.save(old)
        fresh = mk(title="新任务", status="done")
        store.save(fresh)
        # 把老任务的 modified 改成 30 天前（save 会重写 modified，所以先存再改）
        objs = []
        for ln in store.tasks_file.read_text(encoding="utf-8").splitlines():
            if ln.strip():
                o = json.loads(ln)
                if o.get("id") == old.id:
                    o["modified"] = (utcnow() - td(days=30)).isoformat(timespec="seconds")
                objs.append(o)
        store._atomic_write(store.tasks_file, [json.dumps(o, ensure_ascii=False) for o in objs])
        n = store.archive(days=14)
        assert n == 1  # 只有超过 14 天的老任务被归档
        assert store.get(old.id) is None
        assert store.get(fresh.id) is not None
        assert len(store.archived()) == 1
        # 恢复
        restored = store.restore(old.id)
        assert store.get(old.id).title == "老任务"
        assert store.get(old.id).status == "done"
        assert len(store.archived()) == 0

    def test_archive_restore_deleted_becomes_todo(self, store):
        from datetime import timedelta as td
        t = mk(title="已删除任务")
        store.save(t)
        store.delete(t.id)
        # 改 modified 为 30 天前再归档
        objs = []
        for ln in store.tasks_file.read_text(encoding="utf-8").splitlines():
            if ln.strip():
                import json
                o = json.loads(ln)
                if o.get("id") == t.id:
                    o["modified"] = (utcnow() - td(days=30)).isoformat(timespec="seconds")
                objs.append(o)
        store._atomic_write(store.tasks_file, [json.dumps(o, ensure_ascii=False) for o in objs])
        assert store.archive(days=14) == 1
        restored = store.restore(t.id)
        assert "deleted" not in restored
        assert restored["status"] == "todo"
        assert store.get(t.id).status == "todo"

    def test_reopen(self, store):
        t = mk(title="完成的任务", status="done", end="2026-08-18T10:00:00+00:00")
        store.save(t)
        got = store.get(t.id)
        got.status = "todo"
        got.end = None
        for r in got.reminders or []:
            r["fired"] = False
        store.save(got, before=t)
        reopened = store.get(t.id)
        assert reopened.status == "todo"
        assert reopened.end is None


class TestAgenda:
    def test_finished_hidden_by_default_shown_on_status_query(self):
        from atd.agenda import groups
        done = mk(title="已完成事项", status="done")
        open_ = mk(title="进行中")
        # 默认议程不显示终态任务
        gs = groups([done, open_], cfg=CFG, now=NOW)
        assert all("已完成" not in g.name for g in gs)
        # 显式 status:done 时给出终态组
        gs2 = groups([done, open_], cfg=CFG, query="status:done", now=NOW)
        assert any(g.name == "已完成/已取消" and any(t is done for t in g.tasks) for g in gs2)

    def test_date_format_modes(self):
        from datetime import datetime as dt
        from atd.agenda import format_date
        today = date(2026, 8, 19)
        t = mk(title="任务", due=dt(2026, 8, 17, 9))
        assert format_date(t, today, "auto").startswith("超")
        assert format_date(t, today, "md") == "8/17"
        assert format_date(t, today, "full") == "2026-08-17"


class TestSyncMerge:
    def test_union_merge(self):
        from atd.sync import _merge_union
        ours = [
            json.dumps({"id": "a", "title": "A-v2", "modified": "2026-08-18T10:00:00+00:00"}, ensure_ascii=False),
            json.dumps({"id": "b", "title": "B-local", "modified": "2026-08-18T09:00:00+00:00"}, ensure_ascii=False),
        ]
        theirs = [
            json.dumps({"id": "a", "title": "A-v1", "modified": "2026-08-18T08:00:00+00:00"}, ensure_ascii=False),
            json.dumps({"id": "c", "title": "C-remote", "modified": "2026-08-18T09:30:00+00:00"}, ensure_ascii=False),
        ]
        merged = _merge_union(ours, theirs)
        m = {json.loads(ln)["id"]: json.loads(ln) for ln in merged}
        assert m["a"]["title"] == "A-v2"  # 新 modified 胜
        assert m["b"]["title"] == "B-local"
        assert m["c"]["title"] == "C-remote"  # 并集

    def test_tombstone_wins(self):
        from atd.sync import _merge_union
        ours = [json.dumps({"id": "a", "deleted": True, "modified": "2026-08-18T10:00:00+00:00"})]
        theirs = [json.dumps({"id": "a", "title": "旧编辑", "modified": "2026-08-18T11:00:00+00:00"})]
        merged = _merge_union(ours, theirs)
        assert json.loads(merged[0]).get("deleted") is True  # 删除优先，即使远端更新


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
