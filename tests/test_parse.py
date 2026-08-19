import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ.setdefault("ATD_HOME", str(Path(__file__).parent / "tmpdata"))

from datetime import date, datetime  # noqa: E402

from atd.parse import parse, preview  # noqa: E402

NOW = datetime(2026, 8, 18, 14, 0)  # 周二
TODAY = NOW.date()
LEVELS = ["低", "中", "高"]


def p(text, **kw):
    kw.setdefault("now", NOW)
    kw.setdefault("levels", LEVELS)
    return parse(text, **kw)


class TestDates:
    def test_rel_days(self):
        assert p("后天 交笔记").due.date() == date(2026, 8, 20)
        assert p("大后天 交笔记").due.date() == date(2026, 8, 21)
        assert p("明天 开会").due.date() == date(2026, 8, 19)
        assert p("今天 收尾").due.date() == TODAY

    def test_weekday(self):
        assert p("周五 交笔记").due.date() == date(2026, 8, 21)
        assert p("下周一 开学").due.date() == date(2026, 8, 24)
        assert p("本周五 交笔记").due.date() == date(2026, 8, 21)
        assert p("礼拜三 会议").due.date() == date(2026, 8, 19)
        # 周二说"周二"→ 下周二
        assert p("周二 复盘").due.date() == date(2026, 8, 25)

    def test_numeric(self):
        assert p("8.20 采购").due.date() == date(2026, 8, 20)
        assert p("8-20 采购").due.date() == date(2026, 8, 20)
        assert p("8/20 采购").due.date() == date(2026, 8, 20)
        assert p("2026.8.20 采购").due.date() == date(2026, 8, 20)
        assert p("2026-08-20 采购").due.date() == date(2026, 8, 20)
        assert p("8月20日 采购").due.date() == date(2026, 8, 20)
        # 过去的日期保持字面，不推明年
        assert p("8-17 复盘").due.date() == date(2026, 8, 17)

    def test_month_bounds(self):
        assert p("月底 盘点").due.date() == date(2026, 8, 31)
        assert p("下月初 盘点").due.date() == date(2026, 9, 1)
        assert p("下月底 盘点").due.date() == date(2026, 9, 30)

    def test_holiday(self):
        assert p("十一 出游").due.date() == date(2026, 10, 1)

    def test_time_of_day(self):
        r = p("明天 晚上8点 开会")
        assert r.due.date() == date(2026, 8, 19)
        assert r.due.hour == 20
        r = p("明天 14:30 开会")
        assert (r.due.hour, r.due.minute) == (14, 30)
        r = p("明天 下午3点半 电话面")
        assert (r.due.hour, r.due.minute) == (15, 30)
        r = p("今晚 复盘")
        assert r.due.hour == 20

    def test_iso_with_time(self):
        r = p("2026-08-20 09:30 采购")
        assert r.due == datetime(2026, 8, 20, 9, 30)


class TestPriority:
    def test_phrases(self):
        assert p("买牛奶 很急").priority == "高"
        assert p("买牛奶 比较着急").priority == "高"
        assert p("买牛奶 特急").priority == "高"
        assert p("买牛奶 一般").priority == "中"
        assert p("买牛奶 不急").priority == "低"
        assert p("买牛奶 有空再说").priority == "低"

    def test_level_word(self):
        assert p("买牛奶 Sol").priority is None  # 未定义档位
        r = parse("买牛奶 Sol", now=NOW, levels=["Terra", "Sol"])
        assert r.priority == "Sol"
        assert r.title == "买牛奶"

    def test_no_false_positive(self):
        # "急" 出现在标题词内部不应误伤标题
        r = p("复习急性处理流程")
        assert r.priority is None
        assert "急" not in (r.priority or "")


class TestFields:
    def test_tags_project(self):
        r = p("明天 整理笔记 #工作 #周报 proj:读书")
        assert r.tags == ["工作", "周报"]
        assert r.project == "读书"
        assert r.title == "整理笔记"

    def test_reminder_at_time(self):
        r = p("后天 交笔记 @18:30")
        assert r.due.date() == date(2026, 8, 20)
        assert len(r.reminders) == 1
        assert r.reminders[0].at == datetime(2026, 8, 20, 18, 30)
        assert r.reminders[0].hooks == ["toast"]

    def test_reminder_hooks(self):
        r = p("明天 交笔记 @9:00:toast,email")
        assert r.reminders[0].hooks == ["toast", "email"]

    def test_reminder_relative(self):
        r = p("交笔记 @30m")
        assert r.reminders[0].at == NOW + __import__("datetime").timedelta(minutes=30)
        assert r.reminders[0].relative

    def test_reminder_passed_time_today_pushes_tomorrow(self):
        # 现在 14:00，@9:00 已过 → 无日期任务顺延到明天 9:00
        r = p("交笔记 @9:00")
        assert r.reminders[0].at == datetime(2026, 8, 19, 9, 0)

    def test_wait(self):
        r = p("修车回复 ~周五")
        assert r.wait == date(2026, 8, 21)
        assert r.title == "修车回复"

    def test_parent(self):
        r = p("写结论 ^ab12cd34")
        assert r.parent == "ab12cd34"

    def test_title_only(self):
        r = p("买牛奶")
        assert r.title == "买牛奶"
        assert r.due is None and r.priority is None


class TestPreview:
    def test_preview(self):
        s = preview("后天 买牛奶 很急", now=NOW, levels=LEVELS)
        assert "后天" in s and "高" in s
        assert "买牛奶" in s


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
