# anothertodo (`atd`)

![atd TUI](.assets/TUI.png)

**中文 README** · [English README](README.en.md)

轻量 todo：一行模糊输入添加任务，命令行 TUI 管理，提醒 hook 通知，git 多端同步。数据是纯文本 JSONL，存在 `~/.atd/`。

> 完整功能与案例见 **[VitePress 文档站](https://meredith2328.github.io/anothertodo/)**。本 README 是速查。

## 安装

**Node.js**：需要 Node.js 22+，从源码安装：

```bash
npm ci
npm run build
npm link
```

安装后 `atd` 使用 Node 实现。数据存在 `~/.atd/`，与其他安装方式互通。

**独立可执行文件（推荐，无需安装任何东西）**：从 GitHub Releases（`node-v*` tag）下载对应平台的单文件程序——Windows 直接双击 `atd-windows.exe` 进入 TUI；macOS/Linux `chmod +x` 后运行。数据仍存 `~/.atd`。

数据目录 `~/.atd/` 首次运行自动创建。

## 快速上手

**命令行**：

```bash
atd add "后天 买牛奶 很急 @18:30"   # 一行添加：日期/紧急度/提醒全解析
atd list                          # 逾期/今天/接下来/等待/无日期 分组
atd done 3fbd                     # 完成任务（id 前几位即可）
atd undo                          # 撤销上一步
```

**TUI**（直接敲 `atd`）：

```
直接打字 = 添加（下方实时解析预览）    j/k 移动 · d 完成 · x 删除 · e 编辑
: 命令（list/undo/sync/mode）       / 搜索 · ? 帮助 · q/Q/双击 Esc 退出
```

## 一行输入魔法

日期、时间、紧急度、标签、提醒，混写在一行里自动解析，剩下的是标题：

```bash
atd add "周五 18:30 例会 #工作 proj:日常"       # 最近周五 18:30 + 标签/项目
atd add "下月初 交总结 很急 @月初:toast,email"  # 下月 1 号 + 高紧急度 + 双提醒
atd add "等回复 ~下周一 Terra"                  # wait 到下周一浮出 + 档位
atd preview "后天 下午2点半 复盘 特急"           # 先看解析结果再添加
```

| 你写 | 解析为 |
|---|---|
| `明天` `后天` `周五` `下周一` `月底` `8.20` | 各种日期（数字过期保持字面） |
| `today` `tomorrow` `tonight` `next fri` `this weekend` | 英文日期（tomorrow 默认上午 10 点，next 指下一周） |
| `晚上8点` `下午3点半` `14:30` `2:30pm` `9am` | 时间（无日期则顺延明天；支持 12 小时制） |
| `很急` `特急` `urgent` `very urgent` → 高；`一般` `normal` → 中；`不急` `no rush` → 低 | 紧急度短语（`Sol` 等档位名也行；英文短语带词边界） |
| `#标签` `proj:项目` `^父id` `~周五` `~next monday` | 标签 / 项目 / 子任务 / wait（含多词英文日期） |
| `@18:30` `@9:00:toast,email` `@30m` | 提醒（锚定任务日期，可多 hook） |

不写提醒时，有截止时间的任务会自动补一个 toast：距截止超过 24 小时提前 1 天，否则提前 15 分钟；写 `@none`、`@off` 或 `no reminders` 可关闭。

## 提醒

```bash
atd watch --install        # 开机自启守护进程（Win schtasks / Mac launchd / Linux systemd）
atd watch                  # 前台运行（每 30s 扫描，错过补发并标 [错过]）
atd snooze 3fbd 10m        # 推迟提醒
```

内置 hook：`toast`（三端系统通知）、`email`（配置 `[email]` 段）。自定义 hook：`~/.atd/hooks/` 放脚本即可，添加时 `@18:00:名字` 调用。

## 排序与查询

两种排序随时切换（TUI 按 `1`/`2`，或 `config.toml` 的 `priority.mode`）：`levels` 按档位、`urgency` 按加权分（逾期/临期/年龄，系数可调）。

```bash
atd list due:today +urgent -低 project:读书 status:waiting /关键字
atd list -m urgency        # 单次用 urgency 排序
```

## 多端同步

代码开源、**数据私有**：`~/.atd` 是一个私有 git 仓库，各端本地读写，`atd sync` 时才合并。

```bash
cd ~/.atd && git remote add origin <你的私有仓库>
atd sync          # commit + fetch + rebase + push
```

冲突规则：同一任务取新修改、删除优先于旧编辑、不同任务取并集（已实测双端场景）。

## 数据与命令

```
~/.atd/tasks.jsonl    任务数据（唯一事实源）      ~/.atd/archive.jsonl  归档
~/.atd/config.toml    配置                       atd archive list/restore  查看/恢复历史
```

全部命令：`add list done rm edit show undo reopen archive sync watch snooze hooks config preview`

## 开发与打包

```bash
npm test                 # 运行测试套件
npm run typecheck        # tsc 类型检查
npm run build            # 构建到 dist-node
npm run build:sea        # 打包独立可执行文件
```

发布产物由 GitHub Actions 自动构建：push `node-v*` tag 即产出三平台**独立可执行文件**（Node SEA 单文件程序，无需安装 Node，Windows 双击即用）。实现细节见文档站 [开发与构建](https://meredith2328.github.io/anothertodo/guide/development)。
