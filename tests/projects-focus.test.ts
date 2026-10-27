import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApplicationService } from '../src/app/service.js';
import { Store } from '../src/storage/store.js';
import { loadConfig } from '../src/core/config.js';
import { executableTasks, projectAgenda } from '../src/core/projects.js';
import { groups } from '../src/core/agenda.js';
import { recommend } from '../src/app/recommendation.js';

const fresh = async (): Promise<ApplicationService> => {
  await mkdir(resolve('work/tests'), { recursive: true });
  return new ApplicationService(new Store(await mkdtemp(resolve('work/tests/project-'))));
};

describe('project and focus workflows', () => {
  it('advances five real chapters, completes the project and undoes atomically', async () => {
    const service = await fresh();
    const project = await service.addProject('学习测试书', Array.from({ length: 5 }, (_, i) => `学习测试书的第${i + 1}章`));
    let catalog = await service.dependencyTasks();
    const children = catalog.filter(task => task.parent === project.id);
    expect(children).toHaveLength(5);
    expect(executableTasks(catalog, catalog).map(task => task.id)).toEqual([children[0]!.id]);
    const config = await service.config();
    const view = projectAgenda(groups(catalog, config), catalog);
    expect(view.flatMap(group => group.tasks).map(task => task.id)).toEqual([project.id, children[0]!.id]);
    await service.complete(children[0]!.id);
    catalog = await service.dependencyTasks();
    expect(executableTasks(catalog, catalog).map(task => task.id)).toEqual([children[1]!.id]);
    await service.complete(project.id);
    expect((await service.tasks()).every(task => task.status === 'done')).toBe(true);
    await service.undo();
    expect((await service.store.find(children[0]!.id))!.status).toBe('done');
    expect((await service.store.find(children[1]!.id))!.status).toBe('todo');
    for (const child of children.slice(1)) await service.complete(child.id);
    expect((await service.store.find(project.id))!.status).toBe('done');
  });

  it('loads an external script, gates prerequisites and keeps surviving cards', async () => {
    const service = await fresh();
    await service.addProject('阅读书籍', ['阅读第一章', '阅读第二章']);
    const urgent = await service.add('缴纳账单 今天 高 @none');
    await service.add('未来事项 ~2099-01-01 @none');
    const other = await service.add('散步 @none');
    const config = await loadConfig(service.store.paths.dir);
    const tasks = await service.tasks();
    const cards = await recommend(tasks, tasks, config);
    expect(cards).toHaveLength(2);
    expect(cards[0]!.id).toBe(urgent.id);
    expect(cards.every(task => task.kind !== 'project' && task.title !== '阅读第二章' && task.title !== '未来事项')).toBe(true);
    config.focus.template = 'custom';
    config.focus.script = 'custom.js';
    const scriptPath = join(service.store.paths.dir, 'custom.js');
    await writeFile(scriptPath, 'function recommend(tasks) { return tasks.sort((a, b) => a.title < b.title ? 1 : -1).map(t => t.id); }');
    const custom = await recommend(tasks, tasks, config, {}, service.store.paths.dir);
    expect(custom.map(task => task.title)).toEqual([...executableTasks(tasks, tasks)].sort((a, b) => b.title > a.title ? 1 : -1).slice(0, 2).map(task => task.title));
    await writeFile(scriptPath, 'function recommend() { return ["missing"]; }');
    await expect(recommend(tasks, tasks, config, {}, service.store.paths.dir)).rejects.toThrow('未知');
    await writeFile(scriptPath, 'function recommend(tasks) { return [tasks[0].id, tasks[0].id]; }');
    await expect(recommend(tasks, tasks, config, {}, service.store.paths.dir)).rejects.toThrow('重复');
    await writeFile(scriptPath, 'function recommend() { throw new Error("脚本错误"); }');
    await expect(recommend(tasks, tasks, config, {}, service.store.paths.dir)).rejects.toThrow('脚本错误');
    await writeFile(scriptPath, 'function recommend() { while (true) {} }');
    await expect(recommend(tasks, tasks, config, {}, service.store.paths.dir)).rejects.toThrow('推荐脚本执行失败');
    config.focus.template = 'random';
    const retained = await recommend(tasks, tasks, config, { previous: [other.id] });
    expect(retained[0]!.id).toBe(other.id);
    expect(join(service.store.paths.dir, 'tasks.jsonl')).toContain('work');
  }, 60_000);
});
