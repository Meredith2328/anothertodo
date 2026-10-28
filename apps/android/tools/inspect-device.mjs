import { chromium } from 'playwright';
import { writeFile } from 'node:fs/promises';
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts()[0].pages()[0];
await page.screenshot({ path: 'test-results/current.png' });
const result = await page.evaluate(() => ({
  viewport: { width: innerWidth, height: innerHeight, visual: { width: visualViewport.width, height: visualViewport.height, top: visualViewport.offsetTop } },
  dialogs: [...document.querySelectorAll('dialog, #dialog-content, dialog button')].map(node => {
    const rect = node.getBoundingClientRect();
    return { text: node.textContent.slice(0, 40), rect: rect.toJSON(), scroll: node.scrollTop, hit: document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.outerHTML.slice(0, 100) };
  }),
  state: JSON.parse(Native.invoke('load', '{}')),
  text: document.body.innerText,
}));
await writeFile('test-results/current.json', JSON.stringify(result, null, 2));
console.log(JSON.stringify({ viewport: result.viewport, dialogs: result.dialogs }));
await browser.close();
