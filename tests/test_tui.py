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


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
