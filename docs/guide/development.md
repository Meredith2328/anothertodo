# 开发与构建

## 前置要求

- **Node.js ≥ 22**

## 常用命令

```bash
npm ci              # 安装依赖
npm run dev         # 用 tsx 直接运行 CLI（开发模式）
npm run build       # tsup 构建到 dist-node
npm test            # vitest 运行全部测试
npm run typecheck   # tsc 类型检查
npm run lint        # eslint
npm run docs:api    # 从源码生成 API 文档（docs/api/）
```

## 文档站（本站点）

本站点用 **VitePress** 构建，源码在 `docs/`。

### 本地预览

```bash
npx vitepress dev docs
```

访问 `http://localhost:5173/anothertodo/`。

### 构建

```bash
npx vitepress build docs
```

产物在 `docs/.vitepress/dist`。

### 目录结构

```
docs/
├── index.md                 # 首页
├── .vitepress/
│   ├── config.mjs           # 站点配置（base=/anothertodo/）
│   └── theme/               # 自定义主题（配色与产品 UI 一致）
├── guide/                   # 指南页（介绍/安装/上手/输入/CLI/TUI/查询/提醒/优先级/同步/配置/数据/实测/开发）
├── api/                     # TypeDoc 自动生成的 API 文档（勿手改）
├── public/
│   └── screenshots/tui/     # TUI 实测截图
└── snippets/                # 实测的终端输出片段
```

### 保持 API 文档与代码同步

`docs/api/` 由 **TypeDoc** 从 `src/index.ts`（公共导出面）自动生成，**不要手工编辑**。改了源码后重新生成：

```bash
npm run docs:api
```

类型变更后运行 `npm run typecheck` 校验，`npm run docs:api` 会反映最新导出面。

### 实测证据的生成

- `docs/snippets/cli/` + `tools/docs-out/cli-report.json`：`node --import tsx tools/docs-capture-cli.mjs`
- `docs/snippets/tui/` + `docs/public/screenshots/tui/` + `tools/docs-out/tui-report.json`：`node --import tsx tools/docs-tui-shots.mjs`

这些脚本在本地跑，产物提交进仓库，保证文档里的命令输出和截图是真实采集的。

## 架构概览

代码分层（`src/`），展示层和逻辑层严格分离：

```
src/
├── contracts.ts    # Zod schema：Task/Reminder/Tombstone/Config
├── core/           # 纯逻辑，无 UI 依赖
│   ├── parse.ts    # 模糊输入解析
│   ├── priority.ts # 档位 + urgency 双模式排序
│   ├── query.ts    # 过滤查询编译与匹配
│   ├── agenda.ts   # 议程分组编排
│   ├── config.ts   # 配置读写
│   └── task.ts     # 任务数据类/状态/序列化
├── storage/        # 存储：原子写、文件锁、undo 日志、归档
│   └── store.ts
├── sync/           # git 同步 + 并集合并
├── reminders/      # watcher 守护进程 + hook 注册表
├── tui/            # Ink 全屏界面
├── app/service.ts  # CLI 和 TUI 共用的应用操作
├── cli.ts          # commander 子命令入口
└── index.ts        # 公共导出面（TypeDoc 入口）
```

给 Web 端预留的接口形态：直接复用 `Store / parse / groups / sortTasks`，读写同一份 `~/.atd/tasks.jsonl`（有文件锁，与 TUI/watcher 并发安全），从而做到"手机浏览器改一条，桌面 TUI 30 秒内自动刷新"。

## 下一步

- [API 参考](/api/README)
- [实测证据](/guide/verification)
