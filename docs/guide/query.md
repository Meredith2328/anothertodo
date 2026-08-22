# 查询语法

`atd list`、TUI 的 `:list`、`/` 过滤共用同一套查询语法。多个条件用空格连接，是 **AND** 关系。查询语法定义在 `src/core/query.ts`，可参考 [API 文档](/api/README)。

## 条件

| 条件 | 含义 |
|---|---|
| `overdue` | 已逾期 |
| `due:today` `due:tomorrow` `due:yesterday` | 指定日 |
| `due:周五` `due:8.20` | 任意日期写法 |
| `due:before:周五` `due:after:8.20` | 之前 / 之后到期 |
| `due:week` `due:month` `due:nextweek` | 本周 / 本月 / 下周到期 |
| `due:none` `due:any` | 没有 / 有截止日期 |
| `wait:week` `wait:any` `wait:none` | 等待日期在本周内 / 有 / 没有 |
| `wait:after:2026-09-01` | 等待日期在指定日之后 |
| `status:todo` `status:waiting` `status:done` `status:cancelled` `status:meeting` | 按状态 |
| `project:读书` `proj:读书` | 按项目（精确匹配） |
| `priority:高` `priority:Sol` | 按档位 |
| `+高` `-低` `!高` | 按优先级档位过滤（`!` 与 `-` 等价） |
| `+urgent` `+#学习` `-#生活` | 含 / 不含标签（档位名对不上时按标签） |
| `parent:a1b2` | 某个任务的子任务（id 前缀即可） |
| `parent:none` `parent:any` | 没有父任务 / 有父任务（即子任务） |
| `has:notes` `has:recur` `has:due` `has:reminder` `has:parent` `has:tags` `has:time` | 有对应字段；前面加 `-` 取反（如 `-has:due`） |
| `-status:waiting` `-project:读书` `-#标签` `-/关键字` | 取反过滤 |
| `/关键字` | 标题、标签、项目名或备注包含关键字（英文不区分大小写） |
| 裸词 `采购` | 等价于 `/采购` |

几处是 0.2.1 修掉或补上的：

- `+高` 现在按优先级档位过滤，和 `-低` 对称（以前 `+X` 一律当标签）。
- `wait:` 的范围写法以前是坏的，`wait:week` 会筛出所有*没有*等待日期的任务，现在正常。
- `/关键字` 现在也搜项目名和备注，不再只看标题和标签。
- 查询里点名写了 `wait:` 条件时，等待未到期的任务不再被折叠隐藏。
- `atd list -低` 这种以 `-` 开头的查询以前会被命令行当成未知选项拒绝，现在正常，不需要再加 `--`。

## 实测示例

### 关键词查询

<pre class="terminal-output">$ atd list 报告
== 接下来 ==
  72cbb033 周一     交季度报告  高  #工作
隐藏(等待未到) 0 项</pre>

### 按标签 / 排除标签

<pre class="terminal-output">$ atd list +工作
== 今天 ==
  0eeadd6a 今天     健身
== 接下来 ==
  0f4e7b9f 后天     例会  #meeting
  72cbb033 周一     交季度报告  高  #工作</pre>

排除标签直接写 `-` 前缀，0.2.1 起不会再被当成命令行选项，不用再加 `--` 分隔：

<pre class="terminal-output">$ atd list -生活
== 今天 ==
  0eeadd6a 今天     健身
== 接下来 ==
  0f4e7b9f 后天     例会  #meeting
  72cbb033 周一     交季度报告  高  #工作
== 更远 ==
  f8aae6b7 8/30   写学习总结  #学习
隐藏(等待未到) 0 项</pre>

### 子串匹配

<pre class="terminal-output">$ atd list /奶
== 接下来 ==
  60a2422e 明天     买牛奶  低  #生活
隐藏(等待未到) 0 项</pre>

### 按到期时间过滤

<pre class="terminal-output">$ atd list due:before:明天
== 今天 ==
  0eeadd6a 今天     健身
== 接下来 ==
  60a2422e 明天     买牛奶  低  #生活
隐藏(等待未到) 0 项</pre>

### 组合过滤

<pre class="terminal-output">$ atd list proj:q3 priority:高
== 接下来 ==
  72cbb033 周一     交季度报告  高  #工作
隐藏(等待未到) 0 项</pre>

几个组合起来的例子：

```bash
atd list due:week -低 has:notes    # 本周到期、非低档、带备注
atd list parent:a1b2               # a1b2 的全部子任务
atd list -has:due                  # 没有截止日期的任务
```

### 显示已完成

<pre class="terminal-output">$ atd list status:done
== 已完成/已取消 ==
  76d7d504 8/30   写学习总结  [done]  #学习
隐藏(等待未到) 0 项</pre>

> 默认议程不显示 done / cancelled；只有查询里显式写了 `status:done` 或 `status:cancelled` 才会出现"已完成/已取消"分组。

## 注意事项

- 条件里有空格时整个查询要加引号（shell 层面）。
- **Git Bash 用户**：`/关键字` 开头的参数会被 MSYS 当作路径转换，导致"不认识的过滤器"。两种解法：

```bash
atd list //关键字                            # 双斜杠
MSYS2_ARG_CONV_EXCL='*' atd list /关键字     # 或禁用转换
```

PowerShell / CMD 无此问题。

## 下一步

- [优先级双模式](/guide/priority)
- [多端同步](/guide/sync)
- [配置详解](/guide/config)
