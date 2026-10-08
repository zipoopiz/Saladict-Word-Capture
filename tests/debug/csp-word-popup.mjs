// [DEBUG] 回归回路：模拟 YouTube 的 Trusted Types CSP（require-trusted-types-for 'script'），
// 单击单词断言释义弹窗能正常创建。用法：node tests/debug/csp-word-popup.mjs
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const EXE = '/root/.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell';
const src = fs.readFileSync(new URL('../../saladict-word-capture.user.js', import.meta.url), 'utf8');
const fixtureUrl = new URL('./phrase-fixture.html', import.meta.url).href;
const withCsp = process.argv.includes('--no-csp') === false;

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.text().includes('TrustedHTML')) errors.push(m.text()); });
page.on('pageerror', (e) => errors.push(e.message));

if (withCsp) {
  // Trusted Types 指令只能经 HTTP 头交付，用 route.fulfill 注入
  await page.route('**/*', (route) => route.fulfill({
    path: new URL(route.request().url()).pathname,
    headers: { 'Content-Security-Policy': "require-trusted-types-for 'script'" }
  }));
}

await page.addInitScript(`
  const store = {};
  window.GM_getValue = (k, d) => (k in store ? store[k] : d);
  window.GM_setValue = (k, v) => { store[k] = v; };
  window.GM_deleteValue = (k) => { delete store[k]; };
  window.GM_registerMenuCommand = () => {};
  window.GM_addStyle = (css) => { const s = document.createElement('style'); s.textContent = css; (document.head || document.documentElement).appendChild(s); };
  window.GM_xmlhttpRequest = (opts) => { setTimeout(() => opts.onerror && opts.onerror(new Error('offline-stub')), 10); };
  ` + src);

await page.goto(fixtureUrl);
await page.waitForTimeout(400);

// 单击 "assignment"（合成 click，坐标落在词上，走 wordAtPoint -> showPopup -> innerHTML）
const clicked = await page.evaluate(() => {
  const p = document.getElementById('target');
  const tn = p.firstChild;
  const s = tn.nodeValue.indexOf('assignment');
  const range = document.createRange();
  range.setStart(tn, s); range.setEnd(tn, s + 'assignment'.length);
  const r = range.getBoundingClientRect();
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  p.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y }));
  return { x, y };
});
await page.waitForTimeout(500);

const verdict = await page.evaluate(() => {
  const pop = document.querySelector('.swc-popup');
  return { opened: !!pop, word: pop ? (pop.querySelector('b') || {}).textContent : null };
});

console.log('clicked:', JSON.stringify(clicked));
console.log('verdict:', JSON.stringify(verdict));
console.log('tt errors:', errors.length ? errors.slice(0, 3) : '(none)');
await browser.close();
if (verdict.opened && !errors.some((e) => e.includes('TrustedHTML'))) {
  console.log('GREEN: CSP 下释义弹窗正常创建');
} else {
  console.log('RED: CSP 下弹窗创建失败（用户症状）');
  process.exit(1);
}
