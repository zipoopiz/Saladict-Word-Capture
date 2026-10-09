// [DEBUG] 诊断回路：无头浏览器驱动夹具页 + 注入 userscript（GM stub），模拟划选 2 词后断言「＋ 收录短语」浮标出现且可点击。
// 双场景回归：
//   clean   = 普通页面，无任何拦截
//   blocked = 注入与"解除复制"书签完全相同的拦截器（documentElement 捕获层对 mousedown/mouseup/mousemove 等
//             stopPropagation + stopImmediatePropagation）——复现 fanfiction.net 症状：挂 document 冒泡层的
//             mouseup 触发器收不到事件；修复后触发器挂 window 捕获层（路径第一站）应免疫。
// 用法：node tests/debug/phrase-repro.mjs [url]   （退出码 0=两场景均绿；1=任一场景红）
import fs from 'node:fs';
import { chromium } from 'playwright-core';

const EXE = '/root/.cache/ms-playwright/chromium_headless_shell-1148/chrome-linux/headless_shell';
const src = fs.readFileSync(new URL('../../saladict-word-capture.user.js', import.meta.url), 'utf8');
const fixtureUrl = new URL('./phrase-fixture.html', import.meta.url).href;

const browser = await chromium.launch({ executablePath: EXE, args: ['--no-sandbox'] });

async function runScenario(name, blocked) {
  console.log(`\n===== 场景 ${name}${blocked ? '（注入书签拦截器）' : ''} =====`);
  const page = await browser.newPage();
  page.on('console', (m) => console.log(`[${name}]`, m.type(), m.text()));
  page.on('pageerror', (e) => console.log(`[${name}][pageerror]`, e.message));

  await page.addInitScript(`
    const store = {};
    window.GM_getValue = (k, d) => (k in store ? store[k] : d);
    window.GM_setValue = (k, v) => { store[k] = v; };
    window.GM_deleteValue = (k) => { delete store[k]; };
    window.GM_registerMenuCommand = () => {};
    window.GM_addStyle = (css) => { const s = document.createElement('style'); s.textContent = css; (document.head || document.documentElement).appendChild(s); };
    window.GM_xmlhttpRequest = (opts) => { setTimeout(() => opts.onerror && opts.onerror(new Error('offline-stub')), 10); };
    ` + src);

  await page.goto(process.argv[2] || fixtureUrl, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch((e) => console.log('[nav]', e.message));
  await page.waitForTimeout(3000); // 等脚本初始化 + SPA 渲染

  // 模拟"解除复制"书签：脚本已加载、用户手动触发后再注入拦截器（与真实时序一致）
  if (blocked) {
    await page.evaluate(() => {
      const t = (e) => { e.stopPropagation(); e.stopImmediatePropagation && e.stopImmediatePropagation(); };
      ['copy', 'cut', 'contextmenu', 'selectstart', 'mousedown', 'mouseup', 'mousemove']
        .forEach((ty) => document.documentElement.addEventListener(ty, t, { capture: true }));
    });
  }

  // 真实页面：找正文段落，划选其中 2 个相邻英文词
  const result = await page.evaluate(() => {
    const paras = [...document.querySelectorAll('p, .Comment, [data-testid="comment"], shreddit-comment p, .md p')]
      .filter((p) => p.offsetParent !== null && /^[A-Za-z].{40,}/.test(p.textContent.trim()));
    const p = paras[0];
    if (!p) return { error: 'no candidate paragraph', paras: paras.length };
    // 找到含两个相邻英文词的文本节点
    let tn = null, s = -1, e = -1;
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode());) {
      const m = /\b([a-z]{3,8})\s+([a-z]{2,8})\b/i.exec(n.nodeValue);
      if (m) { tn = n; s = m.index; e = m.index + m[0].length; break; }
    }
    if (!tn) return { error: 'no text node with 2 words' };
    const range = document.createRange();
    range.setStart(tn, s);
    range.setEnd(tn, e);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const el = tn.parentElement;
    const r = range.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: r.left + 5, clientY: r.top + 5 }));
    return { selected: sel.toString(), host: location.host };
  });

  const verdict = await page.evaluate(() => {
    const btn = document.querySelector('.swc-phbtn');
    const r = btn ? btn.getBoundingClientRect() : null;
    return { found: !!btn, text: btn ? btn.textContent : null, x: r ? r.left + r.width / 2 : 0, y: r ? r.top + r.height / 2 : 0 };
  });

  console.log('result:', JSON.stringify(result));
  console.log('btn appeared:', JSON.stringify({ found: verdict.found, text: verdict.text }));

  // 模拟真实用户点击浮标（原生鼠标事件：mousedown -> mouseup -> click），断言短语弹层打开
  let popupOpened = null;
  if (verdict.found) {
    await page.mouse.click(verdict.x, verdict.y, { delay: 120 }); // 真实手指按下-松开间隔
    await page.waitForTimeout(400);
    popupOpened = await page.evaluate(() => {
      const pop = document.querySelector('.swc-popup');
      return { opened: !!pop, btnStillThere: !!document.querySelector('.swc-phbtn') };
    });
    console.log('after click:', JSON.stringify(popupOpened));
  }

  await page.close();
  return { found: verdict.found, opened: !!(popupOpened && popupOpened.opened) };
}

const clean = await runScenario('clean', false);
const blocked = await runScenario('blocked', true);
await browser.close();

console.log('\nverdict:', JSON.stringify({ clean, blocked }));
if (clean.found && clean.opened && blocked.found && blocked.opened) {
  console.log('GREEN: 两场景下浮标均出现且点击后弹层正常打开');
} else {
  console.log('RED: 存在场景浮标未出现或点击后弹层未打开（用户症状）');
  process.exit(1);
}
