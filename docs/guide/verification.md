# 实测证据

本页汇总对当前版本（基于 commit `1fdd82a`，tag `node-v0.2.0` 之后快照）的全部实测结果，确保文档所述功能与真实行为一致。

## 测试基线

- **单元/集成测试**：94 个测试全部通过（vitest）
- **CLI 实测**：34 个场景真实运行，捕获每条命令的终端输出和退出码
- **TUI 实测**：14 个场景用真实 Ink 渲染管线驱动，每个场景断言帧内容符合预期

## CLI 实测场景

以下每个场景都是真实运行 `atd` 命令捕获的，脚本见 `tools/docs-capture-cli.mjs`，结果清单见 `tools/docs-out/cli-report.json`。

| 场景 | 覆盖功能 |
|---|---|
| `add-multi` | 批量添加，日期/紧急度/标签/项目/提醒解析 |
| `preview-basic` | 预览：日期+紧急度+提醒 |
| `preview-en-dates` | 英文相对日期 |
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

所有场景的非零退出码仅出现在预期的错误演示中（`show deadbeef`、空标题 `add`）。

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
| `delete-soft` | `x` 软删除、任务数减少 |
| `wait-defer` | `w` 设为等待 |
| `date-format` | `t` 切换日期列格式 |
| `undo` | `:undo` 撤销 |
| `sort-2` | `2` 切换 urgency 排序 |
| `exit-armed` | 双击 Esc 出现二次提示 |

14 个场景全部通过。

## 已发现的已知问题

在实测中发现了以下与预期不符的问题，如实记录如下：

### `Ctrl+Z` / `Ctrl+S` / `Ctrl+F` 在真实 TUI 中不生效

这三个快捷键在 `keymap.ts` 里通过 `key.ctrl && key.name === "z"/"s"/"f"` 判断。但 Ink 的 `useInput` 传给按键处理器的事件对象**不包含 `key.name` 字段**（只有 `key.ctrl` 标志）。因此这三个组合键无法匹配，实际行为是作为普通字符输入。

- **影响**：`Ctrl+Z`（撤销）、`Ctrl+S`（同步）、`Ctrl+F`（搜索）在 TUI 中失效。
- **替代方案**（均可用）：撤销 → `:undo`，同步 → `:sync`，搜索 → `/`。
- **定位**：`src/tui/keymap.ts` 依赖 `key.name`，而 `src/tui/app.tsx` 通过 `useInput` 收到的 `key` 对象无 `name`。单测 `tests/keymap.test.ts` 直接构造了含 `name` 的 key，掩盖了该问题。
- **状态**：待主线修复。

这解释了为什么 TUI 指南里的"通用快捷键"表格对这些键做了特殊标注。

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
