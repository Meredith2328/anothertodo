import { chromium } from 'playwright';
import { XMLParser } from 'fast-xml-parser';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8' }).trim();
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '' });
const nodes = value => {
  if (!value || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap(nodes);
  return [...(value.bounds ? [value] : []), ...Object.values(value).filter(item => typeof item === 'object').flatMap(nodes)];
};
const snapshot = () => { adb('shell', 'uiautomator', 'dump', '/sdcard/atd-files.xml'); return nodes(parser.parse(adb('shell', 'cat', '/sdcard/atd-files.xml'))); };
const tap = async predicate => {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const node = snapshot().find(predicate);
    if (node) { const values = node.bounds.match(/\d+/g).map(Number); adb('shell', 'input', 'tap', String(Math.floor((values[0] + values[2]) / 2)), String(Math.floor((values[1] + values[3]) / 2))); return; }
    await setTimeout(300);
  }
  throw new Error('文件选择界面未找到指定控件');
};
adb('forward', 'tcp:9223', `localabstract:webview_devtools_remote_${adb('shell', 'pidof', 'io.anothertodo.mobile')}`);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts()[0].pages()[0];
try {
  if (await page.locator('dialog[open]').count()) await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '导出', exact: true }).click();
  await page.getByRole('button', { name: '保存导出文件', exact: true }).click();
  await tap(node => /^(SAVE|保存)$/i.test(node.text));
  if (snapshot().some(node => /^Replace$/i.test(node.text))) await tap(node => /^Replace$/i.test(node.text));
  await page.waitForFunction(() => document.getElementById('notice').textContent === '文件已导出');
  const exported = adb('shell', 'ls', '/sdcard/Download').split(/\r?\n/).filter(name => name.startsWith('anothertodo-') && name.endsWith('.json')).at(-1);
  assert.ok(exported);
  adb('pull', `/sdcard/Download/${exported}`, 'test-results/exported-backup.json');
  const backup = JSON.parse(await readFile('test-results/exported-backup.json', 'utf8'));
  assert.equal(backup.format, 'anothertodo-backup-v1'); assert.ok(backup.tasks.length > 0); assert.ok(Array.isArray(backup.archive));
  assert.equal('token' in backup, false);
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  const incoming = { id: 'native-file-import', title: '系统文件导入验收', status: 'todo', tags: [], notes: '通过 Android 文件选择器导入', reminders: [], entry: new Date().toISOString(), modified: new Date().toISOString() };
  await writeFile('test-results/import.json', JSON.stringify([incoming]));
  adb('push', 'test-results/import.json', '/sdcard/Download/atd-file-import.json');
  adb('shell', 'am', 'broadcast', '-a', 'android.intent.action.MEDIA_SCANNER_SCAN_FILE', '-d', 'file:///sdcard/Download/atd-file-import.json');
  await page.locator('#content').getByRole('button', { name: '导入', exact: true }).click();
  await page.getByRole('button', { name: '选择文件', exact: true }).click();
  await tap(node => node['content-desc'] === 'Show roots');
  await tap(node => node.text === 'Downloads');
  await tap(node => node.text === 'atd-file-import.json');
  await page.getByLabel('导入数据').waitFor();
  await page.waitForFunction(() => document.querySelector('[aria-label="导入数据"]').value.includes('native-file-import'));
  await page.locator('dialog').getByRole('button', { name: '导入', exact: true }).click();
  await page.locator('dialog[open]').waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '任务', exact: true }).click();
  await page.locator('#content').getByText(incoming.title, { exact: true }).waitFor();
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '导出', exact: true }).click();
  await page.getByRole('button', { name: '分享导出文件', exact: true }).click();
  const shareDeadline = Date.now() + 10000;
  while (!snapshot().some(node => node.text === 'Sharing 1 file' || node.text === 'Quick Share' || node.text === 'Nearby Share')) {
    if (Date.now() > shareDeadline) throw new Error('系统分享界面未打开');
    await setTimeout(300);
  }
  const activity = adb('shell', 'dumpsys', 'activity', 'activities');
  assert.ok(activity.includes('ChooserActivity') || activity.includes('IntentResolver'));
  adb('shell', 'input', 'keyevent', 'KEYCODE_BACK');
  await writeFile('test-results/files.json', JSON.stringify({ checks: ['Android document creation', 'backup contents', 'Android document selection', 'JSON import', 'share content provider'], exported, tasks: backup.tasks.length }, null, 2));
  console.log('Android 系统文件导入导出验收通过');
} finally { await browser.close(); }
