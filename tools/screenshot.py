"""TUI 截图工具：无头模式跑 TodoApp 并导出 SVG 布局快照。

Textual 原生只输出 SVG；不要把它重命名为 PNG 再用不同字体转换，否则 ASCII
横幅的斜线可能出现视觉错位。用法：python tools/screenshot.py [输出.svg] [--wide]
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

    # 截图应展示主界面；首次启动引导另有 TUI 测试覆盖。
    app = TodoApp(welcome=False)
    size = (140, 40) if wide else (100, 34)
    async with app.run_test(size=size) as pilot:
        await pilot.pause()
        out_path = Path(out).with_suffix(".svg")
        app.save_screenshot(str(out_path))
    print(f"saved: {out_path}")


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "shot.svg"
    asyncio.run(main(out, "--wide" in sys.argv))
