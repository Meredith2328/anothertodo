import type { Task } from "../contracts.js";
import type { Parsed } from "./parse.js";

export const applyParsedUpdate = (task: Task, parsed: Parsed): Task => {
  if (parsed.title) task.title = parsed.title;
  if (parsed.due !== undefined) task.due = parsed.due;
  if (parsed.priority) task.priority = parsed.priority;
  if (parsed.tags.length) task.tags = [...parsed.tags];
  if (parsed.project !== undefined) task.project = parsed.project;
  if (parsed.parent !== undefined) task.parent = parsed.parent;
  if (parsed.wait !== undefined) task.wait = parsed.wait;
  if (parsed.reminders.length) task.reminders = parsed.reminders.map(({ relative: _relative, dead, ...reminder }) => ({ ...reminder, dead: dead ?? false }));
  return task;
};

export const taskToInput = (task: Task): string => {
  const parts = [task.title];
  if (task.priority) parts.push(task.priority);
  if (task.project) parts.push(`proj:${task.project}`);
  parts.push(...task.tags.map((tag) => `#${tag}`));
  if (task.parent) parts.push(`^${task.parent}`);
  if (task.wait) parts.push(`~${task.wait}`);
  if (task.due) {
    parts.push(task.due.slice(0, 10));
    if (task.due.slice(11, 16) !== "00:00") parts.push(task.due.slice(11, 16));
  }
  for (const reminder of task.reminders) parts.push(`@${reminder.at.replace("T", " ")}:${reminder.hooks.join(",")}`);
  return parts.filter(Boolean).join(" ");
};
