import { SMTPServer } from 'smtp-server';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { setTimeout } from 'node:timers/promises';
import { parse, stringify } from 'smol-toml';

const messages = [];
const server = new SMTPServer({
  disabledCommands: ['STARTTLS'],
  onAuth(auth, session, callback) {
    assert.equal(auth.username, 'android-smtp'); assert.equal(auth.password, 'device-mail-password'); callback(null, { user: auth.username });
  },
  onData(stream, session, callback) {
    const chunks = []; stream.on('data', chunk => chunks.push(chunk));
    stream.on('end', () => { messages.push({ envelope: session.envelope, content: Buffer.concat(chunks).toString('utf8') }); callback(); });
  },
});
await new Promise(resolve => server.listen(9848, '127.0.0.1', resolve));
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8' }).trim();
adb('reverse', 'tcp:9848', 'tcp:9848');
adb('forward', 'tcp:9223', `localabstract:webview_devtools_remote_${adb('shell', 'pidof', 'io.anothertodo.mobile')}`);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts()[0].pages()[0];
try {
  if (await page.locator('dialog[open]').count()) await page.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('button', { name: '更多', exact: true }).click();
  await page.getByRole('button', { name: '设置', exact: true }).click();
  await page.getByText('高级配置', { exact: true }).click();
  const config = parse(await page.getByLabel('完整配置 TOML').inputValue());
  config.email = { host: '127.0.0.1', port: 9848, ssl: false, user: 'android-smtp', password: 'device-mail-password', from: 'android@example.invalid', to: 'recipient@example.invalid' };
  await page.getByLabel('完整配置 TOML').fill(stringify(config));
  await page.getByRole('button', { name: '保存配置', exact: true }).click();
  await page.getByRole('button', { name: '任务', exact: true }).click();
  await page.getByRole('button', { name: '添加任务', exact: true }).click();
  await page.getByLabel('一行一个任务').fill('邮件提醒验收 @none >>正文包含中文');
  await page.getByRole('button', { name: '检查任务', exact: true }).click();
  await page.getByRole('button', { name: '添加 1 个任务', exact: true }).click();
  await page.getByText('邮件提醒验收', { exact: true }).click();
  await page.getByText('提醒 · 0', { exact: true }).click();
  await page.getByRole('button', { name: '添加提醒', exact: true }).click();
  const at = await page.evaluate(() => {
    const now = new Date(); now.setMinutes(now.getMinutes() + 1); now.setSeconds(0, 0);
    const pad = value => String(value).padStart(2, '0'); return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;
  });
  await page.getByLabel('提醒时间').fill(at); await page.getByLabel('通知方式').fill('email');
  await page.getByRole('button', { name: '关闭', exact: true }).click();
  adb('shell', 'input', 'keyevent', 'KEYCODE_HOME');
  const deadline = Date.now() + 75000;
  while (!messages.length && Date.now() < deadline) await setTimeout(1000);
  assert.equal(messages.length, 1, '真实 SMTP 服务器应收到邮件');
  assert.equal(messages[0].envelope.mailFrom.address, 'android@example.invalid');
  assert.equal(messages[0].envelope.rcptTo[0].address, 'recipient@example.invalid');
  assert.ok(messages[0].content.includes('Content-Type: text/plain; charset=UTF-8'));
  await writeFile('test-results/mail.json', JSON.stringify({ checks: ['TOML mail settings', 'real SMTP authentication', 'background alarm email', 'MIME text encoding', 'recipient envelope'], messages }, null, 2));
  console.log('Android 邮件提醒真实 SMTP 验收通过');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); adb('shell', 'am', 'start', '-W', '-n', 'io.anothertodo.mobile/.MainActivity'); }
