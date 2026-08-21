# 提醒系统

提醒靠一个后台守护进程触发。任务的 `@` 提醒在到点后通过 hook 推送（Windows toast、邮件、自定义脚本）。

## 守护进程

```bash
atd watch                # 前台运行，每 30 秒扫一次，Ctrl+C 退出
atd watch --install      # 注册开机自启（Windows 计划任务 / macOS launchd / Linux systemd）
atd watch --uninstall    # 取消自启
atd watch --once         # 只扫一轮（调试 / 手动触发）
```

行为规则：

- 每 30 秒扫描 `tasks.jsonl`，发现 `at <= 现在` 且未触发的提醒就逐个调 hook。
- **错过的提醒会补发**：比如电脑 8:00 关机、10:00 开机，watcher 启动时发现 8:00 的提醒没发，会立即补发，消息前缀 `[错过]`。超过 5 分钟未触发即算"错过"。
- hook 全部失败时不会标记 fired，而是记录 attempts 并退避重试；达到 3 次后进入 dead-letter，避免无限重试。
- `atd done` 之后任务的未触发提醒自然不会再弹（任务已不在待办）。

<pre class="terminal-output">$ atd watch --once
提醒处理：0，发送：0，重试：0，dead-letter：0</pre>

## 设置提醒

提醒用 `@` 开头设置（详见 [一行输入魔法](/guide/input)）：

```bash
atd add "后天 买牛奶 很急 @18:30"        # 后天 18:30 toast
atd add "周五 复盘 @8:00:toast,email"    # 周五 8:00 toast + 邮件
atd add "想起来订水 @2h"                 # 两小时后提醒
atd add "下周三 例会 @周一 @9:00"        # 周一 9 点预提醒 + 当天缺省提醒
```

规则细节：

- 行里有日期时，纯时间提醒锚定到**任务日期**那天，不是输入时的今天。
- 行里没有日期、且时间已过（现在 14:00 写 `@9:00`）→ 顺延到明天 9:00。
- 一个任务可以有**多个**提醒，写多个 `@` 即可。

### 默认提醒

任务设了未来截止日期但没写 `@` 时，自动补一个 toast 提醒——距截止超过 24 小时提前 1 天，否则提前 15 分钟。用 `@none` / `@off` / `no reminders` 关闭。

## 内置 hook

### toast（默认）

Windows 通知中心弹横幅，标题 "atd 提醒"，正文含任务名、日期。Linux 用 `notify-send`，macOS 用 `osascript`。三端零依赖降级。

### email

给 `config.toml` 的 `[email].to` 发邮件。配置示例（QQ 邮箱）：

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

配好后测试：

```bash
atd add "邮件通道测试 @1m:email"
```

## 自定义 hook（扩展点）

`~/.atd/hooks/` 下放一个脚本，文件名（去扩展名）就是 hook 名。脚本从 **stdin 收一个 JSON**，退出码 0 表示成功：

```json
{
  "task": { "id": "3fbd8742", "title": "买牛奶", "due": "...", "priority": "高" },
  "message": "⏰ 买牛奶（2026-08-23 18:30）"
}
```

一个最小的 Telegram hook（`~/.atd/hooks/tg.py`）：

```python
import sys, json, urllib.request, urllib.parse

data = json.loads(sys.stdin.read())
token, chat_id = "你的bot_token", "你的chat_id"
text = urllib.parse.quote(f"⏰ {data['message']}")
urllib.request.urlopen(
    f"https://api.telegram.org/bot{token}/sendMessage?chat_id={chat_id}&text={text}")
```

之后就能用：

```bash
atd add "明早 签到 @8:55:tg"       # 只用 tg
atd add "复盘 @8:00:toast,tg"      # toast + tg 同时
atd hooks                          # 查看可用 hook 名单
```

## 推迟提醒（snooze）

提醒弹了但暂时顾不上：

```bash
atd snooze 3fbd 10     # id前缀 + 分钟数
atd snooze 3fbd 2h     # 推迟 2 小时
```

推迟的是该任务**最后一个未触发**的提醒。

## 下一步

- [优先级双模式](/guide/priority)
- [多端同步](/guide/sync)
- [配置详解](/guide/config)
