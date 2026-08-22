# 优先级双模式

atd 提供两种排序模式，随时可切换：

- **档位模式（levels）**：任务被分成几个档位，同组内按日期排。
- **urgency 模式**：TaskWarrior 式加权评分，分数越高越靠前。

## 怎么切换

| 方式 | 说明 |
|---|---|
| `config.toml` 的 `priority.mode` | 全局默认 |
| TUI 按 `1`（档位）/ `2`（urgency） | 临时切换 |
| `:mode urgency` | 命令模式切换 |
| `atd list -m urgency` | 单次查询 |

实测（`list -m urgency` 在行尾显示 `U=分数`）：

<pre class="terminal-output">$ atd list -m urgency
== 今天 ==
  c8aa696e 今天     健身  U=8.0
== 接下来 ==
  22f45066 明天     买牛奶  低  #生活  U=7.9
  9b5680af 周一     交季度报告  高  #工作  U=7.6
  7043d6cf 后天     例会  #meeting  U=5.7
== 无日期 ==
  923c3221 昨天 交水电费  低  U=1.0
  5b64982b 3天后 取快递  U=0.0
隐藏(等待未到) 0 项</pre>

## 档位模式（levels）

档位在 `priority.levels` 里定义，**从低到高**排，可以任意改名、增删：

```toml
[priority]
mode = "levels"
levels = ["Terra", "Sol"]        # 两档
# levels = ["低", "中", "高"]    # 经典三档
# levels = ["S", "A", "B", "C"]  # 四档也行
```

排序规则：逾期组 → 今天组 → 未来组 → 无日期组；组内按日期升序、同日按档位降序。紧急度短语按"最高档 / 中间档 / 最低档"映射（中文 `很急`→Sol、`一般`→中间那档、`不急`→Terra；英文 `urgent`→最高档、`normal`→中间档、`no rush`→最低档）。

## urgency 模式

TaskWarrior 式加权评分，分数越高越靠前。构成（系数在 `[priority.urgency]` 可调）：

| 因子 | 默认系数 | 说明 |
|---|---|---|
| 逾期 | 12.0 | 按逾期天数线性升，最多 7 天到顶 |
| 今天到期 | 8.0 | |
| 7 天内临近 | 8.0 | 线性衰减：明天 ≈6.9，3 天后 ≈4.6 |
| 档位基础分 | 3.0/档 | Sol 记 2 档分 |
| 任务年龄 | 0.05/天 | 封顶 2.0，防止老任务永久霸榜 |
| waiting 惩罚 | -3.0 | |

系数除了改 `config.toml`，也能用命令直接改，比如 `atd config set priority.urgency.overdue 20`——以前 `config set` 只认两段 key，这个三层路径设不了，现在任意层级都行。

```bash
atd list -m urgency     # 行尾显示 U=8.7 这样的分数
```

## 体会两种模式的差别

```bash
atd add "后天 交笔记 Sol" "明天 交税单 Terra" "整理桌面 Terra"
atd list                # 档位模式：按日期排
atd list -m urgency     # urgency：高优先级任务可能反超
```

## 下一步

- [多端同步](/guide/sync)
- [配置详解](/guide/config)
- [数据管理](/guide/storage)
