# 实测证据

本页汇总对当前版本（基于 commit `c236fc8`，tag `node-v0.2.0` 之后快照）的全部实测结果，确保文档所述功能与真实行为一致。

## 测试基线

- **单元/集成测试**：110 个测试全部通过（vitest）
- **CLI 实测**：51 个场景真实运行，捕获每条命令的终端输出和退出码
- **TUI 实测**：20 个场景用真实 Ink 渲染管线驱动，每个场景断言帧内容符合预期

## CLI 实测场景

以下每个场景都是真实运行 `atd` 命令捕获的，脚本见 `tools/docs-capture-cli.mjs`，结果清单见 `tools/docs-out/cli-report.json`。

| 场景 | 覆盖功能 |
|---|---|
| `add-multi` | 批量添加，日期/紧急度/标签/项目/提醒解析 |
| `preview-basic` | 预览：日期+紧急度+提醒 |
| `preview-en-dates` | 英文相对日期 |
| `preview-en-urgency` | 英文紧急度短语（`urgent`/`very urgent`/`no rush`） |
| `preview-12h` | 12 小时制时间（`2:30pm`/`9am`/`12pm`/`12am`） |
| `preview-wait-multiword` | 多词 wait 日期（`~next monday`/`~this weekend`/`~day after tomorrow`） |
| `default-reminder` | 默认提醒自动补 toast |
| `no-reminder` | `@none` / `no reminders` 关闭默认提醒 |
| `list-all` / `list-keyword` / `list-tag` / `list-notag` / `list-substr` | 查询与过滤 |
| `list-overdue` / `list-due` / `list-proj-prio` | 条件过滤 |
| `list-urgency` | urgency 排序模式 |
| `done` / `wait` / `reopen` | 状态变更 |
| `edit` / `show` | 编辑与查看 |
| `rm` / `undo-delete` | 软删除与撤销 |
| `archive-flow` | 归档/归档列表/恢复 |
| `snooze` / `undo-snooze` | 推迟提醒与撤销 |
| `sync-status` / `sync-remote` | git 同步 |
| `hooks` | 查看 hook |
| `config-show` / `config-set` | 配置查看与修改 |
| `watch-once` | 守护进程单次检查 |
| `error-show-missing` / `error-empty-title` | 错误处理 |
| `notes-input` | 备注语法 `>>`：之后的内容整段按备注处理，不再解析成字段 |
| `recur-input` | 重复规则的中英文写法（`*每天` `*每2周` `*每周三` `*工作日` `*weekly:mon`） |
| `recur-spawn` | 重复任务完成时派生出下一次，原任务留在历史里 |
| `clear-fields` | `edit` 用 `-due -proj -#标签` 清空字段 |
| `query-new` | 新增查询：`+高` 按档位、`!高`、`has:notes`、`-has:due`、`wait:none` |
| `subtasks` | 子任务缩进显示，父任务完成时点名未完成的子任务 |
| `status-entries` | 新状态入口 `cancel` / `meeting` / `todo` |
| `wait-until` | `wait --until 下周一` 押后到指定日期 |
| `show-human` | `show` 默认给出人读字段表，`--json` 输出原始 JSON |
| `summaries` | `projects` / `tags` / `stats` 三个汇总命令 |
| `export` | 导出 markdown 与 csv |
| `config-deep` | `config set` 写入任意层级 key、`config get` 读取，坏值与拼错 key 被当场拒绝 |
| `ui-lang` | 界面语言中英切换 |
| `done-twice` | 重复完成同一任务被拒绝 |

所有场景的非零退出码共 5 处，全部出现在刻意设计的错误演示里：

- `show deadbeef` —— 任务不存在
- `add "   "` —— 空标题
- `config set priority.mode nonsense` —— 配置值类型不对，被当场拒绝
- `config set priorty.mode urgency` —— key 拼错，被当场拒绝
- `done <已完成的 id>` —— 重复完成同一任务，被拒绝

这些非零退出码都是正确行为，恰好证明错误处理生效了。

## TUI 实测场景

每个场景用 `ink-testing-library` 驱动真实 `TuiApp`（真实 Store），通过 `TuiTestSignals` 同步按键时序，并断言帧内容。脚本见 `tools/docs-tui-shots.mjs`，结果清单见 `tools/docs-out/tui-report.json`。

| 场景 | 断言 |
|---|---|
| `main-list` | 横幅像素字、分组（接下来/等待中）、任务标题 |
| `add-flow` | 输入+预览显示日期/紧急度、提交成功、任务入库 |
| `help-full` | 完整帮助可见、任意键关闭 |
| `help-compact` | 矮终端切换紧凑版、无完整节名 |
| `command-mode` | `:mode urgency` 切换后显示 urgency 排序 |
| `search-filter` | `/报告` 过滤生效且排除未匹配 |
| `edit-task` | `e` 进入编辑态并回填内容 |
| `complete-done` | `d` 完成任务、状态落库 |
| `delete-soft` | `x` 先弹确认框；未确认前不删除；按 `y` 后任务数减少 |
| `detail-overlay` | `l` 打开详情浮层，显示备注正文、提醒投递状态、浮层操作提示 |
| `multi-select` | 空格多选后顶栏显示 `◉2`，行首出现勾选标记 |
| `subtasks` | 子任务有 `↳` 缩进标记，父任务排在其上方 |
| `recur-marks` | 列表里显示 `↻每天` 重复规则和 `✎` 有备注标记 |
| `wait-defer` | `w` 设为等待 |
| `date-format` | `t` 切换日期列格式 |
| `undo` | `Ctrl+Z` 撤销 |
| `ctrl-sync` | `Ctrl+S` 同步 |
| `ctrl-search` | `Ctrl+F` 搜索过滤 |
| `sort-2` | `2` 切换 urgency 排序 |
| `exit-armed` | 双击 Esc 出现二次提示 |

20 个场景全部通过。

## 实测发现并已修复的问题

在实测中发现了以下与预期不符的问题，主线已修复并随本文档同步：

### `Ctrl+Z` / `Ctrl+S` / `Ctrl+F` 在真实 TUI 中曾不生效（已修复）

这三个快捷键在 `keymap.ts` 里原先通过 `key.ctrl && key.name === "z"/"s"/"f"` 判断。但 Ink 的 `useInput` 传给按键处理器的事件对象**不包含 `key.name` 字段**（只有 `key.ctrl` 标志）。因此这三个组合键无法匹配，实际行为是作为普通字符输入。

- **影响**：`Ctrl+Z`（撤销）、`Ctrl+S`（同步）、`Ctrl+F`（搜索）在 TUI 中失效。
- **定位**：`src/tui/keymap.ts` 依赖 `key.name`，而 `src/tui/app.tsx` 通过 `useInput` 收到的 `key` 对象无 `name`。单测 `tests/keymap.test.ts` 直接构造了含 `name` 的 key，掩盖了该问题。
- **修复**（主线 commit `f1210b2`）：改为 `key.ctrl + input`（小写字母）识别 Ctrl 组合键，方向键改用 `upArrow/downArrow`，测试同步按真实 Ink 的 key 形状构造。

现在 `Ctrl+Z` / `Ctrl+S` / `Ctrl+F` 均已实测可用（见下方 TUI 实测场景 `undo` / `ctrl-sync` / `ctrl-search`）。

## 复现实测

你可以自己复现这些实测：

```bash
# CLI 实测（产出 docs/snippets/cli/ 和 cli-report.json）
node --import tsx tools/docs-capture-cli.mjs

# TUI 实测（产出 docs/snippets/tui/、docs/public/screenshots/tui/ 和 tui-report.json）
node --import tsx tools/docs-tui-shots.mjs

# API 文档（从源码自动生成，保证同步）
npm run docs:api
```

## 下一步

- [API 参考](/api/README)
- [开发与构建](/guide/development)
