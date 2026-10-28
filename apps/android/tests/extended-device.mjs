import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';

const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8' }).trim();
adb('forward', 'tcp:9223', `localabstract:webview_devtools_remote_${adb('shell', 'pidof', 'io.anothertodo.mobile')}`);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts()[0].pages()[0];
const errors = []; page.on('pageerror', error => errors.push(error.message));
try {
  if (await page.locator('dialog[open]').count()) await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '任务', exact: true }).click();
  await page.getByRole('button', { name: '添加任务', exact: true }).click();
  await page.getByLabel('一行一个任务').fill('连续撤销验收 @none');
  await page.getByRole('button', { name: '检查任务', exact: true }).click();
  await page.getByRole('button', { name: '添加 1 个任务', exact: true }).click();
  for (const title of ['连续撤销第一修改', '连续撤销第二修改']) {
    await page.locator('#content .task-title').filter({ hasText: /^连续撤销/ }).click();
    await page.getByLabel('任务标题').fill(title); await page.getByRole('button', { name: '关闭', exact: true }).click();
  }
  for (const title of ['连续撤销第一修改', '连续撤销验收']) {
    await page.getByRole('button', { name: '撤销操作', exact: true }).click(); await page.locator('#content').getByText(title, { exact: true }).waitFor();
  }
  await page.getByRole('button', { name: '撤销操作', exact: true }).click();
  assert.equal(await page.locator('#content').getByText('连续撤销验收', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '归档', exact: true }).click();
  await page.getByLabel('归档超过多少天的历史').fill('0');
  await page.locator('dialog').getByRole('button', { name: '归档', exact: true }).click();
  await page.locator('#navigation').getByRole('button', { name: '任务', exact: true }).click();
  await page.getByRole('button', { name: '撤销操作', exact: true }).click();
  const state = await page.evaluate(() => JSON.parse(Native.invoke('load', '{}')).value.state);
  assert.ok(state.tasks.some(task => task.title === '每日验收' && task.status === 'done'));
  const items = Array.from({ length: 1000 }, (_, index) => ({ id: `perf-${index}`, title: `性能验收任务 ${index}`, status: 'todo', project: '性能验收', tags: ['性能'], notes: index === 777 ? '检索特别备注' : '', reminders: [], entry: new Date().toISOString(), modified: new Date().toISOString() }));
  await page.locator('#navigation').getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '导入', exact: true }).click();
  await page.getByLabel('导入数据').fill(JSON.stringify(items));
  await page.locator('dialog').getByRole('button', { name: '导入', exact: true }).click();
  await page.locator('dialog[open]').waitFor({ state: 'hidden' });
  const start = performance.now();
  await page.getByRole('button', { name: '任务', exact: true }).click();
  await page.locator('#content').getByText('性能验收任务 999', { exact: true }).waitFor({ state: 'attached' });
  await page.locator('#content .task-card').first().waitFor();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const renderMs = Math.round(performance.now() - start);
  assert.ok(renderMs < 5000, `千条任务显示耗时 ${renderMs}ms`);
  const searchStart = performance.now();
  await page.getByLabel('搜索与查询').fill('/检索特别备注');
  await page.waitForFunction(() => document.querySelectorAll('#content .task-card').length === 1);
  const searchMs = Math.round(performance.now() - searchStart);
  assert.ok(searchMs < 1500, `备注检索耗时 ${searchMs}ms`);
  await page.getByRole('button', { name: '选择任务', exact: true }).click();
  await page.getByRole('button', { name: '全选当前结果', exact: true }).click();
  await page.locator('#batch').getByRole('button', { name: '取消任务', exact: true }).click();
  await page.getByRole('button', { name: '撤销操作', exact: true }).click();
  await page.getByRole('button', { name: '取消选择', exact: true }).click();
  const after = await page.evaluate(() => JSON.parse(Native.invoke('load', '{}')).value.state);
  assert.equal(after.tasks.find(task => task.id === 'perf-777').status, 'todo');
  assert.ok(after.undo.every(change => !('before' in change)), '撤销记录需要只保存发生变化的记录');
  await page.getByRole('button', { name: '清空搜索', exact: true }).click();
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByLabel('界面语言').selectOption('en');
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await page.getByRole('button', { name: 'Tasks', exact: true }).click();
  await page.getByRole('button', { name: 'Statistics', exact: true }).click();
  await page.getByText('Completed in 7 days', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('Language', { exact: true }).selectOption('zh');
  await page.getByRole('button', { name: 'Save configuration', exact: true }).click();
  assert.equal(errors.length, 0, errors.join('\n'));
  await writeFile('test-results/performance.json', JSON.stringify({ checks: ['three consecutive undo operations', 'archive transaction undo', '1000 real imported tasks', 'notes search', 'batch cancellation and undo', 'compact undo records', 'English interface'], renderMs, searchMs, tasks: after.tasks.length, errors }, null, 2));
  console.log(`Android 扩展验收通过：千条任务 ${renderMs}ms，检索 ${searchMs}ms`);
} finally { await browser.close(); }
