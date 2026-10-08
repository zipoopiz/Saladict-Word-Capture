// [DEBUG] 回归回路：复刻 fanfiction.net 两个特征——①摘要正文在 div.z-list（无 p 祖先），
// ②CSP trusted-types 白名单且站点自建 default policy。划选短语断言浮标与弹窗结构完好。
// 用法：node tests/debug/ff-block-repro.mjs  （可传真实 URL，但会被 Cloudflare 拦）
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const EXE = '/root/.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell';
const src = fs.readFileSync(new URL('../../saladict-word-capture.user.js', import.meta.url), 'utf8');

// 站点自建 default policy（模拟 fanfiction），须在页面脚本期执行；userscript 注入早于它，验证惰性取 policy
const FIXTURE_HTML = `<!doctype html><html><body>
<script>trustedTypes.createPolicy('default', { createHTML: (s) => s });</script>
<div class="z-list" style="width:640px;padding:16px;font:15px/1.6 serif;">
Naruto Uzumaki carried the burden of the hidden village without complaint. Sighing softly he watched the sunset fade behind the mountains.
</div></body></html>`;

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });
const page = await browser.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error' && m.text().includes('TrustedType')) errors.push(m.text()); });

await page.route('**/*', (route) => route.fulfill({
  body: FIXTURE_HTML, contentType: 'text/html',
  headers: { 'Content-Security-Policy': "trusted-types nAZtB7 default" }
}));

await page.addInitScript(`
  const store = {};
  window.GM_getValue = (k, d) => (k in store ? store[k] : d);
  window.GM_setValue = (k, v) => { store[k] = v; };
  window.GM_deleteValue = (k) => { delete store[k]; };
  window.GM_registerMenuCommand = () => {};
  window.GM_addStyle = (css) => { const s = document.createElement('style'); s.textContent = css; (document.head || document.documentElement).appendChild(s); };
  window.GM_xmlhttpRequest = (opts) => { setTimeout(() => opts.onerror && opts.onerror(new Error('offline-stub')), 10); };
  ` + src);

await page.goto('https://example.test/anime/Naruto/');
await page.waitForTimeout(400);

// 在 div.z-list（无 p 祖先）里划选 "burden of"
const result = await page.evaluate(() => {
  const z = document.querySelector('.z-list');
  const tn = z.firstChild;
  const s = tn.nodeValue.indexOf('burden of');
  const range = document.createRange();
  range.setStart(tn, s); range.setEnd(tn, s + 'burden of'.length);
  const sel = window.getSelection();
  sel.removeAllRanges(); sel.addRange(range);
  const r = range.getBoundingClientRect();
  tn.parentElement.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 }));
  return { selected: sel.toString(), parentTag: tn.parentElement.tagName };
});
await page.waitForTimeout(400);

const verdict = await page.evaluate(() => {
  const btn = document.querySelector('.swc-phbtn');
  if (btn) btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  return { btn: !!btn, text: btn ? btn.textContent : null };
});
await page.waitForTimeout(500);

const popup = await page.evaluate(() => {
  const pop = document.querySelector('.swc-popup');
  return { opened: !!pop, hasButton: !!(pop && pop.querySelector('button[data-swc-add]')), raw: pop ? pop.textContent.slice(0, 40) : null };
});

console.log('result:', JSON.stringify(result));
console.log('verdict:', JSON.stringify(verdict));
console.log('popup:', JSON.stringify(popup));
console.log('tt errors:', errors.length ? errors : '(none)');
await browser.close();
// createPolicy('swc') 被白名单拒绝是预期内的（浏览器行为，退回 defaultPolicy 兜底）；
// 其余 TrustedHTML/innerHTML 违规才算失败
const badErrors = errors.filter((e) => !e.includes("named 'swc'"));
if (result.selected && verdict.btn && popup.opened && popup.hasButton && badErrors.length === 0) {
  console.log('GREEN: div 摘要划选浮标出现，且白名单 CSP 下弹窗结构完好');
} else {
  console.log('RED: fanfiction 特征场景失败');
  process.exit(1);
}
