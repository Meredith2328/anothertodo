import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ApplicationService } from '../src/app/service.js';
import { Store } from '../src/storage/store.js';
import { parse } from '../src/core/parse.js';
import { parseTask } from '../src/core/task.js';
import { dependencyCandidates, blockedDependencies, validateDependencies } from '../src/core/dependencies.js';

const fresh = async () => {
  await mkdir('tests/tmpdata/dependencies', { recursive: true });
  return new ApplicationService(new Store(await mkdtemp(join('tests/tmpdata/dependencies', 'case-'))));
};
describe('task dependencies', () => {
  it.each([
    ['整理资料之后写报告', '写报告', 'after', '整理资料'],
    ['提交之前检查附件', '检查附件', 'before', '提交'],
    ['发邮件 在「写报告」之后', '发邮件', 'after', '写报告'],
    ['修复错误 before "publish release"', '修复错误', 'before', 'publish release'],
    ['after "collect data", write report', 'write report', 'after', 'collect data'],
    ['write report depends on "collect data"', 'write report', 'after', 'collect data'],
    ['在「整理资料」完成后 写报告', '写报告', 'after', '整理资料'],
    ['写报告在整理资料后', '写报告', 'after', '整理资料'],
    ['买菜后做饭', '做饭', 'after', '买菜'],
    ['「collect data」后 write report', 'write report', 'after', 'collect data'],
  ])('parses %s', (input, title, direction, reference) => {
    const parsed = parse(`${input} @none`, '2026-10-06T09:00');
    expect(parsed.title).toBe(title);
    expect(parsed.dependencies).toEqual([{ direction, reference }]);
  });
  it('keeps date expressions and notes separate from dependency references', () => {
    const value = parse('明天之前写报告 >>整理资料之后再检查', '2026-10-06T09:00');
    expect(value.dependencies).toEqual([]);
    expect(value.due?.slice(0, 10)).toBe('2026-10-07');
    expect(value.notes).toBe('整理资料之后再检查');
  });
  it('saves forward batch references and reverses before edges atomically', async () => {
    const app = await fresh();
    const batch = await app.addBatch(['写报告 after:整理资料 @none', '整理资料 @none', '检查附件 before:写报告 @none']);
    const report = batch.find(task => task.title === '写报告')!;
    expect((await app.store.find(report.id))?.dependsOn?.sort()).toEqual([batch[1]!.id, batch[2]!.id].sort());
    await app.undo();
    expect(await app.tasks()).toEqual([]);
  });
  it('requires confirmation for ambiguous matches and refuses to guess', async () => {
    const app = await fresh();
    await app.add('整理资料 @none'); await app.add('整理资料 @none');
    await expect(app.add('写报告 after:整理资料 @none')).rejects.toThrow('多个');
    expect(await app.tasks()).toHaveLength(2);
  });
  it('blocks completion until prerequisites are done and preserves archived completion', async () => {
    const app = await fresh();
    const input = await app.add('整理资料 @none');
    const report = await app.add(`写报告 after:${input.id} @none`);
    await expect(app.complete(report.id)).rejects.toThrow('依赖');
    await app.complete(input.id); await app.archive(0);
    expect((await app.complete(report.id)).task.status).toBe('done');
  });
  it('rejects cycles without partial writes', async () => {
    const app = await fresh();
    await expect(app.addBatch(['甲任务 after:乙任务 @none', '乙任务 after:甲任务 @none'])).rejects.toThrow('循环');
    expect(await app.tasks()).toEqual([]);
    const first = await app.add('甲任务 @none');
    const second = await app.add(`乙任务 after:${first.id} @none`);
    await expect(app.edit(first.id, `after:${second.id}`)).rejects.toThrow('循环');
    expect((await app.store.find(first.id))?.dependsOn ?? []).toEqual([]);
  });
  it('completes dependent children in one operation and undoes completion before undoing creation', async () => {
    const app = await fresh();
    const parent = await app.add('装修 @none');
    const children = await app.addBatch([`铺地砖 ^${parent.id} after:买瓷砖 @none`, `买瓷砖 ^${parent.id} @none`]);
    await app.complete(parent.id, { cascade: true });
    expect((await app.tasks()).every(task => task.status === 'done')).toBe(true);
    await app.undo(); expect((await app.tasks()).every(task => task.status === 'todo')).toBe(true);
    await app.undo(); expect((await app.tasks()).map(task => task.id)).toEqual([parent.id]);
    expect(children).toHaveLength(2);
  });
  it('reports missing prerequisites and ranks exact titles before fuzzy alternatives', () => {
    const one = parseTask({ id: 'a1', title: '整理季度资料' });
    const two = parseTask({ id: 'b2', title: '整理资料' });
    expect(dependencyCandidates('整理资料', [one, two])[0]?.task.id).toBe(two.id);
    expect(blockedDependencies(parseTask({ id: 'c3', dependsOn: ['missing'] }), [one, two])).toEqual(['missing']);
    expect(() => validateDependencies([parseTask({ id: 'self', dependsOn: ['self'] })])).toThrow('自身');
  });
  it('validates a long dependency chain and rejects a cycle at its end', () => {
    const tasks = Array.from({ length: 10000 }, (_, index) => parseTask({ id: String(index), dependsOn: index ? [String(index - 1)] : [] }));
    expect(() => validateDependencies(tasks)).not.toThrow();
    tasks[0]!.dependsOn = ['9999'];
    expect(() => validateDependencies(tasks)).toThrow('循环');
  });
  it('keeps a deletion authoritative when archive history contains an older completed record', async () => {
    const app = await fresh();
    const prerequisite = await app.add('历史前置任务 @none');
    const dependent = await app.add(`后续任务 after:${prerequisite.id} @none`);
    const completed = (await app.complete(prerequisite.id)).task;
    await writeFile(app.store.paths.archive, `${JSON.stringify(completed)}\n`, 'utf8');
    await app.remove(prerequisite.id);
    await expect(app.complete(dependent.id)).rejects.toThrow('依赖');
  });
});
