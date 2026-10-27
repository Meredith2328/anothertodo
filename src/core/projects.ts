import type { Task } from '../contracts.js';
import type { Group } from './agenda.js';
import { blockedDependencies } from './dependencies.js';
import { ACTIVE_STATES, hiddenByWait, localNow } from './task.js';

export const executableTasks = (tasks: readonly Task[], catalog: readonly Task[], now = localNow()): Task[] => {
  const byId = new Map(catalog.map(task => [task.id, task]));
  return tasks.filter(task => {
    if (!ACTIVE_STATES.has(task.status) || hiddenByWait(task, now.slice(0, 10)) || blockedDependencies(task, catalog).length) return false;
    if (task.kind === 'project' && catalog.some(child => child.parent === task.id)) return false;
    const seen = new Set([task.id]);
    let parent = task.parent;
    while (parent) {
      if (seen.has(parent)) throw new Error('父子任务形成循环');
      seen.add(parent);
      const ancestor = byId.get(parent);
      if (!ancestor) break;
      if (ancestor.kind === 'project' && (!ACTIVE_STATES.has(ancestor.status) || hiddenByWait(ancestor, now.slice(0, 10)) || blockedDependencies(ancestor, catalog).length)) return false;
      parent = ancestor.parent;
    }
    return true;
  });
};

export const projectAgenda = (agenda: Group[], catalog: Task[], now = localNow()): Group[] => {
  const ready = new Set(executableTasks(catalog, catalog, now).map(task => task.id));
  const projects = new Set(catalog.filter(task => task.kind === 'project' && ACTIVE_STATES.has(task.status)).map(task => task.id));
  const candidates = agenda.flatMap(group => group.tasks);
  const chosen = new Map<string, Task>();
  for (const task of candidates) if (task.parent && projects.has(task.parent) && ready.has(task.id) && !chosen.has(task.parent)) chosen.set(task.parent, task);
  const visibleParents = new Set(candidates.filter(task => projects.has(task.id)).map(task => task.id));
  return agenda.map(group => ({ ...group, tasks: group.tasks.flatMap(task => {
    if (task.parent && visibleParents.has(task.parent) && projects.has(task.parent)) return [];
    const child = chosen.get(task.id);
    return child ? [task, child] : [task];
  }) })).filter(group => group.tasks.length || group.key === 'hidden');
};
