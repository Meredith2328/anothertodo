import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';

const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8' }).trim();
const pkg = 'io.anothertodo.mobile';
const connect = async () => {
  const pid = adb('shell', 'pidof', pkg), port = 12000 + Number(pid) % 40000;
  adb('forward', `tcp:${port}`, `localabstract:webview_devtools_remote_${pid}`);
  const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
  const page = browser.contexts()[0].pages()[0]; await page.waitForFunction(() => typeof window.nativeBack === 'function'); return { browser, page };
};
let { browser, page } = await connect();
try {
  await page.locator('#navigation').getByRole('button', { name: '任务', exact: true }).click();
  await page.getByRole('button', { name: '添加任务', exact: true }).click();
  await page.getByLabel('一行一个任务').fill('提醒前置条件 @none\n依赖释放后的系统提醒 after:提醒前置条件 @none');
  await page.getByRole('button', { name: '检查任务', exact: true }).click();
  await page.getByRole('button', { name: '添加 2 个任务', exact: true }).click();
  await page.locator('#content').getByText('依赖释放后的系统提醒', { exact: true }).click();
  await page.getByText('提醒 · 0', { exact: true }).click();
  await page.getByRole('button', { name: '添加提醒', exact: true }).click();
  const deadline = await page.evaluate(() => { const date = new Date(); date.setMinutes(date.getMinutes() + 1); date.setSeconds(0,0); return date.getTime(); });
  const at = await page.evaluate(time => { const date = new Date(time); const pad = value => String(value).padStart(2,'0'); return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`; }, deadline);
  await page.getByLabel('提醒时间').fill(at); await page.getByRole('button', { name: '关闭', exact: true }).click();
  adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
  await browser.close(); adb('shell', 'am', 'kill', pkg);
  while (Date.now() < deadline + 2000) await setTimeout(1000);
  assert.ok(!adb('shell', 'dumpsys', 'notification', '--noredact').includes('依赖释放后的系统提醒'));
  adb('shell', 'am', 'start', '-W', '-n', `${pkg}/.MainActivity`);
  ({ browser, page } = await connect());
  await page.getByRole('button', { name: '完成 提醒前置条件', exact: true }).click();
  const end = Date.now() + 20000;
  let delivered = false;
  while (Date.now() < end) { await setTimeout(1000); if (adb('shell', 'dumpsys', 'notification', '--noredact').includes('依赖释放后的系统提醒')) { delivered = true; break; } }
  assert.ok(delivered, '完成依赖后，已经到期的提醒需要真实投递');
  await writeFile('test-results/dependency-reminder.json', JSON.stringify({ checks: ['blocked reminder withheld', 'process terminated while blocked', 'prerequisite completion releases alarm', 'real system notification'], at }, null, 2));
  console.log('Android 依赖阻塞与系统提醒释放验收通过');
} finally { await browser.close(); }
