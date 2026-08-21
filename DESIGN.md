# anothertodo：Python → TypeScript / Node.js 完整迁移方案

## 1. 迁移目标与边界

目标：

- 保留当前所有用户可见行为：CLI、TUI、模糊输入、提醒、hook、Git 同步、undo、归档、跨平台打包。
- 保持现有数据目录和 JSONL 数据可读，避免用户迁移时丢任务。
- 用 TypeScript 严格类型、运行时 schema 校验、明确的事件模型替代 Python 里的隐式耦合。
- 不进行一次性重写；每阶段都有可运行、可回退、可对比的版本。

不建议迁移时顺手改变：

- 输入语法。
- `~/.atd` / `%USERPROFILE%\.atd` 的默认位置。
- 任务 ID、JSON 字段和 tombstone 删除语义。
- 现有快捷键含义。
- Git 同步的“新 modified 优先、删除优先、不同任务并集”规则。

## 2. 推荐技术栈

```
运行时：Node.js 22 LTS+
语言：TypeScript strict
包管理：npm workspaces
构建：tsup 或 esbuild
测试：Vitest
CLI 参数：commander
运行时数据校验：zod
终端 UI：Ink + React
Git 调用：execa
SMTP：nodemailer
桌面通知：按平台拆适配器
文件锁：proper-lockfile
日期：date-fns
```

不要把 `EventEmitter` 当数据库或工作流引擎。它只负责“存储成功后通知其他模块”；Node 的监听器默认同步执行，订阅者必须短小、无副作用或自行异步处理。

## 3. 目标目录结构

```
anothertodo/
  package.json
  package-lock.json
  tsconfig.json
  vitest.config.ts
  apps/
    cli/
      src/
        main.ts
        commands/
          add.ts
          list.ts
          done.ts
          edit.ts
          undo.ts
          sync.ts
          watch.ts
          archive.ts
          config.ts
          tui.ts
  packages/
    core/
      src/
        task.ts
        schema.ts
        parse/
          parser.ts
          dates.ts
          reminders.ts
          priority.ts
        query.ts
        agenda.ts
        events.ts
        errors.ts
    storage/
      src/
        paths.ts
        jsonl.ts
        lock.ts
        store.ts
        undo.ts
        archive.ts
    sync/
      src/
        git.ts
        merge.ts
    reminders/
      src/
        watcher.ts
        scheduler.ts
        hooks/
          registry.ts
          toast.ts
          email.ts
          script.ts
    tui/
      src/
        app.tsx
        state.ts
        keymap.ts
        components/
          TaskTable.tsx
          InputBar.tsx
          Preview.tsx
          HelpModal.tsx
  tests/
    fixtures/
      parser-cases.json
      task-cases.json
      sync-cases.json
      tui-cases.json
```

如果工作区拆包过重，也可以先保留单个 `src/`，但模块边界必须按上面的分层实现。

## 4. 核心数据契约

先把 Python 当前数据格式冻结为 JSON Schema / Zod schema。任何 TS 代码只能通过 schema 读写任务。

```
const TaskSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{8}$/),
  title: z.string(),
  status: z.enum(["todo", "waiting", "done", "cancelled", "meeting"]),
  due: z.string().datetime().optional(),
  priority: z.string().optional(),
  tags: z.array(z.string()).default([]),
  project: z.string().optional(),
  parent: z.string().optional(),
  wait: z.string().date().optional(),
  notes: z.string().default(""),
  reminders: z.array(
    z.object({
      at: z.string().datetime(),
      hooks: z.array(z.string()).min(1),
      fired: z.boolean().default(false),
      attempts: z.number().int().optional(),
    }),
  ).default([]),
  entry: z.string().datetime(),
  modified: z.string().datetime(),
  end: z.string().datetime().optional(),
});

const TombstoneSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{8}$/),
  deleted: z.literal(true),
  modified: z.string().datetime(),
});
```

约束：

- `modified` 和 `entry` 使用 UTC ISO 8601。
- `due` 保持当前的本地“无时区日期时间”语义；不要在迁移时悄悄改为 UTC。
- 读 JSONL 时，同 ID 取最后一条。
- 写入时执行 canonicalize：同 ID 只保留一条最终记录。
- 删除写 tombstone；同步时 tombstone 永远优先于任务更新。

## 5. 事件模型

事件只在存储事务成功后发出。

```
type DomainEvents = {
  "task.created": { task: Task };
  "task.updated": { before: Task; after: Task };
  "task.deleted": { id: string; before: Task };
  "task.restored": { task: Task };
  "reminder.due": { task: Task; reminderIndex: number };
  "reminder.fired": { taskId: string; reminderIndex: number };
  "sync.completed": { changedTaskIds: string[] };
  "config.reloaded": { config: Config };
};
```

事务顺序必须固定：

```
命令/UI 输入
  → 参数与 schema 校验
  → Store 写入 + fsync + 原子 rename
  → undo 日志写入（仅用户操作）
  → 发布领域事件
  → TUI / watcher / 日志等订阅者响应
```

规则：

- `task.updated` 不能反过来触发再次保存。
- 提醒的 `fired` 标记不写入 undo。
- 订阅者失败不回滚已完成的任务写入。
- watcher 应轮询或监听数据文件，但不能直接绕过 `Store` 修改 JSONL。

## 6. 存储设计

保留：

```
~/.atd/
  tasks.jsonl
  undo.jsonl
  archive.jsonl
  config.toml
  hooks/
```

实现要求：

- `proper-lockfile` 锁住 `.lock`，所有写操作必须持锁。
- 临时文件必须在目标文件同目录创建。
- 写入顺序：写临时文件 → flush/fsync → atomic rename。
- 恢复归档时，前缀匹配必须删除真实完整 ID 的归档记录。
- 读取损坏行只报警并跳过；不得让整个 CLI 崩溃。
- 所有文件系统路径通过单一 `Paths` 模块管理。

长期可选改进：

```
tasks/
  <id>.json
tombstones/
  <id>.json
```

这会更利于 Git 合并，但属于第二阶段优化，不能和语言迁移混在一起。

## 7. 模糊输入迁移

Python parser 是最高风险模块，必须先做 golden tests。

先生成并提交测试夹具：

```
{
  "input": "下周五 下午2点半 采购复盘 特急 #重要 proj:采购 @14:00:toast,email",
  "now": "2026-08-18T14:00:00",
  "levels": ["低", "中", "高"],
  "expected": {
    "title": "采购复盘",
    "due": "2026-08-28T14:30:00",
    "priority": "高",
    "tags": ["重要"],
    "project": "采购"
  }
}
```

覆盖至少：

- 今天、明天、后天、大后天、今晚、明晚。
- 周几、本周、下周、周末。
- 月初、月底、下月初、下月底、跨年。
- 数字日期、中文日期、过去日期保留字面。
- 中英文时间、上午/下午/晚上、半、一刻、三刻。
- 高中低紧急度短语和误匹配保护。
- 标签、项目、父任务、waiting。
- 相对提醒、绝对提醒、多 hook。
- 自定义 priority levels。
- 反向序列化 `taskToInput`。

验收标准：

```
TS parser 对全部 golden fixtures 的输出与 Python 当前版本一致。
```

## 8. TUI 迁移策略

TUI 最后迁移。

状态应集中在一个 reducer：

```
type TuiState = {
  focusedArea: "table" | "input";
  selectedTaskId?: string;
  input: string;
  query: string;
  editingTaskId?: string;
  mode: "levels" | "urgency";
  dateFormat: "auto" | "md" | "full";
  flashMessage?: string;
  helpOpen: boolean;
  exitArmedAt?: number;
};
```

键盘逻辑必须独立成 `keymap.ts`，避免散落在 React 组件里。

保留快捷键：

```
j/k/↑/↓、g/G、Enter、d、x、e、w、u、Ctrl+Z、r、
1/2、t、/、Ctrl+F、:、Tab、?、F1、Ctrl+S、Esc、Q、Ctrl+Q。
```

关键回归测试：

- 进入已有任务列表时，默认选中真实任务而非分组标题。
- 输入框中 `d/x/e/u` 等字符必须作为文本输入，不触发全局快捷键。
- `Tab` 仅在输入框中补全。
- 输入框 Esc、编辑 Esc、列表双 Esc 退出语义完全保持。
- 终端 resize 时横幅在 full/small 两种稳定变体间切换。
- Windows Terminal 下中文输入、全角标点、IME 输入不丢字符。

## 9. 提醒与 hooks

接口：

```
interface NotificationHook {
  readonly name: string;
  send(input: {
    task: Task;
    message: string;
  }): Promise<void>;
}
```

实现：

```
toast:
  Windows：PowerShell / WinRT 适配器
  macOS：osascript
  Linux：notify-send

email:
  nodemailer
  SMTP 配置来自 config.toml
  支持环境变量覆盖密码，如 ATD_EMAIL_PASSWORD

script:
  hooks/<name>.js/.cmd/.ps1/.py/.exe
  stdin JSON
  timeout
  非 0 退出码记录错误
```

watcher：

- 每 30 秒扫描未 fired 的提醒。
- 只触发 active 状态的任务：todo、waiting、meeting。
- done/cancelled 永不触发。
- 提醒失败也标记 fired，避免无限重复；日志必须明确失败。
- `snooze` 只改最后一个未触发提醒。
- 真实 SMTP、通知和自定义 hook 的 E2E 测试不进入普通 CI，只走手动 workflow。

## 10. Git 同步

封装 `GitClient`，不允许业务代码直接 `spawn("git")`。

算法：

```
1. 持锁。
2. git add / commit 本地更改。
3. fetch。
4. 远程没有分支时首次 push。
5. rebase。
6. tasks.jsonl 冲突时按 ID 读取双方内容。
7. 合并规则：
   - 不同 ID：并集。
   - 同 ID：modified 新者胜。
   - 任意一方 tombstone：tombstone 胜。
8. 写入合并结果，继续 rebase。
9. push。
10. 发布 sync.completed。
```

必须用 fixture 测试：

- 双端分别新增。
- 同任务不同时间修改。
- 删除 vs 编辑。
- 同时间 modified。
- 重复 ID。
- 无远程、空远程、rebase 失败。
- 非 tasks 文件冲突时保留本地规则。

## 11. 打包与发布

不要在 matrix 的三个 job 内直接创建 Release；否则某个 OS 失败时会留下半成品 Release。

正确 CI：

```
test/build matrix
  ├─ Windows：测试 → 打包 → 上传 artifact
  ├─ macOS：测试 → 打包 → 上传 artifact
  └─ Linux：测试 → 兼容容器打包 → 上传 artifact
                         ↓
                 release job（needs matrix）
                         ↓
          下载全部 artifact → 创建 GitHub Release
```

发布 job 只有在三个构建 job 都成功后执行。Linux 构建继续固定低 glibc 基线容器，并保留 WSL 真实二进制冒烟测试。

推荐命令：

```
{
  "scripts": {
    "dev": "tsx src/cli.ts",
    "build": "tsup src/cli.ts --format cjs --platform node",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "lint": "eslint .",
    "smoke:linux": "bash tools/smoke-linux.sh"
  }
}
```

先发布 npm 包；单文件可执行文件作为第二阶段。Node SEA 可用但仍在演进，必须有独立的每平台冒烟测试，不能只看“构建成功”。

## 12. 分阶段迁移路线

每一步必须是可运行、可测试、可提交的独立里程碑。

| 阶段 | 内容                               | 完成标准                                         |
| ---- | ---------------------------------- | ------------------------------------------------ |
| 0    | 冻结 Python 行为                   | 现有测试全绿；补齐 golden fixtures               |
| 1    | 初始化 TS 工程和契约               | `npm test`、`npm run typecheck` 全绿             |
| 2    | Task / 配置 / JSONL / 锁           | 与 Python fixtures 逐条一致                      |
| 3    | parser / query / priority / agenda | 对同一输入产生相同 task 和排序                   |
| 4    | CLI 命令                           | `add/list/done/edit/undo/archive` 全部端到端通过 |
| 5    | Git 同步                           | 双目录冲突合并、墓碑优先、失败可回滚             |
| 6    | 提醒与 hooks                       | 真实 SMTP、通知、用户 hook、snooze 测试          |
| 7    | TUI                                | 快捷键与 Python 版行为兼容，Windows 实测         |
| 8    | 三端打包与发布                     | Windows/macOS/Linux 真实产物冒烟通过             |
| 9    | 切换默认实现                       | `atd` 指向 Node；Python 保留只读兼容期           |
| 10   | 移除 Python                        | 至少一个稳定版本后再删除旧实现                   |

## 13. 阶段 0：冻结契约

在动任何业务代码前生成并提交 fixtures：

```
fixtures/
  parse-cases.json
  query-cases.json
  priority-cases.json
  agenda-cases.json
  storage-cases.json
  sync-cases.json
  tui-shortcuts.md
```

`parse-cases.json` 至少覆盖：

- 中文相对日期、周几、月底/月初、节日、数字日期；
- 时间、晚间/下午/半点；
- 紧急度词边界；
- 标签、项目、父任务、waiting；
- 绝对/相对提醒、多个 hook；
- 非法输入与空标题。

fixture 格式：

```
{
  "input": "后天 下午2点半 复盘 特急 #重要 @14:00:toast,email",
  "now": "2026-08-20T10:00:00",
  "levels": ["低", "中", "高"],
  "expected": {
    "title": "复盘",
    "due": "2026-08-22T14:30:00",
    "priority": "高",
    "tags": ["重要"]
  }
}
```

Node 版一开始不需要调用 Python；只以这些已冻结 fixtures 为唯一行为规范。

## 14. 数据兼容策略

第一阶段必须继续兼容：

```
~/.atd/
  tasks.jsonl
  undo.jsonl
  archive.jsonl
  config.toml
  hooks/
```

字段必须保持：

```
type Task = {
  id: string;
  title: string;
  status: "todo" | "waiting" | "done" | "cancelled" | "meeting";
  due?: string;
  priority?: string;
  tags?: string[];
  project?: string;
  parent?: string;
  wait?: string;
  notes?: string;
  reminders?: Reminder[];
  entry: string;
  modified: string;
  end?: string;
};

type Tombstone = {
  id: string;
  deleted: true;
  modified: string;
};
```

规则：

- `modified` 统一 UTC ISO 时间；
- `due` 保持当前无时区的本地语义，不能贸然改为 UTC；
- 重复 id 取最后一条；
- tombstone 永远优先于旧编辑；
- 任何写入都通过同目录临时文件 + 原子 rename；
- 锁文件必须在异常时释放；
- 迁移期 Node 与 Python 不要同时写同一个目录。

长期可考虑从 JSONL 改为 `tasks/<id>.json`，但要等 Node 版稳定后另开数据格式版本；不要把 Git 同步迁成单 SQLite 文件。

## 15. 事件模型

事件只用于“提交成功后的通知”，不用于替代事务或存储。

```
type DomainEvents = {
  "task.created": { task: Task };
  "task.updated": { before: Task; after: Task };
  "task.deleted": { task: Task; tombstone: Tombstone };
  "task.restored": { task: Task };
  "reminder.due": { task: Task; reminder: Reminder; missed: boolean };
  "config.reloaded": { config: Config };
  "sync.completed": { summary: SyncSummary };
  "sync.failed": { error: Error };
};
```

写入流程固定：

```
命令 / TUI action
  → validate
  → Store transaction
  → 原子落盘成功
  → emit domain event
  → UI / watcher / 日志订阅者响应
```

约束：

- subscriber 失败不能回滚已提交任务；
- 事件 payload 使用不可变快照；
- 不允许 subscriber 再隐式写同一任务；
- 长操作（sync、email、外部 hook）放任务队列或明确 `await`；
- `EventEmitter` 的监听器默认同步执行，因此同步监听器必须轻量。

## 16. TUI 迁移要求

先实现 CLI，再实现 TUI。TUI 不得自行重写业务逻辑，只能调用 application service。

需要保留的交互：

```
j/k/↑/↓、g/G、Enter、d/x/e/w/u/r、
1/2/t/i、Tab、:/、? / F1、
Ctrl+Z/Ctrl+S/Ctrl+F、Esc、Q/Ctrl+Q
```

TUI 状态建议：

```
type UiMode =
  | { kind: "list" }
  | { kind: "add"; input: string }
  | { kind: "edit"; taskId: string; input: string }
  | { kind: "search"; input: string }
  | { kind: "command"; input: string }
  | { kind: "help" };
```

关键回归点：

- 初始光标必须指向第一条真实任务，不是分组标题；
- 输入框中的 `d/x/u` 必须是文字，不得触发全局快捷键；
- Tab 只在输入模式补全；
- Esc 的编辑取消、输入清空、双击退出必须分层处理；
- Windows Terminal、PowerShell、WSL 各跑一次真实手工测试；
- 不要依赖 SVG 截图判断 ASCII 横幅；终端字体差异会误导视觉判断。

## 17. 提醒、通知与外部 hook

接口定义：

```
interface NotificationAdapter {
  name: string;
  send(input: NotificationInput): Promise<void>;
}

interface HookRunner {
  run(name: string, payload: HookPayload): Promise<HookResult>;
}
```

实现：

```
toast/windows
toast/macos
toast/linux
email/nodemailer
user-script/spawn
```

要求：

- hook 子进程设置超时、捕获 stdout/stderr、检查退出码；
- 邮箱密码只能读环境变量或用户配置，不进入日志、fixture、Git；
- watcher 只扫描 active task；
- reminder fired 标记不写入 undo；
- watcher 每次读数据后重新确认任务状态，避免完成任务仍通知；
- 自启测试执行“注册 → 查询 → 卸载”，不能残留系统计划任务。

## 18. Git 同步实现

使用受控命令执行器封装 `git`：

```
interface GitRunner {
  run(args: string[], options?: { cwd: string }): Promise<GitResult>;
}
```

同步顺序：

```
获取锁
→ 校验 / 修复 JSONL
→ git add + commit
→ fetch
→ 判断远端分支
→ rebase
→ 仅 tasks.jsonl 冲突时执行按 id 合并
→ continue
→ push
→ 释放锁
```

冲突合并测试至少包括：

- 两端新增不同任务；
- 同一任务两端编辑，`modified` 新者胜；
- 删除与编辑冲突，删除胜；
- 空、损坏、重复记录；
- rebase continue 失败后 abort；
- 无远端、空远端、无 git 用户配置。

## 19. Luna 的主提示词

```
你正在把 anothertodo 从 Python 迁移到 TypeScript/Node.js。

硬约束：
1. 不修改 ~/.atd 的现有数据格式，除非本阶段明确写迁移。
2. 不做一次性重写；每阶段必须可运行、可测试、可提交。
3. 先读文档站 [开发与构建](https://meredith2328.github.io/anothertodo/guide/development) 和现有测试。
4. 业务行为以 fixtures 为准，不以“更合理”的猜测替代兼容性。
5. TypeScript 开启 strict；禁止 any、静默 catch、未处理 Promise。
6. 不在 UI 中写业务规则；UI 只能调用 application services。
7. 所有存储写入必须原子化且有锁。
8. 事件只能在持久化成功后发送；subscriber 失败不能损坏任务。
9. 每次改动后执行 typecheck、相关测试和完整测试。
10. 不删除 Python 实现，直到迁移阶段明确允许。

当前阶段：
<填写阶段编号与目标>

完成后输出：
- 修改的文件；
- 新增或变更的行为；
- 测试命令及结果；
- 兼容性风险；
- 下一阶段前置条件。
```

## 20. 每阶段交付门槛

任何阶段未满足以下条件都不能进入下一阶段：

```
npm run typecheck
npm test
跨平台 fixture 一致性
无敏感信息进入仓库
git diff 可读、无无关格式化
至少一个真实 CLI 端到端流程
```

进入发布阶段额外要求：

```
Windows：exe --help、add/list/watch
macOS：binary --help、add/list
Linux / WSL：binary --help、add/list/done/reopen/watch
真实 SMTP：临时凭据测试后删除
计划任务：注册 → 查询 → 卸载
Git：本地 bare remote 冲突合并测试
```

## 21. 建议的首个 Luna 任务

```
执行迁移阶段 0 和阶段 1。

- 新建 ts-next 分支或 ts/ 目录，不动 Python 运行入口。
- 初始化 npm workspaces + TypeScript strict + Vitest + ESLint。
- 从 Python tests 提取并提交 parse/query/priority/agenda 的 golden fixtures。
- 实现最小的 Zod Task、Reminder、Config schema。
- 添加 fixture 加载测试。
- 不实现 CLI、TUI、存储写入或提醒。
- 跑完全部 Node 测试与现有 Python 测试。
```

这样开始最稳：先把“不能变的行为”钉死，再逐层替换实现。