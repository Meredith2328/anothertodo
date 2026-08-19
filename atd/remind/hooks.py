"""提醒 hook：内置 toast / email，外加用户脚本目录 ~/.atd/hooks/。"""
from __future__ import annotations

import json
import subprocess
import sys
import traceback
from pathlib import Path

from .. import config
from ..model import Task

HOOK_NAMES = ("toast", "email")


def discover_user_hooks() -> list[str]:
    """扫描 ~/.atd/hooks 下的 .py / .bat / .exe / .cmd，名字即 hook 名。"""
    d = config.data_dir() / "hooks"
    out = []
    if d.is_dir():
        for p in sorted(d.iterdir()):
            if p.is_file() and p.suffix.lower() in (".py", ".bat", ".exe", ".cmd", ".ps1"):
                out.append(p.stem)
    return out


def available_hooks() -> list[str]:
    return list(HOOK_NAMES) + discover_user_hooks()


# ---------------------------------------------------------------- 内置 toast
# 三端系统通知：Windows 用 winrt toast，macOS 用 osascript，Linux 用 notify-send。
# toast 名字三端通用，hooks 里写 @18:00:toast 即可。

def fire_toast(task: Task, message: str) -> None:
    if sys.platform == "win32":
        _toast_windows(message)
    elif sys.platform == "darwin":
        _toast_macos(message)
    else:
        _toast_linux(message)


def _toast_windows(message: str) -> None:
    try:
        from windows_toasts import Toast, WindowsToaster
    except ImportError:
        print("atd: 未安装 windows-toasts，跳过 toast", file=sys.stderr)
        return
    t = Toast(text_fields=["atd 提醒", message])
    WindowsToaster("anothertodo").show_toast(t)


def _toast_macos(message: str) -> None:
    """macOS 系统通知（osascript，零依赖）。"""
    # osascript 字符串里的引号/反斜杠需转义，防止脚本注入
    safe = message.replace("\\", "\\\\").replace('"', '\\"')
    script = f'display notification "{safe}" with title "atd 提醒"'
    try:
        subprocess.run(["osascript", "-e", script], check=True,
                       capture_output=True, text=True, timeout=15)
    except (subprocess.SubprocessError, FileNotFoundError, OSError) as e:
        print(f"atd: macOS toast 失败：{e}", file=sys.stderr)


def _toast_linux(message: str) -> None:
    """Linux 桌面通知（notify-send，零依赖）。"""
    try:
        subprocess.run(["notify-send", "atd 提醒", message], check=True,
                       capture_output=True, text=True, timeout=15)
    except (subprocess.SubprocessError, FileNotFoundError, OSError) as e:
        print(f"atd: Linux toast 失败：{e}", file=sys.stderr)


# ---------------------------------------------------------------- 内置 email

def fire_email(task: Task, message: str) -> None:
    import smtplib
    from email.mime.text import MIMEText

    cfg = config.load()["email"]
    if not cfg.get("host") or not cfg.get("to"):
        print("atd: email 未配置（config.toml 的 [email] 段），跳过", file=sys.stderr)
        return
    msg = MIMEText(message, "plain", "utf-8")
    msg["Subject"] = f"[atd] {task.title}"
    msg["From"] = cfg.get("from") or cfg.get("user")
    msg["To"] = cfg["to"]
    cls = smtplib.SMTP_SSL if cfg.get("ssl", True) else smtplib.SMTP
    with cls(cfg["host"], int(cfg.get("port", 465)), timeout=15) as s:
        if cfg.get("user"):
            s.login(cfg["user"], cfg["password"])
        s.sendmail(msg["From"], [cfg["to"]], msg.as_string())


BUILTIN = {"toast": fire_toast, "email": fire_email}


def fire_user_hook(name: str, task: Task, message: str) -> None:
    d = config.data_dir() / "hooks"
    for ext in (".py", ".bat", ".exe", ".cmd", ".ps1"):
        p = d / (name + ext)
        if p.exists():
            payload = json.dumps({"task": task.to_dict(), "message": message}, ensure_ascii=False)
            if p.suffix.lower() == ".py":
                result = subprocess.run([sys.executable, str(p)], input=payload,
                                        capture_output=True, text=True, encoding="utf-8", timeout=60)
            else:
                result = subprocess.run([str(p)], input=payload,
                                        capture_output=True, text=True, encoding="utf-8", timeout=60)
            if result.returncode != 0:
                detail = result.stderr.strip() or result.stdout.strip()
                raise RuntimeError(f"用户 hook {name} 退出码 {result.returncode}: {detail}")
            return
    raise KeyError(f"找不到用户 hook：{name}")


def fire(hook_name: str, task: Task, message: str) -> bool:
    """触发一个 hook，吞掉异常（提醒不能因单个 hook 挂掉而中断）。"""
    try:
        if hook_name in BUILTIN:
            BUILTIN[hook_name](task, message)
        else:
            fire_user_hook(hook_name, task, message)
        return True
    except Exception:
        traceback.print_exc()
        return False


def build_message(task: Task, missed: bool, now_str: str) -> str:
    from ..agenda import format_date
    from datetime import date
    due = format_date(task, date.today()) if task.due else ""
    prefix = "[错过] " if missed else ""
    bits = [prefix + task.title]
    if task.priority:
        bits.append(f"[{task.priority}]")
    if due.strip():
        bits.append(f"日期 {due.strip()}")
    bits.append(f"@{now_str}")
    return "  ".join(bits)
