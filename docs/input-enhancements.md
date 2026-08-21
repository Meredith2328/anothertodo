# atd 输入解析功能改造清单（英文支持）

> **状态**：第 1、2、3、5 点已完成并合入主线（`src/core/parse.ts` + `tests/parse.test.ts`）。
> 第 4 点（`~wait` 与英文日期词的边界语义）未改动——`~` 仍专用于 wait，`tomorrow` 单独出现是截止日期，
> 两者互不冲突，维持现状即可。

> 背景：英文版 README（`README.en.md`）已写好，但实测发现 atd 的输入解析对英文支持不完整，
> 导致英文版 README 只能展示"部分支持"的用法，无法像中文版那样自然。本清单列出需要改造的功能点，
> 每条都标注了**现状、问题、建议方案、验证方式**。开发完成后，README.en.md 里相关的示例即可解锁为更自然的写法。

**依据**：本清单基于对 `src/core/parse.ts` 的源码阅读 + 真实 `atd preview` 实测。

---

## 1. 紧急度短语支持英文 ✅

### 现状
`URGENCY_PHRASES`（`parse.ts:22`）只定义了中文短语：

```ts
const URGENCY_PHRASES: Record<string, string[]> = {
  high: ["非常急", "特别急", "特急", "很急", "比较着急", "有点着急", "着急", "紧急", "加急", "急"],
  mid:  ["一般般", "一般", "普通", "中等", "还行", "常规"],
  low:  ["有空再说", "慢慢来", "不着急", "不用急", "不急"],
};
```

### 实测问题
`atd preview "tomorrow buy milk urgent"` → 标题：`buy milk urgent`（`urgent` 进了标题，没被识别为紧急度）。

### 建议方案
在 `high/mid/low` 三组里补充英文短语，例如：

```ts
high: [...中文..., "urgent", "very urgent", "asap", "high priority", "critical"],
mid:  [...中文..., "normal", "medium", "regular"],
low:  [...中文..., "no rush", "not urgent", "low priority", "someday"],
```

需要**注意词边界**：现有匹配用的是 `(?<![\u4e00-\u9fff])(短语)(?![\u4e00-\u9fff])`（中文词边界保护）。英文短语要加英文词边界（`\b`），否则 `urgent` 会误匹配 `urgently`、`not urgent` 里的 `urgent`。建议英文短语用独立正则或统一改成 `\b` 边界。

### 验证方式
```bash
atd preview "tomorrow buy milk urgent"      # 期望：[高]
atd preview "next friday report very urgent" # 期望：[高]
atd preview "clean desk no rush"             # 期望：[低]
atd preview "urgent vs urgency"              # 期望：标题含 urgent，不误判紧急度
```

---

## 2. 12 小时制时间支持 ✅

### 现状
`TIME_RE`（`parse.ts:67`）只匹配 24 小时制（`14:30`）和中文时段（`下午2点半`）：

```ts
const TIME_RE = /(?<pre>凌晨|清晨|早上|上午|中午|下午|傍晚|晚上|夜里)(?<h1>\d{1,2})(?:[:：](?<m1>\d{1,2})|点(?<q1>半|一刻|三刻)?)?|(?<h2>\d{1,2})[:：](?<m2>\d{2})|(?<h3>\d{1,2})点(?<q3>半|一刻|三刻)?/gu;
```

### 实测问题
`atd preview "day after tomorrow 2:30pm review"` → 标题：`pm review`（`2:30pm` 没被识别，`pm` 残留标题）。

### 建议方案
在 `TIME_RE` 增加 12 小时制分支，支持 `2:30pm`、`2:30 pm`、`9am`、`12pm`、`12am` 等。解析时：

- `am`（或 `a.m.`）：0-11 点按字面，`12am` → 00:00。
- `pm`（或 `p.m.`）：0-11 点 +12，`12pm` → 12:00。

注意：`12:00` 这种裸的 24 小时制要优先匹配，避免 `12` 被误当 12 小时制。

### 验证方式
```bash
atd preview "tomorrow 2:30pm meeting"   # 期望：14:30
atd preview "tonight 9am gym"           # 期望：09:00
atd preview "next friday 12pm lunch"    # 期望：12:00
atd preview "8.20 12am report"          # 期望：00:00
```

---

## 3. `~wait` 支持多词英文日期 ✅

### 现状
wait 分支（`parse.ts:217`）用 `/[^\s~]+/` 抓单个非空白 token，再交给 `scanDate` 解析：

```ts
const wait = source.match(/~([^\s~]+)/u);
if (wait) { const found = scanDate(wait[1]!, today); if (found && found.start === 0 && found.end === wait[1]!.length) { ... } }
```

### 实测问题
`atd add "await reply ~next monday"` → 标题：`await reply ~`（`~` 只抓到 `next`，`next monday` 是两词被空格断开，wait 解析失败）。

### 建议方案
`~` 后面允许抓**多词**日期短语，例如把正则改成匹配到日期短语结束：

```ts
// 先尝试匹配完整英文/中文日期短语，再回退到单 token
const wait = source.match(/~((?:day\s+after\s+tomorrow|next\s+\w+|this\s+weekend|[^\s~]+))/iu);
```

更稳妥的做法：用 `scanDate` 在 `~` 之后的子串上做**最长前缀匹配**——从 `~` 后面尝试 `scanDate(子串)`，找到一个完整、可被识别的日期短语为止。

### 验证方式
```bash
atd preview "await reply ~next monday"        # 期望：wait 到下一周一，标题：await reply
atd preview "await reply ~this weekend"       # 期望：wait 到本周末
atd preview "await reply ~day after tomorrow" # 期望：wait 到后天
```

---

## 4.（可选）`~wait` 与英文日期词的边界

### 现状
英文日期词（`tomorrow`/`next monday` 等）在 `DATE_RE` 里用 `\b` 词边界匹配（`parse.ts:66`）。但 `~` 后面的日期，是**作为 wait 日期**解析（`~tomorrow`），还是**作为任务截止日期**解析（`tomorrow` 本身）？当前 `~` 只用于 wait，`tomorrow` 单独出现是截止日期。这个语义要清晰。

### 建议
确认 `~next monday`（wait）和 `next monday`（截止）不冲突。如果 `~` 后面直接跟日期词，应优先作为 wait 日期，从 `source` 里摘除，避免同时被当作截止日期。

---

## 5. 英文 README 示例依赖以上能力 ✅

以上 1-3 改造完成后，`README.en.md` 里以下示例可解锁为**更自然**的英文写法（当前为保守写法）：

| 当前（保守） | 解锁后可改为 |
|---|---|
| `tomorrow 14:30 buy milk 高 @18:30` | `tomorrow 2:30pm buy milk urgent @18:30` |
| `tomorrow 14:30 report 高 @18:30` | `tomorrow report very urgent` |
| `8.20 review` | 无需改 |
| `await reply ~next monday`（当前不工作） | `await reply ~next monday`（第 3 点修复后可用） |

> **注意**：上述 1-3 开发完成后，README.en.md 已更新为更自然的英文写法（`urgent`/`2:30pm`/`~next monday` 均已解锁）。

---

## 改造顺序建议（已完成）

1. **第 1 点（紧急度英文）**：最影响 README 观感，且改法清晰（加短语 + 词边界）。优先。✅
2. **第 2 点（12 小时制）**：改 `TIME_RE`，注意与 24 小时制优先级。次优先。✅
3. **第 3 点（wait 多词日期）**：改 wait 正则 + scanDate 最长前缀匹配。稍复杂，建议先写测试。✅

三项均已落地并附测试用例。

---

## 测试建议

每个功能点改动后，补充 `tests/parse.test.ts` 的用例（或 `fixtures/parse-cases.json`），确保：

- 正常解析（英文短语 → 对应档位）
- 词边界（`urgently` 不误判为 `urgent`）
- 12 小时制与 24 小时制不冲突
- wait 多词日期完整摘除

改动后用 `atd preview` 逐一验证上述"验证方式"里的命令。
