import { describe, expect, it } from 'vitest';
import { parseTask } from '../src/core/task.js';
import { dependencyMap } from '../src/core/dependency-map.js';

const task = (id: string, dependsOn: string[] = [], status = 'todo', wait?: string) => parseTask({
  id, title: `任务 ${id}`, status, dependsOn, wait, tags: [], notes: '', reminders: [],
  entry: '2026-10-06T08:00:00Z', modified: '2026-10-06T08:00:00Z',
});
describe('dependency level map', () => {
  it('shows every available branch and gates a merge until both branches finish', () => {
    const tasks = [task('00000001', [], 'done'), task('00000002', ['00000001']), task('00000003', ['00000001']), task('00000004', ['00000002', '00000003'])];
    const map = dependencyMap(tasks, '2026-10-06');
    expect(map.routes).toHaveLength(1);
    expect(map.routes[0]!.ready).toEqual(['00000002', '00000003']);
    expect(map.routes[0]!.completed).toBe(1);
    expect(map.nodes.get('00000004')!.state).toBe('locked');
    tasks[1]!.status = 'done'; tasks[2]!.status = 'done';
    expect(dependencyMap(tasks, '2026-10-06').routes[0]!.ready).toEqual(['00000004']);
    tasks[0]!.status = 'todo';
    expect(dependencyMap(tasks, '2026-10-06').nodes.get('00000002')!.state).toBe('done');
    tasks[1]!.status = 'todo';
    expect(dependencyMap(tasks, '2026-10-06').nodes.get('00000002')!.state).toBe('locked');
  });
  it('preserves archived completion, missing prerequisites and unavailable states', () => {
    const map = dependencyMap([task('00000001', [], 'done'), task('00000002', ['00000001'], 'todo', '2026-10-07'), task('00000003', ['00000009']), task('00000004', [], 'cancelled'), task('00000005', [], 'review')], '2026-10-06');
    expect(map.nodes.get('00000001')!.state).toBe('done');
    expect(map.nodes.get('00000002')!.state).toBe('deferred');
    expect(map.nodes.get('00000003')!.state).toBe('locked');
    expect(map.nodes.get('00000009')!.state).toBe('missing');
    expect(map.nodes.get('00000009')!.task).toBeUndefined();
    expect(map.nodes.get('00000004')!.state).toBe('cancelled');
    expect(map.nodes.get('00000005')!.state).toBe('inactive');
    expect(map.routes.reduce((sum, route) => sum + route.total, 0)).toBe(5);
    expect(dependencyMap([task('00000002', [], 'waiting', '2026-10-06')], '2026-10-06').nodes.get('00000002')!.state).toBe('ready');
  });
  it('keeps components, numbering and edge direction stable across catalog ordering', () => {
    const tasks = [task('00000003', ['00000001', '00000002']), task('00000001'), task('00000002'), task('00000004')];
    const map = dependencyMap(tasks, '2026-10-06');
    expect(map.routes).toEqual(dependencyMap([...tasks].reverse(), '2026-10-06').routes);
    expect(map.routes.map(route => route.ids.length)).toEqual([3, 1]);
    expect(map.edges).toContainEqual({ from: '00000001', to: '00000003' });
    expect(map.nodes.get('00000003')!.previous).toEqual(['00000001', '00000002']);
    expect(map.nodes.get('00000001')!.next).toEqual(['00000003']);
  });
  it('handles empty catalogs and rejects cycles', () => {
    expect(dependencyMap([], '2026-10-06').routes).toEqual([]);
    expect(() => dependencyMap([task('00000001', ['00000002']), task('00000002', ['00000001'])], '2026-10-06')).toThrow('循环');
  });
  it('retains all 1000 tasks and their real completion frontier', () => {
    const tasks = Array.from({ length: 1000 }, (_, index) => task(index.toString(16).padStart(8, '0'), index ? [(index - 1).toString(16).padStart(8, '0')] : [], index < 499 ? 'done' : 'todo'));
    const map = dependencyMap(tasks, '2026-10-06');
    expect(map.routes[0]!.total).toBe(1000);
    expect(map.routes[0]!.completed).toBe(499);
    expect(map.routes[0]!.ready).toEqual(['000001f3']);
    expect(map.edges).toHaveLength(999);
  });
});
