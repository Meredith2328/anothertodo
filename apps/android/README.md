# AnotherTODO Android

Android 版本使用 APK 内置的 HTML、CSS 和 TypeScript 界面，通过 Android WebView 显示。任务操作复用 `src/app/service.ts`，输入解析、重复规则、查询、议程、排序、统计和导出复用 `src/core`。APK 可以离线使用，支持 Android 8.0 及以上版本；系统 WebView 需要支持 Chromium 108 及以上版本的网页功能。

## 手机操作

- 点击右下角加号逐行填写任务，每一行对应一个任务。检查页确认日期、标题和依赖候选后统一添加，支持同一批任务的前向引用。
- 点击任务编辑标题、截止时间、优先级和多行备注，修改后自动保存。项目、标签、执行顺序、等待、重复和提醒按需展开；关闭前会完成保存。
- 点击左侧方框完成任务。父任务有未完成子任务时，可以选择连同子任务完成。
- 右上角选择按钮提供批量完成、等待、取消、重新打开、推迟提醒和删除；撤销按钮撤销整次操作。
- 任务页按逾期、今天、接下来、稍后、等待、无日期与依赖阻塞分组。日程页提供日历、周历、月历、重要度和四象限视图。
- 四象限以最高优先级表示重要，以今天到期或逾期表示紧急。选中日期会用于日程页新增任务的缺省日期。
- 统计页的完成方块可以独立开启或关闭，记录真实每日完成量，支持三个月与全年范围，包含归档中的完成记录。
- 更多页面提供全部任务、归档、统计、同步、导入、导出、设置和帮助。

任务状态、重复任务生成、提醒投递状态和删除记录均保留原有数据语义。新增任务的父任务编号会解析为完整编号，父子关联形成循环时会拒绝保存。

依赖输入支持 `整理资料之后写报告`、`检查附件 before:提交材料`、`write report after "collect data"`。候选显示名称、编号和状态；保存循环关系或完成依赖未结束的任务会明确报错。一次编辑产生的连续自动保存可以整次撤销。

每一屏的信息层级、默认内容、按需入口、操作路径与尺寸适应见 [页面设计](DESIGN.md)。

## 存储与备份

Android 私有目录中的 SQLite 保存任务、归档、配置和最近 100 次撤销记录。一次手机操作通过数据库事务保存，使用版本检查防止界面操作覆盖后台提醒的更新。撤销记录只保存变化的任务。

导入支持桌面 JSONL、JSON 数组和 Android 完整备份；JSONL 和 TOML 使用成熟的 JSON 与 TOML 库读取，格式错误会阻止写入。导出提供 JSONL、JSON、CSV、Markdown 和完整备份。Android 系统文件选择器处理文件读写，系统分享界面处理分享。

完整备份包含任务、归档和 `config.toml`，其中包括用户填写的邮件配置。Git 访问令牌与 webhook 设置保存在 Android KeyStore 加密的存储中，不进入任务导出文件。卸载应用会删除私有数据，卸载前请导出完整备份。

## 后台提醒

在设置中开启系统通知和精确提醒权限。存在待发提醒且权限尚未开启时，任务页面会显示权限入口。应用使用 `AlarmManager` 调度最近一次提醒，关闭界面后仍能投递；系统重启、应用更新和时区变化后重新调度。

通知可以打开对应任务，并提供推迟十分钟操作。错过的提醒会补发。投递失败后按原项目的提醒规则重试，三次失败后标记为失败；投递状态可在任务详情中查看。

`toast` 对应 Android 系统通知，`email` 使用 TOML 中的 SMTP 配置。默认端口 465 和 `ssl=true` 使用 TLS；`ssl=false` 会根据服务器能力协商 STARTTLS。手机端自定义通知方式通过 HTTPS webhook 发送任务 JSON，可在设置中填写名称和地址，例如：

```json
{"企业通知":"https://example.com/task-webhook"}
```

对应提醒输入为 `@18:30:企业通知`。桌面终端与本地脚本操作通过手机触摸界面和 webhook 完成。Android 设置中的“强行停止”会禁止系统投递，重新打开应用后会恢复调度。

## Git 同步

在更多 → 同步中填写 HTTPS 私有仓库地址、分支、Git 用户名、访问令牌、提交姓名和提交邮箱。同步使用 isomorphic-git 和原项目的合并规则：任务取并集，同一任务选择较新的修改，删除记录优先。

原生 HTTP 连接处理认证与 TLS，Git 文件保存在应用私有目录中；无需手机安装 Git、Node.js 或终端。同步的文件仍为 `tasks.jsonl`、`archive.jsonl` 和 `config.toml`，可以与桌面 `atd sync` 使用同一个私有仓库。手机端支持 HTTPS 与访问令牌认证，SSH 仓库需要提供同一仓库的 HTTPS 地址。配置文件同时被两端修改时会明确报告冲突，处理后可以重新同步。

## 构建

本机需要 Node.js 22+、PowerShell 7、JDK 17、Android SDK Platform 35 和 Build Tools 36.1.0。构建使用 SDK 自带的 `aapt2`、`javac`、`D8`、`zipalign` 和 `apksigner`。

在仓库根目录执行：

```powershell
npm ci
npm run build -w @anothertodo/android
```

输出为 `apps/android/build/AnotherTODO.apk`。构建会从 Maven Central 下载 JavaMail Android 与 Activation 依赖，并将邮件运行时资源一并加入 APK。签名证书和密码保存在已忽略的 `apps/android/.local/`；后续更新需要保留该目录。

## 设备验收

测试直接操作安装后的 Android WebView、原生数据库、文件选择器与系统提醒。同步测试使用真实的 `git-upload-pack`、`git-receive-pack` 和电脑端 Git 仓库；邮件测试使用本机 SMTP 服务器。

在 `apps/android` 目录执行：

```powershell
pwsh -NoProfile -File tools/build-apk.ps1 -DebugBuild
adb install -r build/AnotherTODO-debug.apk
node tests/device.mjs
node tests/sync-device.mjs
node tests/files-device.mjs
node tests/reminder-device.mjs
node tests/mail-device.mjs
node tests/extended-device.mjs
node tests/clone-device.mjs
```

设备测试会清空测试安装的应用数据，需要在专用模拟器中运行。验收报告和截图位于已忽略的 `test-results/`。正式 APK 关闭 WebView 调试与明文 HTTP。

## 参考资料

- [Android WebView](https://developer.android.com/develop/ui/views/layout/webapps/webview)
- [Android WebView 输入法与窗口边界](https://developer.android.com/develop/ui/views/layout/webapps/understand-window-insets)
- [Android 系统提醒](https://developer.android.com/develop/background-work/services/alarms)
- [isomorphic-git 文件与 HTTP 接口](https://isomorphic-git.org/docs/en/http)
- [isomorphic-git 合并接口](https://isomorphic-git.org/docs/en/merge)
