import type { Task } from "../contracts.js";
import { ACTIVE_STATES } from "./task.js";

/**
 * 任务之间的前置依赖（DAG）。边存在后续任务的 `deps` 字段里：
 * 「领取身份证.deps = [申请身份证.id]」读作「申请身份证做完才能领取身份证」。
 * 前置 done 或 cancelled 都算不再挡路；前置被删掉或归档了也不挡路，
 * 否则后续任务会被一条看不见的记录永远卡住。
 */
const FINISHED = new Set(["done", "cancelled"]);

export const openDeps = (task: Task, byId: Map<string, Task>): Task[] =>
  (task.deps ?? []).flatMap((id) => { const dep = byId.get(id); return dep && !FINISHED.has(dep.status) ? [dep] : []; });

/** 还开着、但有前置没做完的任务 */
export const blockedIds = (tasks: Task[]): Set<string> => {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return new Set(tasks.filter((task) => ACTIVE_STATES.has(task.status) && openDeps(task, byId).length > 0).map((task) => task.id));
};

/** 给 id 设上这些前置后会不会成环：顺着前置往上走，走回 id 就是环 */
export const wouldCycle = (tasks: Task[], id: string, deps: string[]): boolean => {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const seen = new Set<string>();
  const stack = [...deps];
  while (stack.length) {
    const current = stack.pop()!;
    if (current === id) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(byId.get(current)?.deps ?? []));
  }
  return false;
};

/** done 掉 id 之后，因此不再被挡住的后续任务 */
export const unblockedBy = (tasks: Task[], id: string): Task[] => {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  return tasks.filter((task) => ACTIVE_STATES.has(task.status) && (task.deps ?? []).includes(id) && openDeps(task, byId).length === 0);
};

export type GraphMark = "done" | "ready" | "blocked";
export type GraphLine = {
  task: Task;
  /** 树形前缀，如 `│   └─▸ ` */
  prefix: string;
  mark: GraphMark;
  /** 这个节点在上面已经展开过，这里只放一个引用，免得多前置的节点把整棵子树重复画一遍 */
  ref: boolean;
  /** 除了当前这条父边以外的其他前置，画在行尾提示「另需」 */
  otherDeps: Task[];
};

/**
 * 把依赖图摊成终端里能画的森林：从没有前置的任务出发往后续展开。
 * 有多个前置的节点只在第一次遇到时展开，之后遇到画成引用行。
 * 只收参与了依赖的任务，普通任务不进图。
 */
export const dependencyGraph = (tasks: Task[]): GraphLine[] => {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const depsOf = (task: Task): Task[] => (task.deps ?? []).flatMap((id) => { const dep = byId.get(id); return dep && dep.id !== task.id ? [dep] : []; });
  const dependents = new Map<string, Task[]>();
  for (const task of tasks) for (const dep of depsOf(task)) dependents.set(dep.id, [...(dependents.get(dep.id) ?? []), task]);
  const inGraph = tasks.filter((task) => depsOf(task).length > 0 || dependents.has(task.id));
  const byEntry = (a: Task, b: Task): number => a.entry.localeCompare(b.entry) || a.id.localeCompare(b.id);
  const mark = (task: Task): GraphMark => FINISHED.has(task.status) ? "done" : openDeps(task, byId).length ? "blocked" : "ready";
  const lines: GraphLine[] = [];
  const expanded = new Set<string>();
  const visit = (task: Task, via: Task | undefined, lead: string, branch: string): void => {
    const ref = expanded.has(task.id);
    lines.push({ task, prefix: `${lead}${branch}`, mark: mark(task), ref, otherDeps: depsOf(task).filter((dep) => dep.id !== via?.id) });
    if (ref) return;
    expanded.add(task.id);
    const children = [...(dependents.get(task.id) ?? [])].sort(byEntry);
    const childLead = lead + (branch === "" ? "" : branch.startsWith("└") ? "    " : "│   ");
    children.forEach((child, index) => visit(child, task, childLead, index === children.length - 1 ? "└─▸ " : "├─▸ "));
  };
  for (const root of inGraph.filter((task) => depsOf(task).length === 0).sort(byEntry)) visit(root, undefined, "", "");
  // 手改文件或同步后可能出现环，环上没有起点；剩下的挑一个当起点，保证每条都画出来
  for (const task of [...inGraph].sort(byEntry)) if (!expanded.has(task.id)) visit(task, undefined, "", "");
  return lines;
};

export const GRAPH_MARK: Record<GraphMark, string> = { done: "✓", ready: "●", blocked: "○" };

export const renderGraphLine = (line: GraphLine): string => {
  const status = line.task.status === "todo" ? "" : `  [${line.task.status}]`;
  if (line.ref) return `${line.prefix}⤷ ${line.task.title}（见上）`;
  const others = line.otherDeps.length ? `  （另需：${line.otherDeps.map((dep) => dep.title).join("、")}）` : "";
  return `${line.prefix}${GRAPH_MARK[line.mark]} ${line.task.title}${status}${others}`;
};
