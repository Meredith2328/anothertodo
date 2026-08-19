"""配置读写。数据目录默认 ~/.atd，可用环境变量 ATD_HOME 覆盖。"""
from __future__ import annotations

import os
import re
import tomllib
from pathlib import Path

DEFAULT_CONFIG = """\
# atd 配置文件。手工编辑保存即可，下次操作生效。

[priority]
# "levels"  = 档位模式：按 levels 里的顺序排（后面的是更高档）
# "urgency" = 加权评分模式：TaskWarrior 式，分数越高越靠前
mode = "levels"
# 档位名，从低到高。可改名/增删，例如 ["Terra", "Sol"]
levels = ["低", "中", "高"]

[priority.urgency]
# 评分模式各因子系数
overdue = 12.0        # 逾期基础分（按逾期天数递增，封顶本值）
due_today = 8.0       # 今天到期
due_week_decay = 8.0  # 未来 7 天内线性衰减到 0
per_level = 3.0       # 每个档位的基础分
age_per_day = 0.05    # 任务年龄分
age_cap = 2.0         # 年龄分封顶
waiting_penalty = 3.0 # waiting 状态扣分

[agenda]
week_days = 7         # agenda 里"接下来"分组的天数
date_format = "auto"  # 列表日期列：auto(今天/后天/周X) | md(8/21) | full(2026-08-21)

[watch]
interval_seconds = 30 # 守护进程扫描间隔

[email]
# SMTP 配置；host 和 to 填好后 email hook 才可用
host = ""
port = 465
ssl = true
user = ""
password = ""
from = ""
to = ""
"""


def data_dir() -> Path:
    env = os.environ.get("ATD_HOME")
    if env:
        return Path(env)
    return Path.home() / ".atd"


def config_path() -> Path:
    return data_dir() / "config.toml"


def _parse_defaults() -> dict:
    return tomllib.loads(DEFAULT_CONFIG)


def ensure_files() -> Path:
    """首次运行时创建数据目录和默认配置，返回数据目录。"""
    dd = data_dir()
    dd.mkdir(parents=True, exist_ok=True)
    hooks = dd / "hooks"
    hooks.mkdir(exist_ok=True)
    cp = config_path()
    if not cp.exists():
        cp.write_text(DEFAULT_CONFIG, encoding="utf-8")
    return dd


def load() -> dict:
    ensure_files()
    cfg = _parse_defaults()
    cp = config_path()
    if cp.exists():
        try:
            user = tomllib.loads(cp.read_text(encoding="utf-8"))
        except tomllib.TOMLDecodeError as e:
            raise SystemExit(f"配置文件解析失败：{e}\n请检查 {cp}")
        _deep_update(cfg, user)
    return cfg


def _deep_update(base: dict, override: dict) -> None:
    for k, v in override.items():
        if isinstance(v, dict) and isinstance(base.get(k), dict):
            _deep_update(base[k], v)
        else:
            base[k] = v


def set_value(key: str, value: str) -> None:
    """atd config set a.b value —— 对配置文件做定点替换/追加。"""
    ensure_files()
    cp = config_path()
    text = cp.read_text(encoding="utf-8")
    parts = key.split(".")
    if len(parts) != 2:
        raise SystemExit("config set 目前只支持两段 key，如 priority.mode")
    section, leaf = parts
    # 数字/布尔/数组（[ 开头）按 TOML 原样写，其余按字符串加引号
    if re.match(r"^-?\d+(\.\d+)?$|^(true|false)$", value) or value.startswith(("[", "{")):
        new_line = f"{leaf} = {value}"
    else:
        new_line = f'{leaf} = "{value}"'
    # 在对应 section 内替换已有 key，或追加到 section 末尾
    sec_re = re.compile(rf"(?m)^\[{re.escape(section)}\]\s*$")
    m = sec_re.search(text)
    if not m:
        text += f"\n[{section}]\n{new_line}\n"
    else:
        block_end = text.find("\n[", m.end())
        if block_end == -1:
            block_end = len(text)
        block = text[m.end():block_end]
        key_re = re.compile(rf"(?m)^(\s*){re.escape(leaf)}\s*=.*$")
        if key_re.search(block):
            block = key_re.sub(lambda mm: f"{mm.group(1)}{new_line}", block, count=1)
        else:
            block = block.rstrip("\n") + f"\n{new_line}\n"
        text = text[:m.end()] + block + text[block_end:]
    cp.write_text(text, encoding="utf-8")


def levels(cfg: dict) -> list[str]:
    lv = cfg["priority"].get("levels") or ["低", "中", "高"]
    return list(lv)


def priority_mode(cfg: dict) -> str:
    mode = cfg["priority"].get("mode", "levels")
    return mode if mode in ("levels", "urgency") else "levels"
