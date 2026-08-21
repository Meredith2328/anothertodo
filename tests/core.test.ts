import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { groups, formatDate } from "../src/core/agenda.js";
import { ConfigSchema, TaskSchema } from "../src/contracts.js";
import { compileQuery, filterTasks } from "../src/core/query.js";
import { sortTasks, urgency } from "../src/core/priority.js";

const config = ConfigSchema.parse({ priority: { mode: "levels", levels: ["低", "中", "高"], urgency: { overdue: 12, due_today: 8, due_week_decay: 8, per_level: 3, age_per_day: 0.05, age_cap: 2, waiting_penalty: 3 } }, agenda: { week_days: 7, date_format: "auto" }, watch: { interval_seconds: 30 }, email: { host: "", port: 465, ssl: true, user: "", password: "", from: "", to: "" } });
const task = (value: Record<string, unknown>) => TaskSchema.parse({ entry: "2026-08-18T10:00:00Z", modified: "2026-08-18T10:00:00Z", ...value });

describe("stage 3 query, priority, and agenda", () => {
  const tasks = [task({ id: "00000061", title: "读书笔记", status: "todo", due: "2026-08-17T10:00:00", tags: ["会议"], project: "读书" }), task({ id: "00000062", title: "整理笔记", status: "todo", due: "2026-08-19T10:00:00", priority: "高" }), task({ id: "00000063", title: "修车", status: "waiting", wait: "2026-08-21" })];

  it("matches the frozen query cases", () => {
    expect(filterTasks(tasks, "overdue", "2026-08-18").map((item) => item.id)).toEqual(["00000061"]);
    expect(filterTasks(tasks, "due:tomorrow", "2026-08-18").map((item) => item.id)).toEqual(["00000062"]);
    expect(filterTasks(tasks, "+会议", "2026-08-18").map((item) => item.id)).toEqual(["00000061"]);
    expect(filterTasks(tasks, "project:读书", "2026-08-18").map((item) => item.id)).toEqual(["00000061"]);
    expect(filterTasks(tasks, "-高", "2026-08-18").map((item) => item.id)).toEqual(["00000061", "00000063"]);
    expect(() => compileQuery("unknown:value", "2026-08-18")).toThrow("不认识的过滤器");
  });

  it("filters on parent, notes, and field existence", () => {
    const parent = task({ id: "000000a1", title: "装修", status: "todo" });
    const child = task({ id: "000000a2", title: "买瓷砖", status: "todo", parent: "000000a1", notes: "去建材市场比价" });
    const all = [parent, child];
    expect(filterTasks(all, "parent:000000a1", "2026-08-18").map((item) => item.id)).toEqual(["000000a2"]);
    expect(filterTasks(all, "parent:000000a", "2026-08-18").map((item) => item.id)).toEqual(["000000a2"]);
    expect(filterTasks(all, "parent:any", "2026-08-18").map((item) => item.id)).toEqual(["000000a2"]);
    expect(filterTasks(all, "parent:none", "2026-08-18").map((item) => item.id)).toEqual(["000000a1"]);
    expect(filterTasks(all, "has:parent", "2026-08-18").map((item) => item.id)).toEqual(["000000a2"]);
    expect(filterTasks(all, "-has:notes", "2026-08-18").map((item) => item.id)).toEqual(["000000a1"]);
    // 关键字要能命中备注，否则写在备注里的内容永远搜不出来
    expect(filterTasks(all, "/建材", "2026-08-18").map((item) => item.id)).toEqual(["000000a2"]);
    expect(() => compileQuery("has:nope", "2026-08-18")).toThrow("不认识的字段");
    expect(() => compileQuery("-nope:1", "2026-08-18")).toThrow("不支持取反的过滤器");
  });

  it("matches urgency and level sorting semantics", async () => {
    const overdue = task({ id: "00000064", title: "逾期", status: "todo", due: "2026-08-15T09:00:00" });
    const future = task({ id: "00000065", title: "未来", status: "todo", due: "2026-08-25T09:00:00", priority: "高" });
    expect(urgency(overdue, config, "2026-08-18T14:00")).toBeGreaterThan(0);
    expect((await sortTasks([future, overdue], "urgency", config, "2026-08-18T14:00"))[0]?.id).toBe("00000064");
  });

  it("keeps agenda groups and date formats stable", () => {
    const all = [task({ id: "00000066", title: "逾期", status: "todo", due: "2026-08-17T09:00:00" }), task({ id: "00000067", title: "今天", status: "todo", due: "2026-08-18T09:00:00" }), task({ id: "00000068", title: "完成", status: "done" }), task({ id: "00000069", title: "无日期", status: "todo" })];
    const result = groups(all, config, "levels", "2026-08-18T14:00");
    expect(result.map((group) => group.name)).toEqual(["逾期", "今天", "无日期"]);
    expect(formatDate(all[0]!, "2026-08-18", "auto")).toBe("昨天");
    expect(formatDate(all[0]!, "2026-08-18", "md")).toBe("8/17");
    expect(formatDate(all[0]!, "2026-08-18", "full")).toBe("2026-08-17");
  });

  it("never loses a task that carries a wait date", () => {
    const now = "2026-08-18T14:00";
    // `atd add "修车 ~下周一"` 落成 waiting，未到期时只计入隐藏计数
    const future = task({ id: "000000b1", title: "修车", status: "waiting", wait: "2026-08-25" });
    const futureTodo = task({ id: "000000b2", title: "还没到", status: "todo", wait: "2026-08-25" });
    // wait 已过期就该重新露面，哪怕没有截止日期
    const past = task({ id: "000000b3", title: "该动了", status: "todo", wait: "2026-08-01" });
    const pastWaiting = task({ id: "000000b4", title: "等到了", status: "waiting", wait: "2026-08-01" });
    const result = groups([future, futureTodo, past, pastWaiting], config, "levels", now);
    expect(result.map((group) => group.name)).toEqual(["等待中", "无日期", "隐藏(等待未到) 2 项"]);
    expect(result.find((group) => group.name === "无日期")?.tasks.map((item) => item.id)).toEqual(["000000b3"]);
    expect(result.find((group) => group.name === "等待中")?.tasks.map((item) => item.id)).toEqual(["000000b4"]);
    // 查询里点名 wait 时，隐藏折叠让位于「我就是要看这些」
    const revealed = groups([future, futureTodo, past, pastWaiting], config, "levels", now, "wait:any");
    expect(revealed.flatMap((group) => group.tasks).map((item) => item.id).sort()).toEqual(["000000b1", "000000b2", "000000b3", "000000b4"]);
    expect(revealed.some((group) => group.name.startsWith("隐藏"))).toBe(false);
  });

  it("treats a passed meeting as overdue", () => {
    const result = groups([task({ id: "000000c1", title: "例会", status: "meeting", due: "2026-08-17T09:00:00" })], config, "levels", "2026-08-18T14:00");
    expect(result.map((group) => group.name)).toEqual(["逾期"]);
  });

  it("executes the frozen query and priority fixtures", async () => {
    const queryFixture = JSON.parse(readFileSync(resolve(process.cwd(), "fixtures", "query-cases.json"), "utf8")) as { today: string; tasks: Array<Record<string, unknown>>; cases: Array<{ query: string; expectedIds: string[] }> };
    const frozenTasks = queryFixture.tasks.map((item) => task(item));
    for (const item of queryFixture.cases) expect(filterTasks(frozenTasks, item.query, queryFixture.today).map((value) => value.id)).toEqual(item.expectedIds);

    const priorityFixture = JSON.parse(readFileSync(resolve(process.cwd(), "fixtures", "priority-cases.json"), "utf8")) as { now: string; config: unknown; tasks: Array<Record<string, unknown>>; expected: { urgency: Record<string, number>; sortLevels: string[] } };
    const frozenConfig = ConfigSchema.parse(priorityFixture.config);
    const priorityTasks = priorityFixture.tasks.map((item) => task(item));
    for (const [id, expected] of Object.entries(priorityFixture.expected.urgency)) expect(urgency(priorityTasks.find((value) => value.id === id)!, frozenConfig, priorityFixture.now.slice(0, 16))).toBe(expected);
    expect((await sortTasks(priorityTasks, "levels", frozenConfig, priorityFixture.now.slice(0, 16))).map((value) => value.id)).toEqual(priorityFixture.expected.sortLevels);
  });
});
