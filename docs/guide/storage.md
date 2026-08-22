# 数据管理

atd 的数据是纯文本 JSONL 文件，可读、可手改、可版本化。数据目录在 `~/.atd/`（用 `atd config path` 确认）。

## 数据目录

| 文件 | 作用 |
|---|---|
| `tasks.jsonl` | 所有任务，一行一个 JSON，唯一事实源 |
| `undo.jsonl` | 撤销日志（不进 git） |
| `archive.jsonl` | 归档的旧任务（不进 git） |
| `config.toml` | 全部配置 |
| `hooks/` | 自定义提醒 hook 目录 |

## 撤销（undo）

每次增/删/改都记日志，`atd undo` 回滚**最近一次**操作，可连续撤销：

```bash
atd add "买牛奶"
atd undo        # 撤销新增：买牛奶 消失
atd done 3fbd
atd undo        # 撤销完成：变回 todo
atd rm 3fbd
atd undo        # 撤销删除：任务回来
```

TUI 里按 `u` 或 `:undo`。注意：undo 撤的是**写入操作**，提醒触发标记（fired）的变更不在撤销范围内。

## 删除与归档

删除是**软删除**：文件里留一行 `{"id":..., "deleted":true}` 的 tombstone，一是给 undo 留恢复依据，二是让多端同步能区分"删除"和"还没同步到"。

归档把终态（done/cancelled/删除）超过 N 天的行挪去 `archive.jsonl`，主文件保持轻快：

```bash
atd archive        # 默认 14 天
atd archive 7      # 7 天
```

查看和恢复归档：

```bash
atd archive-list
atd restore <id>
```

<pre class="terminal-output">$ atd archive 0
归档了 1 行

$ atd archive-list
f8aae6b7 写学习总结

$ atd restore f8aae6b7
已恢复 写学习总结</pre>

> 恢复后任务保持 `done` 状态，默认清单不显示，要用 `list status:done` 查看。

## 直接编辑数据文件

`tasks.jsonl` 是纯文本，极端情况下（批量导入、修复）可以手工编辑，一行一个 JSON，字段含义：

```json
{"id": "3fbd8742", "title": "买牛奶", "status": "todo",
 "due": "2026-08-20T00:00:00", "priority": "Sol",
 "tags": ["采购"], "project": "学习",
 "notes": "低脂的那种",
 "recur": {"kind": "weekly", "interval": 1, "weekday": 3},
 "reminders": [{"at": "2026-08-20T18:30", "hooks": ["toast"], "fired": false}],
 "entry": "...", "modified": "..."}
```

`notes` 是纯文本备注，`recur` 是重复规则，形如 `{ kind, interval, weekday? }`，`kind` 是 daily / weekly / monthly / yearly / weekdays 之一，`weekday` 只在按周重复时出现。数据格式向后兼容，老版本写下的文件照样能读。

手工改时建议顺手把 `modified` 更新为当前 UTC ISO 时间（同步合并按它裁决）。编辑期间确保 `atd watch` / TUI 没在写（有文件锁，一般也安全）。

## 数据在哪、怎么备份

```bash
atd config path                    # 打印数据目录
cd ~/.atd && git bundle create ../atd-backup.bundle --all   # git 冷备份
```

配了远端的话，`atd sync` 本身就是异地备份。

## 下一步

- [实测证据](/guide/verification)
- [API 参考](/api/README)
- [开发与构建](/guide/development)
