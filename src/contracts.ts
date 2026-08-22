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
  priority: z.string().min(1).optional(),
  tags: z.array(z.string().min(1)).default([]),
  project: z.string().min(1).optional(),
  parent: z.string().min(1).optional(),
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
  }),
  watch: z.object({
    interval_seconds: z.number().int().positive(),
  }),
  ui: z.object({
    // auto 跟随环境变量（认不出来按中文）；只影响界面文案，不影响输入与查询语法
    lang: z.enum(["auto", "zh", "en"]).default("auto"),
  }).default({ lang: "auto" }),
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
