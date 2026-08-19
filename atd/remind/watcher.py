"""atd watch：常驻守护进程，扫描 tasks.jsonl 触发到期提醒。

用法：
  atd watch                前台运行（Ctrl+C 退出）
  atd watch --install      注册开机自启（schtasks /sc onlogon）
  atd watch --uninstall    取消自启
  atd watch --once         只跑一轮（调试用）
"""
from __future__ import annotations

import json
import subprocess
import sys
import time
from datetime import datetime

from .. import config
from ..model import ACTIVE_STATES, Task, load_jsonl
from ..storage import Store
from . import hooks as hookmod

TASK_NAME = "atd-watch"


def _iter_reminders(store: Store) -> list[tuple[Task, dict, int]]:
    """返回 (task, reminder, index)，只含未触发的。"""
    out = []
    for t in store.tasks():
        if t.status not in ACTIVE_STATES:
            continue
        for i, r in enumerate(t.reminders or []):
            if not r.get("fired"):
                out.append((t, r, i))
    return out


def check_once(store: Store, *, cfg: dict | None = None, quiet: bool = False) -> int:
    """扫描并触发所有到期提醒。返回触发数。"""
    cfg = cfg or config.load()
    now = datetime.now()
    fired = 0
    for task, rem, idx in _iter_reminders(store):
        try:
            at = datetime.fromisoformat(rem["at"])
        except (KeyError, ValueError):
            continue
        if at > now:
            continue
        missed = (now - at).total_seconds() > 300  # 超过 5 分钟算"错过"
        msg = hookmod.build_message(task, missed, now.strftime("%m-%d %H:%M"))
        if not quiet:
            print(f"触发提醒：{msg} -> {rem.get('hooks') or ['toast']}")
        names = rem.get("hooks") or ["toast"]
        for name in names:
            hookmod.fire(name, task, msg)
        # 无论成功与否都标记 fired，避免每轮重发；失败信息已由 fire 打印
        _mark_fired(store, task, idx)
        fired += 1
    return fired


def _mark_fired(store: Store, task: Task, idx: int) -> None:
    before = Task.from_dict(task.to_dict())
    task.reminders[idx]["fired"] = True
    # Reminder delivery is operational state, not a user edit. It must not
    # consume the next undo slot.
    store.save(task, before=before, record_undo=False)


def snooze(store: Store, task_id: str, minutes: int) -> None:
    """把任务上最后一个未触发提醒推迟 N 分钟。"""
    from datetime import timedelta

    task = store.find(task_id)  # 支持前缀
    if task is None:
        raise SystemExit(f"找不到任务 {task_id}")
    pending = [(i, r) for i, r in enumerate(task.reminders or []) if not r.get("fired")]
    if not pending:
        raise SystemExit("该任务没有待触发的提醒")
    i, r = pending[-1]
    r["at"] = (datetime.now() + timedelta(minutes=minutes)).isoformat(timespec="minutes")
    r["fired"] = False
    store.save(task)
    print(f"已推迟 {minutes} 分钟：{task.title}")


def run_forever(interval: int | None = None) -> None:
    cfg = config.load()
    interval = interval or cfg["watch"].get("interval_seconds", 30)
    store = Store()
    print(f"atd watch 已启动，每 {interval}s 扫描一次（Ctrl+C 退出）", flush=True)
    try:
        while True:
            try:
                n = check_once(store, cfg=cfg, quiet=False)
                if n:
                    print(f"[{datetime.now():%H:%M:%S}] 触发了 {n} 条提醒", flush=True)
            except KeyboardInterrupt:
                raise
            except Exception as e:
                print(f"[{datetime.now():%H:%M:%S}] 扫描出错（忽略继续）：{e}", file=sys.stderr)
            time.sleep(interval)
    except KeyboardInterrupt:
        print("\natd watch 已退出")


# ---------------------------------------------------------------- 开机自启

def _exe_and_args() -> list[str]:
    if getattr(sys, "frozen", False):
        # PyInstaller 冻结后的二进制：无参进 TUI，--watch-daemon 直接跑守护进程
        return [sys.executable, "--watch-daemon"]
    return [sys.executable, "-m", "atd.remind.watcher"]


# ---------------------------------------------------------------- 三端自启

def install_autostart() -> None:
    if sys.platform == "win32":
        _install_windows()
    elif sys.platform == "darwin":
        _install_macos()
    else:
        _install_linux()


def uninstall_autostart() -> None:
    if sys.platform == "win32":
        _uninstall_windows()
    elif sys.platform == "darwin":
        _uninstall_macos()
    else:
        _uninstall_linux()


def _install_windows() -> None:
    cmd = _exe_and_args()
    create = [
        "schtasks", "/Create", "/TN", TASK_NAME, "/SC", "ONLOGON",
        "/RL", "LIMITED", "/F",
    ]
    # schtasks /TR 参数里的引号转义：整个命令包一层引号，内部用 \"
    tr = " ".join(f'"{c}"' if " " in c or "\\" in c or "/" in c else c for c in cmd)
    tr = tr.replace('"', '\\"')
    create += ["/TR", tr]
    r = subprocess.run(create, capture_output=True, text=True, encoding="mbcs", errors="replace")
    if r.returncode != 0:
        raise SystemExit(f"注册失败：{r.stdout}\n{r.stderr}")
    print(f"已注册开机自启（任务名 {TASK_NAME}）。\n"
          f"命令：{' '.join(cmd)}\n"
          f"提示：窗口默认可见；如需静默可用 vbs/pythonw 包一层。")


def _uninstall_windows() -> None:
    r = subprocess.run(["schtasks", "/Delete", "/TN", TASK_NAME, "/F"],
                       capture_output=True, text=True, encoding="mbcs", errors="replace")
    if r.returncode != 0:
        raise SystemExit(f"取消失败：{r.stdout}\n{r.stderr}")
    print(f"已取消自启（任务名 {TASK_NAME}）")


def _install_macos() -> None:
    """launchd LaunchAgent：登录即拉起 watcher，崩溃自动重启。"""
    import plistlib
    from pathlib import Path as FsPath

    cmd = _exe_and_args()
    label = "com.anothertodo.atd"
    plist_path = FsPath.home() / "Library" / "LaunchAgents" / f"{label}.plist"
    plist_path.parent.mkdir(parents=True, exist_ok=True)
    plistlib.dump({
        "Label": label,
        "ProgramArguments": cmd,
        "RunAtLoad": True,
        "KeepAlive": True,
        "StandardOutPath": str(FsPath.home() / ".atd" / "watch.log"),
        "StandardErrorPath": str(FsPath.home() / ".atd" / "watch.err.log"),
    }, plist_path.open("wb"))
    r = subprocess.run(["launchctl", "load", str(plist_path)], capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"launchctl load 失败：{r.stderr}")
    print(f"已注册登录自启（LaunchAgent {label}）\n命令：{' '.join(cmd)}")


def _uninstall_macos() -> None:
    import plistlib
    from pathlib import Path as FsPath

    label = "com.anothertodo.atd"
    plist_path = FsPath.home() / "Library" / "LaunchAgents" / f"{label}.plist"
    if plist_path.exists():
        subprocess.run(["launchctl", "unload", str(plist_path)], capture_output=True, text=True)
        plist_path.unlink()
        print(f"已取消自启（{label}）")
    else:
        raise SystemExit("未找到 LaunchAgent，无需卸载")


def _install_linux() -> None:
    """systemd 用户单元：登录会话拉起 watcher，开机（用户登录后）生效。"""
    from pathlib import Path as FsPath

    cmd = _exe_and_args()
    # systemd ExecStart 用双引号包住含空格路径
    exec_line = " ".join(f'"{c}"' if " " in c else c for c in cmd)
    unit = (
        "[Unit]\n"
        "Description=atd reminder watcher\n"
        "After=network.target\n\n"
        "[Service]\n"
        f"ExecStart={exec_line}\n"
        "Restart=always\n"
        "RestartSec=5\n\n"
        "[Install]\n"
        "WantedBy=default.target\n"
    )
    unit_dir = FsPath.home() / ".config" / "systemd" / "user"
    unit_dir.mkdir(parents=True, exist_ok=True)
    unit_path = unit_dir / "atd-watch.service"
    unit_path.write_text(unit, encoding="utf-8")
    r = subprocess.run(["systemctl", "--user", "daemon-reload"], capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"systemctl daemon-reload 失败：{r.stderr}")
    r = subprocess.run(["systemctl", "--user", "enable", "--now", "atd-watch.service"],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise SystemExit(f"systemctl enable 失败：{r.stderr}")
    print(f"已注册用户级自启（atd-watch.service）\n命令：{exec_line}")


def _uninstall_linux() -> None:
    from pathlib import Path as FsPath

    subprocess.run(["systemctl", "--user", "disable", "--now", "atd-watch.service"],
                   capture_output=True, text=True)
    unit_path = FsPath.home() / ".config" / "systemd" / "user" / "atd-watch.service"
    if unit_path.exists():
        unit_path.unlink()
    print("已取消自启（atd-watch.service）")


def main(argv: list[str] | None = None) -> int:
    argv = argv if argv is not None else sys.argv[1:]
    if "--install" in argv:
        install_autostart()
        return 0
    if "--uninstall" in argv:
        uninstall_autostart()
        return 0
    cfg = config.load()
    store = Store()
    if "--once" in argv:
        n = check_once(store, cfg=cfg, quiet=False)
        print(f"本轮触发 {n} 条提醒")
        return 0
    run_forever()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
