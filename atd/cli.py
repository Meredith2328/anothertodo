"""atd 命令行入口：子命令 + `atd`（无参数）进 TUI。"""
from __future__ import annotations

import argparse
import sys
from datetime import date, datetime

from . import config, sync
from .model import Task, new_id, utcnow
from .parse import parse, preview as parse_preview, task_to_input
from .priority import sort_tasks, urgency
from .runtime import configure_utf8_output
from .storage import Store
from .task_ops import apply_parsed_update

# rich 是 textual 的依赖，这里直接用于 CLI 着色输出
from rich.console import Console
from rich.table import Table

configure_utf8_output()
console = Console()


def _store() -> Store:
    return Store()


def _now_levels():
    cfg = config.load()
    return cfg, config.levels(cfg)


# ---------------------------------------------------------------- add

def cmd_add(argv: list[str]) -> int:
    if not argv:
        console.print("[red]用法：atd add \"后天 买牛奶 很急 @18:00\"[/red]")
        return 2
    cfg, levels = _now_levels()
    store = _store()
    for raw in argv:
        p = parse(raw, levels=levels)
        if not p.title:
            console.print(f"[red]无法解析出标题：{raw}[/red]")
            return 2
        t = Task(
            id=new_id(),
            title=p.title,
            due=p.due,
            priority=p.priority,
            tags=p.tags,
            project=p.project,
            parent=p.parent,
            wait=p.wait,
            reminders=[r.to_dict() for r in p.reminders],
            entry=utcnow().isoformat(timespec="seconds"),
            modified=utcnow().isoformat(timespec="seconds"),
        )
        if p.due_has_time is False and p.due is not None:
            t.due = p.due
        store.save(t)
        console.print(f"[green]已添加[/green] {t.id}  {parse_preview(raw, levels=levels)[2:]}")
    return 0


# ---------------------------------------------------------------- list

def _print_tasks(store: Store, query: str, mode: str | None) -> None:
    from .agenda import groups, render_line
    cfg = config.load()
    mode = mode or config.priority_mode(cfg)  # 未指定 -m 时用配置里的默认模式
    now = datetime.now()
    tasks = store.tasks()
    gs = groups(tasks, cfg=cfg, mode=mode, now=now, query=query)
    if not any(g.tasks for g in gs):
        console.print("[dim]（没有匹配的任务）[/dim]")
        return
    for g in gs:
        if not g.tasks and "隐藏" in g.name:
            console.print(f"[dim]{g.name}[/dim]")
            continue
        if not g.tasks:
            continue
        console.print(f"[{g.style}]== {g.name} ==[/{g.style}]")
        for i, t in enumerate(g.tasks):
            console.print(f"  [dim]{t.id:<8}[/dim] {render_line(t, cfg=cfg, today=now.date(), mode=mode)}")


def cmd_list(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="atd list", add_help=False)
    ap.add_argument("-m", "--mode", choices=["levels", "urgency"], default=None)
    ap.add_argument("query", nargs="*", default=[])
    known, extra = ap.parse_known_args(argv)
    if extra:
        # extra 里可能是查询词
        known.query = (known.query or []) + extra
    _print_tasks(_store(), " ".join(known.query), known.mode)
    return 0


# ---------------------------------------------------------------- done / rm / edit / show

def _resolve_target(store: Store, key: str) -> Task:
    t = store.find(key)
    if t is None:
        raise SystemExit(f"找不到任务：{key}")
    return t


def cmd_done(argv: list[str]) -> int:
    if not argv:
        console.print("[red]用法：atd done <id前缀> [id前缀...] [/red]")
        return 2
    store = _store()
    for key in argv:
        t = _resolve_target(store, key)
        before = Task.from_dict(t.to_dict())
        t.status = "done"
        t.end = utcnow().isoformat(timespec="seconds")
        store.save(t, before=before)
        console.print(f"[green]✓ 完成[/green] {t.title}")
    return 0


def cmd_rm(argv: list[str]) -> int:
    if not argv:
        console.print("[red]用法：atd rm <id前缀>[/red]")
        return 2
    store = _store()
    for key in argv:
        t = _resolve_target(store, key)
        store.delete(t.id)
        console.print(f"[yellow]已删除[/yellow] {t.title}（atd undo 可恢复）")
    return 0


def cmd_edit(argv: list[str]) -> int:
    """atd edit <id> <整行新内容>：按解析结果覆盖字段（缺省字段不动）。"""
    if len(argv) < 2:
        console.print('[red]用法：atd edit <id前缀> "后天 很急 新标题"[/red]')
        return 2
    store = _store()
    key, raw = argv[0], " ".join(argv[1:])
    t = _resolve_target(store, key)
    before = Task.from_dict(t.to_dict())
    cfg, levels = _now_levels()
    p = parse(raw, levels=levels)
    apply_parsed_update(t, p)
    store.save(t, before=before)
    console.print(f"[green]已更新[/green] {t.title}")
    return 0


def cmd_show(argv: list[str]) -> int:
    if not argv:
        console.print("[red]用法：atd show <id前缀>[/red]")
        return 2
    store = _store()
    t = _resolve_target(store, argv[0])
    tbl = Table(show_header=False, box=None)
    tbl.add_column(style="cyan", no_wrap=True)
    tbl.add_column()
    tbl.add_row("id", t.id)
    tbl.add_row("标题", t.title)
    tbl.add_row("状态", t.status)
    tbl.add_row("日期", t.due.strftime("%Y-%m-%d %H:%M") if t.due else "—")
    tbl.add_row("档位", t.priority or "—")
    tbl.add_row("标签", " ".join(t.tags) if t.tags else "—")
    tbl.add_row("项目", t.project or "—")
    tbl.add_row("等待至", t.wait.isoformat() if t.wait else "—")
    cfg = config.load()
    tbl.add_row("urgency", f"{urgency(t, cfg=cfg):.2f}")
    for r in t.reminders or []:
        state = "已触发" if r.get("fired") else "待触发"
        tbl.add_row("提醒", f"{r['at']} {'/'.join(r.get('hooks', ['toast']))} [{state}]")
    if t.notes:
        tbl.add_row("备注", t.notes)
    console.print(tbl)
    return 0


# ---------------------------------------------------------------- 其他子命令

def cmd_undo(argv: list[str]) -> int:
    desc = _store().undo()
    console.print(f"[green]{desc}[/green]")
    return 0


def cmd_reopen(argv: list[str]) -> int:
    """atd reopen <id>：把已完成/已取消的任务重新打开为 todo。"""
    if not argv:
        console.print("[red]用法：atd reopen <id前缀>[/red]")
        return 2
    store = _store()
    for key in argv:
        t = store.find(key)
        if t is None:
            raise SystemExit(f"找不到任务：{key}")
        if t.status not in ("done", "cancelled"):
            console.print(f"[yellow]跳过：{t.title}（当前状态 {t.status}，只有 done/cancelled 可 reopen）[/yellow]")
            continue
        before = Task.from_dict(t.to_dict())
        t.status = "todo"
        t.end = None
        # 提醒已触发过的重置为未触发（重新打开后提醒可再响）
        for r in t.reminders or []:
            r["fired"] = False
        store.save(t, before=before)
        console.print(f"[green]↩ 重新打开[/green] {t.title}")
    return 0


def cmd_archive(argv: list[str]) -> int:
    """atd archive [天数] 归档 | atd archive list 查看 | atd archive restore <id> 恢复"""
    store = _store()
    if argv and argv[0] in ("list", "ls"):
        items = store.archived()
        if not items:
            console.print("[dim]归档为空[/dim]")
            return 0
        from .agenda import format_date
        from datetime import date
        today = date.today()
        for obj in items:
            t = Task.from_dict(obj) if not obj.get("deleted") else None
            status = "已删除" if obj.get("deleted") else (t.status if t else "?")
            date_s = format_date(t, today) if t and t.due else ""
            console.print(f"  [dim]{obj['id']:<8}[/dim] {date_s:<8} {status:<10} {obj.get('title','')}")
        return 0
    if argv and argv[0] in ("restore", "unarchive") and len(argv) >= 2:
        restored = store.restore(argv[1])
        title = restored.get("title", "")
        st = "todo" if restored.get("status") == "todo" else restored.get("status")
        console.print(f"[green]已恢复[/green] {title}（状态 {st}）")
        return 0
    days = int(argv[0]) if argv else 14
    n = store.archive(days)
    console.print(f"归档了 {n} 行")
    return 0


def cmd_sync(argv: list[str]) -> int:
    try:
        console.print(sync.sync())
    except RuntimeError as e:
        console.print(f"[red]{e}[/red]")
        return 1
    return 0


def cmd_watch(argv: list[str]) -> int:
    from .remind import watcher
    return watcher.main(argv)


def cmd_hooks(argv: list[str]) -> int:
    from .remind.hooks import available_hooks, discover_user_hooks
    console.print("内置 hook：toast, email")
    uh = discover_user_hooks()
    console.print("用户 hook：" + ("、".join(uh) if uh else "（~/.atd/hooks/ 下放 .py/.bat 即可扩展）"))
    return 0


def cmd_snooze(argv: list[str]) -> int:
    from .remind import watcher
    if len(argv) < 2:
        console.print("[red]用法：atd snooze <id前缀> <分钟|10m|1h>[/red]")
        return 2
    key, spec = argv[0], argv[1]
    m = __import__("re").fullmatch(r"(\d+)([mh])?", spec.lower())
    if not m:
        console.print("[red]时间格式：30 / 10m / 1h[/red]")
        return 2
    n = int(m.group(1))
    minutes = n * 60 if m.group(2) == "h" else n
    watcher.snooze(_store(), key, minutes)
    return 0


def cmd_config(argv: list[str]) -> int:
    if not argv:
        console.print(f"配置文件：{config.config_path()}")
        console.print(config.config_path().read_text(encoding="utf-8"))
        return 0
    if argv[0] == "set" and len(argv) >= 3:
        config.set_value(argv[1], argv[2])
        console.print(f"已设置 {argv[1]} = {argv[2]}")
        return 0
    if argv[0] == "path":
        console.print(config.data_dir())
        return 0
    console.print("用法：atd config | atd config set priority.mode urgency")
    return 2


def cmd_preview(argv: list[str]) -> int:
    """调试用：看一行输入会被解析成什么。"""
    cfg, levels = _now_levels()
    console.print(parse_preview(" ".join(argv), levels=levels))
    return 0


# ---------------------------------------------------------------- main

def build_parser() -> argparse.ArgumentParser:
    ap = argparse.ArgumentParser(
        prog="atd",
        description="anothertodo —— 轻量 todo（CLI/TUI）。无参数运行进入 TUI。",
        epilog=(
            "示例：\n"
            '  atd add "后天 晚上8点 买牛奶 很急 @18:30:toast,email"\n'
            "  atd list due:today +urgent\n"
            "  atd done ab12  atd undo  atd sync  atd watch --install\n"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    return ap


HANDLERS = {
    "add": cmd_add, "list": cmd_list, "done": cmd_done, "rm": cmd_rm,
    "edit": cmd_edit, "show": cmd_show, "undo": cmd_undo, "reopen": cmd_reopen,
    "archive": cmd_archive,
    "sync": cmd_sync, "watch": cmd_watch, "hooks": cmd_hooks, "snooze": cmd_snooze,
    "config": cmd_config, "preview": cmd_preview,
}


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    # 冻结 exe 的开机自启入口：atd.exe --watch-daemon（无控制台闪烁需求时也用它调试）
    if "--watch-daemon" in argv:
        from .remind import watcher
        watcher.run_forever()
        return 0
    if not argv:
        from .tui import run
        return run()
    cmd, rest = argv[0], argv[1:]
    if cmd in ("-h", "--help"):
        build_parser().print_help()
        print("子命令：", " ".join(sorted(HANDLERS)))
        return 0
    h = HANDLERS.get(cmd)
    if h is None:
        console.print(f"[red]未知命令：{cmd}[/red]")
        print("子命令：", " ".join(sorted(HANDLERS)))
        return 2
    return h(rest)


if __name__ == "__main__":
    raise SystemExit(main())
