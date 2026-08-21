# 安装

atd 当前是 Node.js 22+ 实现，三端通用（Windows / macOS / Linux）。

## 前置要求

- **Node.js ≥ 22**（Node 20 及以下不支持）
- 可选：`git`（用于多端同步，见 [多端同步](/guide/sync)）

```bash
node --version   # 确认 ≥ 22
```

## 源码安装（开发 / 最新）

```bash
git clone <本仓库> && cd anothertodo
npm ci
npm run build
npm link          # 全局注册 `atd` 命令
```

装好后在任何位置敲 `atd` 都能用。

## 用 npx 临时跑（不想全局安装）

```bash
npx anothertodo list
```

## 验证安装

```bash
atd --help
atd add "明天 买牛奶"     # 添加一条
atd list                 # 查看列表
```

首次执行任何命令时，会自动在用户目录创建数据目录 `~/.atd/`（Windows 上是 `C:\Users\<你>\.atd\`），里面是纯文本文件：

| 文件 | 作用 |
|---|---|
| `tasks.jsonl` | 所有任务，一行一个 JSON，唯一事实源 |
| `undo.jsonl` | 撤销日志 |
| `archive.jsonl` | 归档的旧任务 |
| `config.toml` | 全部配置 |
| `hooks/` | 自定义提醒 hook 目录 |

用 `atd config path` 可随时确认数据目录位置。

## 可选：开机自启守护进程

提醒功能需要一个后台守护进程（见 [提醒系统](/guide/reminders)）。设置开机自启：

```bash
atd watch --install     # Windows 计划任务 / macOS launchd / Linux systemd
atd watch --uninstall   # 取消自启
```

## 下一步

- [三分钟上手](/guide/quickstart)
- [命令行 (CLI)](/guide/cli)
- [全屏界面 (TUI)](/guide/tui)
