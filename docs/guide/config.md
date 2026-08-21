# 配置详解

配置文件：`~/.atd/config.toml`，**手工编辑保存即生效**（TUI 里按 `r` 重载），也可以用命令改（见下）。配置结构定义在 `src/core/config.ts`，类型在 `src/contracts.ts`（[API 参考](/api/README)）。

## 完整默认值

```toml
[priority]
mode = "levels"            # "levels" 档位模式 | "urgency" 加权模式
levels = ["低", "中", "高"]  # 档位名，从低到高

[priority.urgency]         # 评分模式系数，详见优先级双模式
overdue = 12.0
due_today = 8.0
due_week_decay = 8.0
per_level = 3.0
age_per_day = 0.05
age_cap = 2.0
waiting_penalty = 3.0

[agenda]
week_days = 7              # "接下来"分组显示几天
date_format = "auto"       # auto 相对日期 | md 月/日 | full 完整日期

[watch]
interval_seconds = 30      # 守护进程扫描间隔

[email]                    # email hook 的 SMTP 配置
host = ""
port = 465
ssl = true
user = ""
password = ""
from = ""
to = ""
```

## 查看当前配置

```bash
atd config
```

敏感值（password/token/secret）会自动打码：

<pre class="terminal-output">$ atd config
配置文件：C:\Users\<你>\.atd\config.toml
[priority]
mode = "levels"
levels = ["低", "中", "高"]
...（password 等敏感值显示为 ***）</pre>

## 用命令改配置

```bash
atd config                              # 查看当前配置
atd config path                         # 数据目录位置
atd config set priority.mode urgency    # 切换到 urgency 模式
atd config set priority.levels '["Terra", "Sol"]'   # 改档位（数组原样写）
atd config set agenda.week_days 14      # "接下来"看两周
atd config set watch.interval_seconds 60
```

<pre class="terminal-output">$ atd config set priority.mode urgency
已设置 priority.mode = urgency</pre>

> `config set` 只支持两段 key（`段.键`），复杂改动直接编辑文件。

## 自定义状态名？

状态（todo/waiting/done/cancelled/meeting）目前是内置的，和 org-agenda 的 TODO/DOING/WAITING/CANCELLED/MEETING 一一对应，暂不支持改名——查询语法和 TUI 快捷键都依赖这套名字。

## Git Bash 用户注意

Git Bash（MSYS）会把 `/xxx` 开头的命令行参数当 POSIX 路径转换，导致 `atd list /关键字` 报"不认识的过滤器"。两种解法：

```bash
atd list //关键字                  # 双斜杠，MSYS 不转换
MSYS2_ARG_CONV_EXCL='*' atd list /关键字   # 或禁用转换
```

PowerShell / CMD 无此问题。

## 下一步

- [数据管理](/guide/storage)
- [实测证据](/guide/verification)
- [API 参考](/api/README)
