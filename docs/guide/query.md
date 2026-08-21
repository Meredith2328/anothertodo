# 查询语法

`atd list`、TUI 的 `:list`、`/` 过滤共用同一套查询语法。多个条件用空格连接，是 **AND** 关系。查询语法定义在 `src/core/query.ts`，可参考 [API 文档](/api/README)。

## 条件

| 条件 | 含义 |
|---|---|
| `overdue` | 已逾期 |
| `due:today` `due:tomorrow` `due:yesterday` | 指定日 |
| `due:周五` `due:8.20` | 任意日期写法 |
| `due:before:周五` | 周五之前到期 |
| `due:after:8.20` | 8.20 之后到期 |
| `due:week` | 本周（周一起 7 天） |
| `status:todo` `status:waiting` `status:done` `status:cancelled` `status:meeting` | 按状态 |
| `project:读书` `proj:读书` | 按项目（精确匹配） |
| `priority:高` `priority:Sol` | 按档位 |
| `+urgent` `+#学习` | 含该标签 |
| `-低` `-#生活` | 排除该档位 / 标签 |
| `/关键字` | 标题或标签包含关键字（英文不区分大小写） |
| 裸词 `采购` | 等价于 `/采购` |

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

`--` 用于排除标签（避免被当作命令行选项）：

<pre class="terminal-output">$ atd list -- -生活
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
