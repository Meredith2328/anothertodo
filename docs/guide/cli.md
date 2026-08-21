# 命令行 (CLI)

atd 的 CLI 是脚本化和快速操作的主力。所有命令接受任务 id 的**任意长度前缀**。

```bash
atd <command> [args...]
```

## 命令总览

| 命令 | 作用 |
|---|---|
| `atd` | 进入全屏 TUI（见 [TUI 指南](/guide/tui)） |
| `atd add <inputs...>` | 添加任务，可一次多个 |
| `atd list [query...]` | 列出任务（支持过滤和 `-m` 排序模式） |
| `atd done <ids...>` | 完成任务 |
| `atd wait <ids...>` | 设为等待 |
| `atd reopen <ids...>` | 重新打开已完成的 |
| `atd rm <ids...>` | 删除（软删除，可撤销） |
| `atd edit <id> <input...>` | 编辑任务 |
| `atd show <id>` | 查看任务详情（JSON） |
| `atd preview <input...>` | 预览一行输入的解析结果 |
| `atd undo` | 撤销最近一次写操作 |
| `atd archive [days]` | 归档旧任务 |
| `atd archive-list` / `atd archive list` | 查看归档 |
| `atd restore <id>` | 从归档恢复 |
| `atd sync` | git 同步 |
| `atd sync-status` | 查看同步状态 |
| `atd watch [--once] [--install] [--uninstall]` | 提醒守护进程 |
| `atd snooze <id> <minutes>` | 推迟提醒 |
| `atd hooks` | 查看可用 hook |
| `atd config [action] [key] [value]` | 查看/修改配置 |

## 添加

```bash
atd add "后天 14:00 例会 #meeting" "明天 买牛奶 不急 #生活"
```

批量添加时一次给多个参数，每个都会被解析成一条任务。

## 列出

```bash
atd list                 # 默认档位排序，按分组显示
atd list -m urgency      # 换成 urgency 加权排序
atd list 报告            # 关键词过滤
atd list +工作           # 含 #工作 标签
atd list -- -生活        # 排除 #生活 标签（注意 -- 分隔符）
atd list status:done     # 显示已完成
```

<pre class="terminal-output">$ atd list
== 今天 ==
  0eeadd6a 今天     健身
== 接下来 ==
  60a2422e 明天     买牛奶  低  #生活
  0f4e7b9f 后天     例会  #meeting
  72cbb033 周一     交季度报告  高  #工作
== 无日期 ==
  5b64982b 3天后 取快递
隐藏(等待未到) 0 项</pre>

### 查询语法

`list` 支持完整的查询语法，见 [查询语法](/guide/query)。

## 完成 / 等待 / 重开

```bash
atd done 0eeadd6a       # 完成
atd wait 0eeadd6a       # 设为等待
atd reopen 0eeadd6a     # 重新打开已完成的（done/cancelled → todo）
```

<pre class="terminal-output">$ atd done 7043d6cf
✓ 完成 例会

$ atd reopen 7043d6cf
↩ 重新打开 例会</pre>

## 删除（软删除）

删除不是真的抹掉数据，而是写入一条 tombstone 标记，为撤销和多端同步保留依据：

<pre class="terminal-output">$ atd rm 22f45066
已删除 买牛奶和酸奶

$ atd undo
撤销删除：买牛奶和酸奶</pre>

## 编辑

编辑用和添加完全相同的语法，写出来的字段会覆盖，没写的字段保持原值：

<pre class="terminal-output">$ atd edit 22f45066 "明天 18:00 买牛奶和酸奶 #生活 @17:30"
已更新 买牛奶和酸奶</pre>

## 查看

```bash
atd show <id>     # 完整字段
atd preview <id>  # 解析结果
```

## 撤销

每次增/删/改都记录在 undo 日志里，`atd undo` 回滚最近一次，可连续撤销：

```bash
atd undo
```

## 归档与恢复

归档把终态（done/cancelled/删除）且超过 N 天的行挪去 `archive.jsonl`，主文件保持轻快：

<pre class="terminal-output">$ atd done f8aae6b7
✓ 完成 写学习总结

$ atd archive 0
归档了 1 行

$ atd archive-list
f8aae6b7 写学习总结

$ atd restore f8aae6b7
已恢复 写学习总结

$ atd list status:done
== 已完成/已取消 ==
  76d7d504 8/30   写学习总结  [done]  #学习
隐藏(等待未到) 0 项</pre>

> 恢复后任务保持 `done` 状态，默认清单不显示，要用 `list status:done` 查看。

## 同步

```bash
atd sync           # git 同步（首次需配置远程）
atd sync-status    # 查看同步状态
```

<pre class="terminal-output">$ atd sync-status
无远程，待提交变更 1 项</pre>

配置远程后：

<pre class="terminal-output">$ atd sync
远程为空：已推送并建立 master 分支

$ atd sync
同步完成（远端新变更已合并）</pre>

## 提醒守护进程

```bash
atd watch                # 前台运行，每 30 秒扫一次
atd watch --once         # 只扫一轮（调试）
atd watch --install      # 开机自启
atd watch --uninstall    # 取消自启
```

<pre class="terminal-output">$ atd watch --once
提醒处理：0，发送：0，重试：0，dead-letter：0</pre>

## 推迟提醒

```bash
atd snooze 22f45066 30     # 30 分钟
atd snooze 22f45066 2h     # 2 小时
```

推迟的是该任务**最后一个未触发**的提醒。

## Hook

```bash
atd hooks
```

<pre class="terminal-output">$ atd hooks
内置 hook：toast, email
用户 hook：（无）</pre>

## 配置

```bash
atd config                  # 查看当前配置（敏感值打码）
atd config path             # 数据目录位置
atd config set priority.mode urgency   # 改配置
```

<pre class="terminal-output">$ atd config set priority.mode urgency
已设置 priority.mode = urgency

$ atd config set agenda.date_format full
已设置 agenda.date_format = full</pre>

## 错误处理

命令遇到问题会给出明确错误并返回非零退出码：

<pre class="terminal-output">$ atd show deadbeef
找不到任务：deadbeef

$ atd add "   "
标题不能为空</pre>

## 下一步

- [全屏界面 (TUI)](/guide/tui)
- [查询语法](/guide/query)
- [配置详解](/guide/config)
