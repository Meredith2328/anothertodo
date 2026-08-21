import { afterEach, describe, expect, it } from "vitest";

import { ConfigSchema, TaskSchema } from "../src/contracts.js";
import { formatDate, groups } from "../src/core/agenda.js";
import { detectLang, getLang, setLang, t, weekdayName } from "../src/core/i18n.js";
import { describeRecur } from "../src/core/parse.js";

const config = ConfigSchema.parse({
  priority: { mode: "levels", levels: ["低", "中", "高"], urgency: { overdue: 12, due_today: 8, due_week_decay: 8, per_level: 3, age_per_day: 0.05, age_cap: 2, waiting_penalty: 3 } },
  agenda: { week_days: 7, date_format: "auto" },
  watch: { interval_seconds: 30 },
  email: { host: "", port: 465, ssl: true, user: "", password: "", from: "", to: "" },
});
const task = (value: Record<string, unknown>) => TaskSchema.parse({ entry: "2026-08-18T10:00:00Z", modified: "2026-08-18T10:00:00Z", ...value });

describe("interface language", () => {
  afterEach(() => setLang("zh"));

  it("falls back to Chinese when the environment says nothing useful", () => {
    expect(detectLang({})).toBe("zh");
    expect(detectLang({ LANG: "C" })).toBe("zh");
    expect(detectLang({ LANG: "zh_CN.UTF-8" })).toBe("zh");
    // 认不出来时宁可留中文，也不要把现有中文用户翻成英文
    expect(detectLang({ LANG: "de_DE.UTF-8" })).toBe("zh");
  });

  it("picks English from the usual environment variables", () => {
    expect(detectLang({ LANG: "en_US.UTF-8" })).toBe("en");
    expect(detectLang({ LC_ALL: "en_GB" })).toBe("en");
    // ATD_LANG 优先，方便临时切一次
    expect(detectLang({ LANG: "zh_CN.UTF-8", ATD_LANG: "en" })).toBe("en");
  });

  it("switches the whole catalog with setLang", () => {
    setLang("en");
    expect(getLang()).toBe("en");
    expect(t("group.overdue")).toBe("Overdue");
    expect(t("group.hidden", { count: 3 })).toBe("3 hidden (waiting)");
    setLang("zh");
    expect(t("group.overdue")).toBe("逾期");
    expect(t("group.hidden", { count: 3 })).toBe("隐藏(等待未到) 3 项");
  });

  it("returns the key itself for a missing entry instead of an empty string", () => {
    expect(t("nope.missing")).toBe("nope.missing");
  });

  it("translates agenda group names and the date column", () => {
    const all = [task({ id: "00000001", title: "逾期", status: "todo", due: "2026-08-17T09:00:00" }), task({ id: "00000002", title: "今天", status: "todo", due: "2026-08-18T09:00:00" })];
    expect(groups(all, config, "levels", "2026-08-18T14:00").map((group) => group.name)).toEqual(["逾期", "今天"]);
    expect(formatDate(all[0]!, "2026-08-18", "auto")).toBe("昨天");
    setLang("en");
    const english = groups(all, config, "levels", "2026-08-18T14:00");
    expect(english.map((group) => group.name)).toEqual(["Overdue", "Today"]);
    // key 不跟着语言变，上色和判断都靠它
    expect(english.map((group) => group.key)).toEqual(["overdue", "today"]);
    expect(formatDate(all[0]!, "2026-08-18", "auto")).toBe("yesterday");
    // md / full 是数字格式，不受语言影响
    expect(formatDate(all[0]!, "2026-08-18", "md")).toBe("8/17");
    expect(formatDate(all[0]!, "2026-08-18", "full")).toBe("2026-08-17");
  });

  it("translates recurrence descriptions", () => {
    expect(describeRecur({ kind: "daily", interval: 1 })).toBe("每天");
    expect(describeRecur({ kind: "weekly", interval: 2 })).toBe("每2周");
    expect(describeRecur({ kind: "weekly", interval: 1, weekday: 2 })).toBe("每周三");
    expect(describeRecur({ kind: "weekdays", interval: 1 })).toBe("每个工作日");
    setLang("en");
    expect(describeRecur({ kind: "daily", interval: 1 })).toBe("daily");
    expect(describeRecur({ kind: "weekly", interval: 2 })).toBe("every 2 weeks");
    expect(describeRecur({ kind: "weekly", interval: 1, weekday: 2 })).toBe("every Wed");
    expect(describeRecur({ kind: "weekdays", interval: 1 })).toBe("every weekday");
  });

  it("names weekdays in both languages with Monday first", () => {
    expect(weekdayName(0, "zh")).toBe("一");
    expect(weekdayName(6, "zh")).toBe("日");
    expect(weekdayName(0, "en")).toBe("Mon");
    expect(weekdayName(6, "en")).toBe("Sun");
  });

  it("defaults ui.lang to auto so existing config files keep working", () => {
    // 老配置文件没有 [ui] 段，解析不能失败
    expect(config.ui.lang).toBe("auto");
  });
});
