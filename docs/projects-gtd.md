# 项目待办与 GTD

## 创建与推进项目

```powershell
atd project "学习信息物理系统" "学习第1章" "学习第2章" "学习第3章" "学习第4章" "学习第5章"
```

TUI 输入 `:project 学习信息物理系统 | 学习第1章 | 学习第2章 | 学习第3章 | 学习第4章 | 学习第5章`。安卓在添加任务页面选择“创建项目待办”，填写标题和每行一个的步骤。

项目使用已有的父子任务与前置依赖：步骤的 `parent` 指向项目，后一个步骤依赖前一个步骤。列表展示项目及当前可执行步骤，步骤使用 `-` 标记。完成当前步骤后，标题划线，下一步骤出现在下面并上移；终端按照字符行更新，安卓使用连续的高度动画。最后一个步骤完成时，项目一同完成。

完成项目标题会完成剩余步骤。项目完成、步骤完成及自动完成项目均通过共享服务提交，整次操作可以撤销。项目之外的前置依赖仍须满足，失败时整次操作保持原状态。项目创建时每个步骤需要有标题，项目步骤使用独立任务。

## GTD / Flashcard

TUI 使用 `:gtd` 或 `:flashcard` 进入，`:list` 返回普通清单。`:gtd 3` 设置同时显示三件事项。安卓点击任务页顶部的“GTD”，通过设置修改数量与推荐模板。命令行 `atd gtd` 输出同一推荐接口选择的事项。

缺省同时显示最多两件事项。候选需要满足全部前置依赖，未来等待事项与暂停事项不会进入候选。项目存在步骤时，候选包含可执行步骤。项目名称作为步骤的上下文显示。

完成事项后补充新的候选。仍然有效的卡片保持顺序，随机模板也遵循这条规则；安卓“重新推荐”按钮可以主动更新整组随机结果。候选不足时显示实际数量，全部完成时显示空内容。

默认模板包括跟随当前排序、优先级、紧急度与随机。优先级及紧急度顺序直接使用现有 `sortKey`，包括日期分组及 `agenda.tie_break` 设置。

## 用户脚本文件

用户新增 JavaScript 文件即可定义自己的推荐逻辑。TUI、CLI 和安卓使用共享的 QuickJS 解释器与接口，运行时包含在发行包中，可以离线运行。

```javascript
function recommend(tasks, context) {
  return tasks
    .filter(task => task.tags.includes("阅读"))
    .sort((a, b) => b.urgency - a.urgency)
    .map(task => task.id);
}
```

桌面操作：

```powershell
atd script template urgency recommendations/reading.js
atd script use recommendations/reading.js
atd script use recommendations/reading.js --list
```

路径相对于 `ATD_HOME`，也可以使用绝对路径。第一条命令创建可编辑的模板文件，已有文件会得到明确提示。用户编辑该文件，运行 `atd gtd` 或在 TUI 按 `r` 即可重新读取。

TUI 也支持 `:script recommendations/reading.js`、`:script-list on` 与 `:script-list off`。通过 `:recommend current`、`:recommend levels`、`:recommend urgency`、`:recommend random` 选择默认模板。

安卓在 GTD 设置中填写脚本文件名称，选择“导入推荐脚本文件”，通过系统文件选择器选择同一份 `.js` 文件。导入时运行校验，保存配置后生效。修改手机外部文件后需要再次导入；导入副本保存在配置中，包含在完整备份中。设置页面也可以导出默认模板文件。

| 参数 | 内容 |
| --- | --- |
| `tasks` | 当前候选的任务对象数组，附加现有紧急度分数 `urgency`；普通列表模式包含该列表的任务 |
| `context.version` | 接口版本，当前为 `1` |
| `context.view` | `focus` 或 `list` |
| `context.now` | 本地日期与时间 |
| `context.mode` | 当前列表排序：`levels` 或 `urgency` |
| `context.limit` | 当前显示数量；普通列表模式为候选总数 |
| `context.previous` | 之前显示的卡片编号 |
| `context.orders.levels` | 复用现有优先级排序得到的候选编号 |
| `context.orders.urgency` | 复用现有紧急度排序得到的候选编号 |
| `context.all` | 包含归档记录的任务目录，用于读取项目及依赖上下文 |

`recommend` 同步返回任务编号数组，可以筛选候选并改变顺序。返回空数组会显示空内容。GTD 最终结果受显示数量限制；普通清单在原有日期分组内使用脚本顺序。脚本不能返回重复编号、未知编号或候选以外的编号。异步函数、错误的返回类型、脚本异常和执行中断会显示明确错误。

脚本操作的是任务快照，写入任务仍由应用服务处理。解释器提供 JavaScript 标准库，内存上限为 32 MiB，单次执行时间上限为一秒。每次运行使用新的上下文，随后释放解释器中的对象。

## 配置

```toml
[focus]
count = 2
template = "custom"
script = "recommendations/reading.js"
list = true
```

`count` 范围为 1–20。`template` 可以是 `current`、`levels`、`urgency`、`random` 或 `custom`。安卓导入的脚本通过 `focus.files` 保存名称和内容。桌面的外部脚本文件可以单独复制到其他设备。

## 共享实现

| 位置 | 职责 |
| --- | --- |
| `src/app/service.ts` | 创建项目、完成步骤、完成项目、统一保存与撤销 |
| `src/core/projects.ts` | 判断当前可执行事项，生成项目与当前步骤的列表 |
| `src/core/dependencies.ts` | 共享依赖判断与循环校验，兼容已有依赖字段 |
| `src/core/recommendation.ts` | 默认模板、解释器、接口输入与结果校验 |
| `src/app/recommendation.ts` | 读取配置选择的模板或脚本文件 |
| `src/app/task-view.ts` | 普通列表复用脚本排序与项目展示 |
| `src/tui/app.tsx` | 终端显示与交互 |
| `apps/android/web/app.ts` | 安卓显示、动画与文件导入交互 |
| `apps/android/tools/build-web.mjs` | 引入共享源码，替换文件、配置和平台系统接口 |

两端使用相同的数据契约、依赖逻辑、项目服务及脚本执行逻辑。桌面通过 JSONL 存储，安卓通过原生 SQLite 事务保存；平台适配器处理各自的文件与系统接口。

## 验证与截图

`tests/projects-focus.test.ts` 使用真实存储和真实解释器，检查五章项目、推进、自动完成、项目完成、撤销、脚本文件读取、执行错误和候选校验。

`node tools/test-projects-focus-tui.mjs` 启动真实 Windows PTY，通过 xterm 显示终端输出并保存截图；检查项目推进、GTD 补充事项、独立脚本修改与重新加载、普通清单复用脚本。

`node tests/projects-focus-device.mjs` 在安卓模拟器中操作实际 APK，检查项目创建、完成动画、GTD、数量设置、随机结果稳定、系统文件选择器导入脚本、完成项目和撤销。

| 效果 | TUI | 安卓 |
| --- | --- | --- |
| 项目与当前章节 | [截图](images/projects-gtd/tui-project.png) | [截图](images/projects-gtd/android-project.png) |
| 章节完成与替换 | [动画过程](images/projects-gtd/tui-project-animation.png)、[下一章节](images/projects-gtd/tui-project-next.png) | [动画过程](images/projects-gtd/android-project-animation.png)、[下一章节](images/projects-gtd/android-project-next.png) |
| GTD 信息流 | [截图](images/projects-gtd/tui-gtd.png) | [截图](images/projects-gtd/android-gtd.png) |
| 用户脚本 | [推荐结果](images/projects-gtd/tui-script.png)、[普通清单](images/projects-gtd/tui-script-list.png) | [脚本设置](images/projects-gtd/android-script-settings.png)、[推荐结果](images/projects-gtd/android-script-result.png) |
