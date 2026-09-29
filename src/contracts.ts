import { z } from "zod";

const DateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");

// Python stores due/reminder timestamps without a timezone on purpose. Keep that
// local-date-time contract separate from UTC metadata timestamps.
const LocalDateTimeSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?$/,
    "expected a timezone-free ISO local datetime",
  );

const CompatibleDateTimeSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?$/,
    "expected a compatible ISO datetime",
  );

const UtcDateTimeSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]00:00)$/,
    "expected an ISO UTC datetime",
  );

// Existing Python data may contain hand-created ids. New ids still use the
// eight-hex format, but reads must not discard older non-empty ids.
const IdSchema = z.string().min(1, "expected a non-empty task id");

export const ReminderSchema = z.object({
  id: z.string().min(1).optional(),
  at: z.string().min(1),
  hooks: z.array(z.string().min(1)).default(["toast"]),
  fired: z.boolean().default(false),
  attempts: z.number().int().nonnegative().optional(),
  dead: z.boolean().default(false),
  leaseOwner: z.string().min(1).optional(),
  leaseUntil: z.string().min(1).optional(),
});

export const RecurSchema = z.object({
  kind: z.enum(["daily", "weekly", "monthly", "yearly", "weekdays"]),
  // 每 N 天 / N 周 / N 月 / N 年；weekdays 忽略它
  interval: z.number().int().positive().default(1),
  // 0=周一 … 6=周日；只有 weekly 用，缺省时沿用当次截止日的星期
  weekday: z.number().int().min(0).max(6).optional(),
});

export const TaskSchema = z.object({
  id: IdSchema,
  title: z.string().default(""),
  // Python allowed custom status names; known statuses remain handled by the
  // agenda/watcher while unknown ones remain readable and round-trippable.
  status: z.string().min(1).default("todo"),
  due: CompatibleDateTimeSchema.optional(),
  // 时间段的结束时刻：`14:00-15:00` 里的 15:00。只有 due 带时间时才有意义；
  // 可选而不是默认值，老数据写回时不多出字段
  until: CompatibleDateTimeSchema.optional(),
  priority: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).default([]),
  project: z.string().min(1).optional(),
  parent: z.string().min(1).optional(),
  // 前置任务 id：这些任务都完成（done/cancelled）之前，本任务算「被阻塞」。
  // 可选而不是默认空数组，免得每条老任务写回时都多出一个 "deps":[]
  deps: z.array(IdSchema).optional(),
  wait: z.string().min(1).optional(),
  notes: z.string().default(""),
  recur: RecurSchema.optional(),
  reminders: z.array(ReminderSchema).default([]),
  // Empty/non-UTC metadata exists in older Python files. New writes normalize
  // metadata to UTC, but reads must preserve old records instead of dropping them.
  entry: z.string().default(""),
  modified: z.string().default(""),
  end: z.string().optional(),
});

export const TombstoneSchema = z.object({
  id: IdSchema,
  deleted: z.literal(true),
  modified: UtcDateTimeSchema,
});

const UrgencyConfigSchema = z.object({
  overdue: z.number(),
  due_today: z.number(),
  due_week_decay: z.number(),
  per_level: z.number(),
  age_per_day: z.number(),
  age_cap: z.number(),
  waiting_penalty: z.number(),
});

export const ConfigSchema = z.object({
  priority: z.object({
    mode: z.enum(["levels", "urgency"]),
    levels: z.array(z.string().min(1)).min(1),
    urgency: UrgencyConfigSchema,
  }),
  agenda: z.object({
    week_days: z.number().int().positive(),
    date_format: z.enum(["auto", "md", "full"]),
    // 日期、优先级都相同时怎么排：entry 先加的在前 / entry_desc 后加的在前 / title 按标题（中文按拼音）
    tie_break: z.enum(["entry", "entry_desc", "title"]).default("entry"),
  }),
  watch: z.object({
    interval_seconds: z.number().int().positive(),
  }),
  ui: z.object({
    // auto 跟随环境变量（认不出来按中文）；只影响界面文案，不影响输入与查询语法
    lang: z.enum(["auto", "zh", "en"]).default("auto"),
    // 皮肤名：内置的 classic / raised / dracula …，或 ~/.atd/skins/ 下的自定义皮肤
    skin: z.string().min(1).default("classic"),
    // 鼠标点击：关掉后终端原生的选中复制就能用了
    mouse: z.boolean().default(true),
    // 完成任务时的划线动画
    animations: z.boolean().default(true),
    // cards：按分组分块、靠留白分隔的卡片式清单；table：带边框和表头的表格
    layout: z.enum(["cards", "table"]).default("cards"),
    // comfortable 分组之间空一行、输入框带完整边框；compact 挤在一起，给小终端
    density: z.enum(["comfortable", "compact"]).default("comfortable"),
    // 顶部横幅：line 一行标题；small 两行小字；full 六行像素字
    banner: z.enum(["line", "small", "full"]).default("line"),
  }).default({ lang: "auto", skin: "classic", mouse: true, animations: true, layout: "cards", density: "comfortable", banner: "line" }),
  deps: z.object({
    // 被前置任务挡住的后续任务：dim 在主屏淡字显示，hide 不上主屏（依赖图页仍可见）
    blocked: z.enum(["dim", "hide"]).default("dim"),
  }).default({ blocked: "dim" }),
  email: z.object({
    host: z.string(),
    port: z.number().int().positive(),
    ssl: z.boolean(),
    user: z.string(),
    password: z.string(),
    from: z.string(),
    to: z.string(),
  }),
});

export type Reminder = z.infer<typeof ReminderSchema>;
export type Recur = z.infer<typeof RecurSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type Tombstone = z.infer<typeof TombstoneSchema>;
export type Config = z.infer<typeof ConfigSchema>;
