# atd 使用文档

这是 `atd`（anothertodo）的完整使用文档。按功能分章，每章都有可直接照抄的案例。
快速上手只需要读第 1、2 章；其余章节按需要查阅。

> 约定：文档中的命令在 PowerShell / CMD 下原样可用；**Git Bash 用户**请注意第 9.3 节的路径转换问题（`/xxx` 开头的查询要写成 `//xxx`）。

---

## 目录

1. [安装与首次运行](#1-安装与首次运行)
2. [三分钟上手：添加、查看、完成](#2-三分钟上手)
3. [模糊输入详解（日期 / 时间 / 紧急度 / 字段）](#3-模糊输入详解)
4. [提醒系统（watcher / toast / email / 自定义 hook）](#4-提醒系统)
5. [TUI 全屏界面](#5-tui-全屏界面)
6. [查询语法](#6-查询语法)
7. [优先级：档位模式与 urgency 模式](#7-优先级双模式)
8. [多端同步（git）](#8-多端同步git)
9. [配置详解](#9-配置详解)
10. [数据管理（undo / 归档 / 直接编辑）](#10-数据管理)
11. [架构与扩展（Web 端规划）](#11-架构与扩展)
12. [兼容二进制与 Node 分发](#12-兼容二进制与-node-分发)

---

## 1. 安装与首次运行

**Node.js 迁移候选实现需要 Node.js 22+**。源码安装：

```bash
npm ci
npm run build
npm link
```

安装 Node wrapper 后 `atd` 默认走 Node 实现；项目级正式切换仍等待三端 sign-off，数据目录和命令语义保持不变。

兼容期内仍可安装旧 Python 实现：

```bash
git clone <本仓库> && cd anothertodo
python -m pip install -r requirements.txt   # 运行依赖（textual/rich/windows-toasts）
python -m pip install -e .                  # 安装 Python 兼容命令
```

仅安装 Python 包时使用 `python -m atd.cli ...`；通过 Node wrapper 运行时可用
`ATD_ENGINE=python atd ...` 显式选择 Python 回退。不要让两个实现同时写同一个数据目录。

装好后命令叫 `atd`，入口在你的 Python 的 `Scripts` 目录（建议加进 PATH，
之后在任何位置都能直接敲 `atd`）。

**不想碰环境？** 直接下载打包好的单文件 exe（见第 12 章"打包 exe"），
拷贝到任意 Windows 机器双击即用，不需要安装 Python。

不想加 PATH 也可以用模块方式调用，效果完全一样：

```bash
python -m atd.cli list        # 等价于 atd list
```

**首次运行会发生什么**：第一次执行任何 `atd` 命令时，自动在家目录创建数据目录
`~/.atd/`（Windows 上是 `C:\Users\<你>\.atd\`），里面有：

| 文件 | 作用 |
|---|---|
| `tasks.jsonl` | 所有任务，一行一个 JSON，唯一事实源 |
| `undo.jsonl` | 撤销日志（不进 git） |
| `archive.jsonl` | 归档的旧任务（不进 git） |
| `config.toml` | 全部配置 |
| `hooks\` | 自定义提醒 hook 目录 |

用 `atd config path` 可以随时确认数据目录位置。

---

## 2. 三分钟上手

最常用的三个动作：

```bash
# ① 添加：一行写完所有信息，回车即存
atd add "后天 买牛奶 很急 @18:30"

# ② 看列表：按 逾期 → 今天 → 接下来7天 → 等待中 → 无日期 分组
atd list

# ③ 完成：只需要 id 的前几位
atd done 3fbd
```

输出长这样（`atd list`）：

```
== 逾期 ==
  17a4006b 昨天     读书笔记  Sol
== 今天 ==
  ...
== 接下来 ==
  378f3f73 明天     例会  #meeting
== 无日期 ==
  ...
```

每行开头的 8 位十六进制就是任务 id，所有针对单个任务的命令（done / rm / edit /
show / snooze）都接受它的**任意长度前缀**，只要前缀唯一。

日常更推荐直接敲 `atd` 进入全屏 TUI（见第 5 章），添加、完成、编辑都在一个界面里完成。

---

## 3. 模糊输入详解

添加和编辑时，一行文本里的各字段会被自动识别并摘出，**剩余的词就是标题**。
这一节是完整的识别规则手册。拿不准的时候，用预览命令先看解析结果：

```bash
atd preview "下周五 下午2点半 复盘 特急 #重要 @14:00:toast,email"
# → 8月28日(五) 14:30 | 标题：复盘  [高] #重要 ⏰08-28 14:00(toast,email)
```

TUI 里输入时，输入框下方会**实时**显示同样的预览，所见即所得。

### 3.1 日期

| 你写 | 解析为 | 说明 |
|---|---|---|
| `今天` | 当天 | |
| `今晚` `明晚` | 当天 / 明天 **20:00** | 自带默认时间 |
| `明天` `后天` `大后天` | +1 / +2 / +3 天 | |
| `周五` `礼拜三` `星期日` | 最近的一个周五（**含今天**） | 今天就是周五时，解析为**下周五** |
| `本周五` | 本周的周五 | 已过则下周 |
| `下周一` `下周三` | 下周的周一 / 周三 | |
| `周末` | 最近的双休日 | |
| `8.20` `8-20` `8/20` | 今年 8 月 20 日 | 三种分隔符等价 |
| `2026.8.20` `2026-08-20` | 指定年份 | |
| `8月20日` `8月20` | 中文数字日期 | |
| `月底` `月初` | 本月最后一天 / 第一天 | |
| `下月底` `下月初` | 下月对应日 | 12 月会正确跨年 |
| `元旦` `五一` `十一` `国庆` | 最近的该节日 | 过了就明年 |

**过期日期的规则**：数字写法的日期（`8.20`、`8-17`、`2026.8.20`、`8月17日`）即使已经
过去，也**按字面保存**，不自动推到明年——因为补录历史任务（"8-17 读书笔记"）是常见需求。
它们会落在"逾期"分组里标红。

案例：

```bash
atd add "8-17 读书笔记 Sol"          # 补录已过去的会议 → 逾期组
atd add "十一 出游 #假期"            # → 2026-10-01
atd add "下月底 交年度总结"           # → 下月最后一天
atd add "周五 18:30 例会 #meeting"   # 最近的周五 + 时间
```

### 3.2 时间

时间可以和日期组合，也可以单独出现（单独出现时默认今天，已过点则顺延到明天）：

| 你写 | 解析为 |
|---|---|
| `14:30` `9:00` | 14:30 / 09:00 |
| `晚上8点` | 20:00 |
| `下午3点半` | 15:30 |
| `下午3一刻` `2点三刻` | 15:15 / 02:45 |
| `凌晨2点` `早上7点` `中午12点` | 02:00 / 07:00 / 12:00（中午 1-11 点自动 +12） |
| `2026-08-20 09:30` | 日期时间一步到位 |

案例：

```bash
atd add "明天 14:30 导师约谈"        # 明天 14:30
atd add "今晚 复盘"                  # 今天 20:00
atd add "交材料 @17:00"              # 只给提醒时间（见 3.5），due 无
```

### 3.3 紧急度

两种写法，任选：

**自然语言短语**（自动映射到档位）：

| 写法 | 映射 |
|---|---|
| `非常急` `特别急` `特急` `很急` `比较着急` `有点着急` `着急` `紧急` `加急` `急` | 最高档（默认"高"） |
| `一般般` `一般` `普通` `中等` `还行` `常规` | 中间档 |
| `有空再说` `慢慢来` `不着急` `不用急` `不急` | 最低档（默认"低"） |

短语匹配有**词边界保护**：`复习急性处理流程` 里的"急"不会被当成紧急度，
标题原样保留。同理 `着急死了` 中"着急"会被摘出，`死了` 留在标题里。

**直接写档位名**：配置里的档位名（默认 `低` `中` `高`，可自定义成 `Terra` `Sol` 等）
作为独立词出现时被识别。改成自定义档位后（见第 9 章），你最初设想的输入就成立了：

```
atd add "买牛奶 Sol"      → 标题"买牛奶"，紧急度 Sol
atd add "写个TODO List Terra" → 标题"写个TODO List"，紧急度 Terra
```

案例：

```bash
atd add "明天 交读书报告 比较着急"   # → [高]
atd add "整理网盘 有空再说"          # → [低]
atd add "买牛奶 Sol"                # 自定义档位名直接用
```

### 3.4 标签 / 项目 / 父任务 / 等待

| 语法 | 作用 | 案例 |
|---|---|---|
| `#标签` | 打标签，可多个 | `#学习 #采购` |
| `proj:名字` | 归属项目 | `proj:读书` |
| `^父任务id` | 挂为子任务 | `^3fbd8742` |
| `~日期` | 设 wait：该日期前隐藏，到期浮出 | `~周五` `~9.1` |

`~` 后面接任何 3.1 节的日期写法。配合 waiting 状态就是 org-mode 的经典玩法——
"这事现在做不了，先藏起来"：

```bash
atd add "问邮件结果 ~下周一"           # 下周一前不出现在默认议程
```

TUI 里按 `w` 一键把选中任务设为 waiting 并隐藏到明天。

### 3.5 提醒

`@` 开头设置提醒，可以和日期任意组合：

| 写法 | 含义 |
|---|---|
| `@18:30` | 任务日期当天 18:30 提醒（纯时间自动**锚定任务日期**） |
| `@9:00:toast` `@9:00:toast,email` | 指定用哪些 hook 触发（缺省 toast） |
| `@周五` `@8.20` | 具体日期时间点提醒（缺省 09:00） |
| `@30m` `@2h` `@1d` | 相对现在：30 分钟 / 2 小时 / 1 天后 |

规则细节：

- 行里有日期时，纯时间提醒锚定到**任务日期**那天，不是输入时的今天。
  `后天 交笔记 @18:30` → 提醒在后天 18:30。
- 行里没有日期、且时间已过（现在 14:00 写 `@9:00`）→ 顺延到明天 9:00。
- 一个任务可以有**多个**提醒，写多个 `@` 即可：`@9:00 @14:00 @1h`。

案例：

```bash
atd add "后天 买牛奶 很急 @18:30"              # 后天 18:30 toast
atd add "周五 复盘 @8:00:toast,email"          # 周五 8:00 toast+邮件
atd add "想起来订水 @2h"                       # 两小时后提醒我
atd add "下周三 例会 @周一 @9:00"              # 周一 9 点预提醒 + 当天缺省提醒
```

### 3.6 全字段组合案例

一行里所有字段混写，顺序随意：

```bash
atd add "下周五 下午2点半 采购复盘 特急 #重要 #采购 proj:采购 @14:00:toast,email @周三"
```

解析结果（用 preview 验证）：

```
→ 8月28日(五) 14:30 | 标题：采购复盘  [高] #重要 proj:采购 ⏰08-28 14:00(toast,email) ⏰08-26 09:00(toast)
```

---

## 4. 提醒系统

### 4.1 守护进程 atd watch

提醒靠一个后台守护进程触发：

```bash
atd watch                # 前台运行，每 30 秒扫一次，Ctrl+C 退出
atd watch --install      # 注册开机自启（Windows 计划任务 atd-watch）
atd watch --uninstall    # 取消自启
atd watch --once         # 只扫一轮（调试 / 手动触发用）
```

行为规则：

- 每 30 秒扫描 `tasks.jsonl`，发现 `at <= 现在` 且未触发的提醒就逐个调 hook。
- **错过的提醒会补发**：比如电脑 8:00 关机、10:00 开机，watcher 启动时发现
  8:00 的提醒没发，会立即补发，消息前缀 `[错过]`。超过 5 分钟未触发即算"错过"。
- hook 全部失败时不会标记 fired，而是记录 attempts 并指数退避重试；达到 3 次后进入 dead-letter，避免无限重试。部分成功会标记完成，同时把失败 hook 写入 watcher 日志。
- `atd done` 之后任务的未触发提醒自然不会再弹（任务已不在待办）。

### 4.2 内置 hook

**toast**（默认）：Windows 10/11 通知中心弹横幅，标题 "atd 提醒"，正文含任务名、
档位、日期。需要 `windows-toasts` 包（已随安装带上）。

**email**：给 `config.toml` 的 `[email].to` 发邮件。配置示例（QQ 邮箱）：

```toml
[email]
host = "smtp.qq.com"
port = 465
ssl = true
user = "you@qq.com"
password = "授权码（不是登录密码）"
from = "you@qq.com"
to = "you@qq.com"
```

配好后测试一下：

```bash
atd add "邮件通道测试 @1m:email"
```

### 4.3 自定义 hook（扩展点）

`~/.atd/hooks/` 下放一个脚本，文件名（去扩展名）就是 hook 名。支持
`.py` `.bat` `.exe` `.cmd` `.ps1`。`.py` 用当前 Python 解释器执行，其余直接运行。

脚本从 **stdin 收一个 JSON**，退出码 0 表示成功：

```json
{
  "task": { "id": "3fbd8742", "title": "买牛奶", "due": "...", "priority": "高", "...": "..." },
  "message": "买牛奶  [高] 日期 后天 @08-20 18:30"
}
```

一个最小的 Telegram hook（`~/.atd/hooks/tg.py`）：

```python
import sys, json, urllib.request

data = json.loads(sys.stdin.read())
token, chat_id = "你的bot_token", "你的chat_id"
text = urllib.parse.quote(f"⏰ {data['message']}")
urllib.request.urlopen(
    f"https://api.telegram.org/bot{token}/sendMessage?chat_id={chat_id}&text={text}")
```

之后就能用了：

```bash
atd add "明早 签到 @8:55:tg"       # 只用 tg
atd add "复盘 @8:00:toast,tg"      # toast + tg 同时
atd hooks                          # 查看当前可用的 hook 名单
```

### 4.4 推迟提醒（snooze）

提醒弹了但暂时顾不上：

```bash
atd snooze 3fbd 10     # id前缀 + 分钟数
atd snooze 3fbd 10m    # 同上
atd snooze 3fbd 2h     # 推迟 2 小时
```

推迟的是该任务**最后一个未触发**的提醒。

---

## 5. TUI 全屏界面

直接敲 `atd`（无参数）进入。布局：上半是任务列表，底部是输入栏，输入栏上一行
是实时解析预览 / 操作反馈，顶栏有时钟和当前模式。

### 5.1 添加（最常用）

进入 TUI 后**直接打字**——任何非快捷键字符都会自动跳进输入栏。输入时下方
实时预览解析结果，回车保存，继续打下一条。

```
┌─ atd — anothertodo ───────────── 22:31 ─┐
│ 日期  TODO  紧急度  状态                  │
│ — 逾期 —                                 │
│  昨天  读书笔记  Sol                      │
│ — 今天 —                                 │
│ — 接下来 —                               │
│  明天  例会  #meeting                    │
├──────────────────────────────────────────┤
│ → 明天(三) 20:00 | 标题：例会  proj:项目组 │
│ > 明天 晚上8点 例会 #meeting_             │
└──────────────────────────────────────────┘
```

### 5.2 列表操作（输入栏为空时）

| 键 | 动作 |
|---|---|
| `j` `k` `↑` `↓` | 上下移动光标 |
| `g` / `G` | 跳到最上 / 最下 |
| `Enter`（空输入栏回车后） | 完成/取消完成选中任务 |
| 空回车 | 焦点从输入栏切到列表 |
| `d` | 完成选中任务 |
| `x` | 删除选中任务（软删除，可 undo） |
| `e` | 编辑：任务序列化回输入栏（见 5.4） |
| `w` | 设为 waiting，隐藏到明天 |
| `u` / `Ctrl+Z` | 撤销上一步操作 |
| `r` | 重载配置 + 刷新（改了 config.toml 后按它） |
| `1` / `2` | 排序模式切换：档位 / urgency |
| `/` / `Ctrl+F` | 搜索过滤 |
| `Ctrl+S` | git 同步（等价 `:sync`） |
| `:` | 进入命令模式 |
| `Tab` | 补全 `#标签` / `proj:项目`（多个候选取第一个） |
| `?` / `F1` | 快捷键帮助面板（任意键关闭） |
| `Esc` | 取消编辑 → 清空输入 → **双击退出**（1 秒内按两次） |
| `Q` / `Ctrl+Q` | 退出 |

### 5.3 过滤与命令模式

`/` 或直接输入 `/关键字` 回车 → 列表只显示匹配项，顶栏显示当前过滤条件。
`:list due:today +urgent` 换成查询语法过滤（见第 6 章），`:list`（空查询）清除。

命令模式支持：

```
:list <查询>      过滤 / 清除
:undo             撤销
:sync             同步（见第 8 章）
:mode levels      切换排序模式（或 :mode urgency）
:archive [天数]   归档
:quit             退出
```

### 5.4 编辑任务

列表上按 `e`：任务的全部字段被序列化回输入栏——

```
例会 高 proj:项目组 #meeting 2026-08-19 20:00 @2026-08-19 18:00:toast
```

直接改这一行（语法和添加完全相同），回车保存。**注意**：编辑是"写了才改"——
解析出什么字段就覆盖什么字段，没写的字段保持原值。

### 5.5 后台刷新

TUI 每 30 秒自动刷新一次列表（输入栏为空时），所以 watcher 触发提醒、
另一台设备 sync 之后，打开着的 TUI 会自动看到最新数据。

---

## 6. 查询语法

`atd list`、TUI 的 `:list`、`/` 过滤共用同一套语法。多个条件用空格连接，**AND** 关系：

| 条件 | 含义 |
|---|---|
| `overdue` | 已逾期 |
| `due:today` `due:tomorrow` `due:yesterday` | 指定日 |
| `due:周五` `due:8.20` | 任意 3.1 节日期写法 |
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

案例：

```bash
atd list overdue                          # 所有逾期的
atd list due:today +urgent                # 今天到期且带 urgent 标签
atd list "due:before:周五 project:读书"    # 周五前到期的读书任务
atd list status:waiting                   # 所有等待中的
atd list status:done                      # 已完成的（会显示"已完成/已取消"分组）
atd list "/采购"                           # 标题含"采购"
atd list -m urgency overdue               # 用 urgency 模式排序显示
```

注意两点：

- 条件里有空格时整个查询要加引号（shell 层面）。
- **默认议程不显示 done / cancelled**；只有查询里显式写了 `status:done` 或
  `status:cancelled` 才会出现"已完成/已取消"分组。

---

## 7. 优先级双模式

两种模式随时可切换，排序结果立刻不同：

- 全局默认：`config.toml` 的 `priority.mode`
- 临时切换：TUI 按 `1`（档位）/ `2`（urgency），或 `:mode urgency`
- 单次查询：`atd list -m urgency`

### 7.1 档位模式（levels）

档位在 `priority.levels` 里定义，**从低到高**排，可以任意改名、增删：

```toml
[priority]
mode = "levels"
levels = ["Terra", "Sol"]        # 两档
# levels = ["低", "中", "高"]    # 经典三档
# levels = ["S", "A", "B", "C"]  # 四档也行
```

排序规则：逾期组 → 今天组 → 未来组 → 无日期组；组内按日期升序、同日按档位降序。
紧急度短语按"最高档 / 中间档 / 最低档"映射（`很急`→Sol，`一般`→中间那档，`不急`→Terra）。

### 7.2 urgency 模式

TaskWarrior 式加权评分，分数越高越靠前。构成（系数在 `[priority.urgency]` 可调）：

| 因子 | 默认系数 | 说明 |
|---|---|---|
| 逾期 | 12.0 | 按逾期天数线性升，最多 7 天到顶 |
| 今天到期 | 8.0 | |
| 7 天内临近 | 8.0 | 线性衰减：明天 ≈6.9，3 天后 ≈4.6 |
| 档位基础分 | 3.0/档 | Sol 记 2 档分 |
| 任务年龄 | 0.05/天 | 封顶 2.0，防止老任务永久霸榜 |
| waiting 惩罚 | -3.0 | |

`atd list -m urgency` 会在行尾显示 `U=8.7` 这样的分数，方便理解排序。
`atd show <id>` 也显示单任务分数。

案例：体会一下两种模式的差别——

```bash
atd add "后天 交笔记 Sol" "明天 交税单 Terra" "整理桌面 Terra"
atd list                # 档位模式：明天(税单)、后天(报告) 按日期排在前
atd list -m urgency     # urgency：后天 Sol 的报告因档位+临近，分数反超
```

---

## 8. 多端同步（git）

模型：**每个端本地读写自己的 tasks.jsonl，`atd sync` 时才和远端合并**。
不依赖任何服务端，私有 git 仓库（GitHub/Gitee/自建）皆可。

### 8.1 首次设置

```bash
cd ~/.atd
git remote add origin <你的私有仓库URL>
atd sync        # 首次：本地 commit 后 push，建立分支
```

新设备接入：

```bash
git clone <仓库URL> ~/.atd
atd list        # 直接可用
```

### 8.2 日常同步

一端用一天，收工时 `atd sync`；另一端开工前 `atd sync`。TUI 里 `:sync` 等价。

### 8.3 冲突规则

`tasks.jsonl` 一行一任务、行首是 id，所以合并按 id 进行：

| 场景 | 结果 |
|---|---|
| 两端各加了不同任务 | 并集，全保留 |
| 两端改了同一任务 | 取 `modified` 时间戳较新的一方 |
| 一端删除、另一端编辑 | **删除优先**（tombstone 语义） |
| 其他文件冲突（config 等） | 保留本地版本 |

已实测双端并发修改场景，合并后文件干净、历史线性（rebase），无需手动解决冲突。

### 8.4 数据安全

`undo.jsonl`、`archive.jsonl`、`.lock` 不进版本库（.gitignore 自动生成）。
远端仓库设为私有即可；数据里只有你自己的任务文本。

---

## 9. 配置详解

配置文件：`~/.atd/config.toml`，**手工编辑保存即生效**（TUI 里按 `r` 重载），
也可以用命令改（见 9.2）。完整默认值如下，逐段说明：

```toml
[priority]
mode = "levels"            # "levels" 档位模式 | "urgency" 加权模式
levels = ["低", "中", "高"]  # 档位名，从低到高

[priority.urgency]         # 评分模式系数，详见第 7 章
overdue = 12.0
due_today = 8.0
due_week_decay = 8.0
per_level = 3.0
age_per_day = 0.05
age_cap = 2.0
waiting_penalty = 3.0

[agenda]
week_days = 7              # "接下来"分组显示几天

[watch]
interval_seconds = 30      # 守护进程扫描间隔

[email]                    # email hook 的 SMTP 配置，见 4.2
host = ""
port = 465
ssl = true
user = ""
password = ""
from = ""
to = ""
```

### 9.1 自定义状态名？

状态（todo/waiting/done/cancelled/meeting）目前是内置的，和 org-agenda 的
TODO/DOING/WAITING/CANCELLED/MEETING 一一对应，暂不支持改名——查询语法和
TUI 快捷键都依赖这套名字。如果需要更多状态可以提 issue。

### 9.2 用命令改配置

```bash
atd config                              # 查看当前配置（全文打印）
atd config path                         # 数据目录位置
atd config set priority.mode urgency    # 切换到 urgency 模式
atd config set priority.levels '["Terra", "Sol"]'   # 改档位（数组原样写）
atd config set agenda.week_days 14      # "接下来"看两周
atd config set watch.interval_seconds 60
```

注意：`config set` 只支持两段 key（`段.键`），复杂改动直接编辑文件。

### 9.3 Git Bash 用户注意

Git Bash（MSYS）会把 `/xxx` 开头的命令行参数当 POSIX 路径转换，导致
`atd list /关键字` 报"不认识的过滤器"。两种解法：

```bash
atd list //关键字                  # 双斜杠，MSYS 不转换
MSYS2_ARG_CONV_EXCL='*' atd list /关键字   # 或禁用转换
```

PowerShell / CMD 无此问题。

---

## 10. 数据管理

### 10.1 撤销（undo）

每次增/删/改都记日志，`atd undo` 回滚**最近一次**操作，可连续撤销：

```bash
atd add "买牛奶"
atd undo        # 撤销新增：买牛奶 消失
atd done 3fbd
atd undo        # 撤销完成：变回 todo
atd rm 3fbd
atd undo        # 撤销删除：任务回来
```

TUI 里按 `u`。注意：undo 撤的是**写入操作**，提醒触发标记（fired）的变更
不在撤销范围内。

### 10.2 删除与归档

删除是**软删除**：文件里留一行 `{"id":..., "deleted":true}` 的 tombstone，
一是给 undo 留恢复依据，二是让多端同步能区分"删除"和"还没同步到"。

归档把终态（done/cancelled/删除）超过 N 天的行挪去 `archive.jsonl`，
主文件保持轻快：

```bash
atd archive        # 默认 14 天
atd archive 7      # 7 天
```

### 10.3 直接编辑数据文件

`tasks.jsonl` 是纯文本，极端情况下（批量导入、修复）可以手工编辑，
一行一个 JSON，字段含义：

```json
{"id": "3fbd8742", "title": "买牛奶", "status": "todo",
 "due": "2026-08-20T00:00:00", "priority": "Sol",
 "tags": ["采购"], "project": "学习",
 "wait": null,
 "reminders": [{"at": "2026-08-20T18:30", "hooks": ["toast"], "fired": false}],
 "entry": "...", "modified": "..."}
```

手工改时建议顺手把 `modified` 更新为当前 UTC ISO 时间（同步合并按它裁决）。
编辑期间确保 `atd watch` / TUI 没在写（有文件锁，一般也安全）。

### 10.4 数据在哪、怎么备份

```bash
atd config path                    # 打印数据目录
cd ~/.atd && git bundle create ../atd-backup.bundle --all   # git 冷备份
```

配了远端的话，`atd sync` 本身就是异地备份。

---

## 11. 架构与扩展

代码分层（`C:\desktoppp\anothertodo\atd\`），展示层和逻辑层严格分离，
Web 端直接复用 core：

```
model.py      Task 数据类、状态、JSONL 序列化
storage.py    存储：原子写、文件锁、undo 日志、归档
config.py     配置读写
parse.py      模糊输入解析（日期/时间/紧急度/字段/提醒）
priority.py   档位 + urgency 双模式排序
query.py      过滤查询编译与匹配
agenda.py     议程分组编排（core，无 UI 依赖）
cli.py        子命令入口（rich 输出）
tui.py        Textual 全屏界面
sync.py       git 同步 + 并集合并
remind/       watcher 守护进程 + hook 注册表
```

给 Web 端预留的接口形态：FastAPI 直接 import `Store / parse / groups / sort_tasks`，
读写同一份 `~/.atd/tasks.jsonl`（有文件锁，与 TUI/watcher 并发安全），
从而做到"手机浏览器改一条，桌面 TUI 30 秒内自动刷新"。

Python 兼容测试：`python -m pytest tests/ -q`（47 项，覆盖解析全表、urgency、查询、
存储 undo、双端同步合并、TUI 无头流程）。
Node 测试与构建门禁见 `docs/node-usage.md` 和 `docs/ts-migration-plan.md`。

---

## 12. 兼容二进制与 Node 分发

Node 版本优先通过 npm 分发：`npm ci && npm run build && npm link`。
Node 发布使用 `node-v*` tag，三端产物是需要 Node.js 22+ 的可安装 Node 包，不是原生二进制。

下面的 PyInstaller 流程仅用于兼容期的 Python 回退二进制（`legacy-v*` tag）。

单文件二进制把解释器和全部依赖打进去，别人拿到**双击即用**，不需要装 Python。

```bash
python -m pip install pyinstaller        # 只构建时用
python -m PyInstaller atd.spec --noconfirm --clean
# Windows 产物 dist/atd.exe；macOS / Linux 产物 dist/atd（约 35MB）
```

**PyInstaller 不能交叉编译**：Windows 的 exe 只能在 Windows 上构建，
macOS 的 dmg/可执行文件只能在 macOS 上构建，Linux 同理。所以仓库配好了
三平台 CI 矩阵 `.github/workflows/build.yml`：

- 每次 `git push` 一个 `legacy-v*` 开头的 tag（如 `legacy-v0.1.0`），GitHub Actions 会在
  Windows / macOS / Ubuntu 三个 runner 上并行构建，测试通过后自动挂到 Release 页；
- 也可以手动触发（workflow_dispatch）。

spec 里按平台自动适配的项：

- **Windows**：收集 windows-toasts 及其 winrt 依赖链、conda 环境缺的
  `ffi-8.dll`（`_ctypes` 必需）、GBK 控制台强制 UTF-8 输出；
- **macOS / Linux**：自动跳过上述 Windows 专属项。

开机自启（`atd watch --install`）三端实现：

| 平台 | 机制 | 说明 |
|---|---|---|
| Windows | schtasks 计划任务（ONLOGON） | 已实测：注册/查询/卸载全通，命令为 `atd.exe --watch-daemon` |
| macOS | launchd LaunchAgent | `~/Library/LaunchAgents/com.anothertodo.atd.plist`，登录拉起、崩溃自动重启 |
| Linux | systemd 用户单元 | `~/.config/systemd/user/atd-watch.service`，`systemctl --user enable --now` |

依赖很少（textual / rich / windows-toasts 三个），详见 `requirements.txt`。
