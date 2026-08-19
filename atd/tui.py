"""atd 全屏 TUI：上半任务列表 + 底部输入栏（Textual）。

视觉设计：
  - 顶部 ASCII 艺术横幅（atd 字母 + 状态栏：时钟/排序模式/过滤/统计）
  - 任务表格逐列着色（逾期红、今天青、档位按级别分色、标签紫、提醒黄）
  - 分组标题带彩色装饰线
  - 输入栏聚焦高亮，下方实时解析预览

交互：
  直接打字      进入添加模式（输入栏下方实时解析预览）
  j/k ↑/↓      移动选中；g/G 跳最上/最下
  Enter(列表)  完成选中任务
  d            完成；x 删除；e 编辑（内容进输入栏）；w 设等待
  u / Ctrl+Z   撤销；r 刷新；1/2 切换排序模式（档位/urgency）
  / / Ctrl+F   搜索过滤；: 命令模式；Tab 补全标签/项目
  Ctrl+S       同步；? 快捷键帮助面板
  Esc          取消编辑 → 清空输入 → 双击退出
  Q / Ctrl+Q   退出
"""
from __future__ import annotations

import time
from datetime import date, datetime

from rich.text import Text
from textual import work
from textual.app import App, ComposeResult
from textual.binding import Binding
from textual.containers import Horizontal, Vertical
from textual.screen import ModalScreen
from textual.widgets import DataTable, Footer, Input, Static

from . import config, sync
from .agenda import DATE_FORMATS, DATE_FORMAT_LABEL, format_date, groups
from .model import Task, new_id, utcnow
from .parse import parse, preview as parse_preview, task_to_input
from .storage import Store
from .task_ops import apply_parsed_update

MODE_LABEL = {"levels": "档位", "urgency": "urgency"}

# ---------------------------------------------------------------- 配色
C = {
    "accent": "#56d4dd",   # 青：主色/横幅/今天
    "hot": "#ff6188",      # 粉红：最高档/重点
    "warn": "#fc9867",     # 橙：次高档
    "good": "#a9dc76",     # 绿：低档/正常
    "overdue": "#ff6b6b",  # 红：逾期
    "future": "#98c379",   # 绿：临近
    "yellow": "#ffd866",   # 黄：提醒
    "tag": "#c678dd",      # 紫：标签/等待
    "proj": "#61afef",     # 蓝：项目/会议
    "dim": "#888888",
    "dimmer": "#5f5f5f",
    "border": "#3b3b58",
    "flash": "#ffd866",
}

GROUP_COLOR = {
    "逾期": C["overdue"], "今天": C["accent"], "接下来": C["future"],
    "更远": C["dim"], "等待中": C["tag"], "无日期": C["dim"],
    "已完成/已取消": C["dimmer"],
}

STATUS_COLOR = {"waiting": C["tag"], "meeting": C["proj"], "done": C["dimmer"],
                "cancelled": C["dimmer"]}

# ---------------------------------------------------------------- ASCII 横幅
# "ANOTHER TODO" 像素字（figlet standard 字体，6 行高）。逐字母渐变色，
# 终端过窄时自动退化为紧凑小字。
BANNER_FULL = [
    "    _    _   _  ___ _____ _   _ _____ ____    _____ ___  ____   ___  ",
    "   / \\  | \\ | |/ _ \\_   _| | | | ____|  _ \\  |_   _/ _ \\|  _ \\ / _ \\ ",
    "  / _ \\ |  \\| | | | || | | |_| |  _| | |_) |   | || | | | | | | | | |",
    " / ___ \\| |\\  | |_| || | |  _  | |___|  _ <    | || |_| | |_| | |_| |",
    "/_/   \\_\\_| \\_|\\___/ |_| |_| |_|_____|_| \\_\\   |_| \\___/|____/ \\___/ ",
    "",
]

# 紧凑模式：4 列宽小字，ANOTHER TODO 可读版
BANNER_SMALL = [
    "██ █▄█ ███ ███ █▄█ ███ █▄█ ███ ███ ██▄ ███",
    "█▄ █ █ █ █  █  █ █ █▄  █▄   █  █ █ █ █ █ █",
]

_BANNER_COLORS = [
    "#ff6188", "#56d4dd", "#fc9867", "#a9dc76", "#c678dd",
    "#ff6188", "#56d4dd", "#fc9867", "#a9dc76", "#c678dd",
    "#ff6188", "#56d4dd",
]


def _banner_text(width: int | None = None) -> Text:
    use_full = width is None or width >= 72
    t = Text()
    t.append("\n")
    if use_full:
        rows = BANNER_FULL
    else:
        rows = BANNER_SMALL
    n = len(rows)
    for i, line in enumerate(rows):
        if i < len(_BANNER_COLORS):
            t.append(line + "\n", style=_BANNER_COLORS[i])
        else:
            t.append(line + "\n", style=_BANNER_COLORS[-1])
    return t


# 帮助按"区域"组织：清单区（默认焦点）/ 输入区 / 两区通用
HELP_SECTIONS = [
    ("清单区（默认焦点，光标在任务列表）", [
        ("j k ↑ ↓", "移动选择"),
        ("g / G", "跳到最上 / 最下"),
        ("d / x", "完成 / 删除（软删除，可撤销）"),
        ("e", "编辑选中任务"),
        ("w", "设为等待（隐藏到明天）"),
        ("u / r", "撤销上一步 / 重载配置刷新"),
        ("1 / 2", "档位排序 / urgency 排序"),
        ("t", "日期列格式：相对 / 月日 / 完整"),
        ("直接打字", "跳进输入区添加；若首字是快捷键（如 d），先按 i"),
    ]),
    ("输入区（光标在输入框，打字即内容）", [
        ("Enter", "提交：添加 / 命令 / 搜索 / 编辑保存"),
        ("Tab", "补全 #标签 和 proj:项目"),
        ("Esc", "清空输入并回到清单区"),
        (": xx", "命令模式（在清单区按 : 也会进这里）"),
        ("/ xx", "搜索过滤（同上）"),
    ]),
    ("区域切换", [
        ("清单 → 输入", "直接打字（非快捷键首字）· i 进输入区 · : · / · e(编辑)"),
        ("输入 → 清单", "Enter 提交后自动 · Esc 清空 · 空输入回车"),
        ("想打 d/x 等开头的标题", "清单区先按 i 进输入区，再打字"),
        ("默认焦点", "在清单区（无需 Tab；Tab 是输入区补全）"),
    ]),
    ("两区通用", [
        ("? / F1", "本帮助（任意键关闭）"),
        ("Ctrl+Z / Ctrl+S / Ctrl+F", "撤销 / 同步 / 搜索"),
        ("Esc 双击", "退出（Q / Ctrl+Q 也可）"),
    ]),
]


class HelpScreen(ModalScreen):
    """按 ? 弹出的快捷键帮助面板，任意键关闭。"""

    CSS = f"""
    HelpScreen {{ align: center middle; }}
    #help-box {{ border: round {C['accent']}; background: #10101a; padding: 1 2; }}
    .help-sec-title {{ color: {C['warn']}; text-style: bold; }}
    """

    def compose(self) -> ComposeResult:
        from rich.table import Table as RichTable
        header = Text()
        header.append("atd 帮助", style=f"bold {C['accent']}")
        header.append("   （按任意键关闭）", style=C["dim"])
        widgets = [Static(header)]
        for title, rows in HELP_SECTIONS:
            tbl = RichTable(box=None, show_header=False, padding=(0, 2))
            tbl.add_column(style=C["accent"], no_wrap=True)
            tbl.add_column()
            for k, v in rows:
                tbl.add_row(k, v)
            widgets.append(Static(Text(title, style=f"bold {C['warn']}")))
            widgets.append(Static(tbl))
        with Vertical(id="help-box"):
            for w in widgets:
                yield w

    def on_key(self, event) -> None:
        self.dismiss()


class WelcomeScreen(ModalScreen):
    """首次运行的上手引导，任意键关闭，只弹一次。"""

    CSS = f"""
    WelcomeScreen {{ align: center middle; }}
    #welcome-box {{ border: round {C['accent']}; background: #10101a; padding: 1 2; max-width: 78; }}
    """

    def compose(self) -> ComposeResult:
        from rich.table import Table as RichTable
        header = Text()
        header.append("👋 atd 上手三分钟", style=f"bold {C['accent']}")
        header.append("   （按任意键开始）", style=C["dim"])
        tbl = RichTable(box=None, show_header=False, padding=(0, 2))
        tbl.add_column(style=C["accent"], no_wrap=True)
        tbl.add_column()
        rows = [
            ("直接打字", "添加任务：`后天 买牛奶 很急 @18:30`，回车即存"),
            ("j / k", "在任务列表上下移动光标"),
            ("d", "完成选中的任务"),
            (": 命令", "如 `:mode urgency` 切换排序、`:undo` 撤销"),
            ("? / F1", "随时打开完整快捷键帮助"),
            ("Q / 双击 Esc", "退出"),
        ]
        for k, v in rows:
            tbl.add_row(k, v)
        with Vertical(id="welcome-box"):
            yield Static(header)
            yield Static(tbl)

    def on_key(self, event) -> None:
        self.dismiss()


class TodoApp(App):
    TITLE = "atd — anothertodo"
    # dark 主题是 textual 默认；配上面的配色表
    CSS = f"""
    #banner {{ height: auto; padding: 0 1; }}
    #banner-art {{ width: 100%; height: auto; padding: 0 1; overflow: hidden; }}
    #banner-info {{ width: 100%; text-align: right; color: {C['dim']}; padding: 0 1; }}
    #table-wrap {{ border: round {C['border']}; height: 1fr; padding: 0 1; background: #10101a; }}
    DataTable {{ border: none; background: #10101a; }}
    #preview {{ height: 1; padding: 0 2; }}
    #input {{ border: tall {C['border']}; }}
    #input:focus {{ border: tall {C['accent']}; }}
    """
    BINDINGS = [
        # Footer 只显示 4 个入口键：? 帮助、i 输入、d 完成、q 退出。
        # 其余键（x/e/u/1/2/t/r）show=False——键盘照常可用，不出现在 Footer，
        # 完整列表见 ? 帮助面板。
        Binding("q", "quit", "退出"),
        Binding("ctrl+q", "quit", "退出", show=False),
        Binding("d", "done_selected", "完成"),
        Binding("i", "focus_input", "输入"),
        Binding("question_mark", "help", "帮助", priority=True),
        Binding("f1", "help", "帮助", show=False, priority=True),
        # 键盘用、Footer 不显示
        Binding("x", "delete_selected", "删除", show=False),
        Binding("e", "edit_selected", "编辑", show=False),
        Binding("u", "undo", "撤销", show=False),
        Binding("1", "mode_levels", "档位", show=False),
        Binding("2", "mode_urgency", "urgency", show=False),
        Binding("t", "cycle_date", "日期", show=False),
        Binding("r", "refresh", "刷新", show=False),
        Binding("ctrl+z", "undo", "撤销", show=False, priority=True),
        Binding("ctrl+s", "sync", "同步", show=False, priority=True),
        Binding("ctrl+f", "find", "搜索", show=False, priority=True),
    ]

    def __init__(self, welcome: bool = True):
        super().__init__()
        self.welcome = welcome  # False 时跳过首次运行引导（测试用）
        self.store = Store()
        self.cfg = config.load()
        self.mode = config.priority_mode(self.cfg)
        self.levels = config.levels(self.cfg)
        self.query = ""
        self.editing_id: str | None = None  # 输入栏处于编辑该任务的状态
        self._flash_msg = ""
        self._row_map: list[str | None] = []  # 表格行号 → 任务 id（分组行为 None）
        self.date_format = self.cfg["agenda"].get("date_format", "auto")
        self._input_focused = False  # 焦点区域标志（on_focus 维护）

    # ------------------------------------------------ 布局
    def compose(self) -> ComposeResult:
        with Vertical(id="banner"):
            try:
                width = self.size.width
            except Exception:
                width = None
            yield Static(_banner_text(width), id="banner-art")
            yield Static("", id="banner-info")
        with Vertical(id="table-wrap"):
            yield DataTable(id="table", cursor_type="row", zebra_stripes=False)
        yield Static("", id="preview")
        yield Input(id="input", select_on_focus=False, placeholder=(
            "添加：后天 买牛奶 很急 @18:30   ·   : 命令   ·   / 搜索   ·   Tab 补全"))
        yield Footer()

    # ------------------------------------------------ 横幅信息栏
    def _update_banner(self) -> None:
        info = self.query_one("#banner-info", Static)
        now = time.strftime("%H:%M")
        tasks = self.store.tasks()
        today = date.today()
        n_over = sum(1 for t in tasks if t.is_overdue(today))
        n_today = sum(1 for t in tasks if t.status in ("todo", "meeting") and t.due_date == today)
        n_all = sum(1 for t in tasks if t.status in ("todo", "waiting", "meeting"))
        mode_s = MODE_LABEL.get(self.mode, self.mode)
        txt = Text()
        if self.query:
            txt.append(f"过滤 ", style=C["dim"])
            txt.append(self.query, style=C["yellow"])
            txt.append("   ")
        txt.append(f"{mode_s}排序", style=C["accent"])
        # 统计区：全部用单宽等宽字符（emoji 宽度不可控会粘连/过宽）
        txt.append("   ", style=C["dim"])
        txt.append("!", style=f"bold {C['overdue']}")
        txt.append(f"{n_over}", style=f"bold {C['overdue']}")
        txt.append("  ", style=C["dim"])
        txt.append("●", style=C["accent"])
        txt.append(f"{n_today}", style=f"bold {C['accent']}")
        txt.append("  ", style=C["dim"])
        txt.append("∑", style=C["dim"])
        txt.append(f"{n_all}", style=f"bold {C['accent']}")
        txt.append(f"   {now}", style=C["dim"])
        info.update(txt)

    # ------------------------------------------------ 数据渲染
    def _date_cell(self, t: Task, today: date) -> Text:
        s = format_date(t, today, self.date_format)
        if t.due_date is None:
            return Text("—", style=C["dimmer"])
        if t.is_overdue(today):
            return Text(s, style=f"bold {C['overdue']}")
        if (t.due_date - today).days == 0:
            return Text(s, style=f"bold {C['accent']}")
        if (t.due_date - today).days <= 2:
            return Text(s, style=C["future"])
        return Text(s, style=C["dim"])

    def _priority_cell(self, t: Task) -> Text:
        if not t.priority or t.priority not in self.levels:
            return Text("", style=C["dimmer"])
        idx = self.levels.index(t.priority)
        ratio = (idx + 1) / len(self.levels)
        if ratio >= 0.99:
            style = f"bold {C['hot']}"
        elif ratio > 0.5:
            style = C["warn"]
        else:
            style = C["good"]
        return Text(t.priority, style=style)

    def _extras_cell(self, t: Task) -> Text:
        txt = Text()
        if t.project:
            txt.append(f"◈{t.project} ", style=C["proj"])
        for tag in t.tags:
            txt.append(f"#{tag} ", style=C["tag"])
        for r in t.reminders or []:
            if not r.get("fired"):
                txt.append(f"⏰{r['at'][5:16].replace('T', ' ')}", style=C["yellow"])
                break
        return txt

    def _status_cell(self, t: Task) -> Text:
        if t.status == "todo":
            return Text("")
        style = STATUS_COLOR.get(t.status, C["dim"])
        return Text(t.status, style=style)

    def _group_sep(self, name: str, count: int) -> Text:
        color = GROUP_COLOR.get(name, C["dim"])
        txt = Text()
        txt.append("╾─ ", style=color)
        txt.append(name, style=f"bold {color}")
        txt.append(f" {count} ", style=color)
        txt.append("─" * 18, style=C["dimmer"])
        return txt

    def refresh_table(self, keep_id: str | None = None) -> None:
        table = self.query_one("#table", DataTable)
        tasks = self.store.tasks()
        gs = groups(tasks, cfg=self.cfg, mode=self.mode, now=datetime.now(), query=self.query)
        table.clear(columns=True)
        table.add_column("日期", width=6)
        table.add_column("TODO")
        table.add_column("紧急度", width=6)
        table.add_column("状态", width=8)
        table.add_column("标签 / 提醒")
        self._row_map = []
        # 分组标题不是可操作任务。首次打开时选中第一条任务，避免
        # d/x/e/w 等快捷键看起来“没反应”；keep_id 则优先恢复原任务。
        sel: int | None = None
        for g in gs:
            if not g.tasks:
                continue
            table.add_row(Text(""), self._group_sep(g.name, len(g.tasks)),
                          Text(""), Text(""), Text(""))
            self._row_map.append(None)
            for t in g.tasks:
                title = Text(t.title)
                if len(t.title) > 44:
                    title = Text(t.title[:43] + "…")
                table.add_row(self._date_cell(t, date.today()), title,
                              self._priority_cell(t), self._status_cell(t),
                              self._extras_cell(t), key=t.id)
                self._row_map.append(t.id)
                if keep_id and t.id == keep_id:
                    sel = len(self._row_map) - 1
                elif sel is None:
                    sel = len(self._row_map) - 1
        if sel is not None:
            try:
                table.move_cursor(row=sel)
            except Exception:
                pass
        self._update_banner()
        self._render_preview()

    def _selected_task(self) -> Task | None:
        table = self.query_one("#table", DataTable)
        try:
            row = table.cursor_row
        except Exception:
            return None
        if 0 <= row < len(self._row_map):
            tid = self._row_map[row]
            return self.store.get(tid) if tid else None
        return None

    # ------------------------------------------------ 输入栏逻辑
    def _render_preview(self) -> None:
        inp = self.query_one("#input", Input)
        pv = self.query_one("#preview", Static)
        val = inp.value
        if not val:
            if self._flash_msg:
                pv.update(Text(f"› {self._flash_msg}", style=C["flash"]))
            else:
                hint = Text()
                hint.append("› ", style=C["accent"])
                # 标志为主，实际焦点兜底（鼠标点击/帮助面板等未同步标志的场景）
                if self._input_focused or self.focused is inp or inp.has_focus:
                    hint.append("输入区：Enter 提交 · Esc 回清单", style=C["dimmer"])
                else:
                    hint.append("清单区：j/k 移动 · d 完成 · 打字即添加 · : 命令", style=C["dimmer"])
                pv.update(hint)
            return
        if val.startswith(":") or val.startswith("/"):
            txt = Text("› ", style=C["accent"])
            txt.append("命令：list <查询> / undo / sync / mode levels|urgency / archive / quit", style=C["dim"])
            pv.update(txt)
            return
        body = parse_preview(val, levels=self.levels)
        txt = Text("› ", style=C["accent"])
        if self.editing_id:
            txt.append("编辑中(回车保存,Esc取消) ", style=C["yellow"])
        txt.append(body)
        pv.update(txt)

    def on_input_changed(self, event: Input.Changed) -> None:
        self._render_preview()

    def on_focus(self, event) -> None:
        # 焦点切换兜底：帮助面板关闭、外部点击等场景同步区域标志
        self._input_focused = self.focused is self.query_one("#input", Input)
        self._render_preview()

    async def on_input_submitted(self, event: Input.Submitted) -> None:
        inp = self.query_one("#input", Input)
        val = inp.value.strip()
        if not val:
            # 空输入回车：焦点切到表格，再按回车就是完成选中任务
            self.query_one("#table", DataTable).focus()
            return
        if val.startswith(":"):
            await self._run_command(val[1:].strip())
        elif val.startswith("/"):
            self.query = val[1:].strip()
            self.refresh_table()
            self._flash_msg = f"过滤：{self.query}（: 清除）"
        elif self.editing_id:
            task = self.store.get(self.editing_id)
            if task:
                before = Task.from_dict(task.to_dict())
                p = parse(val, levels=self.levels)
                apply_parsed_update(task, p)
                self.store.save(task, before=before)
                self._flash_msg = f"已更新：{task.title}"
                self.refresh_table(keep_id=task.id)
            self.editing_id = None
        else:
            p = parse(val, levels=self.levels)
            if not p.title:
                self._flash_msg = "无法解析出标题，未添加"
            else:
                t = Task(
                    id=new_id(),
                    title=p.title, due=p.due, priority=p.priority, tags=p.tags,
                    project=p.project, parent=p.parent, wait=p.wait,
                    reminders=[r.to_dict() for r in p.reminders],
                    entry=utcnow().isoformat(timespec="seconds"),
                )
                self.store.save(t)
                self._flash_msg = f"已添加：{t.title}"
                self.refresh_table(keep_id=t.id)
        inp.value = ""
        # 操作完成后焦点回列表（快捷操作态），并同步区域标志
        self._input_focused = False
        self.query_one("#table", DataTable).focus()
        self._render_preview()

    async def _run_command(self, cmd: str) -> None:
        if not cmd:
            return
        try:
            parts = cmd.split()
            name = parts[0].lower()
            if name in ("list", "ls"):
                self.query = " ".join(parts[1:])
                self.refresh_table()
                self._flash_msg = f"过滤：{self.query}" if self.query else "已清除过滤"
            elif name == "undo":
                self._flash_msg = self.store.undo()
                self.refresh_table()
            elif name == "sync":
                self._flash_msg = "同步中..."
                self._render_preview()
                try:
                    self._flash_msg = sync.sync()
                except Exception as e:
                    self._flash_msg = f"同步失败：{e}"
                self.refresh_table()
            elif name == "mode":
                arg = parts[1] if len(parts) > 1 else ""
                if arg in ("levels", "urgency"):
                    self.mode = arg
                    self.refresh_table()
                    self._flash_msg = f"排序模式：{MODE_LABEL[arg]}"
                else:
                    self._flash_msg = "用法：mode levels|urgency"
            elif name == "archive":
                n = self.store.archive(int(parts[1]) if len(parts) > 1 else 14)
                self._flash_msg = f"归档 {n} 行"
                self.refresh_table()
            elif name in ("quit", "q", "exit"):
                self.exit()
            else:
                self._flash_msg = f"未知命令：{name}"
        except (SystemExit, ValueError) as e:
            self._flash_msg = str(e) or "命令未执行"
        self._render_preview()

    # ------------------------------------------------ 快捷键
    def on_mount(self) -> None:
        self.refresh_table()
        # 默认焦点在列表：全部快捷键零鼠标可用；打字自动跳进输入框
        self._input_focused = False
        self.query_one("#table", DataTable).focus()
        self.set_interval(30, self._auto_refresh)
        self.set_interval(10, self._tick_clock)
        # 首次运行弹上手引导（按任意键关闭，之后不再弹）；测试可传 welcome=False 跳过
        flag = config.data_dir() / ".welcome_shown"
        if self.welcome and not flag.exists():
            self.call_after_refresh(self.push_screen, WelcomeScreen())
            try:
                flag.write_text("1", encoding="utf-8")
            except Exception:
                pass

    def on_resize(self, event) -> None:
        """Keep the fixed-cell banner aligned when a terminal is resized."""
        try:
            self.query_one("#banner-art", Static).update(_banner_text(event.size.width))
        except Exception:
            # Resize may arrive before composition has completed.
            pass

    def _tick_clock(self) -> None:
        # 只更新横幅时钟/统计，不动表格
        if not self.editing_id:
            self._update_banner()

    def _auto_refresh(self) -> None:
        # watcher 可能改了文件；轻量刷新
        if not self.editing_id and not self.query_one("#input", Input).value:
            self.refresh_table()

    def action_undo(self) -> None:
        try:
            self._flash_msg = self.store.undo()
        except SystemExit as e:
            self._flash_msg = str(e)
        self.refresh_table()
        self._render_preview()

    def action_refresh(self) -> None:
        self.cfg = config.load()
        self.mode = config.priority_mode(self.cfg)
        self.levels = config.levels(self.cfg)
        self.refresh_table()
        self._flash_msg = "已刷新"

    def action_mode_levels(self) -> None:
        self.mode = "levels"
        self.refresh_table()
        self._flash_msg = "档位排序"

    def action_mode_urgency(self) -> None:
        self.mode = "urgency"
        self.refresh_table()
        self._flash_msg = "urgency 排序"

    async def action_sync(self) -> None:
        await self._run_command("sync")

    def action_find(self) -> None:
        inp = self.query_one("#input", Input)
        if not inp.value.startswith("/"):
            inp.value = "/"
            inp.cursor_position = 1
        inp.focus()
        self._render_preview()

    def action_help(self) -> None:
        self.push_screen(HelpScreen())

    def action_cycle_date(self) -> None:
        """循环切换日期列显示：相对日期 → 月/日 → 完整日期。"""
        idx = DATE_FORMATS.index(self.date_format) if self.date_format in DATE_FORMATS else 0
        nxt = DATE_FORMATS[(idx + 1) % len(DATE_FORMATS)]
        self.date_format = nxt
        try:
            config.set_value("agenda.date_format", nxt)
        except Exception:
            pass  # 写配置失败不阻塞切换（本次会话仍生效）
        self.refresh_table()
        self._flash_msg = f"日期列：{DATE_FORMAT_LABEL[nxt]}"

    def on_data_table_row_selected(self, event: DataTable.RowSelected) -> None:
        self._done_selected()

    def _done_selected(self) -> None:
        t = self._selected_task()
        if not t:
            return
        before = Task.from_dict(t.to_dict())
        t.status = "done"
        t.end = utcnow().isoformat(timespec="seconds")
        self.store.save(t, before=before)
        self._flash_msg = f"✓ 完成：{t.title}"
        self.refresh_table()

    def _move_cursor(self, delta: int) -> None:
        table = self.query_one("#table", DataTable)
        try:
            target = max(0, min(table.row_count - 1, table.cursor_row + delta))
            table.move_cursor(row=target)
        except Exception:
            pass

    # ---- Footer 可点击键的 action（键盘也走 binding，输入框打字不受影响）----
    def action_done_selected(self) -> None:
        self._done_selected()

    def action_delete_selected(self) -> None:
        t = self._selected_task()
        if not t:
            return
        self.store.delete(t.id)
        self._flash_msg = f"已删除：{t.title}"
        self.refresh_table()

    def action_edit_selected(self) -> None:
        t = self._selected_task()
        if not t:
            return
        self.editing_id = t.id
        inp = self.query_one("#input", Input)
        inp.value = task_to_input(t, self.levels)
        inp.cursor_position = len(inp.value)
        self._input_focused = True
        inp.focus()
        self._render_preview()

    def action_focus_input(self) -> None:
        self._input_focused = True
        self.query_one("#input", Input).focus()
        self._render_preview()

    def _jump_row(self, row: int) -> None:
        table = self.query_one("#table", DataTable)
        if self._row_map:
            try:
                table.move_cursor(row=max(0, min(row, len(self._row_map) - 1)))
            except Exception:
                pass

    def on_key(self, event) -> None:
        inp = self.query_one("#input", Input)
        # Esc 按区域分流：
        #   编辑态   → 取消编辑、回清单
        #   输入区   → 清空输入、回清单（输入已空则直接回清单）
        #   清单区   → 第一次待命退出，1 秒内再按退出
        if event.key == "escape":
            now = time.monotonic()
            armed = getattr(self, "_esc_armed_at", 0.0)
            # 判断"当前在输入区"：_input_focused 标志可能因鼠标点击/帮助面板等
            # 未同步，用实际焦点信号组合兜底，任一为真即视为在输入区
            in_input = (self.editing_id or self._input_focused
                        or self.focused is inp or inp.has_focus)
            if in_input:
                self._esc_armed_at = 0.0  # 清退出待命，防止误触发双击退出
                if self.editing_id:
                    self.editing_id = None
                    self._flash_msg = "取消编辑"
                else:
                    inp.value = ""
                self._input_focused = False
                self.query_one("#table", DataTable).focus()
                self._render_preview()
                return
            if armed and now - armed < 1.0:
                self.exit()
                return
            self._esc_armed_at = now
            self._flash_msg = "再按一次 Esc 退出（Q 也可）"
            self._render_preview()
            return
        # 其它任意键解除 Esc 退出待命
        self._esc_armed_at = 0.0
        # Input 会自行处理 Tab（通常切换焦点），所以必须在“输入区直接
        # 返回”的分支前截获，才能兑现文档中的标签/项目补全快捷键。
        if inp.has_focus and event.key == "tab":
            self._complete()
            event.prevent_default()
            event.stop()
            return
        if inp.has_focus:
            return
        # 表格态：打字即进输入栏（type-to-add）；单字母快捷键与 / : 除外（走预填分支）
        QUICK = ("d", "x", "e", "w", "j", "k", "u", "r", "1", "2", "t", "g", "G", "i", "?",
                 "/", ":")
        if len(event.key) == 1 and event.key.isprintable() and event.key not in QUICK:
            # 追加而非覆盖；不用 event.stop()（会掐断 CJK 连续输入的后续字符）
            self._input_focused = True
            inp.value = inp.value + event.key
            inp.cursor_position = len(inp.value)
            inp.focus()
            self._render_preview()
            event.prevent_default()
            event.stop()
            return
        key = event.key
        t = self._selected_task()
        if key == "j":
            self._move_cursor(1)
        elif key == "k":
            self._move_cursor(-1)
        elif key == "g":
            self._jump_row(0)
        elif key == "G":
            self._jump_row(len(self._row_map) - 1)
        elif key == "?":
            self.push_screen(HelpScreen())
        elif key == "w" and t:
            from .parse import scan_date
            r = scan_date("明天", date.today())
            before = Task.from_dict(t.to_dict())
            t.status = "waiting"
            t.wait = r[1] if r else date.today()
            self.store.save(t, before=before)
            self._flash_msg = f"等待至 {t.wait}"
            self.refresh_table()
        elif key == "tab":
            self._complete()
            event.prevent_default()
        elif key in ("slash", "/"):
            self._input_focused = True
            inp.value = "/"
            inp.cursor_position = 1
            inp.focus()
            event.prevent_default()
        elif key in ("colon", ":"):
            self._input_focused = True
            inp.value = ":"
            inp.cursor_position = 1
            inp.focus()
            event.prevent_default()

    def _complete(self) -> None:
        """Tab 补全：#标签 / proj:项目 / 裸词补标签。"""
        inp = self.query_one("#input", Input)
        val = inp.value
        if not val:
            return
        import re
        tags = sorted({t for task in self.store.tasks() for t in task.tags})
        projects = sorted({p for p in (task.project for task in self.store.tasks()) if p})
        m = re.search(r"#([^\s#]*)$", val)
        if m and tags:
            cands = [t for t in tags if t.startswith(m.group(1))]
            if len(cands) >= 1:
                val = val[: m.start()] + "#" + cands[0] + " "
                inp.value = val
                inp.cursor_position = len(val)
            return
        m = re.search(r"(?:proj|project):([^\s]*)$", val)
        if m and projects:
            cands = [p for p in projects if p.startswith(m.group(1))]
            if cands:
                val = val[: m.start()] + "proj:" + cands[0] + " "
                inp.value = val
                inp.cursor_position = len(val)
            return


def run() -> int:
    TodoApp().run()
    return 0


if __name__ == "__main__":
    run()
