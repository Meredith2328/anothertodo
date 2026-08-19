"""git 同步：数据目录是 git 仓库，atd sync = commit + pull(并集合并) + push。

冲突处理：tasks.jsonl 一行一任务、行首是 id。若 rebase 冲突，把双方行按 id
做并集：同一 id 取 modified 新者；本地 tombstone（删除）优先于远端旧编辑。
"""
from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime
from pathlib import Path

from . import config
from .model import load_jsonl
from .storage import Store


def _git(dir_: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    r = subprocess.run(["git", "-C", str(dir_), *args],
                       capture_output=True, text=True, encoding="utf-8", errors="replace")
    if check and r.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} 失败：{r.stderr.strip() or r.stdout.strip()}")
    return r


def ensure_repo(dir_: Path | None = None) -> Path:
    dir_ = dir_ or config.data_dir()
    if not (dir_ / ".git").exists():
        _git(dir_, "init")
    # 数据目录里 undo/锁/临时文件不该进版本库
    gi = dir_ / ".gitignore"
    if not gi.exists():
        gi.write_text(".lock\nundo.jsonl\narchive.jsonl\n", encoding="utf-8")
    return dir_


def has_remote(dir_: Path) -> bool:
    r = _git(dir_, "remote", check=False)
    return bool(r.stdout.strip())


def _commit_all(dir_: Path, msg: str) -> bool:
    _git(dir_, "add", "-A")
    r = _git(dir_, "diff", "--cached", "--quiet", check=False)
    if r.returncode == 0:
        return False  # 没有变化
    _git(dir_, "commit", "-m", msg)
    return True


def _ours_id_map(text: str) -> dict[str, dict]:
    m: dict[str, dict] = {}
    for obj in load_jsonl(text):
        m[obj.get("id", "")] = obj
    return m


def _merge_union(ours_lines: list[str], theirs_lines: list[str]) -> list[str]:
    """按 id 并集合并两版 JSONL：新 modified 胜；tombstone 胜过旧编辑。"""
    ours = _ours_id_map("\n".join(ours_lines))
    theirs = _ours_id_map("\n".join(theirs_lines))
    out: dict[str, dict] = {}

    def mod_ts(o: dict) -> datetime:
        try:
            return datetime.fromisoformat(o.get("modified", ""))
        except ValueError:
            return datetime.min

    for tid, obj in ours.items():
        out[tid] = obj
    for tid, tobj in theirs.items():
        if tid not in out:
            out[tid] = tobj
            continue
        o = out[tid]
        if o.get("deleted") and not tobj.get("deleted"):
            continue  # 本地已删除，保留删除
        if tobj.get("deleted") and not o.get("deleted"):
            out[tid] = tobj  # 远端已删除 → 尊重删除
            continue
        if mod_ts(tobj) > mod_ts(o):
            out[tid] = tobj
    return [json.dumps(o, ensure_ascii=False) for o in out.values()]


def _resolve_conflict_file(path: Path) -> None:
    """把带冲突标记的 tasks.jsonl 按"本地版 vs 远端版"并集合并后写回。"""
    text = path.read_text(encoding="utf-8")
    ours: list[str] = []
    theirs: list[str] = []
    in_ours = True  # 冲突块外的公共行两边都有，归入 ours 即可
    for ln in text.splitlines():
        if ln.startswith("<<<<<<<"):
            in_ours = True
        elif ln.startswith("======="):
            in_ours = False
        elif ln.startswith(">>>>>>>"):
            in_ours = True
        else:
            (ours if in_ours else theirs).append(ln)
    merged = _merge_union(ours, theirs)
    path.write_text("\n".join(merged) + ("\n" if merged else ""), encoding="utf-8")


def sync(dir_: Path | None = None, *, can_push: bool = True) -> str:
    dir_ = ensure_repo(dir_)
    _commit_all(dir_, "atd: sync")
    if not has_remote(dir_):
        return "没有配置远程仓库：本地已 commit（git remote add origin <url> 后即可同步）"
    _git(dir_, "fetch", "--all")
    branch = _git(dir_, "rev-parse", "--abbrev-ref", "HEAD").stdout.strip() or "master"
    remote_ref = f"origin/{branch}"
    behind = _git(dir_, "rev-list", "--count", f"HEAD..{remote_ref}", check=False)
    if behind.returncode != 0:
        # 远程还没有这个分支（首次连接空仓库）
        if can_push:
            _git(dir_, "push", "-u", "origin", branch)
            return f"远程为空：已推送并建立 {branch} 分支"
        return f"远程没有 {branch} 分支"
    if behind.stdout.strip() == "0":
        if can_push:
            _git(dir_, "push", check=False)
            return "已推送（远程无新变更）"
        return "已是最新"
    # 远端有新提交：尝试 rebase；tasks.jsonl 冲突时用并集合并落盘后 continue
    r = _git(dir_, "rebase", remote_ref, check=False)
    if r.returncode != 0:
        merged_any = False
        status = _git(dir_, "status", "--porcelain").stdout
        for line in status.splitlines():
            p = line[3:].strip().strip('"')
            fp = dir_ / p
            if not fp.exists():
                continue
            if p == "tasks.jsonl":
                _resolve_conflict_file(fp)
                text = fp.read_text(encoding="utf-8")
                if any(ln.startswith(("<<<<<<<", "=======", ">>>>>>>")) for ln in text.splitlines()):
                    _git(dir_, "rebase", "--abort", check=False)
                    raise RuntimeError("tasks.jsonl 冲突合并失败，已回滚，请手动处理")
                _git(dir_, "add", p)
                merged_any = True
            else:
                _git(dir_, "checkout", "--ours", p, check=False)
                _git(dir_, "add", p, check=False)
        env = {**__import__("os").environ, "GIT_EDITOR": "true"}
        c = subprocess.run(["git", "-C", str(dir_), "rebase", "--continue"],
                           capture_output=True, text=True, encoding="utf-8", errors="replace", env=env)
        if c.returncode != 0:
            _git(dir_, "rebase", "--abort", check=False)
            raise RuntimeError("rebase continue 失败，已回滚：" + (c.stdout + c.stderr)[:300])
        if not merged_any:
            pass
    if can_push:
        p = _git(dir_, "push", check=False)
        if p.returncode != 0:
            _git(dir_, "pull", "--rebase", check=False)
            _git(dir_, "push", check=False)
    return "同步完成（远端新变更已合并）"


def status(dir_: Path | None = None) -> str:
    dir_ = ensure_repo(dir_)
    n_new, n_mod = 0, 0
    r = _git(dir_, "status", "--porcelain")
    for line in r.stdout.splitlines():
        if line.startswith("??") or line.startswith(" M") or line.startswith("M"):
            if "tasks.jsonl" in line:
                n_mod += 1
            else:
                n_new += 1
    remote = has_remote(dir_)
    return ("远程：" if remote else "无远程，") + f"待提交变更 {n_mod + n_new} 项"
