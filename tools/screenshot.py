"""TUI 截图工具：无头模式跑 TodoApp 并导出 PNG，用于快速验证视觉效果。

用法：python tools/screenshot.py [输出.png] [--wide]
"""
import asyncio
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

DEMO = [
    "后天 买牛奶 Sol @18:30",
    "明天 写个TODO List Terra #dev proj:采购",
    "8-17 读书笔记 Sol",
    "今晚 例会 #meeting proj:项目组",
    "修自行车 ~下周一 Terra",
    "整理桌面 有空再说",
    "订水 @2h",
]


async def main(out: str, wide: bool) -> None:
    os.environ["ATD_HOME"] = str(Path(__file__).resolve().parents[1] / "tests" / "shot-data")
    from atd.tui import TodoApp

    # 灌入演示数据（幂等：先清）
    from atd.storage import Store
    dd = Path(os.environ["ATD_HOME"])
    dd.mkdir(parents=True, exist_ok=True)
    for f in ("tasks.jsonl", "undo.jsonl"):
        p = dd / f
        if p.exists():
            p.unlink()
    store = Store()
    from atd.model import Task, new_id, utcnow
    from atd.parse import parse
    from atd import config
    levels = config.levels(config.load())
    for line in DEMO:
        p = parse(line, levels=levels)
        store.save(Task(id=new_id(), title=p.title, due=p.due, priority=p.priority,
                        tags=p.tags, project=p.project, wait=p.wait,
                        reminders=[r.to_dict() for r in p.reminders],
                        entry=utcnow().isoformat(timespec="seconds")))

    app = TodoApp()
    size = (140, 40) if wide else (100, 34)
    async with app.run_test(size=size) as pilot:
        await pilot.pause()
        app.save_screenshot(out)
        svg = str(Path(out).with_suffix(".svg"))
        try:
            app.save_screenshot(svg)
        except Exception as e:
            print(f"(svg export skipped: {e})")
    print(f"saved: {out}")


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "shot.png"
    asyncio.run(main(out, "--wide" in sys.argv))
