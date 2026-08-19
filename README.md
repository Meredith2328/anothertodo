# anothertodo (`atd`)

轻量 todo list：单行模糊输入 + 命令行 TUI + 提醒 hook + git 多端同步。
数据是纯文本 JSONL（一行一任务），存放在 `~/.atd/`。

> **完整使用文档见 [docs/guide.md](docs/guide.md)**——按功能分章，含大量可直接照抄的案例：
> 模糊输入全规则、提醒与自定义 hook、TUI 键位、查询语法、优先级双模式、多端同步、配置与数据管理。本 README 只保留速查。

```
日期        TODO               紧急度
2026-8-18   买牛奶          Sol
2026-8-18   写个TODO List      Terra
2026-8-17   读书笔记            Sol      ⚠逾期
```

## 安装

三种方式任选：

```bash
# ① 源码安装（Python 3.10+，任意虚拟环境均可）
python -m pip install -r requirements.txt
python -m pip install -e .
# 命令入口 atd 会装到你的 Python Scripts 目录（加进 PATH 即可全局使用）

# ② 免环境：直接下载打包好的单文件 exe（dist/atd.exe，无需 Python，见文末"打包 exe"）

# ③ 不装也能跑（源码目录下）
python -m atd.cli list
```

## 快速上手

```bash
atd                      # 进入全屏 TUI（日常主入口）
atd add "后天 买牛奶 很急 @18:30"   # 或直接用子命令
atd list                 # 议程视图：逾期/今天/接下来/等待/无日期
atd done <id前4位>        # 完成任务
atd undo                 # 撤销上一步（增/删/改都能撤）
```

## 模糊输入

一行里混写各字段，剩余词自动作为标题：

| 输入 | 解析为 |
|---|---|
| `后天` `明天` `大后天` `今晚`(=今天20:00) | 相对日期 |
| `周五` `下周一` `本周三` `礼拜二` | 星期（当天则顺延一周） |
| `8.20` `8-20` `8/20` `2026.8.20` `8月20日` | 数字日期（过期不推明年，保持字面） |
| `月底` `下月初` `下月底` `元旦` `五一` `十一` | 特殊日期 |
| `晚上8点` `下午3点半` `14:30` `9点` | 时间 |
| `很急` `特急` `比较着急` → 高；`一般` → 中；`不急` `有空再说` → 低 | 紧急度（词内不误伤，如"急性"） |
| `Sol` / 档位名本身 | 直接指定档位 |
| `#标签` `proj:项目` `^父id` `~周五` | 标签 / 项目 / 父任务 / wait 到期浮现 |
| `@18:30` `@9:00:toast,email` `@30m` `@2h` | 提醒（锚定任务日期；可指定 hook） |

TUI 输入时下方有实时解析预览。`atd preview "..."` 可单独调试解析。

## TUI 操作

- 直接打字进入添加模式；回车添加；输入时下方实时解析预览
- 空回车 → 焦点到列表；列表上回车 = 完成任务
- 完整键位：`j/k`/方向键移动、`g`/`G` 跳首/尾、`d` 完成、`x` 删除、`e` 编辑、`w` 设等待、`u`/`Ctrl+Z` 撤销、`r` 刷新、`1`/`2` 切换排序模式、`/`/`Ctrl+F` 搜索、`Ctrl+S` 同步、`?`/`F1` 快捷键帮助、`Esc` 取消编辑→清空输入→双击退出、`Q`/`Ctrl+Q` 退出
- `Tab` 补全 `#标签` 和 `proj:项目`；`:` 命令模式（`list <查询>` `undo` `sync` `mode urgency` `archive` `quit`）

## 查询语法（list / TUI 过滤共用）

```
atd list due:today overdue +urgent -低 project:读书 status:waiting /关键字
due:before:周五   due:week
```

## 优先级双模式

配置 `~/.atd/config.toml`：

```toml
[priority]
mode = "levels"            # 或 "urgency"
levels = ["低", "中", "高"]  # 可自定义，如 ["Terra", "Sol"]
```

- **levels**：按档位排，直观可控
- **urgency**：TaskWarrior 式加权分（逾期/今天到期/7天衰减/档位/任务年龄/waiting 惩罚），系数都在 `[priority.urgency]` 可调

## 提醒

```bash
atd watch                 # 前台跑守护进程（每 30s 扫一次，错过的补发并标"[错过]"）
atd watch --install       # 注册开机自启（schtasks）
atd watch --uninstall
atd watch --once          # 调试：只扫一轮
atd snooze <id> 10m       # 推迟提醒
```

内置 hook：`toast`（Windows 通知）、`email`（`config.toml` 的 `[email]` 段配 SMTP）。

自定义 hook：`~/.atd/hooks/` 下放 `名字.py`（或 `.bat/.exe/.ps1`），添加时 `@18:00:名字` 即可调用。脚本从 stdin 收到 JSON：`{"task": {...}, "message": "..."}`，退出码 0 为成功。

## 多端同步（git）

```bash
cd ~/.atd
git remote add origin <你的私有仓库>
atd sync        # commit + fetch + rebase + push
```

每端本地读写自己的 `tasks.jsonl`，`atd sync` 时才合并：同一任务取 `modified` 新者，删除（tombstone）优先于旧编辑，不同任务取并集。已实测双端冲突场景。

## 数据与命令速查

```
~/.atd/tasks.jsonl    任务数据（唯一事实源）
~/.atd/undo.jsonl     撤销日志（不进 git）
~/.atd/archive.jsonl  归档（atd archive [天数]）
~/.atd/config.toml    配置
~/.atd/hooks/         自定义提醒 hook

atd add/list/done/rm/edit/show/undo/archive/sync/watch/snooze/hooks/config/preview
```

## 开发

```bash
python -m pip install -r requirements.txt
python -m pytest tests/ -q   # 33 项测试
```

## 打包二进制（免环境分发，三平台）

```bash
python -m pip install pyinstaller
python -m PyInstaller atd.spec --noconfirm --clean
# 产物：dist/atd（Windows 为 atd.exe，约 35MB），拷贝到同平台机器直接使用
```

**PyInstaller 不能交叉编译**——Windows / macOS / Linux 必须各自在本平台构建，
所以仓库内置了三平台 CI 矩阵 `.github/workflows/build.yml`：
push 一个 `v*` tag 即在 GitHub Actions 上同时构建三端产物并挂到 Release。

spec 已内置平台适配：Windows 收集 winrt/toast 依赖与 conda `ffi-8.dll`、
UTF-8 控制台兜底；macOS/Linux 自动跳过这些。二进制里 `atd`（TUI）、
`atd --watch-daemon`（自启守护进程）均可用。

开机自启按平台区分（`atd watch --install`）：Windows 用计划任务 schtasks，
macOS 用 launchd LaunchAgent，Linux 用 systemd 用户单元。

架构分层：`model/storage`（数据）→ `parse/priority/query/agenda`（逻辑）→ `cli/tui`（展示）→ `remind`（提醒）→ `sync`（同步）。
Web 端规划中：直接复用 core 层 + 同一份 JSONL（详见 [docs/guide.md](docs/guide.md#11-架构与扩展)）。
