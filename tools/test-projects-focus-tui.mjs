import { createServer } from 'node:http';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import assert from 'node:assert/strict';
import pty from 'node-pty';
import { chromium } from 'playwright';

const require = createRequire(import.meta.url);
const root = resolve('.');
await mkdir('work/tui-review', { recursive: true });
const dir = await mkdtemp(resolve('work/tui-review/data-'));
const cli = (...args) => execFileSync(process.execPath, ['dist-node/cli.js', ...args], { cwd: root, env: { ...process.env, ATD_HOME: dir, ATD_LANG: 'zh' }, encoding: 'utf8' });
cli('project', '学习信息物理系统', ...Array.from({ length: 5 }, (_, i) => `学习信息物理系统的第${i + 1}章`));
await writeFile(resolve(dir, '.welcome_shown'), '1');
const processTerminal = pty.spawn(process.execPath, ['dist-node/cli.js'], { name: 'xterm-256color', cols: 132, rows: 32, cwd: root, env: { ...process.env, ATD_HOME: dir, ATD_LANG: 'zh', FORCE_COLOR: '1' } });
let backlog = '';
let stream;
processTerminal.onData(data => { if (stream) stream.write(`data: ${JSON.stringify(data)}\n\n`); else backlog += data; });
const html = '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/xterm.css"><style>body{margin:0;padding:24px;background:#20232b}#terminal{width:1200px}</style><div id="terminal"></div><script src="/xterm.js"></script><script>window.term=new Terminal({cols:132,rows:32,fontSize:14,fontFamily:"Cascadia Mono,Microsoft YaHei,monospace",theme:{background:"#20232b",foreground:"#d6d9e0"},allowProposedApi:true});term.open(document.getElementById("terminal"));new EventSource("/events").onmessage=event=>term.write(JSON.parse(event.data));</script>';
const js = await readFile(require.resolve('@xterm/xterm'));
const css = await readFile(resolve(require.resolve('@xterm/xterm'), '../../css/xterm.css'));
const server = createServer((request, response) => {
  if (request.url === '/events') { response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }); stream = response; if (backlog) { stream.write(`data: ${JSON.stringify(backlog)}\n\n`); backlog = ''; } return; }
  const item = request.url === '/xterm.js' ? [js, 'text/javascript'] : request.url === '/xterm.css' ? [css, 'text/css'] : [html, 'text/html'];
  response.writeHead(200, { 'Content-Type': item[1] }); response.end(item[0]);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1250, height: 720 }, deviceScaleFactor: 1 });
const frame = () => page.evaluate(() => Array.from({ length: window.term.rows }, (_, i) => window.term.buffer.active.getLine(i)?.translateToString(true) ?? '').join('\n'));
const wait = text => page.waitForFunction(text => Array.from({ length: window.term.rows }, (_, i) => window.term.buffer.active.getLine(i)?.translateToString(true) ?? '').join('\n').includes(text), text);
const command = async text => { processTerminal.write(`:${text}`); await wait(`:${text}`); processTerminal.write('\r'); await wait('＋ 添加任务'); };
const shot = name => page.screenshot({ path: `work/tui-review/${name}.png` });
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await wait('第1章'); await shot('tui-project');
  processTerminal.write('j'); await sleep(120); processTerminal.write('d');
  await sleep(300); await shot('tui-project-animation');
  await wait('完成：学习信息物理系统的第1章'); await sleep(800);
  assert.ok((await frame()).includes('第2章'));
  await shot('tui-project-next');
  cli('add', '缴纳学费 今天 高 @none', '整理读书笔记 中 @none', '散步 @none', '提交报告 after:整理读书笔记 @none', '等待快递 ~2099-01-01 @none');
  processTerminal.write('r'); await sleep(350);
  await command('gtd'); await wait('最多 2 件'); await sleep(1000);
  await shot('tui-gtd');
  let contents = await frame(); assert.ok(contents.includes('缴纳学费')); assert.ok(!contents.includes('提交报告')); assert.ok(!contents.includes('等待快递'));
  processTerminal.write('d'); await wait('完成：缴纳学费'); await sleep(800);
  await shot('tui-gtd-next');
  contents = await frame(); assert.ok(!contents.includes('缴纳学费 今天')); assert.ok(contents.includes('第2章') || contents.includes('整理读书笔记'));
  await writeFile(resolve(dir, 'reading.js'), 'function recommend(tasks) { return tasks.filter(task => task.title.includes("章") || task.title.includes("笔记")).map(task => task.id); }');
  await command('script reading.js'); await sleep(350);
  await shot('tui-script'); contents = await frame(); assert.ok(!contents.includes('散步')); assert.ok(contents.includes('第2章'));
  await writeFile(resolve(dir, 'reading.js'), 'function recommend(tasks) { return tasks.filter(task => task.title.includes("笔记")).map(task => task.id); }');
  processTerminal.write('r');
  await page.waitForFunction(() => {
    const text = Array.from({ length: window.term.rows }, (_, i) => window.term.buffer.active.getLine(i)?.translateToString(true) ?? '').join('\n');
    return text.includes('整理读书笔记') && !text.includes('第2章');
  });
  contents = await frame(); assert.ok(contents.includes('整理读书笔记')); assert.ok(!contents.includes('第2章'));
  await command('list'); await command('script-list on');
  await page.waitForFunction(() => {
    const text = Array.from({ length: window.term.rows }, (_, i) => window.term.buffer.active.getLine(i)?.translateToString(true) ?? '').join('\n');
    return text.includes('整理读书笔记') && !text.includes('学习信息物理系统');
  });
  contents = await frame(); assert.ok(contents.includes('整理读书笔记')); assert.ok(!contents.includes('学习信息物理系统'));
  await shot('tui-script-list');
  await writeFile('work/tui-review/report.json', JSON.stringify({ checks: ['real Windows PTY', 'project list', 'strike and replacement', 'gtd', 'stream replenishment', 'dependency gating', 'external script file', 'reload edited script without source changes', 'script list ordering'] }, null, 2));
  console.log('TUI 项目、GTD 与独立脚本文件验收通过');
} catch (error) {
  await writeFile('work/tui-review/failure.txt', await frame()); await shot('failure'); throw error;
} finally { processTerminal.kill(); await browser.close(); stream?.end(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
