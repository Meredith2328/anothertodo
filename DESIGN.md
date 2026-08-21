# anothertodo 架构说明

atd 是一个命令行待办工具：一行自然语言输入、终端 TUI、本地提醒、Git 同步。
本文说明它现在长什么样、每层负责什么、以及改代码时哪些地方不能碰。

历史背景：这个项目最早是 Python 实现，后来整体迁到 TypeScript / Node。
迁移已经完成，Python 实现和对应的 PyInstaller CI 都已删除，数据格式保持兼容——
老版本写下的 `~/.atd/tasks.jsonl` 现在照样能读。

## 技术栈

| 用途 | 选择 |
|---|---|
| 语言 | TypeScript strict（禁 `any`、禁静默 catch、禁未处理 Promise） |
| 运行时 | Node ≥ 22，ESM |
| 开发运行 | `tsx`，构建 `tsup` → `dist-node` |
| 单文件发行 | Node SEA（esbuild + postject），见 `tools/build-sea.mjs` |
| 数据校验 | Zod（`src/contracts.ts` 是唯一的数据契约） |
| CLI | Commander v13 |
| TUI | Ink v5 + React 18 |
| 测试 | Vitest，外加 `fixtures/*.json` 里的冻结用例 |

## 分层

```
src/
  contracts.ts        Zod schema：Task / Reminder / Recur / Tombstone / Config
  core/               纯逻辑，不碰 IO
    parse.ts          一行输入解析（日期、时间、优先级、标签、提醒、重复、备注、清空指令）
    query.ts          查询语法编译成谓词并匹配
    priority.ts       档位排序与 urgency 打分
    agenda.ts         分组、父子嵌套、单行渲染
    report.ts         projects / tags / stats / export 的统计与导出
    task.ts           id、时间戳、逾期与等待判断
    task-ops.ts       把解析结果套到任务上，以及反向拼回一行输入
    config.ts         TOML 读写（保留注释）、数据目录定位
    i18n.ts           界面文案中英对照
    width.ts          终端显示宽度（CJK 双宽），CLI 表格与 TUI 共用
    events.ts         领域事件总线
  storage/            JSONL 读写、文件锁、归档事务
  sync/               Git 同步与 id 归并
  reminders/          提醒巡检、通知 hook、开机自启
  app/service.ts      应用服务层：CLI 与 TUI 唯一的写入口
  cli.ts              命令行
  tui/                Ink 界面
```

规矩只有两条，但很硬：

- **业务规则不写在 UI 里。** CLI 和 TUI 只能调 `ApplicationService`，不能自己改任务字段。
  重复任务派生下一次、完成父任务时交代子任务这类决定都在 service 里，
  这样两个界面的行为不会分叉。
- **`core/` 不做 IO。** 纯函数好测，`fixtures/` 里的冻结用例就是靠这一点跑起来的。

## 数据契约

`src/contracts.ts` 是唯一的真相来源，所有读写都过 Zod。几个刻意的选择：

- `due`、`wait`、提醒的 `at` 都是**不带时区**的本地时间字符串。这是从 Python 版继承的语义，
  改成 UTC 会让老数据的含义发生偏移。
- `status` 是自由字符串而不是枚举。已知状态（todo / waiting / done / cancelled / meeting）
  由议程和提醒巡检处理，不认识的状态也要能读出来、原样写回去。
- `entry` / `modified` 允许为空或带非 UTC 偏移，因为老文件里就有这种记录。新写入统一 UTC。
- `id` 只要求非空。新 id 是 8 位十六进制，但手工造的旧 id 不能因为格式不符就被丢掉。

## 存储

数据放在 `~/.atd`（`ATD_HOME` 可覆盖）：

```
tasks.jsonl          一行一个任务或墓碑
archive.jsonl        归档
undo.jsonl           撤销栈
config.toml          配置
.lock                proper-lockfile 的数据锁
.archive.txn.json    归档事务日志
hooks/               用户自定义提醒脚本
```

写入路径上的几件事，改动时要保留：

- **写 → fsync → 原子 rename**，不直接改原文件。
- 所有写操作在 `proper-lockfile` 数据锁内串行，多个 atd 进程并发也不会互相踩。
- **乐观并发**：`save` 会比较传入的 `before.modified` 与磁盘上的值，不一致就抛
  `ConcurrentModificationError`，而不是默默覆盖别人的修改。
- **删除写墓碑**，不物理删行。同步时「删除」要能压过对端的旧编辑。
- 归档是两阶段的：先写 `.archive.txn.json`，再搬数据；启动时发现残留日志会自动补完。

## 事件

`DomainEventBus`（`src/core/events.ts`）只做**提交后通知**，一律在释放文件锁之后才发，
订阅者抛错不会回滚存储。事件与载荷以 `DomainEvents` 类型为准：

| 事件 | 载荷 |
|---|---|
| `task.created` | `{ task }` |
| `task.updated` | `{ before, after }` |
| `task.deleted` | `{ task, tombstone }` |
| `task.restored` | `{ task }` |
| `reminder.due` | `{ task, reminderIndex, missed }` |
| `reminder.fired` | `{ taskId, reminderIndex }` |
| `config.reloaded` | `{ config }` |
| `sync.completed` | `{ summary }` |
| `sync.failed` | `{ error }` |

## 一行输入

`core/parse.ts` 按固定顺序剥离各个字段，顺序本身是有意义的：

1. `>>` 之后到行尾整段当备注——先摘掉，里面的 `#` `@` 日期才不会被误认成字段
2. `-due` `-proj` 这类清空指令，以及 `-#标签`
3. `*每天` `*每周三` 这类重复规则
4. `@none` / `no reminders`（关掉默认提醒），必须在 `@提醒` 循环之前处理
5. `#标签` → `proj:项目` → `^父任务` → `~等待日期`（按最长前缀扫描，支持 `~next monday`）
6. `@提醒` 循环
7. 剩下的文本里扫日期和时间当截止时间
8. 没写提醒也没关闭时补一个默认提醒：距截止超过 24 小时提前一天，否则提前 15 分钟
9. 紧急度短语（中英文都认）
10. 剩下的词拼成标题

`taskToInput` 是它的反函数，负责把任务拼回一行给编辑框回填。
**给 parse 加字段时必须同时改 `taskToInput`**，否则在 TUI 里编辑一次就把新字段丢了。

## 提醒

`reminders/watcher.ts` 巡检到期提醒，投递走 `hooks.ts`：

- **租约认领**：`claimReminder` 用 owner UUID 抢占，`completeReminder` 收尾。
  多个 watcher 同时跑也不会重复发同一条。
- **指数退避**：失败后按 `2 ** attempts` 重排，超过 `MAX_HOOK_ATTEMPTS` 标记为
  dead-letter，不再无限重试。
- 内置 hook：Windows 走 WinRT toast（内联 PowerShell + AppUserModelID 快捷方式）、
  macOS 走 `osascript`、Linux 走 `notify-send`，另有 nodemailer 邮件。
  用户可以往 `~/.atd/hooks/` 放自己的脚本。
- 开机自启：Windows `schtasks /SC ONLOGON`、macOS launchd plist、Linux systemd user unit，
  都调 `--watch-daemon`。这个参数在 commander 解析之前就被短路处理，所以多余的入口参数无害。

## Git 同步

私有仓库放在 `~/.atd` 本地目录，`atd sync` 做 commit → fetch → rebase → push，
`atd sync --setup <url>` 负责第一次配 origin。

归并规则（**不要改**，改了会让两台机器的历史对不上）：

- 按 id 归并 JSONL，`modified` 新的一方胜出
- 删除压过旧的编辑
- 不同 id 的任务取并集

隐私相关的两条硬约束：

- 白名单写在 `.git/info/exclude` 而不是 `.gitignore`，避免多出一个未跟踪文件卡住 rebase
- 如果发现 `config.toml`、`undo.jsonl`、`hooks/` 这些敏感路径已被 Git 跟踪，
  sync 直接拒绝提交并提示用户先 `git rm --cached`

## TUI

单文件 `tui/app.tsx`，reducer 驱动（`tui/state.ts`），按键映射在 `tui/keymap.ts`，
鼠标走自建的 `tui/mouse.ts` 桥接 + alt-screen（`\x1b[?1049h`）。

几个踩过的坑，写在这里免得再踩：

- **鼠标和键盘的 hook 必须放在帮助 / 欢迎 / 详情 / 确认这些早返回之前。**
  否则弹窗打开时 hook 数量变化，React 抛 "Rendered fewer hooks" 直接退出，表现是闪退。
- Ink 的 `key` 没有 `name` 字段，Ctrl+字母要靠 `key.ctrl` + 小写 `input` 判断。
- 整帧行数必须严格等于终端行数，溢出会让上一帧的残留卷在屏幕顶部。
- 选中索引和显示顺序必须用同一份数据。父子嵌套重排后要一起摊平，
  否则 j/k 选中的行和高亮的行会错开。
- 分组用 `key` 而不是显示名来判断和上色——显示名会随界面语言变。

## 不要改的东西

这些是兼容性边界，不是风格偏好：

- 一行输入语法和查询语法（可以加，不要改已有写法的含义）
- 数据目录位置 `~/.atd`
- 任务 id 格式、JSON 字段名、墓碑语义
- 已有快捷键的含义
- Git 归并规则

## 开发

```bash
npm run dev -- list                # tsx 直接跑
npm test                           # vitest
npm run typecheck                  # tsc --noEmit
npm run lint                       # eslint
npm run build                      # tsup → dist-node
npm run build:sea                  # 单文件可执行（CI 里注入 blob）
npm run test:tui:stable            # 反复跑 TUI 集成测试，抓间歇性崩溃
npx tsx tools/dump-tui-frame.mjs   # 渲染几帧 TUI 到 stdout，目检布局
```

改动前后都跑一遍 `typecheck` + `lint` + `test`。
涉及界面的改动用 `dump-tui-frame` 看一眼实际渲染，别只靠测试断言。
