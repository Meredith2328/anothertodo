import type { Config, Task } from '../contracts.js';
import { groups, type Group } from '../core/agenda.js';
import { projectAgenda } from '../core/projects.js';
import { recommend } from './recommendation.js';
import { localNow } from '../core/task.js';

export const taskAgenda = async (tasks: Task[], catalog: Task[], config: Config, query = '', mode = config.priority.mode, now = localNow(), dir?: string): Promise<Group[]> => {
  let agenda = groups(tasks, config, mode, now, query, catalog);
  if (config.focus.list) {
    const ordered = await recommend(agenda.flatMap(group => group.tasks), catalog, config, { list: true, mode, now }, dir);
    const ranks = new Map(ordered.map((task, index) => [task.id, index]));
    agenda = agenda.map(group => ({ ...group, tasks: group.tasks.filter(task => ranks.has(task.id)).sort((a, b) => ranks.get(a.id)! - ranks.get(b.id)!) }));
  }
  return projectAgenda(agenda, catalog, now);
};
