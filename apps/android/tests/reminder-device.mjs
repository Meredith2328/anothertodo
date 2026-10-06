import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8' }).trim();
const packageId = 'io.anothertodo.mobile';
const connect = async () => {
  const pid = adb('shell', 'pidof', packageId);
  const port = 12000 + Number(pid) % 40000;
  adb('forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  return { browser, page: browser.contexts()[0].pages()[0] };
};
let { browser, page } = await connect();
if (await page.locator('dialog[open]').count()) await page.getByRole('button', { name: '关闭', exact: true }).click();
await page.getByRole('button', { name: '任务', exact: true }).click();
await page.getByRole('button', { name: '添加任务', exact: true }).click();
await page.getByLabel('一行一个任务').fill('系统后台提醒验收 @none');
await page.getByRole('button', { name: '检查任务', exact: true }).click();
await page.getByRole('button', { name: '添加 1 个任务', exact: true }).click();
await page.getByText('系统后台提醒验收', { exact: true }).click();
await page.getByText('提醒 · 0', { exact: true }).click();
await page.getByRole('button', { name: '添加提醒', exact: true }).click();
const alarmTime = await page.evaluate(() => {
  const now = new Date(); now.setMinutes(now.getMinutes() + 1); now.setSeconds(0, 0);
  const pad = value => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
});
await page.getByLabel('提醒时间').fill(alarmTime);
await page.getByRole('button', { name: '关闭', exact: true }).click();
const snapshot = await page.evaluate(() => JSON.parse(Native.invoke('load', '{}')).value);
const task = snapshot.state.tasks.find(item => item.title === '系统后台提醒验收');
assert.equal(task.reminders[0].fired, false);
assert.ok(adb('shell', 'dumpsys', 'alarm').includes(packageId));
adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
await browser.close();
adb('shell', 'am', 'kill', packageId);
const deadline = Date.now() + 75000;
let delivered = false;
while (Date.now() < deadline) {
  await setTimeout(1000);
  const notifications = adb('shell', 'dumpsys', 'notification', '--noredact');
  if (notifications.includes('系统后台提醒验收')) { delivered = true; break; }
}
assert.ok(delivered, 'Android AlarmManager 应当在后台显示系统通知');
adb('shell', 'am', 'start', '-W', '-n', `${packageId}/.MainActivity`);
({ browser, page } = await connect());
await page.getByRole('button', { name: '添加任务', exact: true }).waitFor();
const result = await page.evaluate(() => JSON.parse(Native.invoke('load', '{}')).value);
const notified = result.state.tasks.find(item => item.id === task.id);
assert.equal(notified.reminders[0].fired, true);
assert.equal(notified.reminders[0].attempts, 1);
await writeFile('test-results/reminders.json', JSON.stringify({ checks: ['UI reminder editor', 'exact alarm registration', 'background delivery after process kill', 'system notification', 'persisted fired state'], taskId: task.id, alarmTime, reminder: notified.reminders[0] }, null, 2));
await browser.close();
console.log('Android 后台系统提醒验收通过');
