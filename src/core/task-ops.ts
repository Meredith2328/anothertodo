import type { Task } from "../contracts.js";
import { recurToInput, type Parsed } from "./parse.js";

/**
 * 把一行输入的解析结果套到已有任务上。
 * 「没写就不动」是默认规则，想真正清空得用 `-due` `-proj` 这类显式指令，
 * 否则改标题时会顺手把日期抹掉。
 */
export const applyParsedUpdate = (task: Task, parsed: Parsed): Task => {
  if (parsed.title) task.title = parsed.title;
  if (parsed.due !== undefined) task.due = parsed.due;
  if (parsed.priority) task.priority = parsed.priority;
  if (parsed.tags.length) task.tags = [...parsed.tags];
  if (parsed.removeTags.length) task.tags = task.tags.filter((tag) => !parsed.removeTags.includes(tag));
  if (parsed.project !== undefined) task.project = parsed.project;
  if (parsed.parent !== undefined) task.parent = parsed.parent;
  if (parsed.wait !== undefined) task.wait = parsed.wait;
  if (parsed.notes !== undefined) task.notes = parsed.notes;
  if (parsed.recur !== undefined) task.recur = parsed.recur;
  if (parsed.reminders.length) task.reminders = parsed.reminders.map(({ relative: _relative, dead, ...reminder }) => ({ ...reminder, dead: dead ?? false }));
  for (const field of parsed.clears) {
    if (field === "due") delete task.due;
    else if (field === "priority") delete task.priority;
    else if (field === "project") delete task.project;
    else if (field === "parent") delete task.parent;
    else if (field === "wait") delete task.wait;
    else if (field === "tags") task.tags = [];
    else if (field === "notes") task.notes = "";
    else if (field === "recur") delete task.recur;
    else if (field === "reminders") task.reminders = [];
  }
  return task;
};

/** 反向拼回一行输入，供编辑框回填；必须涵盖 parse 认得的每个字段，否则编辑一次就丢字段 */
export const taskToInput = (task: Task): string => {
  const parts = [task.title];
  if (task.priority) parts.push(task.priority);
  if (task.project) parts.push(`proj:${task.project}`);
  parts.push(...task.tags.map((tag) => `#${tag}`));
  if (task.parent) parts.push(`^${task.parent}`);
  if (task.wait) parts.push(`~${task.wait}`);
  if (task.recur) parts.push(recurToInput(task.recur));
  if (task.due) {
    parts.push(task.due.slice(0, 10));
    if (task.due.slice(11, 16) !== "00:00") parts.push(task.due.slice(11, 16));
  }
  for (const reminder of task.reminders) parts.push(`@${reminder.at.replace("T", " ")}:${reminder.hooks.join(",")}`);
  // 备注放最后：`>>` 之后的内容整段算备注，前面还有字段就会被吞掉
  if (task.notes.trim()) parts.push(`>>${task.notes.replace(/\r?\n/gu, " ")}`);
  return parts.filter(Boolean).join(" ");
};
