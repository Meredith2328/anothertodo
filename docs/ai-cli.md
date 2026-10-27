# CLI 结构化操作

现有人类输出保持兼容。机器调用可在 add/edit/done/cancel/meeting/todo/doing/pause/wait/rm/reopen 后加 `--json`：

```sh
atd add '阅读资料 in:在做' --json --request-id reading-creation-1
atd show <完整ID> --json
atd edit <完整ID> '>> 已核对的新备注' --json --if-modified <先前读取的modified>
atd list --json --view hour
atd list --json --view hour --include-unscheduled
```

写操作返回一个 JSON 对象：`schemaVersion: 1`、`command`、`ok` 和 `items`。每项含原始 `input`、`ok`；成功为 `data`，失败为 `error: {code, message}`。add/edit/status 的 data 是完整任务；done 的 data 含 task、next（有重复时）、cascaded、openChildren、unblocked；rm 为完整 id 与 deleted。批量有失败时退出码为 1，仍返回全部逐项结果。参数或命令级失败返回顶层 error 和空 items。判定依据是 code 和退出码，message 用于给人解释；其他底层失败归为 OPERATION_FAILED。进程异常退出或输出不完整时仍应读回确认，不推断全部回滚。

list JSON 复用 TUI 的焦点选择器及父子排列，含 view、window（时区与实际边界）、counts（未安排与范围外计数）、groups。JSON 缺省沿用 agenda.view；人类 list 缺省仍显示完整清单。完成/取消查询请显式 `--view all`，或继续使用 `export -f json` 的原始任务读取。show/export 的既有 JSON 格式不变。

## 新增请求去重

`--request-id` 只接受单条新增，长度 1–128 字符。在同一 ATD_HOME 中，相同键与完全相同的输入字符串返回同一任务的当前版本，包括并发重试；不同字符串返回 REQUEST_CONFLICT。不把相对日期重新解析成另一项任务。每条新意图使用新键，不能把不同请求共用一个键。

去重收据放在数据目录 requests.json，任务格式不改变。收据与任务使用现有数据锁和原子写。新增中断后，只有任务库未被其他 writer 改动才安全恢复；否则返回 REQUEST_INCOMPLETE，先查结果，不自动换新键重试。撤销、删除或归档后，同一个键返回 REQUEST_RESULT_UNAVAILABLE，不会把原任务复活。收据保留用于长期防重复，不随着 undo 一起删除。

## 读取版本条件

`--if-modified` 用于 edit、各状态操作、done、wait、rm、reopen。传入先前 show/export/list 得到的 modified 原字符串；版本不同返回 VERSION_CONFLICT，重新读取并判断是否仍应执行。条件可用于人类或 JSON 输出，省略时保留旧行为。批量传入一个条件会逐项比较同一个版本字符串；针对不同版本的任务建议逐 ID 调用。

单条写入沿用 Store 在锁内的旧版本校验，modified 即使同一毫秒更新也会前进。done 带子任务与派生下一次仍沿用原有批量/撤销语义，并非整个批次的数据库事务；遇到部分失败应逐项读回，尤其不要盲目重试重复任务 done。
