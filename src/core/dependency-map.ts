import type { Task } from '../contracts.js';
import { ACTIVE_STATES } from './task.js';
import { dependencyOrder } from './dependencies.js';

export type MapState = 'done' | 'ready' | 'locked' | 'deferred' | 'cancelled' | 'inactive' | 'missing';
export type MapNode = { id: string; task: Task | undefined; state: MapState; previous: string[]; next: string[] };
export type MapEdge = { from: string; to: string };
export type MapRoute = { id: string; title: string; ids: string[]; completed: number; total: number; ready: string[]; connected: boolean };
export type DependencyMap = { nodes: Map<string, MapNode>; edges: MapEdge[]; routes: MapRoute[] };

export const dependencyMap = (catalog: readonly Task[], today: string): DependencyMap => {
  const ordered = dependencyOrder([...catalog].sort((a, b) => a.entry.localeCompare(b.entry) || a.id.localeCompare(b.id)));
  const tasks = new Map(ordered.map(task => [task.id, task]));
  const nodes = new Map<string, MapNode>(), edges: MapEdge[] = [];
  const missing = new Set(ordered.flatMap(task => task.dependsOn ?? []).filter(id => !tasks.has(id)));
  for (const id of [...missing].sort()) nodes.set(id, { id, task: undefined, state: 'missing', previous: [], next: [] });
  for (const task of ordered) {
    const previous = [...new Set(task.dependsOn ?? [])].sort();
    const state: MapState = task.status === 'done' ? 'done' : task.status === 'cancelled' ? 'cancelled'
      : !ACTIVE_STATES.has(task.status) ? 'inactive' : previous.some(id => tasks.get(id)?.status !== 'done') ? 'locked'
      : task.wait && task.wait > today ? 'deferred' : 'ready';
    nodes.set(task.id, { id: task.id, task, state, previous, next: [] });
  }
  for (const node of nodes.values()) for (const id of node.previous) {
    nodes.get(id)!.next.push(node.id); edges.push({ from: id, to: node.id });
  }
  const position = new Map([...nodes.keys()].map((id, index) => [id, index]));
  const visited = new Set<string>(), routes: MapRoute[] = [];
  for (const first of nodes.keys()) {
    if (visited.has(first)) continue;
    const ids = [first]; visited.add(first);
    for (let index = 0; index < ids.length; index++) {
      const node = nodes.get(ids[index]!)!;
      for (const id of [...node.previous, ...node.next]) if (!visited.has(id)) { visited.add(id); ids.push(id); }
    }
    ids.sort((a, b) => position.get(a)! - position.get(b)!);
    const members = ids.map(id => nodes.get(id)!);
    const goals = members.filter(node => node.task && !node.next.length);
    const goal = goals[0]?.task ?? members.find(node => node.task)!.task!;
    const total = members.filter(node => node.task).length;
    routes.push({ id: [...ids].sort()[0]!, title: goal.title, ids, completed: members.filter(node => node.state === 'done').length,
      total, ready: members.filter(node => node.state === 'ready').map(node => node.id), connected: members.some(node => node.previous.length > 0) });
  }
  return { nodes, edges, routes };
};
