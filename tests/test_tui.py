"""TUI 无头冒烟：全键盘流程（默认焦点在列表，打字自动进输入框）。"""
import asyncio
import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["ATD_HOME"] = str(Path(__file__).parent / "tui-data")


@pytest.fixture()
def clean_home():
    dd = Path(os.environ["ATD_HOME"])
    for f in ("tasks.jsonl", "undo.jsonl", ".welcome_shown"):
        p = dd / f
        if p.exists():
            p.unlink()
    dd.mkdir(parents=True, exist_ok=True)
    yield


async def _drive():
    from atd.tui import TodoApp
    from textual.widgets import DataTable, Input, Static

    def s_text(w) -> str:
        for attr in ("_content", "visual", "_visual"):
            v = getattr(w, attr, None)
            if v:
                return str(v)
        return w.__str__()

    app = TodoApp(welcome=False)  # 跳过首次运行引导，测试焦点断言
    async with app.run_test() as pilot:
        inp = app.query_one("#input", Input)
        pv = app.query_one("#preview", Static)

        # 0. 默认焦点在列表（全键盘，无需鼠标/手动聚焦）
        assert isinstance(app.focused, DataTable)

        # 1. 列表态输入（模拟输入法整串提交）：自动进输入框，预览出现解析结果
        inp.value = "后天 买牛奶 很急 @18:30"
        inp.focus()
        await pilot.pause()
        assert isinstance(app.focused, Input)
        assert "后天" in s_text(pv)

        # 2. 回车添加，焦点回列表
        await pilot.press("enter")
        await pilot.pause()
        table = app.query_one("#table", DataTable)
        assert table.row_count >= 1
        assert "买牛奶" in app.store.tasks()[0].title
        assert isinstance(app.focused, DataTable)

        # 3. 列表态 d = 完成选中（现在无需任何额外操作）
        await pilot.press("d")
        await pilot.pause()
        assert app.store.tasks()[0].status == "done"

        # 4. 列表态 : 命令 → 输入框预填 ":"；回车执行撤销
        await pilot.press(":")
        await pilot.pause()
        assert inp.value == ":"
        for ch in "undo":
            await pilot.press(ch)
        await pilot.press("enter")
        await pilot.pause()
        assert app.store.tasks()[0].status == "todo"
        assert isinstance(app.focused, DataTable)

        # 5. 列表态 / 搜索 → 输入框预填 "/"
        await pilot.press("/")
        await pilot.pause()
        assert inp.value == "/"
        inp.value += "买牛奶"
        await pilot.pause()
        await pilot.press("enter")
        await pilot.pause()
        assert app.query == "买牛奶"
        assert len(app.store.tasks()) == 1

        # 5.5 j/k 移动光标 + g/G 跳转
        await pilot.press("j")
        await pilot.press("k")
        await pilot.press("g")
        await pilot.press("G")
        await pilot.pause()

        # 6. 切换 urgency 模式
        await pilot.press(":")
        for ch in "mode urgency":
            await pilot.press(ch)
        await pilot.press("enter")
        await pilot.pause()
        assert app.mode == "urgency"

        # 7. Ctrl+Z 撤销（列表态直接触发）
        for ch in "买牛奶2":
            await pilot.press(ch)
        await pilot.press("enter")  # 添加
        await pilot.pause()
        assert len(app.store.tasks()) == 2
        await pilot.press("ctrl+z")
        await pilot.pause()
        assert len(app.store.tasks()) == 1

        # 7.5 无撤销项、非法归档天数、非法查询不应让 TUI 退出
        app.store._atomic_write(app.store.undo_file, [])
        await app._run_command("undo")
        assert "没有可撤销" in app._flash_msg
        await app._run_command("archive nope")
        assert "invalid literal" in app._flash_msg
        await app._run_command("list unknown:value")
        assert "不认识的过滤器" in app._flash_msg

        # 8. ? 帮助面板（列表焦点触发）
        await pilot.press("question_mark")
        await pilot.pause()
        from atd.tui import HelpScreen
        assert isinstance(app.screen, HelpScreen)
        await pilot.press("escape")
        await pilot.pause()
        assert not isinstance(app.screen, HelpScreen)

        # 8.5 输入区 Esc → 回清单区（且不清空已输入内容时也回）
        await pilot.press("i")  # 走真实按键进输入区（设焦点标志）
        inp.value = "打了一半"
        await pilot.press("escape")
        await pilot.pause()
        assert isinstance(app.focused, DataTable)
        assert inp.value == ""  # Esc 清空输入并回清单

        # 8.6 输入区已空按 Esc → 直接回清单（不进入退出待命）
        await pilot.press("i")
        await pilot.press("escape")
        await pilot.pause()
        assert isinstance(app.focused, DataTable)

        # 8.7 未同步标志的聚焦（鼠标点击输入框）后按 Esc → 也回清单
        inp.focus()  # 直接 focus，不设 _input_focused（模拟鼠标点击）
        await pilot.pause()
        await pilot.press("escape")
        await pilot.pause()
        assert isinstance(app.focused, DataTable)

        # 8.8 帮助面板关闭后按 Esc → 回清单（焦点恢复但标志未同步）
        await pilot.press("i")
        await pilot.press("question_mark")
        await pilot.pause()
        await pilot.press("escape")  # 关帮助
        await pilot.pause()
        await pilot.press("escape")  # 应回清单而非待命退出
        await pilot.pause()
        assert isinstance(app.focused, DataTable)

        # 8.9 清单区待命后进输入区再 Esc → 回清单，不误触发双击退出
        await pilot.press("escape")
        await pilot.pause()
        assert "Esc" in app._flash_msg  # 清单区待命
        await pilot.press("i")
        await pilot.press("escape")
        await pilot.pause()
        assert isinstance(app.focused, DataTable)

        # 9. 双击 Esc 退出：第一次待命，第二次退出
        await pilot.press("escape")
        await pilot.pause()
        assert "Esc" in app._flash_msg
        await pilot.press("escape")
        await pilot.pause()
    return True


def test_tui_flow(clean_home):
    assert asyncio.run(_drive())


async def _drive_remaining_shortcuts():
    """Exercise every mutation/navigation shortcut not covered by the main flow."""
    from unittest.mock import patch
    from atd.model import Task, new_id, utcnow
    from atd.tui import TodoApp
    from textual.widgets import DataTable, Input

    app = TodoApp(welcome=False)
    task = Task(id=new_id(), title="快捷键任务", tags=["工作"], entry=utcnow().isoformat())
    app.store.save(task)
    async with app.run_test() as pilot:
        inp = app.query_one("#input", Input)
        assert isinstance(app.focused, DataTable)

        # 空输入框时 Enter 作用于清单：完成，再由 u 撤销。
        await pilot.press("enter")
        assert app.store.get(task.id).status == "done"
        await pilot.press("u")
        assert app.store.get(task.id).status == "todo"

        # e / Esc：编辑并取消；w / u：等待和撤销；x / u：删除和撤销。
        await pilot.press("e")
        assert app.editing_id == task.id and isinstance(app.focused, Input)
        await pilot.press("escape")
        assert app.editing_id is None and isinstance(app.focused, DataTable)
        await pilot.press("w")
        assert app.store.get(task.id).status == "waiting"
        await pilot.press("u")
        assert app.store.get(task.id).status == "todo"
        await pilot.press("x")
        assert app.store.get(task.id) is None
        await pilot.press("u")
        assert app.store.get(task.id) is not None

        # 1 / 2 / t / r：排序、日期显示和配置刷新。
        await pilot.press("1")
        assert app.mode == "levels"
        await pilot.press("2")
        assert app.mode == "urgency"
        old_format = app.date_format
        await pilot.press("t")
        assert app.date_format != old_format
        await pilot.press("r")
        assert app.mode in ("levels", "urgency")

        # i / Tab：输入焦点与标签补全；Ctrl+F：搜索输入。
        await pilot.press("i")
        inp.value = "新任务 #"
        await pilot.press("tab")
        assert inp.value.endswith("#工作 ")
        await pilot.press("escape")
        await pilot.press("ctrl+f")
        assert inp.value == "/" and isinstance(app.focused, Input)
        await pilot.press("escape")

        await pilot.press("f1")
        from atd.tui import HelpScreen
        assert isinstance(app.screen, HelpScreen)
        await pilot.press("escape")

        # Ctrl+S uses the same command path but is mocked to avoid real git I/O.
        with patch("atd.tui.sync.sync", return_value="同步测试完成"):
            await pilot.press("ctrl+s")
            await pilot.pause()
        assert app._flash_msg == "同步测试完成"

        # Q exits exactly like its documented uppercase shortcut.
        await pilot.press("Q")
    return True


def test_tui_remaining_shortcuts(clean_home):
    assert asyncio.run(_drive_remaining_shortcuts())


async def _drive_ctrl_q():
    from atd.tui import TodoApp

    app = TodoApp(welcome=False)
    async with app.run_test() as pilot:
        await pilot.press("ctrl+q")
    return True


def test_tui_ctrl_q_quits(clean_home):
    assert asyncio.run(_drive_ctrl_q())


def test_banner_uses_a_stable_variant_at_each_width():
    from atd.tui import BANNER_FULL, BANNER_SMALL, _banner_text

    assert str(_banner_text(140)).count("\n") >= len(BANNER_FULL)
    assert str(_banner_text(40)).count("\n") >= len(BANNER_SMALL)


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
