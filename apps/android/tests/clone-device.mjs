import { chromium } from 'playwright';
import backend from 'git-http-backend';
import http from 'node:http';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { parse, stringify } from 'smol-toml';

const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8' }).trim();
const connect = async () => {
  const pid = adb('shell', 'pidof', 'io.anothertodo.mobile'); const port = 12000 + Number(pid) % 40000;
  adb('forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages()[0];
  await page.waitForFunction(() => typeof window.nativeBack === 'function'); return { browser, page };
};
adb('shell', 'am', 'start', '-W', '-n', 'io.anothertodo.mobile/.MainActivity');
let { browser, page } = await connect();
if (await page.locator('dialog[open]').count()) await page.getByRole('button', { name: '关闭', exact: true }).click();
await page.getByRole('button', { name: '更多', exact: true }).click();
await page.getByRole('button', { name: '设置', exact: true }).click();
const config = parse(await page.getByLabel('完整配置 TOML').inputValue()); config.ui.lang = 'zh';
await browser.close();
const root = resolve('.local', `clone-${Date.now()}`); const bare = resolve(root, 'tasks.git'); const desktop = resolve(root, 'desktop');
await mkdir(desktop, { recursive: true });
execFileSync('git', ['init', '--bare', '--initial-branch=main', bare]);
execFileSync('git', ['init', '--initial-branch=main', desktop]);
const git = (dir, ...args) => execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
git(desktop, 'config', 'user.name', 'Desktop clone test'); git(desktop, 'config', 'user.email', 'clone@example.invalid');
const timestamp = new Date().toISOString();
const parent = { id: 'clone-parent', title: '仓库已有父任务', status: 'todo', tags: ['已有仓库'], notes: '桌面备注', reminders: [], entry: timestamp, modified: timestamp };
const child = { ...parent, id: 'clone-child', title: '仓库已有子任务', parent: parent.id };
await writeFile(resolve(desktop, 'tasks.jsonl'), [parent, child].map(task => JSON.stringify(task)).join('\n') + '\n');
await writeFile(resolve(desktop, 'archive.jsonl'), JSON.stringify({ ...parent, id: 'clone-archive', title: '仓库已有归档', status: 'done', end: timestamp }) + '\n');
await writeFile(resolve(desktop, 'config.toml'), stringify(config));
git(desktop, 'add', '.'); git(desktop, 'commit', '-m', 'Existing desktop repository'); git(desktop, 'remote', 'add', 'origin', bare); git(desktop, 'push', 'origin', 'main');
const server = http.createServer((req, res) => {
  if (req.headers.authorization !== `Basic ${Buffer.from('tester:clone-token').toString('base64')}`) { res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="Git clone test"' }); res.end(); return; }
  req.pipe(backend(req.url, (error, service) => {
    if (error) throw error; res.setHeader('content-type', service.type);
    const process = spawn(service.cmd, [...service.args, bare]); process.on('error', error => { throw error; });
    process.stdout.pipe(service.createStream()).pipe(process.stdin);
  })).pipe(res);
});
await new Promise(resolve => server.listen(9849, '127.0.0.1', resolve));
adb('reverse', 'tcp:9849', 'tcp:9849');
adb('shell', 'pm', 'clear', 'io.anothertodo.mobile');
adb('shell', 'pm', 'grant', 'io.anothertodo.mobile', 'android.permission.POST_NOTIFICATIONS');
adb('shell', 'appops', 'set', 'io.anothertodo.mobile', 'SCHEDULE_EXACT_ALARM', 'allow');
adb('shell', 'am', 'start', '-W', '-n', 'io.anothertodo.mobile/.MainActivity');
({ browser, page } = await connect());
try {
  await page.getByRole('button', { name: '添加任务', exact: true }).click();
  await page.getByLabel('一行一个任务').fill('手机首次同步前的任务 @none');
  await page.getByRole('button', { name: '检查任务', exact: true }).click();
  await page.getByRole('button', { name: '添加 1 个任务', exact: true }).click();
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '同步', exact: true }).click();
  for (const [label, value] of [['仓库地址', 'http://127.0.0.1:9849/tasks.git'], ['分支', 'main'], ['Git 用户名', 'tester'], ['访问令牌', 'clone-token'], ['提交姓名', 'Android clone test'], ['提交邮箱', 'android-clone@example.invalid']]) await page.getByLabel(label, { exact: true }).fill(value);
  await page.getByRole('button', { name: '立即同步', exact: true }).click();
  await page.locator('dialog .status').getByText('同步完成', { exact: true }).waitFor();
  const state = await page.evaluate(() => JSON.parse(Native.invoke('load', '{}')).value.state);
  assert.equal(state.tasks.length, 3); assert.equal(state.archive.length, 1);
  assert.equal(state.tasks.find(task => task.id === child.id).parent, parent.id);
  assert.equal(state.tasks.find(task => task.id === parent.id).notes, parent.notes);
  assert.ok(state.tasks.some(task => task.title === '手机首次同步前的任务'));
  assert.ok(git(bare, 'show', 'main:tasks.jsonl').includes('手机首次同步前的任务'));
  await writeFile('test-results/clone.json', JSON.stringify({ checks: ['clone existing authenticated repository', 'preserve local task during first sync', 'import archived tasks', 'preserve parent IDs and notes', 'push merged data'], tasks: state.tasks.length, archived: state.archive.length }, null, 2));
  console.log('Android 首次连接已有仓库验收通过');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
