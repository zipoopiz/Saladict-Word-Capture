// ==UserScript==
// @name         Saladict Word Capture（生词高亮→Saladict Word 卡）
// @namespace    swc.local
// @version      0.3.3
// @description  网页阅读时高亮生词，点击收录单词+上下文，读完后一键批量生成 Anki 卡片（Saladict Word 模型，自动带有道美音发音）
// @author       local
// @match        *://*/*
// @exclude      *://127.0.0.1:8765/*
// @exclude      *://localhost:8765/*
// @grant        GM_xmlhttpRequest
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @noframes
// @connect      127.0.0.1
// @connect      localhost
// @connect      dict.youdao.com
// @connect      api.dictionaryapi.dev
// @connect      *
// ==/UserScript==

(function () {
  'use strict';

  //<<CORE
  // ===== 纯逻辑区（不依赖 GM/DOM，构建脚本会抽出来跑单元测试） =====

  const IRREGULAR = {
    am: 'be', is: 'be', are: 'be', was: 'be', were: 'be', been: 'be', being: 'be',
    has: 'have', had: 'have', does: 'do', did: 'do', done: 'do',
    goes: 'go', went: 'go', gone: 'go',
    said: 'say', made: 'make', got: 'get', gotten: 'get', took: 'take', taken: 'take',
    came: 'come', saw: 'see', seen: 'see', knew: 'know', known: 'know',
    thought: 'think', found: 'find', gave: 'give', given: 'give', told: 'tell',
    became: 'become', left: 'leave', felt: 'feel', brought: 'bring',
    began: 'begin', begun: 'begin', kept: 'keep', held: 'hold',
    wrote: 'write', written: 'write', stood: 'stand', heard: 'hear',
    meant: 'mean', met: 'meet', ran: 'run', paid: 'pay', sat: 'sit',
    spoke: 'speak', spoken: 'speak', lay: 'lie', lain: 'lie', led: 'lead',
    grew: 'grow', grown: 'grow', lost: 'lose', fell: 'fall', fallen: 'fall',
    sent: 'send', built: 'build', drew: 'draw', drawn: 'draw',
    broke: 'break', broken: 'break', spent: 'spend', rose: 'rise', risen: 'rise',
    drove: 'drive', driven: 'drive', bought: 'buy', wore: 'wear', worn: 'wear',
    chose: 'choose', chosen: 'choose', sought: 'seek', fought: 'fight',
    hid: 'hide', hidden: 'hide', won: 'win', taught: 'teach', caught: 'catch',
    sang: 'sing', sung: 'sing', fed: 'feed', dealt: 'deal', struck: 'strike',
    swung: 'swing', flew: 'fly', flown: 'fly', slept: 'sleep', blew: 'blow',
    blown: 'blow', woke: 'wake', woken: 'wake', swam: 'swim', swum: 'swim',
    froze: 'freeze', frozen: 'freeze', stole: 'steal', stolen: 'steal',
    forgot: 'forget', forgotten: 'forget', rode: 'ride', ridden: 'ride',
    shook: 'shake', shaken: 'shake', swept: 'sweep', wept: 'weep', ate: 'eat',
    men: 'man', women: 'woman', children: 'child', feet: 'foot', teeth: 'tooth',
    mice: 'mouse', people: 'person', geese: 'goose', oxen: 'ox',
    knives: 'knife', wives: 'wife', lives: 'life', leaves: 'leaf',
    wolves: 'wolf', shelves: 'shelf', thieves: 'thief', halves: 'half',
    loaves: 'loaf', potatoes: 'potato', tomatoes: 'tomato', heroes: 'hero',
    analyses: 'analysis', crises: 'crisis', phenomena: 'phenomenon',
    criteria: 'criterion', data: 'datum', media: 'medium'
  };

  // 屈折还原：宽松生成候选词形，用词表成员资格决定真伪
  function genCandidates(word) {
    const w = String(word).toLowerCase().replace(/’/g, "'");
    const out = new Set([w]);
    if (IRREGULAR[w]) out.add(IRREGULAR[w]);
    if (/ies$/.test(w)) { out.add(w.slice(0, -3) + 'y'); out.add(w.slice(0, -3) + 'ie'); }
    if (/ves$/.test(w)) { out.add(w.slice(0, -3) + 'f'); out.add(w.slice(0, -3) + 'fe'); }
    if (/(x|z|ch|sh|ss)es$/.test(w)) out.add(w.slice(0, -2));
    if (/es$/.test(w)) out.add(w.slice(0, -2));
    if (/s$/.test(w) && !/ss$/.test(w)) out.add(w.slice(0, -1));
    if (/ed$/.test(w)) {
      out.add(w.slice(0, -2));       // stopped -> stopp
      out.add(w.slice(0, -1));       // loved  -> love
      out.add(w.slice(0, -2) + 'e'); // hated  -> hate
      out.add(w.slice(0, -3));       // stopped -> stop
    }
    if (/ing$/.test(w)) {
      const b = w.slice(0, -3);
      out.add(b); out.add(b + 'e'); out.add(b.slice(0, -1)); // running -> runn -> run
    }
    if (/er$/.test(w) || /est$/.test(w)) {
      const b = w.replace(/er$|est$/, '');
      out.add(b); out.add(b + 'e'); out.add(b.slice(0, -1));
    }
    if (/ly$/.test(w)) out.add(w.slice(0, -2));
    if (/ily$/.test(w)) out.add(w.slice(0, -3) + 'y');
    for (const c of [...out]) {
      const m = /^(.+[^aeiou])\1$/.exec(c);
      if (m) out.add(m[1]); // 双写辅音还原 stopp -> stop
    }
    return [...out].filter((x) => x.length >= 2).slice(0, 10);
  }

  // 个人生词 > 显式熟词 > 已收藏 > 频率表 > 生词
  // personalUnknown：用户在浮层里点了"其实不认识"的词，强制按生词处理
  function classifyToken(token, explicitKnown, saved, freq, personalUnknown) {
    const cands = genCandidates(token);
    if (cands.some((c) => personalUnknown.has(c))) return 'unknown';
    if (cands.some((c) => explicitKnown.has(c))) return 'known';
    if (cands.some((c) => saved.has(c))) return 'saved';
    if (cands.some((c) => freq.has(c))) return 'known';
    return 'unknown';
  }

  const ABBR = new Set(['mr', 'mrs', 'ms', 'dr', 'prof', 'vs', 'etc', 'eg', 'ie', 'al',
    'inc', 'ltd', 'co', 'corp', 'jr', 'sr', 'st', 'no', 'vol', 'fig', 'dept', 'univ',
    'approx', 'apt', 'est', 'min', 'max', 'cf', 'cit', 'ed', 'pp']);

  const CLOSING_CHARS = '"\')]}\u201d\u300d\u300f';

  // 返回 [{start, end}]，end 为exclusive
  function splitSentences(text) {
    const out = [];
    let start = 0;
    let i = 0;
    while (i < text.length) {
      const ch = text[i];
      if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== '…') { i++; continue; }
      let j = i;
      while (j + 1 < text.length && '.!?…'.includes(text[j + 1])) j++;
      let k = j + 1;
      while (k < text.length && CLOSING_CHARS.includes(text[k])) k++;
      if (ch === '.') {
        const before = text.slice(start, i);
        const m = /([A-Za-z.]+)$/.exec(before);
        const tok = m ? m[1].replace(/\./g, '').toLowerCase() : '';
        if (/\d$/.test(text.slice(start, i)) && /^\s*\d/.test(text.slice(k))) { i = k; continue; }
        if (ABBR.has(tok) || /^[A-Za-z]$/.test(tok)) { i = k; continue; }
      }
      const rest = text.slice(k);
      const nm = /^\s+/.exec(rest);
      if (!nm) { i = k; continue; }
      const after = rest.slice(nm[0].length);
      const fc = (after.match(/[\s]*["'"([【]?\s*(.)/) || [])[1] || '';
      if (ch === '.' && /[a-z]/.test(fc)) { i = k; continue; }
      out.push({ start, end: k });
      i = k;
      start = k;
    }
    if (start < text.length) out.push({ start, end: text.length });
    return out;
  }

  function findWordBounds(text, idx) {
    if (idx < 0 || idx >= text.length) return null;
    const re = /[A-Za-z][A-Za-z'’]*/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m.index <= idx && idx < m.index + m[0].length) {
        return { start: m.index, end: m.index + m[0].length };
      }
      if (m.index > idx) break;
    }
    return null;
  }

  // 从全文 clickIdx 处提取所在句子；过长时以词为中心截断
  function extractSentenceAt(text, idx, maxLen) {
    maxLen = maxLen || 320;
    const wb = findWordBounds(text, idx);
    if (!wb) return null;
    const word = text.slice(wb.start, wb.end);
    const sents = splitSentences(text);
    let s = sents.find((x) => x.start <= wb.start && wb.end <= x.end) ||
      sents.find((x) => wb.start >= x.start && wb.start <= x.end) ||
      { start: Math.max(0, wb.start - 200), end: Math.min(text.length, wb.end + 200) };
    let sent = text.slice(s.start, s.end);
    let w0 = wb.start - s.start;
    let w1 = wb.end - s.start;
    // 去掉跨句边界带来的首尾空白，并同步修正词偏移
    const leadWS = sent.length - sent.replace(/^\s+/, '').length;
    if (leadWS) { sent = sent.slice(leadWS); w0 -= leadWS; w1 -= leadWS; }
    const trailWS = sent.length - sent.replace(/\s+$/, '').length;
    if (trailWS) sent = sent.slice(0, sent.length - trailWS);
    let lead = '';
    if (sent.length > maxLen) {
      const from = Math.max(0, w0 - 120);
      lead = from > 0 ? '…' : '';
      const tailCut = from + maxLen < sent.length;
      sent = sent.slice(from, from + maxLen);
      if (tailCut) sent = sent.replace(/\s+\S*$/, '') + '…';
      w0 = w0 - from + lead.length;
      w1 = w1 - from + lead.length;
    }
    // 词在该句中的第几次出现（截断后重算，保证 cloze 挖中点击的那一个）
    const re = new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let occ = 0, m;
    while ((m = re.exec(sent)) !== null) {
      if (m.index >= w0) break;
      occ++;
      re.lastIndex = m.index + 1;
    }
    return { word, sentence: sent, occurrence: occ };
  }

  function clozeify(sentence, surface, occurrence) {
    const esc = surface.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp('\\b' + esc + '\\b', 'gi');
    const hits = [];
    let m;
    while ((m = re.exec(sentence)) !== null) {
      hits.push(m);
      re.lastIndex = m.index + 1;
    }
    const target = hits.length ? hits[Math.min(occurrence, hits.length - 1)]
      : (new RegExp(esc, 'i').exec(sentence));
    if (!target) return sentence;
    return sentence.slice(0, target.index) + '{{c1::' + target[0] + '}}' +
      sentence.slice(target.index + target[0].length);
  }

  function parseYoudaoEc(data) {
    const w = data && data.ec && data.ec.word && data.ec.word[0];
    if (!w) return null;
    const glosses = (w.trs || []).map((t) => {
      let i = t && t.tr && t.tr[0] && t.tr[0].l && t.tr[0].l.i;
      if (Array.isArray(i)) i = i.join('');
      return String(i || '').trim();
    }).filter(Boolean);
    return { phonetic: w.usphone || w.ukphone || '', glosses };
  }

  function parseFreeDict(data) {
    const e0 = Array.isArray(data) && data[0];
    if (!e0) return null;
    const glosses = [];
    (e0.meanings || []).slice(0, 3).forEach((m) => {
      const d = m.definitions && m.definitions[0];
      if (d && d.definition) glosses.push(m.partOfSpeech ? m.partOfSpeech + '. ' + d.definition : d.definition);
    });
    return { phonetic: (e0.phonetic || e0.phonetics && (e0.phonetics.find((p) => p.text) || {}).text || ''), glosses };
  }

  function safeFilename(word) {
    return 'SW_' + String(word).toLowerCase().replace(/[^a-z0-9]/g, '_').slice(0, 60) + '.mp3';
  }

  function hashStr(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(36);
  }

  function yyyymmdd(d) {
    const p = (n) => String(n).padStart(2, '0');
    return '' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  }

  function hostOf(url) {
    try { return new URL(url).host; } catch (e) { return ''; }
  }

  // 与现有 633 张卡的填写惯例对齐（Date=毫秒时间戳；Cloze 挖原样表面形式）
  // Audio 字段留空：addNote 的 audio 参数会把 [sound:..] 追加进该字段，预填会重复
  function buildNoteFields(item) {
    return {
      Date: String(item.dateAdded || Date.now()),
      Text: item.word,
      Translation: item.translation || '',
      Context: item.sentence || '',
      ContextCloze: item.cloze || '',
      Note: item.note || '',
      Title: item.title || '',
      Url: item.url || '',
      Favicon: item.favicon || '',
      Audio: item.audio || ''
    };
  }
  // ---- 云备份纯逻辑（WebDAV / S3 兼容） ----

  async function sha256Hex(data) {
    const buf = typeof data === 'string' ? new TextEncoder().encode(data) : data;
    const h = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function hmacRaw(keyBytes, msg) {
    const k = await crypto.subtle.importKey('raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    return new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(msg)));
  }

  function amzDateNow() {
    return new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  }

  function parseS3Endpoint(endpoint) {
    const u = new URL(endpoint);
    const path = u.pathname.replace(/\/+$/, '');
    if (path) return { host: u.hostname, bucket: path.slice(1), pathStyle: true };
    return { host: u.hostname, bucket: u.hostname.split('.')[0], pathStyle: false };
  }

  // 阿里 OSS 的 V4 签名要求 scope 里 service=oss、region=oss-cn-xxx（与 endpoint 一致）；
  // 其余 S3 兼容服务用标准 s3
  function s3RegionService(hostname, regionRaw) {
    const isOss = /(^|\.)oss-[a-z0-9-]+\.aliyuncs\.com$/.test(hostname || '');
    let region = String(regionRaw || '').trim() || 'us-east-1';
    if (isOss && /^cn-[a-z0-9-]+$/.test(region)) region = 'oss-' + region;
    return { region, service: isOss ? 'oss' : 's3' };
  }

  // AWS SigV4；s3Compat=true 时附加 x-amz-content-sha256（S3/OSS/R2 需要）
  async function sigv4Headers(opts) {
    const u = new URL(opts.url);
    const payloadHash = await sha256Hex(opts.body || '');
    const canonicalHeaders = 'host:' + u.hostname + '\n' +
      (opts.s3Compat ? 'x-amz-content-sha256:' + payloadHash + '\n' : '') +
      'x-amz-date:' + opts.amzDate + '\n';
    const signedHeaders = opts.s3Compat ? 'host;x-amz-content-sha256;x-amz-date' : 'host;x-amz-date';
    const canonicalRequest = [opts.method, u.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
    const dateStamp = opts.amzDate.slice(0, 8);
    const scope = dateStamp + '/' + opts.region + '/' + opts.service + '/aws4_request';
    const stringToSign = 'AWS4-HMAC-SHA256\n' + opts.amzDate + '\n' + scope + '\n' + await sha256Hex(canonicalRequest);
    let key = new TextEncoder().encode('AWS4' + opts.secretKey);
    for (const part of [dateStamp, opts.region, opts.service, 'aws4_request']) {
      key = await hmacRaw(key, part);
    }
    const sig = [...await hmacRaw(key, stringToSign)].map((b) => b.toString(16).padStart(2, '0')).join('');
    const auth = 'AWS4-HMAC-SHA256 Credential=' + opts.accessKey + '/' + scope +
      ', SignedHeaders=' + signedHeaders + ', Signature=' + sig;
    const headers = { 'x-amz-date': opts.amzDate, Authorization: auth };
    if (opts.s3Compat) headers['x-amz-content-sha256'] = payloadHash;
    return headers;
  }

  // 从 S3/W3C 错误 XML 里提取 Code 和 Message，便于 toast 展示
  function xmlErr(text) {
    const c = /<Code>([^<]+)<\/Code>/.exec(text || '');
    const m = /<Message>([^<]+)<\/Message>/.exec(text || '');
    return c ? c[1] + (m ? ': ' + m[1].trim().slice(0, 120) : '') : String(text || '').slice(0, 150);
  }

  function buildBackupDump(knownArr, savedArr, personalArr, queueArr, settings) {
    const s = Object.assign({}, settings || {});
    delete s.llmKey; // 密钥不上云
    return {
      app: 'swc', version: 1, exportedAt: new Date().toISOString(),
      known: knownArr, saved: savedArr, personalUnknown: personalArr,
      queue: queueArr, settings: s
    };
  }

  // 合并语义：词表取并集，队列按 id 去重追加，不触碰本机设置
  function mergeBackup(local, remote) {
    const mk = new Set(local.known), ms = new Set(local.saved), mp = new Set(local.personal);
    const r = remote || {};
    (r.known || []).forEach((w) => mk.add(w));
    (r.saved || []).forEach((w) => ms.add(w));
    (r.personalUnknown || []).forEach((w) => mp.add(w));
    const ids = new Set(local.queue.map((q) => q.id));
    const addedQueue = (r.queue || []).filter((q) => q && q.id && !ids.has(q.id));
    return {
      known: [...mk], saved: [...ms], personal: [...mp],
      queue: local.queue.concat(addedQueue),
      counts: {
        known: (r.known || []).length, saved: (r.saved || []).length,
        personal: (r.personalUnknown || []).length, queueAdded: addedQueue.length
      }
    };
  }
  //CORE>>

  // ===================== GM 工具 =====================

  const GMK = { settings: 'swc_settings', known: 'swc_known', saved: 'swc_saved', personal: 'swc_personal', queue: 'swc_queue' };

  const DEFAULT_SETTINGS = {
    inited: false,
    ankiUrl: 'http://127.0.0.1:8765',
    deckName: 'english_learning',
    // 原 'Saladict Word' 是 type=0 标准模型，当前 Anki 后端拒绝给它的字段写 {{c1::}}，
    // 故新卡使用逐字节克隆的真 cloze 模型（见 README）
    modelName: 'Saladict Word Cloze',
    freqCutoff: 8000,
    audioType: 2, // 2=美音 1=英音
    excludeSelector: '', // 匹配元素内的文字不扫描不收录，如 ".xgray, .sidebar"
    llmBase: '', llmKey: '', llmModel: '',
    cloudType: '', // ''|'webdav'|'s3'
    davUrl: '', davUser: '', davPass: '',
    s3Endpoint: '', s3Region: '', s3Key: '', s3Secret: '', s3Path: 'swc-backup.json',
    autoBackup: false
  };

  let settings = Object.assign({}, DEFAULT_SETTINGS, gmGet(GMK.settings, {}));
  let knownSet = new Set(gmGet(GMK.known, []));
  let savedSet = new Set(gmGet(GMK.saved, []));
  let personalUnkSet = new Set(gmGet(GMK.personal, []));
  let queue = gmGet(GMK.queue, []);

  function gmGet(key, dflt) {
    try { const v = GM_getValue(key); return v === undefined || v === null ? dflt : JSON.parse(v); }
    catch (e) { return dflt; }
  }
  function gmSet(key, val) { GM_setValue(key, JSON.stringify(val)); }
  function saveSettings() { gmSet(GMK.settings, settings); }
  function saveKnown() { gmSet(GMK.known, [...knownSet]); }
  function saveSaved() { gmSet(GMK.saved, [...savedSet]); }
  function savePersonal() { gmSet(GMK.personal, [...personalUnkSet]); }
  function saveQueue() { gmSet(GMK.queue, queue); }

  function gmReq(opts) {
    return new Promise((resolve, reject) => {
      GM_xmlhttpRequest(Object.assign({
        method: 'GET', timeout: 15000,
        onload: (r) => resolve(r),
        onerror: () => reject(new Error('network error')),
        ontimeout: () => reject(new Error('timeout'))
      }, opts));
    });
  }

  async function gmJSON(method, url, body, headers) {
    const r = await gmReq({
      method, url, data: body,
      headers: Object.assign({ 'Content-Type': 'application/json' }, headers || {})
    });
    if (r.status >= 300) throw new Error('HTTP ' + r.status + ' from ' + url);
    try { return JSON.parse(r.responseText); } catch (e) { throw new Error('bad JSON: ' + String(r.responseText).slice(0, 120)); }
  }

  async function anki(action, params) {
    const r = await gmJSON('POST', settings.ankiUrl, JSON.stringify({ action, version: 6, params: params || {} }));
    if (r.error) throw new Error('AnkiConnect: ' + r.error);
    return r.result;
  }

  // ===================== 词典与 LLM =====================

  async function fetchGlosses(word) {
    try {
      const url = 'https://dict.youdao.com/jsonapi?jsonversion=2&client=mobile&q=' +
        encodeURIComponent(word) + '&dicts=' + encodeURIComponent('{"count":1,"dicts":[["ec"]]}');
      const d = parseYoudaoEc(await gmJSON('GET', url));
      if (d && d.glosses.length) return d;
    } catch (e) { /* 落到 FreeDictionaryAPI */ }
    try {
      const d = parseFreeDict(await gmJSON('GET', 'https://api.dictionaryapi.dev/api/v2/entries/en/' + encodeURIComponent(word)));
      if (d && d.glosses.length) return d;
    } catch (e) { /* 都失败则无释义 */ }
    return { phonetic: '', glosses: [] };
  }

  async function llmRefine(word, sentence, glosses) {
    if (!settings.llmBase || !settings.llmKey || !settings.llmModel) return null;
    const sys = '你是英语学习助手。收到：英文单词、它出现的句子、词典释义。只返回 JSON：' +
      '{"sentence_translation":"整句的中文翻译","gloss_fits_context":布尔,"gloss_adjusted":"若释义不合本句语境给出贴合语境的中文词义，否则给空字符串"}';
    const base = settings.llmBase.replace(/\/+$/, '');
    const r = await gmReq({
      method: 'POST', url: base + '/chat/completions', timeout: 30000,
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + settings.llmKey },
      data: JSON.stringify({
        model: settings.llmModel, temperature: 0.2,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: JSON.stringify({ word, sentence, glosses }) }
        ]
      })
    });
    if (r.status >= 300) throw new Error('LLM HTTP ' + r.status);
    let content = JSON.parse(r.responseText).choices[0].message.content;
    content = String(content).replace(/^```(json)?/m, '').replace(/```$/m, '').trim();
    return JSON.parse(content);
  }

  // ===================== 扫描与高亮 =====================

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'PRE', 'CODE', 'TEXTAREA', 'NOSCRIPT', 'SVG', 'INPUT', 'SELECT']);
  const TOKEN_RE = /[A-Za-z][A-Za-z'’]*/g;
  const MAX_NODES = 30000;

  // 设置里的排除选择器：匹配元素内的文字对脚本完全不可见
  function excluded(el) {
    const sel = (settings.excludeSelector || '').trim();
    if (!sel || !el) return false;
    try { return !!el.closest(sel); } catch (e) { return false; }
  }

  let scanning = false;
  let rescanPending = false;

  function hasHighlightAPI() {
    return typeof window.Highlight === 'function' && typeof CSS !== 'undefined' && CSS.highlights;
  }

  function collectRanges() {
    const unk = [], sav = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        if (!n.nodeValue || n.nodeValue.length < 3) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        if (!p || SKIP_TAGS.has(p.tagName) || p.closest('[data-swc-ui]') || p.isContentEditable) return NodeFilter.FILTER_REJECT;
        if (excluded(p)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    let node, count = 0;
    while ((node = walker.nextNode()) && count < MAX_NODES) {
      count++;
      const text = node.nodeValue;
      TOKEN_RE.lastIndex = 0;
      let m;
      while ((m = TOKEN_RE.exec(text)) !== null) {
        const w = m[0];
        if (w.length < 2 || /^[A-Z]+$/.test(w)) continue;
        const st = classifyToken(w, knownSet, savedSet, freqSet, personalUnkSet);
        if (st === 'known') continue;
        const r = document.createRange();
        r.setStart(node, m.index);
        r.setEnd(node, m.index + w.length);
        (st === 'saved' ? sav : unk).push(r);
      }
    }
    return { unk, sav };
  }

  function rescan() {
    if (!hasHighlightAPI()) return;
    if (scanning) { rescanPending = true; return; }
    scanning = true;
    try {
      const { unk, sav } = collectRanges();
      CSS.highlights.set('swc-unknown', unk.length ? new Highlight(...unk) : new Highlight());
      CSS.highlights.set('swc-saved', sav.length ? new Highlight(...sav) : new Highlight());
    } finally {
      scanning = false;
      if (rescanPending) { rescanPending = false; setTimeout(rescan, 300); }
    }
  }

  let moTimer = null;
  const mo = new MutationObserver(() => {
    if (moTimer) clearTimeout(moTimer);
    moTimer = setTimeout(() => { moTimer = null; rescan(); }, 1200);
  });

  function injectCSS() {
    const css = `
      ::highlight(swc-unknown) { background-color: #ffe08a; color: inherit; }
      ::highlight(swc-saved) { background-color: #ececec; color: #8a8a8a; }
      .swc-popup, .swc-panel { all: initial; font-family: system-ui, -apple-system, sans-serif; }
      *::highlight(swc-unknown) { background-color: #ffe08a; color: inherit; }
      *::highlight(swc-saved) { background-color: #ececec; color: #8a8a8a; }
    `;
    try { GM_addStyle(css); }
    catch (e) {
      const s = document.createElement('style');
      s.textContent = css;
      (document.head || document.documentElement).appendChild(s);
    }
  }

  // ===================== 点击浮层 =====================

  let popupEl = null;

  function closePopup() { if (popupEl) { popupEl.remove(); popupEl = null; } }

  function wordAtPoint(x, y) {
    let node = null, offset = 0;
    if (document.caretPositionFromPoint) {
      const p = document.caretPositionFromPoint(x, y);
      if (p) { node = p.offsetNode; offset = p.offset; }
    } else if (document.caretRangeFromPoint) {
      const r = document.caretRangeFromPoint(x, y);
      if (r) { node = r.startContainer; offset = r.startOffset; }
    }
    if (!node || node.nodeType !== Node.TEXT_NODE || !node.nodeValue) return null;
    // 块级上下文全文 + 点击位置映射
    const block = (node.parentElement && node.parentElement.closest(
      'p,h1,h2,h3,h4,h5,h6,li,dd,dt,blockquote,td,th,figcaption,summary,[role="article"]'
    )) || node.parentElement;
    if (!block) return null;
    const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.parentElement && (SKIP_TAGS.has(n.parentElement.tagName) ||
        n.parentElement.closest('[data-swc-ui]') || excluded(n.parentElement)))
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    let full = '', base = -1, n;
    while ((n = walker.nextNode())) {
      // 相邻文本节点之间补空格，避免 "DevelopmentRated:" 这类粘连
      if (full && !/\s$/.test(full) && n.nodeValue && !/^\s/.test(n.nodeValue)) full += ' ';
      if (n === node) base = full.length;
      full += n.nodeValue;
    }
    if (base < 0) return null;
    const clickIdx = base + offset;
    return extractSentenceAt(full, clickIdx, 320);
  }

  function pageMeta() {
    const icon = document.querySelector('link[rel~="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]');
    return {
      url: location.href.split('#')[0],
      title: (document.title || '').trim().slice(0, 200),
      favicon: (icon && icon.href) || (location.origin + '/favicon.ico')
    };
  }

  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  async function showPopup(x, y, info) {
    closePopup();
    const meta = pageMeta();
    const st = classifyToken(info.word, knownSet, savedSet, freqSet, personalUnkSet);
    const isSaved = st === 'saved';
    const isKnownWord = st === 'known';
    const cloze = clozeify(info.sentence, info.word, info.occurrence);
    const preview = esc(cloze).replace(/\{\{c1::(.*?)\}\}/g, '<mark>$1</mark>');

    const el = document.createElement('div');
    el.className = 'swc-popup';
    el.dataset.swcUi = '1';
    el.style.cssText = 'position:fixed;z-index:2147483646;width:340px;max-height:60vh;overflow:auto;' +
      'background:#fff;color:#333;border:1px solid #ddd;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.18);' +
      'font:14px/1.5 system-ui,sans-serif;padding:12px 14px;';
    el.innerHTML =
      '<div style="display:flex;align-items:baseline;gap:8px;margin-bottom:4px;">' +
      '<b style="font-size:17px;">' + esc(info.word) + '</b>' +
      '<span data-swc-ph style="color:#888;font-size:12px;"></span>' +
      (isSaved ? '<span style="color:#999;font-size:12px;">已收藏过</span>' : '') +
      (isKnownWord ? '<span style="color:#999;font-size:12px;">熟词（频率表判定）</span>' : '') + '</div>' +
      '<div data-swc-gloss style="color:#456;font-size:13px;margin-bottom:6px;">查词典中…</div>' +
      '<div style="border-left:3px solid #ffe08a;padding:4px 8px;margin-bottom:10px;font-size:12.5px;color:#555;">' + preview + '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap;">' +
      '<button data-swc-add style="flex:1;padding:6px 0;border:0;border-radius:6px;background:#f9690e;color:#fff;font-size:13px;cursor:pointer;">' +
      (isSaved ? '再建一张卡' : '生成卡片') + '</button>' +
      (isKnownWord
        ? '<button data-swc-mark style="padding:6px 10px;border:1px solid #e0a030;border-radius:6px;background:#fff;color:#b06f10;font-size:13px;cursor:pointer;">其实不认识，加入生词</button>'
        : '<button data-swc-know style="padding:6px 10px;border:1px solid #ccc;border-radius:6px;background:#fff;color:#555;font-size:13px;cursor:pointer;">我认识，不再问</button>') +
      '<button data-swc-x style="padding:6px 10px;border:1px solid #ccc;border-radius:6px;background:#fff;color:#999;font-size:13px;cursor:pointer;">×</button></div>';
    document.documentElement.appendChild(el);

    const vw = window.innerWidth, vh = window.innerHeight;
    const rect = { left: Math.min(x, vw - 356), top: y + 12 };
    el.style.left = Math.max(8, rect.left) + 'px';
    el.style.top = (rect.top + 180 > vh ? Math.max(8, y - 190) : rect.top) + 'px';
    popupEl = el;

    // 词典释义异步填充
    fetchGlosses(info.word).then((d) => {
      if (popupEl !== el) return;
      el.querySelector('[data-swc-ph]').textContent = d.phonetic ? '/' + d.phonetic + '/' : '';
      el.querySelector('[data-swc-gloss]').innerHTML = d.glosses.length
        ? d.glosses.slice(0, 3).map(esc).join('<br>')
        : '<span style="color:#c0392b">词典没有查到该词</span>';
      el._glosses = d.glosses;
    });

    el.addEventListener('click', (ev) => ev.stopPropagation());
    el.querySelector('[data-swc-x]').onclick = closePopup;
    const knowBtn = el.querySelector('[data-swc-know]');
    if (knowBtn) knowBtn.onclick = () => {
      genCandidates(info.word).forEach((c) => { knownSet.add(c); personalUnkSet.delete(c); });
      saveKnown(); savePersonal();
      toast('已加入熟词表，此后不再高亮');
      closePopup(); rescan();
    };
    const markBtn = el.querySelector('[data-swc-mark]');
    if (markBtn) markBtn.onclick = () => {
      genCandidates(info.word).forEach((c) => { personalUnkSet.add(c); knownSet.delete(c); });
      savePersonal(); saveKnown();
      toast('已标记为生词，此后黄底高亮');
      closePopup(); rescan();
    };
    el.querySelector('[data-swc-add]').onclick = () => {
      const item = {
        id: hashStr(info.word.toLowerCase() + '|' + info.sentence),
        word: info.word,
        sentence: info.sentence,
        cloze: cloze,
        url: meta.url, title: meta.title, favicon: meta.favicon,
        host: hostOf(meta.url),
        dateAdded: Date.now(),
        translation: '', note: '', glosses: el._glosses || []
      };
      if (!queue.some((q) => q.id === item.id)) {
        queue.push(item); saveQueue(); updateBadge();
        toast('已加入待办队列（' + queue.length + ' 词），读完点徽标入库');
      } else toast('该词该句已在队列中');
      closePopup(); rescan();
    };
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest && e.target.closest('[data-swc-ui]')) return;
    if (popupEl && !popupEl.contains(e.target)) closePopup();
    // 链接/控件/双击/划选文本时不劫持，保证正常浏览行为
    if (e.target.closest && e.target.closest('a,button,summary,input,select,textarea,label,[role="button"],video,audio')) return;
    if (e.detail > 1) return;
    if (window.getSelection && String(window.getSelection())) return;
    const info = wordAtPoint(e.clientX, e.clientY);
    if (!info) return;
    showPopup(e.clientX, e.clientY, info);
  }, true);

  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closePopup(); });

  // ===================== 队列面板与入库 =====================

  let panelEl = null, badgeEl = null, ingesting = false;

  function updateBadge() {
    if (!badgeEl) return;
    badgeEl.textContent = '📚 ' + queue.length;
    badgeEl.style.display = queue.length ? 'block' : 'none';
  }

  function toast(msg, ms) {
    const t = document.createElement('div');
    t.dataset.swcUi = '1';
    t.style.cssText = 'position:fixed;left:50%;bottom:70px;transform:translateX(-50%);z-index:2147483647;' +
      'background:rgba(30,30,30,.88);color:#fff;font:13px/1.4 system-ui,sans-serif;padding:8px 14px;border-radius:8px;';
    t.textContent = msg;
    document.documentElement.appendChild(t);
    setTimeout(() => t.remove(), ms || 2600);
  }

  function buildPanel() {
    const el = document.createElement('div');
    el.className = 'swc-panel';
    el.dataset.swcUi = '1';
    el.style.cssText = 'position:fixed;right:16px;bottom:64px;z-index:2147483646;width:360px;max-height:70vh;' +
      'display:flex;flex-direction:column;background:#fff;color:#333;border:1px solid #ddd;border-radius:12px;' +
      'box-shadow:0 8px 32px rgba(0,0,0,.2);font:14px/1.5 system-ui,sans-serif;overflow:hidden;';
    el.innerHTML =
      '<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#f9690e;color:#fff;">' +
      '<b>生词待办</b><span data-swc-count style="font-size:12px;"></span></div>' +
      '<div data-swc-list style="flex:1;overflow:auto;padding:6px 10px;"></div>' +
      '<div data-swc-progress style="display:none;padding:4px 14px;font-size:12px;color:#888;"></div>' +
      '<div style="display:flex;gap:8px;padding:10px 14px;border-top:1px solid #eee;">' +
      '<button data-swc-ingest style="flex:2;padding:7px 0;border:0;border-radius:6px;background:#f9690e;color:#fff;font-size:13px;cursor:pointer;">全部入库</button>' +
      '<button data-swc-clear style="flex:1;padding:7px 0;border:1px solid #ccc;border-radius:6px;background:#fff;color:#888;font-size:13px;cursor:pointer;">清空</button>' +
      '<button data-swc-close style="padding:7px 10px;border:1px solid #ccc;border-radius:6px;background:#fff;color:#999;font-size:13px;cursor:pointer;">×</button></div>';

    el.querySelector('[data-swc-close]').onclick = () => { el.style.display = 'none'; };
    el.querySelector('[data-swc-clear]').onclick = () => {
      if (!queue.length || !confirm('清空全部待办词？')) return;
      queue = []; saveQueue(); refreshPanel(); updateBadge();
    };
    el.querySelector('[data-swc-ingest]').onclick = ingestAll;
    panelEl = el;
    document.documentElement.appendChild(el);
    return el;
  }

  function refreshPanel() {
    if (!panelEl) return;
    panelEl.querySelector('[data-swc-count]').textContent = queue.length + ' 个词待入库';
    const list = panelEl.querySelector('[data-swc-list]');
    if (!queue.length) {
      list.innerHTML = '<div style="color:#aaa;text-align:center;padding:30px 0;">队列为空<br>点击页面上高亮的生词即可收录</div>';
      return;
    }
    list.innerHTML = queue.map((it, i) =>
      '<div style="display:flex;gap:6px;align-items:flex-start;padding:6px 0;border-bottom:1px solid #f2f2f2;">' +
      '<div style="flex:1;min-width:0;"><b>' + esc(it.word) + '</b>' +
      '<span style="color:#aaa;font-size:11px;"> ' + esc(it.host) + '</span>' +
      '<div data-swc-sent style="color:#777;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + esc(it.sentence) + '</div></div>' +
      '<button data-swc-edit="' + i + '" title="编辑上下文" style="border:0;background:none;color:#bbb;cursor:pointer;font-size:13px;">✎</button>' +
      '<button data-swc-del="' + i + '" style="border:0;background:none;color:#ccc;cursor:pointer;font-size:14px;">✕</button></div>'
    ).join('');
    list.querySelectorAll('[data-swc-del]').forEach((b) => {
      b.onclick = () => { queue.splice(+b.dataset.swcDel, 1); saveQueue(); refreshPanel(); updateBadge(); };
    });
    list.querySelectorAll('[data-swc-edit]').forEach((b) => {
      b.onclick = () => startEdit(+b.dataset.swcEdit);
    });
  }

  function startEdit(i) {
    const it = queue[i];
    if (!it) return;
    const sentEl = panelEl.querySelector('[data-swc-edit="' + i + '"]').parentElement.querySelector('[data-swc-sent]');
    sentEl.innerHTML =
      '<textarea data-swc-ta style="width:100%;box-sizing:border-box;height:64px;font:12px/1.4 system-ui,sans-serif;padding:4px;border:1px solid #ccc;border-radius:4px;resize:vertical;">' + esc(it.sentence) + '</textarea>' +
      '<div style="display:flex;gap:6px;margin-top:4px;">' +
      '<button data-swc-esave style="padding:3px 10px;border:0;border-radius:4px;background:#f9690e;color:#fff;font-size:12px;cursor:pointer;">保存</button>' +
      '<button data-swc-ecancel style="padding:3px 10px;border:1px solid #ccc;border-radius:4px;background:#fff;color:#888;font-size:12px;cursor:pointer;">取消</button></div>';
    const ta = sentEl.querySelector('[data-swc-ta]');
    ta.focus();
    sentEl.querySelector('[data-swc-ecancel]').onclick = refreshPanel;
    sentEl.querySelector('[data-swc-esave]').onclick = () => {
      const v = ta.value.trim();
      if (v && v !== it.sentence) {
        it.sentence = v;
        it.cloze = clozeify(v, it.word, 0);
        const present = new RegExp(it.word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i').test(v);
        saveQueue();
        toast(present ? '上下文已更新' : '上下文已更新（注意：新句子里没有该词，未生成挖空）', 3500);
      }
      refreshPanel();
    };
  }

  async function ingestAll() {
    if (ingesting) return;
    if (!queue.length) { toast('队列为空'); return; }
    ingesting = true;
    const prog = panelEl.querySelector('[data-swc-progress]');
    const btn = panelEl.querySelector('[data-swc-ingest]');
    prog.style.display = 'block'; btn.disabled = true; btn.style.opacity = '.6';
    const fail = [];
    let ok = 0;
    try {
      await anki('version');
      for (let i = 0; i < queue.length; i++) {
        const it = queue[i];
        prog.textContent = '入库中 ' + (i + 1) + '/' + queue.length + '：' + it.word;
        try {
          await ingestOne(it);
          ok++;
          queue.splice(i, 1); i--;
          saveQueue(); refreshPanel(); updateBadge();
        } catch (err) {
          fail.push(it.word + '（' + err.message + '）');
        }
      }
    } catch (err) {
      toast('连不上 AnkiConnect：' + err.message + '（Anki 是否开着？）', 4000);
    }
    prog.style.display = 'none'; btn.disabled = false; btn.style.opacity = '';
    ingesting = false;
    if (ok && settings.autoBackup && settings.cloudType) backupToCloud(); // 入库成功后自动备份
    const msg = ok ? '成功入库 ' + ok + ' 张卡' : '';
    if (fail.length) toast(msg + '，失败 ' + fail.length + '：' + fail.slice(0, 2).join('；'), 6000);
    else if (ok) toast(msg);
    if (ok) rescan();
  }

  async function ingestOne(it) {
    if (!it.glosses || !it.glosses.length) {
      const d = await fetchGlosses(it.word);
      it.glosses = d.glosses;
    }
    it.translation = it.glosses.slice(0, 2).join('<br>');
    it.note = '';
    try {
      const llm = await llmRefine(it.word, it.sentence, it.glosses);
      if (llm) {
        it.note = llm.sentence_translation || '';
        if (llm.gloss_fits_context === false && llm.gloss_adjusted) it.translation = llm.gloss_adjusted;
      }
    } catch (e) { /* LLM 失败不阻塞入库 */ }
    it.dateAdded = Date.now();
    const note = {
      deckName: settings.deckName,
      modelName: settings.modelName,
      fields: buildNoteFields(it),
      tags: [it.host || 'web', yyyymmdd(new Date(it.dateAdded)), 'web-reader'],
      options: { allowDuplicate: true },
      audio: [{
        url: 'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(it.word) + '&type=' + (settings.audioType || 2),
        filename: safeFilename(it.word),
        fields: ['Audio'],
        skipHash: true
      }]
    };
    const noteId = await anki('addNote', { note });
    if (!noteId && noteId !== 0) throw new Error('addNote 返回空');
    genCandidates(it.word).forEach((c) => savedSet.add(c));
    saveSaved();
  }

  // ===================== 云备份（WebDAV / S3 兼容） =====================

  const BACKUP_FILE = 'swc-backup.json';

  // 阿里 OSS 禁止路径式访问（报 SecondLevelDomainForbidden），保存时自动转虚拟主机式
  function normalizeS3Endpoint(ep) {
    if (!ep) return ep;
    let s = ep.replace(/\/+$/, '');
    try {
      const u = new URL(s);
      if (/(^|\.)oss-[a-z0-9-]+\.aliyuncs\.com$/.test(u.hostname) && u.pathname.replace(/\/+$/, '')) {
        s = u.protocol + '//' + u.pathname.replace(/^\/|\/+$/g, '') + '.' + u.hostname;
        toast('OSS Endpoint 已自动转换为虚拟主机式（bucket 作子域名）', 4000);
      }
    } catch (e) { /* 非法 URL 交给后续校验 */ }
    return s;
  }

  function utf8B64(str) {
    return btoa(String.fromCharCode(...new TextEncoder().encode(str)));
  }

  function cloudCheck() {
    if (settings.cloudType === 'webdav') {
      if (!settings.davUrl || !settings.davUser) return '请在设置里填写 WebDAV 目录地址和账号';
      return null;
    }
    if (settings.cloudType === 's3') {
      if (!settings.s3Endpoint || !settings.s3Key) return '请在设置里填写 S3 Endpoint 和 AccessKey';
      if (!(window.crypto && crypto.subtle)) return 'S3 签名需要 HTTPS 页面';
      return null;
    }
    return '未配置云备份：请在 油猴菜单 → 设置 里选择备份方式';
  }

  async function cloudPut(text) {
    if (settings.cloudType === 'webdav') {
      const base = settings.davUrl.replace(/\/+$/, '');
      const auth = 'Basic ' + utf8B64(settings.davUser + ':' + settings.davPass);
      const url = base + '/' + BACKUP_FILE;
      let r = await gmReq({ method: 'PUT', url, headers: { Authorization: auth, 'Content-Type': 'application/json' }, data: text });
      if (r.status === 409 || r.status === 404) {
        await gmReq({ method: 'MKCOL', url: base, headers: { Authorization: auth } }); // 目录不存在则建
        r = await gmReq({ method: 'PUT', url, headers: { Authorization: auth, 'Content-Type': 'application/json' }, data: text });
      }
      if (r.status >= 300) throw new Error('WebDAV PUT HTTP ' + r.status + '（检查目录地址/账号/应用密码）');
      return;
    }
    // S3 兼容（阿里OSS/腾讯COS/R2/MinIO/AWS）
    const base = settings.s3Endpoint.replace(/\/+$/, '');
    const url = base + '/' + encodeURIComponent(settings.s3Path || BACKUP_FILE);
    const rs = s3RegionService(new URL(url).hostname, settings.s3Region);
    const headers = await sigv4Headers({
      method: 'PUT', url, body: text,
      accessKey: settings.s3Key, secretKey: settings.s3Secret,
      region: rs.region, service: rs.service,
      amzDate: amzDateNow(), s3Compat: true
    });
    headers['Content-Type'] = 'application/json';
    const r = await gmReq({ method: 'PUT', url, headers, data: text });
    if (r.status >= 300) throw new Error('S3 PUT HTTP ' + r.status + ' ' + xmlErr(r.responseText));
  }

  async function cloudGet() {
    if (settings.cloudType === 'webdav') {
      const base = settings.davUrl.replace(/\/+$/, '');
      const auth = 'Basic ' + utf8B64(settings.davUser + ':' + settings.davPass);
      const r = await gmReq({ method: 'GET', url: base + '/' + BACKUP_FILE, headers: { Authorization: auth } });
      if (r.status === 404) return null;
      if (r.status >= 300) throw new Error('WebDAV GET HTTP ' + r.status);
      return r.responseText;
    }
    const base = settings.s3Endpoint.replace(/\/+$/, '');
    const url = base + '/' + encodeURIComponent(settings.s3Path || BACKUP_FILE);
    const rs = s3RegionService(new URL(url).hostname, settings.s3Region);
    const headers = await sigv4Headers({
      method: 'GET', url, body: '',
      accessKey: settings.s3Key, secretKey: settings.s3Secret,
      region: rs.region, service: rs.service,
      amzDate: amzDateNow(), s3Compat: true
    });
    const r = await gmReq({ method: 'GET', url, headers });
    if (r.status === 404) return null;
    if (r.status >= 300) throw new Error('S3 GET HTTP ' + r.status + ' ' + xmlErr(r.responseText));
    return r.responseText;
  }

  async function backupToCloud() {
    const err = cloudCheck();
    if (err) { toast(err, 4000); return; }
    try {
      const dump = buildBackupDump([...knownSet], [...savedSet], [...personalUnkSet], queue, settings);
      await cloudPut(JSON.stringify(dump));
      toast('已备份到云：熟词 ' + dump.known.length + ' / 已收藏 ' + dump.saved.length +
        ' / 个人生词 ' + dump.personalUnknown.length + ' / 待办 ' + dump.queue.length, 3500);
    } catch (e) { toast('备份失败：' + e.message, 5000); }
  }

  async function restoreFromCloud() {
    const err = cloudCheck();
    if (err) { toast(err, 4000); return; }
    try {
      const text = await cloudGet();
      if (!text) { toast('云端还没有备份文件', 3500); return; }
      const remote = JSON.parse(text);
      const m = mergeBackup(
        { known: [...knownSet], saved: [...savedSet], personal: [...personalUnkSet], queue },
        remote
      );
      knownSet = new Set(m.known); saveKnown();
      savedSet = new Set(m.saved); saveSaved();
      personalUnkSet = new Set(m.personal); savePersonal();
      queue = m.queue; saveQueue();
      refreshPanel(); updateBadge(); rescan();
      toast('恢复完成（合并）：云端熟词 ' + m.counts.known + ' / 已收藏 ' + m.counts.saved +
        ' / 个人生词 ' + m.counts.personal + '，队列新增 ' + m.counts.queueAdded + ' 条', 4500);
    } catch (e) { toast('恢复失败：' + e.message, 5000); }
  }

  // ===================== Anki 生词同步 =====================

  async function syncAnkiWords() {
    const ids = await anki('findNotes', {
      query: 'note:"' + settings.modelName + '" OR note:"Saladict Word"'
    });
    const set = new Set();
    for (let i = 0; i < ids.length; i += 150) {
      const infos = await anki('notesInfo', { notes: ids.slice(i, i + 150) });
      infos.forEach((n) => {
        const t = n && n.fields && n.fields.Text && n.fields.Text.value;
        if (t) genCandidates(t.trim()).forEach((c) => set.add(c));
      });
    }
    savedSet = set;
    saveSaved();
    settings.lastSync = Date.now(); saveSettings();
    rescan();
    return ids.length;
  }

  // ===================== 设置 / 菜单 =====================

  function showSettings() {
    closePopup();
    let dlg = document.querySelector('[data-swc-settings]');
    if (dlg) { dlg.style.display = 'block'; return; }
    dlg = document.createElement('div');
    dlg.dataset.swcUi = '1';
    dlg.dataset.swcSettings = '1';
    dlg.style.cssText = 'position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:2147483647;width:380px;max-height:85vh;overflow:auto;' +
      'background:#fff;color:#333;border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.3);font:14px/1.5 system-ui,sans-serif;padding:16px 18px;';
    const row = (label, id, val, type, extra) =>
      '<div style="margin-bottom:8px;"><label style="display:block;font-size:12px;color:#888;margin-bottom:2px;">' + label + '</label>' +
      '<input id="' + id + '" type="' + (type || 'text') + '" value="' + esc(val) + '" style="width:100%;box-sizing:border-box;padding:6px 8px;border:1px solid #ccc;border-radius:6px;font-size:13px;" ' + (extra || '') + '></div>';
    dlg.innerHTML =
      '<b style="display:block;margin-bottom:10px;">SWC 设置</b>' +
      row('AnkiConnect 地址', 'swc-f-anki', settings.ankiUrl) +
      row('目标 deck', 'swc-f-deck', settings.deckName) +
      row('笔记模型', 'swc-f-model', settings.modelName) +
      '<div style="margin-bottom:8px;"><label style="display:block;font-size:12px;color:#888;margin-bottom:2px;">频率表截断（前 N 词视为已认识）</label>' +
      '<select id="swc-f-freq" style="width:100%;padding:6px;border:1px solid #ccc;border-radius:6px;">' +
      [3000, 5000, 8000, 10000].map((n) => '<option ' + (n === settings.freqCutoff ? 'selected' : '') + '>' + n + '</option>').join('') +
      '</select></div>' +
      row('发音类型（2=美音 1=英音）', 'swc-f-audio', settings.audioType, 'number') +
      row('排除元素 CSS 选择器（可选）', 'swc-f-excl', settings.excludeSelector, 'text', 'placeholder=".xgray, .sidebar"') +
      '<div style="border-top:1px solid #eee;margin:10px 0;padding-top:8px;font-size:12px;color:#999;">云备份（词表+队列+设置；LLM key 不上传）</div>' +
      '<div style="margin-bottom:8px;"><label style="display:block;font-size:12px;color:#888;margin-bottom:2px;">备份方式</label>' +
      '<select id="swc-f-cloud" style="width:100%;padding:6px;border:1px solid #ccc;border-radius:6px;">' +
      '<option value=""' + (settings.cloudType === '' ? ' selected' : '') + '>不备份</option>' +
      '<option value="webdav"' + (settings.cloudType === 'webdav' ? ' selected' : '') + '>WebDAV（坚果云 / Nextcloud / Alist）</option>' +
      '<option value="s3"' + (settings.cloudType === 's3' ? ' selected' : '') + '>S3 兼容（阿里 OSS / 腾讯 COS / R2 / MinIO）</option>' +
      '</select></div>' +
      '<div data-swc-dav style="display:' + (settings.cloudType === 'webdav' ? 'block' : 'none') + ';">' +
      row('WebDAV 目录地址', 'swc-f-davurl', settings.davUrl, 'text', 'placeholder="https://dav.jianguoyun.com/dav/SWCBackup"') +
      row('账号', 'swc-f-davuser', settings.davUser, 'text', 'placeholder="邮箱"') +
      row('密码（坚果云填应用密码）', 'swc-f-davpass', settings.davPass, 'password') + '</div>' +
      '<div data-swc-s3 style="display:' + (settings.cloudType === 's3' ? 'block' : 'none') + ';">' +
      row('Endpoint（含 bucket）', 'swc-f-s3ep', settings.s3Endpoint, 'text', 'placeholder="https://bucket.oss-cn-hangzhou.aliyuncs.com"') +
      row('Region', 'swc-f-s3region', settings.s3Region, 'text', 'placeholder="oss-cn-hangzhou / us-east-1 / auto"') +
      row('AccessKeyId', 'swc-f-s3key', settings.s3Key, 'password') +
      row('SecretAccessKey', 'swc-f-s3secret', settings.s3Secret, 'password') +
      row('对象路径', 'swc-f-s3path', settings.s3Path) + '</div>' +
      '<label style="display:flex;gap:6px;align-items:center;margin-bottom:8px;font-size:13px;color:#444;">' +
      '<input type="checkbox" id="swc-f-autob"' + (settings.autoBackup ? ' checked' : '') + '>入库成功后自动备份到云</label>' +
      '<div style="border-top:1px solid #eee;margin:10px 0;padding-top:8px;font-size:12px;color:#999;">LLM（可选，OpenAI 兼容接口，用于整句翻译与词义核验；不填则词典义直填、句翻留空）</div>' +
      row('Base URL', 'swc-f-llmbase', settings.llmBase, 'text', 'placeholder="https://api.xxx.com/v1"') +
      row('API Key', 'swc-f-llmkey', settings.llmKey, 'password') +
      row('模型名', 'swc-f-llmmodel', settings.llmModel, 'text', 'placeholder="gpt-4o-mini / glm-4-flash …"') +
      '<div style="display:flex;gap:8px;margin-top:10px;">' +
      '<button data-swc-save style="flex:1;padding:7px 0;border:0;border-radius:6px;background:#f9690e;color:#fff;cursor:pointer;">保存并重扫</button>' +
      '<button data-swc-cancel style="padding:7px 12px;border:1px solid #ccc;border-radius:6px;background:#fff;color:#888;cursor:pointer;">取消</button></div>';
    document.documentElement.appendChild(dlg);
    const cloudSel = dlg.querySelector('#swc-f-cloud');
    const davBox = dlg.querySelector('[data-swc-dav]');
    const s3Box = dlg.querySelector('[data-swc-s3]');
    cloudSel.onchange = () => {
      davBox.style.display = cloudSel.value === 'webdav' ? 'block' : 'none';
      s3Box.style.display = cloudSel.value === 's3' ? 'block' : 'none';
    };
    dlg.querySelector('[data-swc-cancel]').onclick = () => { dlg.remove(); };
    dlg.querySelector('[data-swc-save]').onclick = () => {
      settings.ankiUrl = dlg.querySelector('#swc-f-anki').value.trim() || DEFAULT_SETTINGS.ankiUrl;
      settings.deckName = dlg.querySelector('#swc-f-deck').value.trim() || DEFAULT_SETTINGS.deckName;
      settings.modelName = dlg.querySelector('#swc-f-model').value.trim() || DEFAULT_SETTINGS.modelName;
      settings.freqCutoff = +dlg.querySelector('#swc-f-freq').value || 8000;
      settings.audioType = +dlg.querySelector('#swc-f-audio').value || 2;
      settings.excludeSelector = dlg.querySelector('#swc-f-excl').value.trim();
      settings.cloudType = cloudSel.value;
      settings.davUrl = dlg.querySelector('#swc-f-davurl').value.trim();
      settings.davUser = dlg.querySelector('#swc-f-davuser').value.trim();
      settings.davPass = dlg.querySelector('#swc-f-davpass').value.trim();
      settings.s3Endpoint = normalizeS3Endpoint(dlg.querySelector('#swc-f-s3ep').value.trim());
      settings.s3Region = dlg.querySelector('#swc-f-s3region').value.trim();
      settings.s3Key = dlg.querySelector('#swc-f-s3key').value.trim();
      settings.s3Secret = dlg.querySelector('#swc-f-s3secret').value.trim();
      settings.s3Path = dlg.querySelector('#swc-f-s3path').value.trim() || 'swc-backup.json';
      settings.autoBackup = dlg.querySelector('#swc-f-autob').checked;
      settings.llmBase = dlg.querySelector('#swc-f-llmbase').value.trim();
      settings.llmKey = dlg.querySelector('#swc-f-llmkey').value.trim();
      settings.llmModel = dlg.querySelector('#swc-f-llmmodel').value.trim();
      settings.inited = true;
      saveSettings();
      rebuildFreqSet();
      dlg.remove();
      rescan();
      toast('设置已保存');
    };
  }

  function exportKnown() {
    const blob = new Blob([JSON.stringify({ known: [...knownSet], saved: [...savedSet], personalUnknown: [...personalUnkSet], exportedAt: new Date().toISOString() }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'swc-wordlist-' + yyyymmdd(new Date()) + '.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  }

  function importKnown() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = () => {
      const f = input.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        try {
          const d = JSON.parse(r.result);
          if (Array.isArray(d.known)) { d.known.forEach((w) => knownSet.add(w)); saveKnown(); }
          if (Array.isArray(d.saved)) { d.saved.forEach((w) => savedSet.add(w)); saveSaved(); }
          if (Array.isArray(d.personalUnknown)) { d.personalUnknown.forEach((w) => personalUnkSet.add(w)); savePersonal(); }
          rescan();
          toast('词表已导入');
        } catch (e) { toast('导入失败：不是有效 JSON', 3500); }
      };
      r.readAsText(f);
    };
    input.click();
  }

  async function testConnection() {
    try {
      const v = await anki('version');
      const models = await anki('modelNames');
      const has = models.includes(settings.modelName);
      const decks = await anki('deckNames');
      const hasDeck = decks.includes(settings.deckName);
      toast('AnkiConnect OK（v' + v + '）模型 ' + settings.modelName + (has ? ' ✓' : ' ✗不存在') +
        '，deck ' + settings.deckName + (hasDeck ? ' ✓' : ' ✗不存在'), 5000);
    } catch (e) { toast('连接失败：' + e.message, 4000); }
  }

  // ===================== 启动 =====================

  const FREQ_ALL = "the\nbe\nand\nof\na\nin\nto\nhave\nit\ni\nthat\nfor\nyou\nhe\nwith\non\ndo\nsay\nthis\nthey\nat\nbut\nwe\nhis\nfrom\nnot\nby\nshe\nor\nas\nwhat\ngo\ntheir\ncan\nwho\nget\nif\nwould\nher\nall\nmy\nmake\nabout\nknow\nwill\nup\none\ntime\nthere\nyear\nso\nthink\nwhen\nwhich\nthem\nsome\nme\npeople\ntake\nout\ninto\njust\nsee\nhim\nyour\ncome\ncould\nnow\nthan\nlike\nother\nhow\nthen\nits\nour\ntwo\nmore\nthese\nwant\nway\nlook\nfirst\nalso\nnew\nbecause\nday\nuse\nno\nman\nfind\nhere\nthing\ngive\nmany\nwell\nonly\nthose\ntell\nvery\neven\nback\nany\ngood\nwoman\nthrough\nus\nlife\nchild\nwork\ndown\nmay\nafter\nshould\ncall\nworld\nover\nschool\nstill\ntry\nlast\nask\nneed\ntoo\nfeel\nthree\nstate\nnever\nbecome\nbetween\nhigh\nreally\nsomething\nmost\nanother\nmuch\nfamily\nown\nleave\nput\nold\nwhile\nmean\nkeep\nstudent\nwhy\nlet\ngreat\nsame\nbig\ngroup\nbegin\nseem\ncountry\nhelp\ntalk\nwhere\nturn\nproblem\nevery\nstart\nhand\nmight\namerican\nshow\npart\nagainst\nplace\nsuch\nagain\nfew\ncase\nweek\ncompany\nsystem\neach\nright\nprogram\nhear\nquestion\nduring\nplay\ngovernment\nrun\nsmall\nnumber\noff\nalways\nmove\nnight\nlive\nmr\npoint\nbelieve\nhold\ntoday\nbring\nhappen\nnext\nwithout\nbefore\nlarge\nmillion\nmust\nhome\nunder\nwater\nroom\nwrite\nmother\narea\nnational\nmoney\nstory\nyoung\nfact\nmonth\ndifferent\nlot\nstudy\nbook\neye\njob\nword\nthough\nbusiness\nissue\nside\nkind\nfour\nhead\nfar\nblack\nlong\nboth\nlittle\nhouse\nyes\nsince\nprovide\nservice\naround\nfriend\nimportant\nfather\nsit\naway\nuntil\npower\nhour\ngame\noften\nyet\nline\npolitical\nend\namong\never\nstand\nbad\nlose\nhowever\nmember\npay\nlaw\nmeet\ncar\ncity\nalmost\ninclude\ncontinue\nset\nlater\ncommunity\nname\nfive\nonce\nwhite\nleast\npresident\nlearn\nreal\nchange\nteam\nminute\nbest\nseveral\nidea\nkid\nbody\ninformation\nnothing\nago\nlead\nsocial\nunderstand\nwhether\nwatch\ntogether\nfollow\nparent\nstop\nface\nanything\ncreate\npublic\nalready\nspeak\nothers\nread\nlevel\nallow\nadd\noffice\nspend\ndoor\nhealth\nperson\nart\nsure\nwar\nhistory\nparty\nwithin\ngrow\nresult\nopen\nmorning\nwalk\nreason\nlow\nwin\nresearch\ngirl\nguy\nearly\nfood\nmoment\nhimself\nair\nteacher\nforce\noffer\nenough\neducation\nacross\nalthough\nremember\nfoot\nsecond\nboy\nmaybe\ntoward\nable\nage\npolicy\neverything\nlove\nprocess\nmusic\nincluding\nconsider\nappear\nactually\nbuy\nprobably\nhuman\nwait\nserve\nmarket\ndie\nsend\nexpect\nsense\nbuild\nstay\nfall\noh\nnation\nplan\ncut\ncollege\ninterest\ndeath\ncourse\nsomeone\nexperience\nbehind\nreach\nlocal\nkill\nsix\nremain\neffect\nyeah\nsuggest\nclass\ncontrol\nraise\ncare\nperhaps\nlate\nhard\nfield\nelse\npass\nformer\nsell\nmajor\nsometimes\nrequire\nalong\ndevelopment\nthemselves\nreport\nrole\nbetter\neconomic\neffort\ndecide\nrate\nstrong\npossible\nheart\ndrug\nleader\nlight\nvoice\nwife\nwhole\npolice\nmind\nfinally\npull\nreturn\nfree\nmilitary\nprice\nless\naccording\ndecision\nexplain\nson\nhope\ndevelop\nview\nrelationship\ncarry\ntown\nroad\ndrive\narm\ntrue\nfederal\nbreak\ndifference\nthank\nreceive\nvalue\ninternational\nbuilding\naction\nfull\nmodel\njoin\nseason\nsociety\ntax\ndirector\nposition\nplayer\nagree\nespecially\nrecord\npick\nwear\npaper\nspecial\nspace\nground\nform\nsupport\nevent\nofficial\nwhose\nmatter\neveryone\ncenter\ncouple\nsite\nproject\nhit\nbase\nactivity\nstar\ntable\ncourt\nproduce\neat\nteach\noil\nhalf\nsituation\neasy\ncost\nindustry\nfigure\nstreet\nimage\nitself\nphone\neither\ndata\ncover\nquite\npicture\nclear\npractice\npiece\nland\nrecent\ndescribe\nproduct\ndoctor\nwall\npatient\nworker\nnews\ntest\nmovie\ncertain\nnorth\npersonal\nsimply\nthird\ntechnology\ncatch\nstep\nbaby\ncomputer\ntype\nattention\ndraw\nfilm\nrepublican\ntree\nsource\nred\nnearly\norganization\nchoose\ncause\nhair\ncentury\nevidence\nwindow\ndifficult\nlisten\nsoon\nculture\nbillion\nchance\nbrother\nenergy\nperiod\nsummer\nrealize\nhundred\navailable\nplant\nlikely\nopportunity\nterm\nshort\nletter\ncondition\nchoice\nsingle\nrule\ndaughter\nadministration\nsouth\nhusband\ncongress\nfloor\ncampaign\nmaterial\npopulation\neconomy\nmedical\nhospital\nchurch\nclose\nthousand\nrisk\ncurrent\nfire\nfuture\nwrong\ninvolve\ndefense\nanyone\nincrease\nsecurity\nbank\nmyself\ncertainly\nwest\nsport\nboard\nseek\nper\nsubject\nofficer\nprivate\nrest\nbehavior\ndeal\nperformance\nfight\nthrow\ntop\nquickly\npast\ngoal\nbed\norder\nauthor\nfill\nrepresent\nfocus\nforeign\ndrop\nblood\nupon\nagency\npush\nnature\ncolor\nrecently\nstore\nreduce\nsound\nnote\nfine\nnear\nmovement\npage\nenter\nshare\ncommon\npoor\nnatural\nrace\nconcern\nseries\nsignificant\nsimilar\nhot\nlanguage\nusually\nresponse\ndead\nrise\nanimal\nfactor\ndecade\narticle\nshoot\neast\nsave\nseven\nartist\nscene\nstock\ncareer\ndespite\ncentral\neight\nthus\ntreatment\nbeyond\nhappy\nexactly\nprotect\napproach\nlie\nsize\ndog\nfund\nserious\noccur\nmedia\nready\nsign\nthought\nlist\nindividual\nsimple\nquality\npressure\naccept\nanswer\nresource\nidentify\nleft\nmeeting\ndetermine\nprepare\ndisease\nwhatever\nsuccess\nargue\ncup\nparticularly\namount\nability\nstaff\nrecognize\nindicate\ncharacter\ngrowth\nloss\ndegree\nwonder\nattack\nherself\nregion\ntelevision\nbox\ntv\ntraining\npretty\ntrade\nelection\neverybody\nphysical\nlay\ngeneral\nfeeling\nstandard\nbill\nmessage\nfail\noutside\narrive\nanalysis\nbenefit\nsex\nforward\nlawyer\npresent\nsection\nenvironmental\nglass\nskill\nsister\npm\nprofessor\noperation\nfinancial\ncrime\nstage\nok\ncompare\nauthority\nmiss\ndesign\nsort\nact\nten\nknowledge\ngun\nstation\nblue\nstrategy\nclearly\ndiscuss\nindeed\ntruth\nsong\nexample\ndemocratic\ncheck\nenvironment\nleg\ndark\nvarious\nrather\nlaugh\nguess\nexecutive\nprove\nhang\nentire\nrock\nforget\nclaim\nremove\nmanager\nenjoy\nnetwork\nlegal\nreligious\ncold\nfinal\nmain\nscience\ngreen\nmemory\ncard\nabove\nseat\ncell\nestablish\nnice\ntrial\nexpert\nspring\nfirm\ndemocrat\nradio\nvisit\nmanagement\navoid\nimagine\ntonight\nhuge\nball\nfinish\nyourself\ntheory\nimpact\nrespond\nstatement\nmaintain\ncharge\npopular\ntraditional\nonto\nreveal\ndirection\nweapon\nemployee\ncultural\ncontain\npeace\npain\napply\nmeasure\nwide\nshake\nfly\ninterview\nmanage\nchair\nfish\nparticular\ncamera\nstructure\npolitics\nperform\nbit\nweight\nsuddenly\ndiscover\ncandidate\nproduction\ntreat\ntrip\nevening\naffect\ninside\nconference\nunit\nstyle\nadult\nworry\nrange\nmention\ndeep\nedge\nspecific\nwriter\ntrouble\nnecessary\nthroughout\nchallenge\nfear\nshoulder\ninstitution\nmiddle\nsea\ndream\nbar\nbeautiful\nproperty\ninstead\nimprove\nstuff\ndetail\nmethod\nsomebody\nmagazine\nhotel\nsoldier\nreflect\nheavy\nsexual\nbag\nheat\nmarriage\ntough\nsing\nsurface\npurpose\nexist\npattern\nwhom\nskin\nagent\nowner\nmachine\ngas\nahead\ngeneration\ncommercial\naddress\ncancer\nitem\nreality\ncoach\nmrs\nyard\nbeat\nviolence\ntotal\ntend\ninvestment\ndiscussion\nfinger\ngarden\nnotice\ncollection\nmodern\ntask\npartner\npositive\ncivil\nkitchen\nconsumer\nshot\nbudget\nwish\npainting\nscientist\nsafe\nagreement\ncapital\nmouth\nnor\nvictim\nnewspaper\nthreat\nresponsibility\nsmile\nattorney\nscore\naccount\ninteresting\naudience\nrich\ndinner\nvote\nwestern\nrelate\ntravel\ndebate\nprevent\ncitizen\nmajority\nnone\nfront\nborn\nadmit\nsenior\nassume\nwind\nkey\nprofessional\nmission\nfast\nalone\ncustomer\nsuffer\nspeech\nsuccessful\noption\nparticipant\nsouthern\nfresh\neventually\nforest\nvideo\nglobal\nsenate\nreform\naccess\nrestaurant\njudge\npublish\nrelation\nrelease\nbird\nopinion\ncredit\ncritical\ncorner\nconcerned\nrecall\nversion\nstare\nsafety\neffective\nneighborhood\noriginal\ntroop\nincome\ndirectly\nhurt\nspecies\nimmediately\ntrack\nbasic\nstrike\nsky\nfreedom\nabsolutely\nplane\nnobody\nachieve\nobject\nattitude\nlabor\nrefer\nconcept\nclient\npowerful\nperfect\nnine\ntherefore\nconduct\nannounce\nconversation\nexamine\ntouch\nplease\nattend\ncompletely\nvariety\nsleep\ninvolved\ninvestigation\nnuclear\nresearcher\npress\nconflict\nspirit\nreplace\nbritish\nencourage\nargument\ncamp\nbrain\nfeature\nafternoon\nam\nweekend\ndozen\npossibility\ninsurance\ndepartment\nbattle\nbeginning\ndate\ngenerally\nafrican\nsorry\ncrisis\ncomplete\nfan\nstick\ndefine\neasily\nhole\nelement\nvision\nstatus\nnormal\nchinese\nship\nsolution\nstone\nslowly\nscale\nuniversity\nintroduce\ndriver\nattempt\npark\nspot\nlack\nice\nboat\ndrink\nsun\ndistance\nwood\nhandle\ntruck\nmountain\nsurvey\nsupposed\ntradition\nwinter\nvillage\nsoviet\nrefuse\nsales\nroll\ncommunication\nscreen\ngain\nresident\nhide\ngold\nclub\nfarm\npotential\neuropean\npresence\nindependent\ndistrict\nshape\nreader\nms\ncontract\ncrowd\nchristian\nexpress\napartment\nwilling\nstrength\nprevious\nband\nobviously\nhorse\ninterested\ntarget\nprison\nride\nguard\nterms\ndemand\nreporter\ndeliver\ntext\ntool\nwild\nvehicle\nobserve\nflight\nfacility\nunderstanding\naverage\nemerge\nadvantage\nquick\nleadership\nearn\npound\nbasis\nbright\noperate\nguest\nsample\ncontribute\ntiny\nblock\nprotection\nsettle\nfeed\ncollect\nadditional\nhighly\nidentity\ntitle\nmostly\nlesson\nfaith\nriver\npromote\nliving\ncount\nunless\nmarry\ntomorrow\ntechnique\npath\near\nshop\nfolk\nprinciple\nsurvive\nlift\nborder\ncompetition\njump\ngather\nlimit\nfit\ncry\nequipment\nworth\nassociate\ncritic\nwarm\naspect\ninsist\nfailure\nannual\nfrench\nchristmas\ncomment\nresponsible\naffair\nprocedure\nregular\nspread\nchairman\nbaseball\nsoft\nignore\negg\nbelief\ndemonstrate\nanybody\nmurder\ngift\nreligion\nreview\neditor\nengage\ncoffee\ndocument\nspeed\ncross\ninfluence\nanyway\nthreaten\ncommit\nfemale\nyouth\nwave\nafraid\nquarter\nbackground\nnative\nbroad\nwonderful\ndeny\napparently\nslightly\nreaction\ntwice\nsuit\nperspective\ngrowing\nblow\nconstruction\nintelligence\ndestroy\ncook\nconnection\nburn\nshoe\ngrade\ncontext\ncommittee\nhey\nmistake\nlocation\nclothes\nindian\nquiet\ndress\npromise\naware\nneighbor\nfunction\nbone\nactive\nextend\nchief\ncombine\nwine\nbelow\ncool\nvoter\nlearning\nbus\nhell\ndangerous\nremind\nmoral\nunited\ncategory\nrelatively\nvictory\nacademic\ninternet\nhealthy\nnegative\nfollowing\nhistorical\nmedicine\ntour\ndepend\nphoto\nfinding\ngrab\ndirect\nclassroom\ncontact\njustice\nparticipate\ndaily\nfair\npair\nfamous\nexercise\nknee\nflower\ntape\nhire\nfamiliar\nappropriate\nsupply\nfully\nactor\nbirth\nsearch\ntie\ndemocracy\neastern\nprimary\nyesterday\ncircle\ndevice\nprogress\nbottom\nisland\nexchange\nclean\nstudio\ntrain\nlady\ncolleague\napplication\nneck\nlean\ndamage\nplastic\ntall\nplate\nhate\notherwise\nwriting\nmale\nalive\nexpression\nfootball\nintend\nchicken\narmy\nabuse\ntheater\nshut\nmap\nextra\nsession\ndanger\nwelcome\ndomestic\nlots\nliterature\nrain\ndesire\nassessment\ninjury\nrespect\nnorthern\nnod\npaint\nfuel\nleaf\ndry\nrussian\ninstruction\npool\nclimb\nsweet\nengine\nfourth\nsalt\nexpand\nimportance\nmetal\nfat\nticket\nsoftware\ndisappear\ncorporate\nstrange\nlip\nreading\nurban\nmental\nincreasingly\nlunch\neducational\nsomewhere\nfarmer\nsugar\nplanet\nfavorite\nexplore\nobtain\nenemy\ngreatest\ncomplex\nsurround\nathlete\ninvite\nrepeat\ncarefully\nsoul\nscientific\nimpossible\npanel\nmeaning\nmom\nmarried\ninstrument\npredict\nweather\npresidential\nemotional\ncommitment\nsupreme\nbear\npocket\nthin\ntemperature\nsurprise\npoll\nproposal\nconsequence\nbreath\nsight\nbalance\nadopt\nminority\nstraight\nconnect\nworks\nteaching\nbelong\naid\nadvice\nokay\nphotograph\nempty\nregional\ntrail\nnovel\ncode\nsomehow\norganize\njury\nbreast\niraqi\nacknowledge\ntheme\nstorm\nunion\ndesk\nthanks\nfruit\nexpensive\nyellow\nconclusion\nprime\nshadow\nstruggle\nconclude\nanalyst\ndance\nregulation\nbeing\nring\nlargely\nshift\nrevenue\nmark\nlocate\ncounty\nappearance\npackage\ndifficulty\nbridge\nrecommend\nobvious\nbasically\ngenerate\nanymore\npropose\nthinking\npossibly\ntrend\nvisitor\nloan\ncurrently\ncomfortable\ninvestor\nprofit\nangry\ncrew\naccident\nmeal\nhearing\ntraffic\nmuscle\nnotion\ncapture\nprefer\ntruly\nearth\njapanese\nchest\nthick\ncash\nmuseum\nbeauty\nemergency\nunique\ninternal\nethnic\nlink\nstress\ncontent\nselect\nroot\nnose\ndeclare\nappreciate\nactual\nbottle\nhardly\nsetting\nlaunch\nfile\nsick\noutcome\nad\ndefend\nduty\nsheet\nought\nensure\ncatholic\nextremely\nextent\ncomponent\nmix\nslow\ncontrast\nzone\nwake\nairport\nbrown\nshirt\npilot\nwarn\nultimately\ncat\ncontribution\ncapacity\nourselves\nestate\nguide\ncircumstance\nsnow\nenglish\npolitician\nsteal\npursue\nslip\npercentage\nmeat\nfunny\nneither\nsoil\nsurgery\ncorrect\njewish\nblame\nestimate\ndue\nbasketball\ngolf\ninvestigate\ncrazy\nsignificantly\nchain\nbranch\ncombination\nfrequently\ngovernor\nrelief\nuser\ndad\nkick\nmanner\nancient\nsilence\nrating\ngolden\nmotion\ngerman\ngender\nsolve\nfee\nlandscape\nused\nbowl\nequal\nforth\nframe\ntypical\nexcept\nconservative\neliminate\nhost\nhall\ntrust\nocean\nrow\nproducer\nafford\nmeanwhile\nregime\ndivision\nconfirm\nfix\nappeal\nmirror\ntooth\nsmart\nlength\nentirely\nrely\ntopic\ncomplain\nvariable\ntelephone\nperception\nattract\nconfidence\nbedroom\nsecret\ndebt\nrare\ntank\nnurse\ncoverage\nopposition\naside\nanywhere\nbond\npleasure\nmaster\nera\nrequirement\nfun\nexpectation\nwing\nseparate\nsomewhat\npour\nstir\njudgment\nbeer\nreference\ntear\ndoubt\ngrant\nseriously\nminister\ntotally\nhero\nindustrial\ncloud\nstretch\nwinner\nvolume\nseed\nsurprised\nfashion\npepper\nbusy\nintervention\ncopy\ntip\ncheap\naim\ncite\nwelfare\nvegetable\ngray\ndish\nbeach\nimprovement\neverywhere\nopening\noverall\ndivide\ninitial\nterrible\noppose\ncontemporary\nroute\nmultiple\nessential\nleague\ncriminal\ncareful\ncore\nupper\nrush\nnecessarily\nspecifically\ntired\nemploy\nholiday\nvast\nresolution\nhousehold\nfewer\nabortion\napart\nwitness\nmatch\nbarely\nsector\nrepresentative\nbeneath\nbeside\nincident\nlimited\nproud\nflow\nfaculty\nincreased\nwaste\nmerely\nmass\nemphasize\nexperiment\ndefinitely\nbomb\nenormous\ntone\nliberal\nmassive\nengineer\nwheel\ndecline\ninvest\ncable\ntowards\nexpose\nrural\naids\njew\nnarrow\ncream\nsecretary\ngate\nsolid\nhill\ntypically\nnoise\ngrass\nunfortunately\nhat\nlegislation\nsucceed\ncelebrate\nachievement\nfishing\naccuse\nuseful\nreject\ntalent\ntaste\ncharacteristic\nmilk\nescape\ncast\nsentence\nunusual\nclosely\nconvince\nheight\nphysician\nassess\nplenty\nvirtually\naddition\nsharp\ncreative\nlower\napprove\nexplanation\ngay\ncampus\nproper\nguilty\nacquire\ncompete\ntechnical\nplus\nimmigrant\nweak\nillegal\nhi\nalternative\ninteraction\ncolumn\npersonality\nsignal\ncurriculum\nhonor\npassenger\nassistance\nforever\nregard\nisraeli\nassociation\ntwenty\nknock\nwrap\nlab\ndisplay\ncriticism\nasset\ndepression\nspiritual\nmusical\njournalist\nprayer\nsuspect\nscholar\nwarning\nclimate\ncheese\nobservation\nchildhood\npayment\nsir\npermit\ncigarette\ndefinition\npriority\nbread\ncreation\ngraduate\nrequest\nemotion\nscream\ndramatic\nuniverse\ngap\nexcellent\ndeeply\nprosecutor\nlucky\ndrag\nairline\nlibrary\nagenda\nrecover\nfactory\nselection\nprimarily\nroof\nunable\nexpense\ninitiative\ndiet\narrest\nfunding\ntherapy\nwash\nschedule\nsad\nbrief\nhousing\npost\npurchase\nexisting\nsteel\nregarding\nshout\nremaining\nvisual\nfairly\nchip\nviolent\nsilent\nsuppose\nself\nbike\ntea\nperceive\ncomparison\nsettlement\nlayer\nplanning\ndescription\nslide\nwidely\nwedding\ninform\nportion\nterritory\nimmediate\nopponent\nabandon\nlake\ntransform\ntension\nleading\nbother\nconsist\nalcohol\nenable\nbend\nsaving\ndesert\nshall\nerror\ncop\narab\ndouble\nsand\nspanish\nprint\npreserve\npassage\nformal\ntransition\nexistence\nalbum\nparticipation\narrange\natmosphere\njoint\nreply\ncycle\nopposite\nlock\ndeserve\nconsistent\nresistance\ndiscovery\nexposure\npose\nstream\nsale\npot\ngrand\nmine\nhello\ncoalition\ntale\nknife\nresolve\nracial\nphase\njoke\ncoat\nmexican\nsymptom\nmanufacturer\nphilosophy\npotato\nfoundation\nquote\nonline\nnegotiation\nurge\noccasion\ndust\nbreathe\nelect\ninvestigator\njacket\nglad\nordinary\nreduction\nrarely\npack\nsuicide\nnumerous\nsubstance\ndiscipline\nelsewhere\niron\npractical\nmoreover\npassion\nvolunteer\nimplement\nessentially\ngene\nenforcement\nvs\nsauce\nindependence\nmarketing\npriest\namazing\nintense\nadvance\nemployer\nshock\ninspire\nadjust\nretire\nvisible\nkiss\nillness\ncap\nhabit\ncompetitive\njuice\ncongressional\ninvolvement\ndominate\npreviously\nwhenever\ntransfer\nanalyze\nattach\ndisaster\nparking\nprospect\nboss\ncomplaint\nchampionship\nfundamental\nsevere\nenhance\nmystery\nimpose\npoverty\nentry\nspending\nking\nevaluate\nsymbol\nmaker\nmood\naccomplish\nemphasis\nillustrate\nboot\nmonitor\nasian\nentertainment\nbean\nevaluation\ncreature\ncommander\ndigital\narrangement\nconcentrate\nusual\nanger\npsychological\nheavily\npeak\napproximately\nincreasing\ndisorder\nmissile\nequally\nvary\nwire\nround\ndistribution\ntransportation\nholy\ntwin\ncommand\ncommission\ninterpretation\nbreakfast\nstrongly\nengineering\nluck\nconstant\nclinic\nveteran\nsmell\ntablespoon\ncapable\nnervous\ntourist\ntoss\ncrucial\nbury\npray\ntomato\nexception\nbutter\ndeficit\nbathroom\nobjective\nelectronic\nally\njourney\nreputation\nmixture\nsurely\ntower\nsmoke\nconfront\npure\nglance\ndimension\ntoy\nprisoner\nfellow\nsmooth\nnearby\npeer\ndesigner\npersonnel\neducator\nrelative\nimmigration\nbelt\nteaspoon\nbirthday\nimplication\nperfectly\ncoast\nsupporter\naccompany\nsilver\nteenager\nrecognition\nretirement\nflag\nrecovery\nwhisper\ngentleman\ncorn\nmoon\ninner\njunior\nthroat\nsalary\nswing\nobserver\npublication\ncrop\ndig\npermanent\nphenomenon\nanxiety\nunlike\nwet\nliterally\nresist\nconvention\nembrace\nassist\nexhibition\nconstruct\nviewer\npan\nconsultant\nadministrator\noccasionally\nmayor\nconsideration\nceo\nsecure\npink\nbuck\nhistoric\npoem\ngrandmother\nbind\nfifth\nconstantly\nenterprise\nfavor\ntesting\nstomach\napparent\nweigh\ninstall\nsensitive\nsuggestion\nmail\nrecipe\nreasonable\npreparation\nwooden\nelementary\nconcert\naggressive\nfalse\nintention\nchannel\nextreme\ntube\ndrawing\nprotein\nquit\nabsence\nlatin\nrapidly\njail\ndiversity\nhonest\npalestinian\npace\nemployment\nspeaker\nimpression\nessay\nrespondent\ngiant\ncake\nhistorian\nnegotiate\nrestore\nsubstantial\npop\nspecialist\norigin\napproval\nquietly\nadvise\nconventional\ndepth\nwealth\ndisability\nshell\ncriticize\neffectively\nbiological\nonion\ndeputy\nflat\nbrand\nassure\nmad\naward\ncriteria\ndealer\nvia\nutility\nprecisely\narise\narmed\nnevertheless\nhighway\nclinical\nroutine\nwage\nnormally\nphrase\ningredient\nstake\nmuslim\nfiber\nactivist\nislamic\nsnap\nterrorism\nrefugee\nincorporate\nhip\nultimate\nswitch\ncorporation\nvaluable\nassumption\ngear\nbarrier\nminor\nprovision\nkiller\nassign\ngang\ndeveloping\nclassic\nchemical\nlabel\nteen\nindex\nvacation\nadvocate\ndraft\nextraordinary\nheaven\nrough\nyell\npregnant\ndistant\ndrama\nsatellite\npersonally\nclock\nchocolate\nitalian\ncanadian\nceiling\nsweep\nadvertising\nuniversal\nspin\nbutton\nbell\nrank\ndarkness\nclothing\nsuper\nyield\nfence\nportrait\nsurvival\nroughly\nlawsuit\ntestimony\nbunch\nfound\nburden\nreact\nchamber\nfurniture\ncooperation\nstring\nceremony\ncommunicate\ncheek\nlost\nprofile\nmechanism\ndisagree\npenalty\nie\nresort\ndestruction\nunlikely\ntissue\nconstitutional\npant\nstranger\ninfection\ncabinet\nbroken\napple\nelectric\nproceed\nbet\nliterary\nvirus\nstupid\ndispute\nfortune\nstrategic\nassistant\novercome\nremarkable\noccupy\nstatistics\nshopping\ncousin\nencounter\nwipe\ninitially\nblind\nport\nelectricity\ngenetic\nadviser\nspokesman\nretain\nlatter\nincentive\nslave\ntranslate\naccurate\nwhereas\nterror\nexpansion\nelite\nolympic\ndirt\nodd\nrice\nbullet\ntight\nbible\nchart\nsolar\nsquare\nconcentration\ncomplicated\ngently\nchampion\nscenario\ntelescope\nreflection\nrevolution\nstrip\ninterpret\nfriendly\ntournament\nfiction\ndetect\ntremendous\nlifetime\nrecommendation\nsenator\nhunting\nsalad\nguarantee\ninnocent\nboundary\npause\nremote\nsatisfaction\njournal\nbench\nlover\nraw\nawareness\nsurprising\nwithdraw\ndeck\nsimilarly\nnewly\npole\ntestify\nmode\ndialogue\nimply\nnaturally\nmutual\nfounder\nadvanced\npride\ndismiss\naircraft\ndelivery\nmainly\nbake\nfreeze\nplatform\nfinance\nsink\nattractive\ndiverse\nrelevant\nideal\njoy\nregularly\nworking\nsinger\nevolve\nshooting\npartly\nunknown\noffense\ncounter\ndna\npotentially\nthirty\njustify\nprotest\ncrash\ncraft\ntreaty\nterrorist\ninsight\npossess\npolitically\ntap\nextensive\nepisode\nswim\ntire\nfault\nloose\nshortly\noriginally\nconsiderable\nprior\nintellectual\nassault\nrelax\nstair\nadventure\nexternal\nproof\nconfident\nheadquarters\nsudden\ndirty\nviolation\ntongue\nlicense\nshelter\nrub\ncontroversy\nentrance\nproperly\nfade\ndefensive\ntragedy\nnet\ncharacterize\nfuneral\nprofession\nalter\nconstitute\nestablishment\nsqueeze\nimagination\nmask\nconvert\ncomprehensive\nprominent\npresentation\nregardless\nload\nstable\nintroduction\npretend\nelderly\nrepresentation\ndeer\nsplit\nviolate\npartnership\npollution\nemission\nsteady\nvital\nfate\nearnings\noven\ndistinction\nsegment\nnowhere\npoet\nmere\nexciting\nvariation\ncomfort\nradical\nadapt\nirish\nhoney\ncorrespondent\npale\nmusician\nsignificance\nvessel\nstorage\nflee\nleather\ndistribute\nevolution\nill\ntribe\nshelf\ngrandfather\nlawn\nbuyer\ndining\nwisdom\ncouncil\nvulnerable\ninstance\ngarlic\ncapability\npoetry\ncelebrity\ngradually\nstability\nfantasy\nscared\nplot\nframework\ngesture\ndepending\nongoing\npsychology\ncounselor\nchapter\ndivorce\nowe\npipe\nathletic\nslight\nmath\nshade\ntail\nsustain\nmount\nobligation\nangle\npalm\ndiffer\ncustom\neconomist\nfifteen\nsoup\ncelebration\nefficient\ncomposition\nsatisfy\npile\nbriefly\ncarbon\ncloser\nconsume\nscheme\ncrack\nfrequency\ntobacco\nsurvivor\nbesides\npsychologist\nwealthy\ngalaxy\ngiven\nski\nlimitation\ntrace\nappointment\npreference\nmeter\nexplosion\npublicly\nincredible\nfighter\nrapid\nadmission\nhunter\neducate\npainful\nfriendship\naide\ninfant\ncalculate\nfifty\nrid\nporch\ntendency\nuniform\nformation\nscholarship\nreservation\nefficiency\nqualify\nmall\nderive\nscandal\npc\nhelpful\nimpress\nheel\nresemble\nprivacy\nfabric\ncontest\nproportion\nguideline\nrifle\nmaintenance\nconviction\ntrick\norganic\ntent\nexamination\npublisher\nstrengthen\nproposed\nmyth\nsophisticated\ncow\netc\nstanding\nasleep\ntennis\nnerve\nbarrel\nbombing\nmembership\nratio\nmenu\ncontroversial\ndesperate\nlifestyle\nhumor\nloud\nglove\nsufficient\nnarrative\nphotographer\nhelicopter\nmodest\nprovider\ndelay\nagricultural\nexplode\nstroke\nscope\npunishment\nhandful\nbadly\nhorizon\ncurious\ndowntown\ngirlfriend\nprompt\ncholesterol\nabsorb\nadjustment\ntaxpayer\neager\nprincipal\ndetailed\nmotivation\nassignment\nrestriction\nlaboratory\nworkshop\ndifferently\nauto\nromantic\ncotton\nmotor\nsue\nflavor\noverlook\nfloat\nundergo\nsequence\ndemonstration\njet\norange\nconsumption\nassert\nblade\ntemporary\nmedication\ncabin\nbite\nedition\nvalley\nyours\npitch\npine\nbrilliant\nversus\nmanufacturing\nabsolute\nchef\ndiscrimination\noffensive\nboom\nregister\nappoint\nheritage\ngod\ndominant\nsuccessfully\nshit\nlemon\nhungry\nwander\nsubmit\neconomics\nnaked\nanticipate\nnut\nlegacy\nextension\nshrug\nbattery\narrival\nlegitimate\norientation\ninflation\ncope\nflame\ncluster\nwound\ndependent\nshower\ninstitutional\ndepict\noperating\nflesh\ngarage\noperator\ninstructor\ncollapse\nborrow\nfurthermore\ncomedy\nmortgage\nsanction\ncivilian\ntwelve\nweekly\nhabitat\ngrain\nbrush\nconsciousness\ndevote\nmeasurement\nprovince\nease\nseize\nethics\nnomination\npermission\nwise\nactress\nsummit\nacid\nodds\ngifted\nfrustration\nmedium\nphysically\ndistinguish\nshore\nrepeatedly\nlung\nrunning\ndistinct\nartistic\ndiscourse\nbasket\nah\nfighting\nimpressive\ncompetitor\nugly\nworried\nportray\npowder\nghost\npersuade\nmoderate\nsubsequent\ncontinued\ncookie\ncarrier\ncooking\nfrequent\nban\nawful\nadmire\npet\nmiracle\nexceed\nrhythm\nwidespread\nkilling\nlovely\nsin\ncharity\nscript\ntactic\nidentification\ntransformation\neveryday\nheadline\nventure\ninvasion\nnonetheless\nadequate\npiano\ngrocery\nintensity\nexhibit\nblanket\nmargin\nquarterback\nmouse\nrope\nconcrete\nprescription\nchase\nbrick\nrecruit\npatch\nconsensus\nhorror\nrecording\nchanging\npainter\ncolonial\npie\nsake\ngaze\ncourage\npregnancy\nswear\ndefeat\nclue\nreinforce\nconfusion\nslice\noccupation\ndear\ncoal\nsacred\nformula\ncognitive\ncollective\nexact\nuncle\ncaptain\nsigh\nattribute\ndare\nhomeless\ngallery\nsoccer\ndefendant\ntunnel\nfitness\nlap\ngrave\ntoe\ncontainer\nvirtue\nabroad\narchitect\ndramatically\nmakeup\ninquiry\nrose\nsurprisingly\nhighlight\ndecrease\nindication\nrail\nanniversary\ncouch\nalliance\nhypothesis\nboyfriend\ncompose\nmess\nlegend\nregulate\nadolescent\nshine\nnorm\nupset\nremark\nresign\nreward\ngentle\nrelated\norgan\nlightly\nconcerning\ninvent\nlaughter\nnorthwest\ncounseling\nreceiver\nritual\ninsect\ninterrupt\nsalmon\ntrading\nmagic\nsuperior\ncombat\nstem\nsurgeon\nacceptable\nphysics\nrape\ncounsel\njeans\nhunt\ncontinuous\nlog\necho\npill\nexcited\nsculpture\ncompound\nintegrate\nflour\nbitter\nbare\nslope\nrent\npresidency\nserving\nsubtle\ngreatly\nbishop\ndrinking\nacceptance\npump\ncandy\nevil\npleased\nmedal\nbeg\nsponsor\nethical\nsecondary\nslam\nexport\nexperimental\nmelt\nmidnight\ncurve\nintegrity\nentitle\nevident\nlogic\nessence\nexclude\nharsh\ncloset\nsuburban\ngreet\ninterior\ncorridor\nretail\npitcher\nmarch\nsnake\nexcuse\nweakness\npig\nclassical\nestimated\nunemployment\ncivilization\nfold\nreverse\nmissing\ncorrelation\nhumanity\nflash\ndeveloper\nreliable\nexcitement\nbeef\nislam\nroman\narchitecture\noccasional\nadministrative\nelbow\ndeadly\nhispanic\nallegation\nconfuse\nairplane\nmonthly\nduck\ndose\nkorean\nplead\ninitiate\nlecture\nvan\nsixth\nbay\nmainstream\nsuburb\nsandwich\ntrunk\nrumor\nimplementation\nswallow\nmotivate\nrender\nlongtime\ntrap\nrestrict\ncloth\nseemingly\nlegislative\neffectiveness\nenforce\nlens\ninspector\nlend\nplain\nfraud\ncompanion\ncontend\nnail\narray\nstrict\nassemble\nfrankly\nrat\nburst\nhallway\ncave\ninevitable\nsouthwest\nmonster\nunexpected\nobstacle\nfacilitate\nrip\nherb\noverwhelming\nintegration\ncrystal\nrecession\nwritten\nmotive\nflood\npen\nownership\nnightmare\ninspection\nsupervisor\nconsult\narena\ndiagnosis\npossession\nforgive\nconsistently\nbasement\ndrift\ndrain\nprosecution\nmaximum\nannouncement\nwarrior\nprediction\nbacteria\nquestionnaire\nmud\ninfrastructure\nhurry\nprivilege\ntemple\noutdoor\nsuck\nbroadcast\nre\nleap\nrandom\nwrist\ncurtain\npond\ndomain\nguilt\ncattle\nwalking\nplayoff\nminimum\nfiscal\nskirt\ndump\nhence\ndatabase\nuncomfortable\nexecute\nlimb\nideology\ntune\ncontinuing\nharm\nrailroad\nendure\nradiation\nhorn\nchronic\npeaceful\ninnovation\nstrain\nguitar\nreplacement\nbehave\nadminister\nsimultaneously\ndancer\namendment\npad\ntransmission\nawait\nretired\ntrigger\nspill\ngrateful\ngrace\nvirtual\ncolony\nadoption\nindigenous\nclosed\nconvict\ntowel\nmodify\nparticle\nprize\nlanding\nboost\nbat\nalarm\nfestival\ngrip\nweird\nundermine\nfreshman\nsweat\nouter\ndrunk\nseparation\ntraditionally\ngovern\nsoutheast\nintelligent\nwherever\nballot\nrhetoric\nconvinced\ndriving\nvitamin\nenthusiasm\naccommodate\npraise\ninjure\nwilderness\nendless\nmandate\nrespectively\nuncertainty\nchaos\nmechanical\ncanvas\nforty\nlobby\nprofound\nformat\ntrait\ncurrency\nturkey\nreserve\nbeam\nastronomer\ncorruption\ncontractor\napologize\ndoctrine\ngenuine\nthumb\nunity\ncompromise\nhorrible\nbehavioral\nexclusive\nscatter\ncommonly\nconvey\ntwist\ncomplexity\nfork\ndisk\nrelieve\nsuspicion\nresidence\nshame\nmeaningful\nsidewalk\nolympics\ntechnological\nsignature\npleasant\nwow\nsuspend\nrebel\nfrozen\nspouse\nfluid\npension\nresume\ntheoretical\nsodium\npromotion\ndelicate\nforehead\nrebuild\nbounce\nelectrical\nhook\ndetective\ntraveler\nclick\ncompensation\nexit\nattraction\ndedicate\naltogether\npickup\ncarve\nneedle\nbelly\nscare\nportfolio\nshuttle\ninvisible\ntiming\nengagement\nankle\ntransaction\nrescue\ncounterpart\nhistorically\nfirmly\nmild\nrider\ndoll\nnoon\namid\nidentical\nprecise\nanxious\nstructural\nresidential\ndiagnose\ncarbohydrate\nliberty\nposter\ntheology\nnonprofit\ncrawl\noxygen\nhandsome\nsum\nprovided\nbusinessman\npromising\nconscious\ndetermination\ndonor\nhers\npastor\njazz\nopera\nacquisition\npit\nhug\nwildlife\npunish\nequity\ndoorway\ndeparture\nelevator\nteenage\nguidance\nhappiness\nstatue\npursuit\nrepair\ndecent\ngym\noral\nclerk\nenvelope\nreporting\ndestination\nfist\nendorse\nexploration\ngenerous\nbath\nthereby\nindicator\nsunlight\nfeedback\nspectrum\npurple\nlaser\nbold\nreluctant\nstarting\nexpertise\npractically\neating\nhint\nsharply\nparade\nrealm\ncancel\nblend\ntherapist\npeel\npizza\nrecipient\nhesitate\nflip\naccounting\nbias\nhuh\nmetaphor\ncandle\njudicial\nentity\nsuffering\nlamp\ngarbage\nservant\nregulatory\ndiplomatic\nelegant\nreception\nvanish\nautomatically\nchin\nnecessity\nconfess\nracism\nstarter\nbanking\ncasual\ngravity\nenroll\ndiminish\nprevention\nminimize\nchop\nperformer\nintent\nisolate\ninventory\nproductive\nassembly\ncivic\nsilk\nmagnitude\nsteep\nhostage\ncollector\npopularity\nalien\ndynamic\nscary\nequation\nangel\noffering\nrage\nphotography\ntoilet\ndisappointed\nprecious\nprohibit\nrealistic\nhidden\ntender\ngathering\noutstanding\nstumble\nlonely\nautomobile\nartificial\ndawn\nabstract\ndescend\nsilly\ntide\nshared\nhopefully\nreadily\ncooperate\nrevolutionary\nromance\nhardware\npillow\nkit\ncontinent\nseal\ncircuit\nruling\nshortage\nannually\nlately\nscan\nfool\ndeadline\nrear\nprocessing\nranch\ncoastal\nundertake\nsoftly\nburning\nverbal\ntribal\nridiculous\nautomatic\ndiamond\ncredibility\nimport\nsexually\ndivine\nsentiment\ncart\noversee\nelder\npro\ninspiration\ndutch\nquantity\ntrailer\nmate\ngreek\ngenius\nmonument\nbid\nquest\nsacrifice\ninvitation\naccuracy\njuror\nofficially\nbroker\ntreasure\nloyalty\ntalented\ngasoline\nstiff\noutput\nnominee\nextended\ndiabetes\nslap\ntoxic\nalleged\njaw\ngrief\nmysterious\nrocket\ndonate\ninmate\ntackle\ndynamics\nbow\nours\ndignity\ncarpet\nparental\nbubble\nbuddy\nbarn\nsword\nseventh\nglory\ntightly\nprotective\ntuck\ndrum\nfaint\nqueen\ndilemma\ninput\nspecialize\nnortheast\nshallow\nliability\nsail\nmerchant\nstadium\nimproved\nbloody\nassociated\nwithdrawal\nrefrigerator\nnest\nthoroughly\nlane\nancestor\ncondemn\nsteam\naccent\noptimistic\nunite\ncage\nequip\nshrimp\nhomeland\nrack\ncostume\nwolf\ncourtroom\nstatute\ncartoon\nproductivity\ngrin\nsymbolic\nbug\nbless\naunt\nagriculture\nhostile\nconceive\ncombined\ninstantly\nbankruptcy\nvaccine\nbonus\ncollaboration\nmixed\nopposed\norbit\ngrasp\npatience\nspite\ntropical\nvoting\npatrol\nwillingness\nrevelation\ncalm\njewelry\ncuban\nhaul\nconcede\nwagon\nafterward\nspectacular\nruin\nsheer\nimmune\nreliability\nass\nalongside\nbush\nexotic\nfascinating\nclip\nthigh\nbull\ndrawer\nsheep\ndiscourage\ncoordinator\nideological\nrunner\nsecular\nintimate\nempire\ncab\nexam\ndocumentary\nneutral\nbiology\nflexible\nprogressive\nweb\nconspiracy\ncasualty\nrepublic\nexecution\nterrific\nwhale\nfunctional\ninstinct\nteammate\naluminum\nwhoever\nministry\nverdict\ninstruct\nskull\ncooperative\nmanipulate\nbee\npractitioner\nloop\nedit\nwhip\npuzzle\nmushroom\nsubsidy\nboil\ntragic\nmathematics\nmechanic\njar\nearthquake\npork\ncreativity\nsafely\nunderlying\ndessert\nsympathy\nfisherman\nincredibly\nisolation\nsock\neleven\nsexy\nentrepreneur\nsyndrome\nbureau\nworkplace\nambition\ntouchdown\nutilize\nbreeze\ncostly\nambitious\nchristianity\npresumably\ninfluential\ntranslation\nuncertain\ndissolve\nstatistical\ngut\nmetropolitan\nrolling\naesthetic\nspell\ninsert\nbooth\nhelmet\nwaist\nexpected\nlion\naccomplishment\nroyal\npanic\ncrush\nactively\ncliff\nminimal\ncord\nfortunately\ncocaine\nillusion\nanonymous\ntolerate\nappreciation\ncommissioner\nflexibility\ninstructional\nscramble\ncasino\ntumor\ndecorate\npulse\nequivalent\nfixed\nexperienced\ndonation\ndiary\nsibling\nirony\nspoon\nmidst\nalley\ninteract\nsoap\ncute\nrival\npunch\npin\nhockey\npassing\npersist\nsupplier\nknown\nmomentum\npurse\nshed\nliquid\nicon\nelephant\nconsequently\nlegislature\nfranchise\ncorrectly\nmentally\nfoster\nbicycle\nencouraging\ncheat\nheal\nfever\nfilter\nrabbit\ncoin\nexploit\naccessible\norganism\nsensation\npartially\nupstairs\ndried\nconservation\nshove\nbackyard\ncharter\nstove\nconsent\ncomprise\nreminder\nalike\nplacement\ndough\ngrandchild\ndam\nreportedly\nsurrounding\necological\noutfit\nunprecedented\ncolumnist\nworkout\npreliminary\npatent\nshy\ntrash\ndisabled\ngross\ndamn\nhormone\ntexture\npencil\nfrontier\nspray\ndisclose\ncustody\nbanker\nbeast\ninterfere\noak\neighth\nnotebook\noutline\nattendance\nspeculation\nuncover\nbehalf\ninnovative\nshark\nmill\ninstallation\nstimulate\ntag\nvertical\nswimming\nfleet\ncatalog\noutsider\ndesperately\nstance\ncompel\nsensitivity\nsomeday\ninstant\ndebut\nproclaim\nworldwide\nhike\nrequired\nconfrontation\ncolorful\nconstitution\ntrainer\nthanksgiving\nscent\nstack\neyebrow\nsack\ncease\ninherit\ntray\npioneer\norganizational\ntextbook\nuh\nnasty\nshrink\nemerging\ndot\nwheat\nfierce\nenvision\nrational\nkingdom\naisle\nweaken\nprotocol\nexclusively\nvocal\nmarketplace\nopenly\nunfair\nterrain\ndeploy\nrisky\npasta\ngenre\ndistract\nmerit\nplanner\ndepressed\nchunk\nclosest\ndiscount\nladder\njungle\nmigration\nbreathing\ninvade\nhurricane\nretailer\nclassify\ncoup\nambassador\ndensity\nsupportive\ncuriosity\nskip\naggression\nstimulus\njournalism\nrobot\ndip\nlikewise\ninformal\npersian\nfeather\nsphere\ntighten\nboast\npat\nperceived\nsole\npublicity\nunfold\nvalidity\necosystem\nstrictly\npartial\ncollar\nweed\ncompliance\nstreak\nsupposedly\nadded\nbuilder\nglimpse\npremise\nspecialty\ndeem\nartifact\nsneak\nmonkey\nmentor\nlistener\nlightning\nlegally\nsleeve\ndisappointment\ndisturb\nrib\nexcessive\ndebris\nrod\nlogical\nash\nsocially\nparish\nslavery\nblank\ncommodity\ncure\nmineral\nhunger\ndying\ndevelopmental\nfaster\nspare\nhalfway\nequality\ncemetery\nharassment\ndeliberately\nfame\nregret\nstriking\nlikelihood\ncarrot\natop\ntoll\nrim\nembarrassed\nfucking\ncling\nisolated\nblink\nsuspicious\nwheelchair\nsquad\neligible\nprocessor\nplunge\ndemographic\nchill\nrefuge\nsteer\nlegislator\nrally\nprogramming\ncheer\noutlet\nintact\nvendor\nthrive\npeanut\nchew\nelaborate\nconception\nauction\nsteak\ncomply\ntriumph\nshareholder\ncomparable\ntransport\nconscience\ncalculation\nconsiderably\ninterval\nscratch\nawake\njurisdiction\ninevitably\nfeminist\nconstraint\nemotionally\nexpedition\nallegedly\nsimilarity\nbutt\nlid\ndumb\nbulk\nsprinkle\nmortality\nphilosophical\nconversion\npatron\nmunicipal\nliver\nharmony\nsolely\ntolerance\ngoat\nblessing\nbanana\npalace\nformerly\npeasant\nneat\ngrandparent\nlawmaker\nsupermarket\ncruise\nmobile\ncalendar\nwidow\ndeposit\nbeard\nbrake\nscreening\nimpulse\nforbid\nfur\nbrutal\npredator\npoke\nopt\nvoluntary\nvalid\nforum\ndancing\nhappily\nsoar\nremoval\nautonomy\nenact\nthread\nlandmark\nunhappy\noffender\ncoming\nprivately\nfraction\ndistinctive\ntourism\nthreshold\nroutinely\nsuite\nregulator\nstraw\ntheological\nexhaust\nglobe\nfragile\nobjection\nchemistry\ncrowded\nblast\nprevail\novernight\ndenial\nrental\nfantastic\nfragment\nscrew\nwarmth\nundergraduate\nheadache\npoliceman\nprojection\nsuitable\ngraduation\ndrill\ncruel\nmansion\ngrape\nauthorize\ncottage\ndriveway\ncharm\nsexuality\nloyal\nclay\nballoon\ninvention\nego\nfare\nhomework\ndisc\nsofa\navailability\nradar\nfrown\nregain\nsweater\nrehabilitation\nrubber\nretreat\nmolecule\nfreely\nfavorable\nsteadily\nintegrated\nha\nyoungster\npremium\naccountability\noverwhelm\ncontemplate\nupdate\nspark\nironically\nfatigue\nspeculate\nmarker\npreach\nbucket\nblond\nconfession\nprovoke\nmarble\nsubstantially\ndefender\nexplicit\ndisturbing\nsurveillance\nmagnetic\ntechnician\nmutter\ndevastating\ndepart\narrow\ntrauma\nneighboring\nsoak\nribbon\nmeantime\ntransmit\nharvest\nconsecutive\ncoordinate\nspy\nslot\nriot\nnutrient\ncitizenship\nseverely\nsovereignty\nridge\nbrave\nlighting\nspecify\ncontributor\nfrustrate\narticulate\nimportantly\ntransit\ndense\nseminar\nelectronics\nsunny\nshorts\nswell\naccusation\nsoften\nstraighten\nterribly\ncue\nbride\nbiography\nhazard\ncompelling\nseldom\ntile\neconomically\nhonestly\ntroubled\ntwentieth\nbalanced\nforeigner\nconvenience\ndelight\nweave\ntimber\ntill\naccurately\nplea\nbulb\nflying\nsustainable\ndevil\nbolt\ncargo\nspine\nseller\nskilled\nmanaging\nmarine\ndock\norganized\nfog\ndiplomat\nboring\nsometime\nsummary\nmissionary\nepidemic\nfatal\ntrim\nwarehouse\naccelerate\nbutterfly\nbronze\ndrown\ninherent\nnationwide\nspit\nkneel\nvacuum\nselected\ndictate\nstereotype\nsensor\nlaundry\nmanual\npistol\nnaval\nplaintiff\napology\nbore\nbeloved\nwebsite\nentertain\nchopped\nsmoking\nbizarre\noverseas\ntribute\nretrieve\ndevise\nbomber\nnominate\nbargain\nskeptical\nscrutiny\nsuppress\nbrass\nconsidering\nunfortunate\nanchor\nzero\nextract\nintensive\nbetray\nconsistency\nvideotape\ndeveloped\nbureaucracy\nclever\ninteractive\nloser\nchallenging\nskiing\ncritique\ncongregation\ndelicious\naboard\nreproduce\ncompassion\niranian\ngop\nworm\nbeneficial\nawkward\nlegendary\ncomplication\nmarijuana\nrestoration\ncomposer\nconcession\nmilitia\nauthentic\ntenure\nrejection\nthief\ndome\ninadequate\nlocker\neditorial\nautumn\nsubsequently\nfaithful\nmerger\nhaunt\ncrude\nsheriff\nvague\ntrader\nevoke\npal\ncompletion\nvein\nscar\nsurrender\nsurge\naffirmative\ninspect\ncommentary\nsailor\nvariance\nfollower\nimperial\nsuspension\ncaller\nranking\ncompensate\nmaking\nfossil\nstunning\nhover\ntrout\ninappropriate\nfuck\nviable\nray\ncowboy\nsketch\nclarify\nchat\ncountless\ncopper\nupcoming\nninth\npupil\nstrive\nlyrics\nneglect\ngambling\nward\nwarfare\nmound\nmedieval\nrob\nlearner\nreasonably\nbang\nknot\ndragon\nadvocacy\ntilt\nmonetary\nprosperity\nantibiotic\ncreator\naccumulate\nbiologist\nelectoral\nfishery\nprosecute\nembody\nrug\ndull\nintervene\nraid\nglow\ncrown\nfake\nillustration\ncrab\ncreep\nworthy\nsatisfied\nhydrogen\ncapitalism\nfarming\nprobability\nvinegar\nadvisory\norganizer\nremedy\nmanuscript\ninability\nsmash\nhopeful\ndisagreement\nfancy\nmandatory\nmorality\ndive\npurely\nsoda\nadvertise\nshiny\nbass\nmemo\nlesser\nstun\njunk\ndevoted\nmanufacture\npoorly\naffection\nmature\nstamp\nsilently\ncolored\nwarming\nphilosopher\nclutch\nbreakdown\nconceal\nmonitoring\nkidney\ncurl\nhealing\nnineteenth\ngoodness\ngeography\ndestiny\nremarkably\nliteracy\ntaxi\nleak\nsolo\naustralian\ntrillion\nloving\nhomicide\nparliament\nherd\ngreenhouse\nbiblical\npassionate\nexpenditure\nprobe\npipeline\npsychiatrist\natom\nsnack\nhood\nending\nmigrant\npositively\ncharming\nbaking\nsupplement\nink\ndistress\ncompetence\nadaptation\noscar\nimagery\naddiction\npledge\nparadigm\nhomeowner\nmemorial\nhierarchy\ninfect\nbackward\noffend\nappetite\nsympathetic\nreconstruction\ncondom\nhostility\ntemporarily\nlitigation\nspectator\nbleed\ncomet\nexplicitly\nensemble\nchoke\nsaint\ncocktail\npea\npesticide\ndelegate\ntremble\npreservation\ncautious\nrotation\naffordable\nprejudice\ncertificate\nrobe\ndesignate\nabruptly\nmercy\nrookie\nclassmate\ncult\nacute\nmotel\nhatred\ndiameter\nnursing\npredecessor\ninduce\nenlist\ndisclosure\njuvenile\ngown\nnotably\nhalt\npersistent\ncorrelate\nhumanitarian\nexile\nroar\ntorture\narchitectural\nchorus\nfountain\nrevive\nendangered\ncomic\nreside\nrevenge\nunclear\nsour\ncaution\noriginate\nempirical\nlure\ncompile\nnationally\nerupt\ngraphic\nloom\nwitch\nendorsement\nnotable\ndusty\ncane\nfortunate\nforge\ndisrupt\ncommerce\naging\nrap\nsurgical\nbreakthrough\nspecialized\nestablished\nlobbyist\ndesirable\nslim\nremains\nallege\nalert\nattain\ncountryside\nhut\nsixteen\nholding\nexcite\ndinosaur\nchoir\nurgent\npronounce\nbanner\nrising\ninsider\nconfine\nassertion\nunderground\northodox\npayroll\nodor\noutbreak\ngrim\nwinning\nstrand\nfreshly\nprofitable\norchestra\ndrought\nbead\nuphold\ncommentator\nbeliever\nhazardous\nconfirmation\nwireless\nmerge\nproceedings\nshaft\nconvenient\naccommodation\ntheft\nfrog\nvanilla\ngrind\nelected\nlone\nregistration\nwounded\nprescribe\ncourtesy\nshotgun\nsubway\ncirculation\ntransplant\nexplosive\ncongressman\npenetrate\nilluminate\nvenue\nnazi\nparameter\ncanal\ngrill\nunnecessary\nchampagne\nregression\nflaw\ninnocence\nevolutionary\noptimism\nskinny\nposture\nsystematic\ndemon\nresulting\ninclusion\nrehearsal\nreassure\ninvoke\ndiscard\ntub\nrestraint\nprospective\nrevival\ncorrespond\ntheirs\nmurderer\nduration\ntin\nabundance\nlime\nproposition\ndespair\nattendant\nethnicity\nfulfill\nsuccessor\nassassination\natomic\ngeographic\ncrying\nportable\nhandling\nstrawberry\nholder\nguerrilla\nclarity\nenvironmentalist\ncanyon\nverse\nmoisture\ncontradiction\ntrophy\nironic\nrattle\nparenting\ngorgeous\nshatter\ndescent\nwiden\ntease\nstartle\ngospel\nprince\nwaiter\nvow\nseparately\nprecision\ndownstairs\nrigid\nsemester\ncutting\njam\nhometown\nfinancially\nstatistically\ntumble\nbackup\ndetector\ngrid\npsychiatric\neighteen\nrotate\nrecount\nspotlight\nsettler\nmagnificent\npolite\ncontrary\nscrape\noptical\nfourteen\nambulance\nsuperintendent\nbump\nprey\nsadness\nenthusiastic\npeculiar\naudit\nsupporting\ncontinually\nmodem\nfirefighter\nsupper\napplicant\negyptian\nabsent\nsalvation\nnamely\ninjured\nconceptual\nvisa\nrenew\noverhead\npeach\nmodification\ngoose\nfireplace\ncaribbean\nnurture\nkeyboard\nformally\nvivid\nfrighten\nfrightening\nfurious\npoison\nrepeated\ndaddy\nruler\nundoubtedly\nrocky\ntenant\nomit\nspider\nobsession\ncorpse\ndamp\nturkish\nproblematic\ncertainty\nunidentified\nnutrition\nmelody\nelectron\nphysicist\ndistinguished\nvocabulary\nmaple\nwool\nsalesman\nmemoir\nutterly\ncultivate\nmicrophone\ncherry\nluxury\nsummarize\nmeadow\ngoodbye\ndisposal\nmagical\naccordingly\ndefy\nplug\nmining\nwallet\nsocialist\nlamb\nscrap\ntempt\nfundamentally\nwildly\ndeclaration\naxis\nacademy\napplause\ninject\nevenly\nprecede\ndual\nsupervise\nshield\nnewcomer\ntriangle\naspiration\nfinancing\nnarrator\nfried\nsuitcase\ninclined\ncalcium\nsupervision\nsubstitute\ncon\nrealization\npicnic\ngravel\nnationalism\ntextile\nprecedent\nvisiting\neternal\ninterpreter\nindictment\nplanned\nencompass\ncollision\ncalf\nclan\nverify\ncreek\nnursery\nskillet\nboxing\nfaction\ndiplomacy\nspice\nconfused\nmat\nhop\nimmense\nsixty\nthirteen\nashamed\nbitch\ndean\nafterwards\nindependently\ninstrumental\nnoble\naftermath\nmillennium\ngasp\nastronaut\ncrust\nuseless\nreproduction\nflu\nembarrassing\naltar\numbrella\nenrollment\nunconscious\nlisting\nmosquito\nintimacy\ndivert\nvine\nguardian\nobey\nthoughtful\nshocked\ntech\nmethodology\nsimulation\npermanently\nawaken\npassive\nmonopoly\nloudly\nnun\noutrage\nquantum\noptional\nsummon\nattachment\nminer\naloud\ncigar\nbreed\nbroth\ndelegation\nhaven\ndangle\njerk\nmobility\nassurance\ncompeting\nmob\ndioxide\naffirm\nconsultation\nweep\nliquor\naccountable\nsip\nsadly\nemergence\nspan\napplaud\nlifelong\nlinger\ncube\nswiss\nfax\npreacher\nunderneath\nembassy\ninjection\nplantation\ndim\nsunset\nfacial\npredictable\npresume\nnearest\nstabilize\nexcess\nconstituent\nproponent\nvietnamese\ngardener\nantique\npolish\nsweeping\ndairy\nskate\nmanipulation\nwit\nlegitimacy\ncurse\nsaudi\nfabulous\nresignation\nintersection\nreconciliation\nimpairment\nlatino\ndeed\nculturally\nmiserable\nclosure\nmachinery\nlively\nshave\ninstitute\nerase\nirrelevant\nterminal\nharbor\ncoaching\nfoolish\nfrightened\nreverend\nignorance\nneatly\nskier\nwetland\nplayground\ncellular\nembarrassment\namateur\ncompetent\nlinear\nmosque\nprimitive\nreasoning\nbalcony\nclosing\nexcellence\nbrow\nant\npar\nharmful\nrecycle\nworship\ncoincidence\nresentment\nfeminine\njustification\ndependence\ndestructive\nrepetition\nniche\ntuition\ndividend\nrevise\nbark\ninexpensive\nterrify\ngovernmental\nsleeping\ncourtyard\nfascinate\ngenerator\nstab\ncafe\nincidence\nprop\nfailed\npropaganda\nunderscore\nformulate\ncorrupt\ncastle\ntechnically\nparallel\nwan\nfulfil\nmicrowave\nthorough\nspecimen\nobscure\nspectacle\nthrill\nheroin\nmonk\noutlook\nbout\nlaptop\nsniff\nreproductive\nvarying\nmatrix\nprinter\nspatial\nsetup\nbored\ncone\ncleanup\nrunway\nlocally\narmor\nstroll\nlineup\nnitrogen\nrebound\ntransparent\nintegral\nrespective\nsaying\ncirculate\nforecast\neaster\nintriguing\nclassification\nbreeding\nparagraph\nadvisor\nthrust\nallied\nrecreation\nfootage\nabsurd\npreferred\ntemptation\nreservoir\nfeast\nunfamiliar\nanalogy\nconductor\ninhabitant\nstrap\ndetermined\nlogo\nintensify\ntoddler\narc\nsway\nsophomore\nmaximize\nupgrade\nmanifest\nrefusal\nerosion\nrecreational\nflush\neducated\nlick\npredominantly\nunaware\nalign\ncourthouse\nmighty\nsufficiently\nidiot\nsubjective\nvalve\ndefect\naccountant\nfairness\nvulnerability\nadditionally\nfinely\nowl\nslash\npetition\ndiner\nadvertisement\ncorrespondence\nstatic\nartery\nmist\ncurator\nbaseline\ncoefficient\ncorrection\ngrower\nnonsense\ngum\nthesis\ndressing\naudio\nqualified\ncosmic\nponder\nsanctuary\ncomplicate\ndenounce\nbeating\nprepared\nlounge\nstool\nrecycling\ncredible\nsimmer\ntuna\nrevision\nhorizontal\nmattress\ndaylight\nwarrant\nexceptional\nsaturated\nembed\nstaffer\nwary\nbundle\nmemorable\nlinen\nozone\nrobbery\nfootstep\nprostitute\ndrip\nbattlefield\nnicely\nshocking\nrecorder\nclove\nloosen\nintake\npredictor\nelevate\nforced\nlottery\nchore\nfringe\nreduced\nlengthy\nhedge\ntattoo\nshopper\ntelecommunications\ncoral\nheating\nlease\nappliance\ncensus\nmaid\nmurmur\ncircus\nrationale\ngauge\ncorps\ninjustice\ninhabit\nquota\nlieutenant\nexcerpt\nstride\nsoy\ndub\nmotorcycle\ncopyright\nminiature\ncoordination\ninsurer\nunbelievable\nripe\namazed\nslogan\noversight\nreunion\naccord\njewel\nsnatch\nwaiting\nperch\noutrageous\nviewpoint\noverly\nalbeit\nadequately\nshrine\nindividually\nmisery\nmold\ndial\navenue\naddict\nmarginal\nramp\nberry\nmug\nmustard\ncleaning\ncontroller\nnickname\nvillager\nwhatsoever\nrelaxed\nhail\ngarment\nwatercolor\nsecretly\nindoor\nfertility\nnotify\ncaregiver\nactivate\nexert\nnaive\ntrustee\nkindergarten\ncereal\narctic\ncertification\nquilt\nsensible\nturnover\nfracture\npyramid\ntract\nmoving\nbachelor\nprotestant\nhumble\noperational\nconvincing\ndescendant\nproudly\nscarf\nlump\ndecoration\nmammal\npumpkin\nconfiguration\nsampling\nfreeway\nclash\nnewsletter\nimitate\nmultiply\nupward\nyank\ncough\nnotorious\nstereo\nvelvet\nlethal\nentail\nroller\nolive\ncompost\ntoast\nendeavor\ncredential\nbroadly\nfilmmaker\nsmoothly\nswirl\ndistraction\nham\nroam\nbasin\nfling\nlivestock\nfoam\nheroic\nasteroid\nheir\ntomb\noffset\nbald\nabandoned\nanticipation\nstraightforward\ninsure\nviking\ninterface\nbookstore\npope\ncrisp\nencouragement\nprotester\nhonesty\nsausage\nsunni\nglorious\nfrustrating\noverturn\ncompact\ndeprive\nfearful\nselective\ntranscript\nmeditation\nshiver\ndon\nflourish\ndischarge\nmainland\nstandpoint\nbeautifully\ntug\nempower\nlobster\nsolidarity\nturning\ndetection\noccurrence\nsaddle\nartwork\npartisan\nprone\nlasting\nhose\nliberation\nabundant\nconfusing\nrenewed\nhammer\naggressively\nformidable\nburial\nunwilling\npacket\nexclusion\nmobilize\nvigorous\nlazy\npassport\nmarital\nfond\nphotographic\nquestionable\npoise\nhomemade\ndrape\nsurplus\narchaeologist\nsurroundings\nvicious\nwedge\neagle\nvictorian\ndisturbance\nsandy\nevangelical\ncoffin\ntense\nserver\nspokeswoman\nleisure\nemit\npharmaceutical\nprototype\nunusually\nlender\nacquaintance\nvegetation\ncomparative\nanthropologist\nmagnet\nseasonal\ncontempt\nbastard\nmodule\ndominance\ndesired\nample\nzoo\ntheorist\ndisadvantage\nefficacy\nstripe\nforemost\npotent\nexclaim\ntee\ncrossing\ndentist\nden\nadverse\nreported\nscholarly\nconditioning\nimproving\nsorrow\nwhisk\npastry\nprovincial\nexaggerate\nreactor\noyster\ndecisive\narch\nsatisfying\nvisually\nseventeen\nvolcano\ngreeting\njealous\nchuckle\nmolecular\npasture\nswamp\nrebellion\nstandardized\ndash\nconstituency\ncommunist\nsteering\nawesome\nlesbian\nevidently\nbait\nsore\ndeliberate\nembargo\nnovelist\nreef\nfictional\nusage\nregistered\nerect\noath\nefficiently\ndeficiency\nnephew\nglare\nimplant\ndietary\nblur\nfertilizer\nfairy\nvintage\nfreezing\naltitude\nsubscale\nprotected\nsquint\nurgency\ndownload\nrecruitment\nhandy\noddly\nflashlight\ndifferentiate\nracist\nvaried\ncollaborate\nsuccession\ntricky\nwaitress\nremnant\ncement\nelk\nmorally\nrecite\nunemployed\ncommunal\nbrazilian\nguiding\ncuisine\ninterference\nsituate\nthinker\nexpanding\nmaturity\nbacon\nspoil\nwrestle\ndevastate\nunderestimate\nnavigate\nrobust\nclause\ncommitted\ncollaborative\nbulletin\ndarling\necology\ndeployment\nterrace\nnorthwestern\nresent\nblossom\ntemper\ncontinuity\ngenuinely\naccessory\npetty\nobsessed\nsmiling\nindirect\nspacecraft\nya\nbureaucratic\ngeneric\nglobalization\nmarathon\nmassacre\nspur\nprestigious\ndiscomfort\nbackpack\ntrench\ndeviation\nspirituality\nicy\napplied\ndiesel\nwhistle\nastronomy\ngovernance\ndevotion\ncinnamon\nappropriately\nskeleton\nbriefing\nsew\nspawn\nroster\nunpleasant\ninflict\ninsane\nindict\nentertaining\nprofoundly\nmarked\nmuddy\nsinging\nturtle\noccupational\ntrio\nferry\nleverage\ncomeback\nconsulting\nthereafter\nconflicting\nsticky\npainted\nturmoil\nastonishing\nrandomly\nreferral\nperfection\nclergy\nrenewal\nmigrate\nsustained\nkeen\norient\nrite\nimaginary\nmathematical\noffspring\nradically\narchive\npillar\nadhere\nreceipt\nunderwear\ncontamination\nparlor\nuneasy\nunacceptable\nappropriation\nretention\ndisappearance\nprivileged\ncarriage\nsporting\nartillery\nmessenger\nmotif\nmentality\npavement\nmoist\ntractor\nstatewide\nhitter\npostpone\nbeneficiary\nhelpless\ncontention\nrelevance\nballet\nhobby\nswedish\nbosnian\npolicymaker\nvelocity\ncritically\nreconcile\npathway\nnoisy\nopposing\nmadness\ncleaner\nhub\ncompartment\nfury\ninsult\nrespected\nspontaneous\nusher\ngolfer\nembark\nasthma\nmisleading\nbloom\nslender\nblouse\nproliferation\nmanifestation\nstark\nnecklace\nlettuce\nproximity\nbrochure\nperimeter\nperfume\nfiring\nbrace\nsymbolize\nmatching\nflock\nfirearm\nrefine\nrivalry\nvolatile\nsermon\nrigorous\nmule\ndelighted\noval\nhurdle\nsturdy\ncanoe\nturf\nparsley\nbroaden\nworkforce\nvoyage\ndefinitive\npropel\ndistort\nscoop\noverweight\nreplicate\nswift\ntab\nlinebacker\nundo\nadvancement\nbasics\ngoddess\nstalk\nintimidate\ngrandson\nverge\nplague\nbipartisan\nsergeant\nbatch\nlace\ndeter\nprivatization\nlord\nexpire\nadjacent\nmessy\nsmoker\ncatastrophe\nwithhold\nunpredictable\nivory\nembryo\ncoincide\ntranscend\nviolin\nlucrative\ndiagnostic\ndecorative\nresistant\nescort\nrag\npromptly\nreopen\nexpanded\nstall\ndetention\ndedicated\ntalking\nliar\nhomosexuality\nsoutheastern\npact\nelicit\nvest\nfascination\ninquire\nbust\ncontender\nsignify\nbolster\noblige\nhull\nparole\nsplash\nprestige\nelevation\nbackdrop\nloved\nhappening\nvibrant\nmodeling\npoetic\ninterrogation\nsensibility\nlinguistic\nreformer\nsticker\nshooter\nscoring\ngeographical\nstain\npublishing\nunveil\nimminent\nflawed\nbackwards\nclap\nalpha\nfoil\nuncommon\nbearing\nrude\nbunker\nfrustrated\namusement\nanthropology\ndeepen\naccepted\nanimated\nlandlord\ncurb\ncomposite\ncrouch\nconquer\nenduring\nimplicit\nunlimited\ndictator\ninhale\ninterestingly\ngenetically\nforthcoming\nenvironmentally\nwidth\ntherapeutic\nfetch\ngreed\ncircular\nsiren\nweary\nvacant\ncomplement\ndeaf\nincoming\nfastest\ntiger\nreferendum\nallocate\nmillionaire\nhillside\nparadox\nlush\ncharitable\nmourn\narguably\nscarce\nsiege\nprobable\npervasive\nprevailing\nbarbecue\nterritorial\nstrangely\ndefinite\ntranslator\nstrategist\nmarsh\ndisruption\npreside\ngradual\nnowadays\ndisplace\ndiscriminate\ntrademark\nsolitary\ncatalogue\ndocumentation\nhomosexual\nmulticultural\ncasually\npolar\npuppy\nprohibition\ncoconut\nmedian\nremainder\nbadge\nnavy\npending\ndislike\nangler\nvoid\nslump\nseafood\nhum\ntheologian\ndating\ninaudible\nsynthetic\nparadise\ngranite\nbattered\nsyrup\nbuying\nmimic\nrestrain\nbroadway\npremiere\ndesktop\nerode\nbeverage\npest\nqualification\nviewing\ninterim\nwholly\npaperwork\noppression\nhybrid\nillegally\nlodge\npierce\nammunition\nindulge\ncommuter\nsuspected\nsteroids\nflick\nanswering\nprairie\natmospheric\npear\nserial\ninvestigative\nreflective\nboomer\nfinished\nlandfill\nsurpass\ninfinite\ncommute\ngossip\nmuscular\ncontradict\ndiscrepancy\nbilateral\nintermediate\ntemporal\nlunar\nsincere\npluck\ndice\ndemise\npatio\npremature\nutter\nroommate\nchant\ntout\noverwhelmingly\ncrater\nenrich\nexploitation\nsubmarine\nditch\nclown\ncomfortably\nloaf\ntwilight\nsecondly\nwrestling\ndispose\ncushion\nimaging\nprincess\ncomprehend\nvaguely\nsquirrel\nadolescence\nunlock\nbleeding\nroyalty\nsalon\ndestine\ndescriptive\nresponsive\nloosely\nsuperb\nevacuate\nunderstandable\nsquash\npostcard\nmodified\nelusive\nhardship\nrelocate\naffiliate\nclaw\npity\nincomplete\ninstability\ndodge\nunwanted\nbureaucrat\nprojected\nskepticism\nmarvelous\ncater\nlaborer\ncontinuously\nreliance\nimmunity\ntornado\nchess\nfiling\nhalloween\nbuffalo\ncamel\nplanetary\nnucleus\nheck\ndeclining\nblonde\nconform\ntaliban\ncuff\nworthwhile\nbrightly\nshipment\nbud\nsperm\nsedan\naccompanying\ncertified\nadmiration\napartheid\nearring\napparatus\nwithstand\nexpel\nextinction\narchaeological\noverview\nreluctance\nforgiveness\nprevalent\nscarcely\nirrigation\nsocietal\nbenign\nlumber\nextensively\ncabbage\nslack\ncalmly\ndedication\nrugged\nboulder\ninequality\ncoherent\nkidnap\nearnest\napt\noptimal\nsimplicity\nstaple\ncanned\nplaque\nautobiography\npreschool\nconfidential\nsuperstar\nintensely\nsleek\nwindshield\ndune\nambiguity\nwhiskey\ncompatible\nshipping\nindirectly\nsusceptible\ndeduction\ngrilled\ntester\nrinse\nvigorously\nappealing\nrelentless\nsunglasses\ninconsistent\ninterpersonal\nvase\ncanopy\ncrumble\nstaircase\nfixture\nmaternal\nnegotiator\nvampire\ncertify\ncynical\nperiodically\nloneliness\nmerchandise\nexcel\nblunt\nauthoritarian\nastronomical\ngardening\nmassage\naccidentally\ngratitude\nemperor\noutraged\naffiliation\ntriple\nhue\nfungus\ndisparity\nenzyme\nintercept\npostal\ndeepest\nsurviving\ncylinder\nmembrane\ncafeteria\nambiguous\ndismantle\nselling\ndire\nhonorable\nheap\nallocation\nglide\npave\ninfectious\ncommunism\npreceding\nprecaution\nfry\nsaucepan\nmetro\nqualitative\nactivism\ninfrared\nawe\nunstable\ninvariably\ninformant\nonset\nmyriad\ninternationally\nheated\nnervously\nfreeman\nexemption\nreluctantly\nscout\nexposed\npottery\ninsufficient\nsubcommittee\nantenna\nstew\nprinted\nfolder\ngoverning\nplausible\nabusive\nairborne\nsneakers\nsomeplace\nharass\nenergetic\nethic\nsecrecy\nrep\nconfer\ndesignated\nparalyze\nendanger\nembarrass\nbillboard\nsubstantive\nthermal\nprecinct\ndaytime\nshrub\nunderway\ngrader\nconsolidate\nnationalist\ntribunal\npressing\narouse\ndental\ncockpit\nstressful\nnapkin\nunload\npornography\naffluent\ncozy\nknight\nurine\nobesity\nexacerbate\ninnings\ngroan\ntakeover\ndwell\nmilky\ntangible\nfeat\nmilitant\nrealism\nlurk\ntorch\nswiftly\nhay\nspinach\ndwarf\nterminate\nbeetle\ntactical\nprobation\npopulate\nmistress\nattic\nmaneuver\nhuddle\npirate\nconstellation\nwreck\nbaptist\ncivilized\nsmack\nmasculine\nlingering\nsubscriber\nplatter\nprinting\npearl\ndusk\nrenowned\ncrumb\nsewage\ngee\nallergy\nprovocative\nsweetheart\nreversal\nstolen\nretiree\ndisappointing\ndisposition\nbatter\ndart\nallegiance\nwax\nfelony\nfingertip\nsob\ntrousers\ncrap\nfusion\nshovel\nsocialism\ngraceful\npuppet\nwholesale\nfreezer\nchapel\nsubsidize\ndisastrous\npastoral\nfilling\nadversary\nintricate\nvoucher\nexplosives\nscheduled\nfloating\nburger\nthrone\nrenovation\nchick\norchard\ndiaper\ngunman\nauditor\nmural\nfingerprint\nchord\nglue\nvisibility\nunified\nshining\nrestructuring\nsideline\nmankind\nincorrect\ntheatrical\nfrenzy\nserbian\nturbine\ncondo\nbetrayal\nfocal\nbaggage\neventual\nshack\nveto\ntraumatic\ninsurgent\nshowcase\nbleak\nveil\nsetback\ninsistence\nrestless\nseverity\npounding\nrenewable\ncompetency\ncrusade\npublished\nentitlement\ntorso\nsunrise\ndeposition\nstump\npakistani\ncheerful\nginger\nextraordinarily\nfuzzy\npuzzled\num\nreconstruct\nopenness\npancake\nformulation\ndiagram\ncomb\nluggage\nelimination\nhurl\nwhoa\nfriction\nfurnish\nknowledgeable\nsegregation\naerial\nprosperous\nvoluntarily\nmid\nmama\nunleash\ngiggle\nanalytical\nforensic\nkin\ntariff\ncontrolled\nexaminer\nfoliage\nrespectable\nignorant\ndomination\nprostate\nclimbing\ndispatch\ndisguise\ntick\nraised\nhatch\ndine\nsigning\nraft\namend\nmultimedia\ncohort\nseizure\narthritis\nnutritional\nprolonged\nsideways\npalette\nshifting\nimitation\nlipstick\nmediate\ncathedral\ncram\ngenome\nspike\nworrying\nlament\nselfish\nalternate\nignite\nbully\nrevolve\nbracelet\nnegatively\narsenal\nkeeper\nspa\nbasil\nhmm\ncontaminate\ndisbelief\ninhibit\nalumnus\nenormously\nplight\nvibration\nstartling\ndefault\nczech\nsickness\nchaotic\ndisperse\nhollow\nsober\nsleepy\nlistening\nsaw\ncamping\nyouthful\nglowing\npub\ncomrade\nrainbow\ncontradictory\nawhile\nmadame\nmerry\nflatten\nintrinsic\ncorresponding\nroadside\nnap\npeek\nunexpectedly\nimpatient\ncharcoal\npresently\nstarve\nimpair\nfrantic\nrazor\ncautiously\ndistributor\nplanting\nconstructive\nfertile\nreclaim\nprose\nprevalence\ndaunting\ndisgust\nsewer\neagerly\ntimely\nwield\nslab\nyogurt\nsouthwestern\ncatcher\nfox\ndoom\ncrest\nnortheastern\nrainy\nniece\nlayout\npersistence\neighty\nhamburger\nupright\nrancher\nreadiness\nabolish\naccidental\nrespiratory\ncapsule\ngi\nautonomous\nyacht\nlever\nrhetorical\nmumble\nliner\nlibrarian\nliberate\ndesperation\nfeminism\nmorale\nanonymity\nreinforcement\ndistortion\ninterstate\nprophet\npragmatic\nalmond\ntopple\nvalidate\ncooked\nvastly\ndime\ndiversion\ngraze\ninferior\nreminiscent\nsitting\ncomedian\nsubsidiary\norphan\nalleviate\npersona\nfounding\npreview\nprotagonist\ninn\nundercover\ncolonel\ncollectively\nsystematically\nreel\nenlarge\ncruiser\ncrunch\nescalate\nstubborn\nmock\nscrub\nrubble\ndiscretion\nsprawling\nfoe\npolished\nbathe\navert\ndetain\narbitrary\nresemblance\noutdoors\ngenocide\nconjunction\nredefine\ncavity\nunrelated\ntroubling\nnovice\nanimation\nblueprint\ntenth\ncatastrophic\ncompliment\ncrave\npedestrian\nnude\nhiring\nresidue\nprogression\nrunoff\nshorten\nagony\naccustom\ndeteriorate\nprofessionally\nempathy\ncollide\nbargaining\nfeasible\napplicable\nimpeachment\nmastery\nplaywright\ndirective\nbypass\nreap\nfacade\nunderlie\narrogant\nvent\ndubious\npreventive\ncreamy\nforesee\noneself\nwade\nenhanced\nbracket\nharmless\nloading\nbinoculars\nbra\npaste\npremier\nperil\neclipse\nmediterranean\nenjoyment\nreign\nconvicted\nrightly\npatriotic\nbruise\nadvertiser\npoultry\nheterosexual\nrewrite\ndictatorship\nmoan\nprocession\nem\nautomaker\ncracker\nsitcom\nlessen\ngenetics\nconquest\ngosh\npayoff\nlebanese\nparliamentary\nperpetuate\nfashionable\nmethodist\npackaging\nrailing\ninheritance\nexpectancy\nquantitative\ninfamous\nbrink\ncellar\nbriefcase\npollutant\npaycheck\nplum\nelevated\nrecede\ninherently\nabound\nrepression\nboiling\nallowance\nkidnapping\nlinkage\nbreakup\nmasterpiece\nlust\nroast\nculminate\nplummet\nmaze\ndepiction\nhumiliation\nkindness\nwatershed\nwartime\npronounced\ndrainage\nordeal\nsplendid\nmultinational\nimplicate\nperiodic\nrefined\nmesh\nsnapshot\ndiscern\ninning\nadore\nliteral\ndove\nslippery\nfoul\nproven\nouting\nalarming\nhomer\nsolicit\npolitely\nthinly\nintercourse\ntentative\nache\ninformed\nunsuccessful\npaid\nwicked\nstagger\nconjure\nparcel\nnudge\ntrained\nnasal\nuprising\nendurance\nspicy\ntrajectory\nconstrain\nornament\norderly\nsaga\nintentionally\npinch\nnationality\ncomforting\ndealings\nflake\nrecess\nalcoholic\nappraisal\nopener\nreconsider\noffshore\nsurf\nsliced\nsunshine\nculinary\nnewborn\nbiodiversity\ndegradation\nexplorer\nsuperiority\nhiss\ncubic\nadulthood\nquestioning\nautopsy\nincapable\nresidual\nslower\ngigantic\nfingernail\nasylum\nbum\niq\nrepertoire\nloft\nrethink\nrehearse\npsyche\npedal\nexemplify\nimported\nshuffle\nfiercely\npenis\nlizard\ncrate\nuranium\ntailor\nmarvel\nkurdish\nbrighten\nscattered\nceramic\nlayoff\ncompassionate\nconvene\nchamp\nviolently\npsychic\ngem\nnineteen\nroasted\ninterviewer\nlandowner\ncomprehension\ncompute\nwrinkle\naspire\namongst\npainfully\nscrutinize\nscottish\nfiery\nfireworks\nspecification\npardon\nhawaiian\ntexan\nwalnut\ncomputing\nenhancement\nbluff\ncapitalist\ngeometry\nslick\nknob\naspirin\nonstage\ntracking\nhog\npier\nnickel\nbreach\nideally\nhmo\ndependency\nbroccoli\nyoga\ntablet\nresonate\nglacier\nchemotherapy\nfumble\nerotic\nhelping\nestrogen\nineffective\npolling\ncardboard\nsquat\nsediment\njersey\nattribution\nrecollection\nfallen\nlobbying\nseventy\nbartender\nakin\nforearm\nsuccumb\nseasoned\nevaporate\nwink\nsimulate\nshudder\nintrigue\nvolleyball\ngrenade\nregimen\ncoarse\nincumbent\nstature\nrecruiting\nradioactive\ngraph\ngoddamn\noutreach\nspelling\nproceeds\ncelebrated\nstellar\nbaked\nalignment\ncatalyst\nfetus\nextremist\ncontour\nwhine\nperpetrator\nordinance\nwardrobe\ngulf\ngrease\nhawk\nimaginative\nepiscopal\naviation\ndoctoral\npathetic\nmercury\ndecay\nsilhouette\nstruggling\nconserve\nhen\nhopeless\nrevisit\nconfide\nnode\nfasten\nportrayal\nresonance\nnoodle\nmoonlight\nvillain\nspecially\ndurable\ngenerosity\ncasting\nshaky\ncompass\nbowling\nrevised\nsift\ncapitalize\nindustrialized\nbail\ndropout\ndeliberation\npodium\nnovelty\nhoop\noutset\nmartial\nbrightness\nrepay\nirresponsible\nschooling\ngrouping\nneon\nflooding\npastel\njeopardize\nchili\nsubscribe\nstimulation\nfunctioning\nsprout\ncardiovascular\ngland\npigeon\nspinal\nheighten\neve\nsociology\nexpressive\nmoose\nyearn\ngig\nmutually\nunsure\nbound\nlatitude\nprostitution\nmeaningless\nceramics\nadorn\nacceleration\ndetainee\nrabbi\nequate\nclearing\nunseen\ninaugural\nshiite\nhindu\ntheoretically\nunify\nfamed\ntwisted\nturnout\nindifference\npharmacy\ncontingency\nwhirl\nwavelength\ncategorize\ndistinctly\nspiral\nattempted\ncardiac\nplow\nflutter\nflirt\npunk\npaw\ncomputerized\natrocity\nsovereign\nhypothetical\npostmodern\ncooler\nblessed\ndelete\nflicker\nincur\nglamorous\nbrag\nsuccessive\nsouvenir\nslate\ncarpenter\nbenchmark\nexhausted\nfamiliarity\nplank\nblaze\nrelaxation\nlousy\ngdp\nbiscuit\nconversely\nnarrowly\ntortilla\ndisciple\nangrily\nvet\nbacklash\nphysiological\nmonastery\nbakery\nhesitation\nheadlight\nconsortium\napron\nthunder\nintern\nnostalgia\npreclude\nlitter\ndivorced\nexquisite\nwaterfall\ninitiation\nsniper\nautomated\nuneven\ninfected\naccordance\nbodyguard\nsic\nswap\nimmerse\ncoyote\nmustache\nconsciously\nthug\nplaza\nmisunderstanding\njealousy\ncadet\naura\npetroleum\nflap\nsubmission\npreheat\nhoneymoon\ndrastic\nfarewell\nchilling\ncompetitiveness\npatriotism\nstriped\nadvent\ndisciplinary\nwoe\nripple\nimbalance\nmoderately\nshortcoming\npoker\nindoors\neighteenth\nseam\nrestructure\ncookbook\nlonging\nbooster\ncarved\nbroadcaster\nalienate\nswimmer\nsting\nidle\nsoftball\ndolphin\nexhaustion\nanatomy\nliberalism\npinpoint\npivotal\ncinema\nragged\nsandal\nlavender\nubiquitous\nsolitude\ndrunken\ndissent\nsculptor\nkurd\nhaze\nmince\nscenery\nscenic\ncosmos\ngrove\ninch\ndisconnect\ncourageous\nauthenticity\nfragrance\nconverge\nluckily\nsyrian\ntrivial\ndesignation\ncelery\nsystemic\nporcelain\ngleaming\ninventor\ndeception\npricing\nbuzz\nreinvent\nscanner\nfines\nexpanse\ngourmet\nclump\nsocket\nboxer\naquatic\ncycling\nfamine\ndisappoint\neerie\ndirectory\narrogance\nsubdivision\nliaison\ncassette\ndwelling\ncolon\nlighter\ncarving\nalgorithm\ndominican\nharden\ndecidedly\nhinder\nevacuation\nturk\nfrank\nburner\nclamp\npatiently\narmored\nsage\ntrooper\nhack\nirrational\npristine\npaperback\nboutique\nabnormal\ndiver\ncreditor\nnavigation\nplaster\nredemption\nalpine\nprosper\nimproper\nbamboo\nplasma\ntread\nstifle\ninterception\npianist\ndownward\ndivided\nsynthesis\ndanish\ninsecurity\nadaptive\nboarding\ninclination\nheartbeat\nsentimental\nstainless\nmonumental\nrecognizable\nmemorize\nupscale\ninclusive\nvocational\nninety\nsnort\npilgrimage\nannoying\nturnaround\nsuperficial\nvapor\nexcursion\nhallmark\npuff\nplaying\nrig\nmisunderstand\nreviewer\nnightclub\nthyme\nmortar\npecan\nbloc\nbacking\ndemonstrator\nasphalt\nmicroscope\nsharpen\nspear\nsubscription\nsavor\nsatisfactory\nsuperpower\nliable\ncucumber\nledge\ncrooked\nmodernity\nimpending\nmediation\nbroadcasting\nbitterness\ngroove\nrelay\nchimney\nlantern\npacked\novertime\ndorm\naroma\nye\nheroine\njog\nweekday\noccupant\ncurved\nthwart\nawfully\ncruelty\nplateau\ncosmetic\nfin\nstint\ndispense\nbuffet\nsocialize\nslaughter\nlateral\nretrospect\nlily\nclubhouse\ngrapple\nfloral\ndamaging\nrecommended\nstocking\nheightened\ncitation\ncongratulate\nmingle\npony\ncenterpiece\ntrot\ncharacterization\nhospitality\nseriousness\nimperative\nperipheral\ngrammar\neternity\nmodernization\nhowl\nrespectful\nindifferent\ndude\nrailway\ncompression\nimpoverished\ncricket\nsynagogue\nominous\nmartyr\nrotten\nstructured\nethanol\nhumidity\nlightweight\nfarmhouse\nrelic\ndeceive\nhype\nacting\nvodka\nprogrammer\neligibility\ndownturn\ncrane\ncoating\npod\ndemocratization\ndecree\nvie\njeopardy\ncollaborator\nunfinished\nmaterialize\nanguish\nlesion\nabstraction\ncommanding\nirregular\nchurn\nbodily\nvariability\npromoter\nfootprint\nindefinitely\ncrow\ntransitional\nempowerment\noblivious\nfaded\nthankful\nmuster\nprominence\ncannon\nnarcotic\nmultitude\ncloak\nvault\nknit\ntemperament\ndrummer\ndisruptive\ndegrade\nchilly\nconvoy\nflank\nplayful\nperforming\nmildly\nlag\nnylon\nvitality\nabide\nthai\ndiploma\ncumulative\nlash\nmixing\nunconstitutional\narchaeology\nenclose\nflare\ndarken\naccumulation\ninsulation\nrove\nfluctuation\nimprison\nmomentarily\nirritate\nparasite\nretaliation\noutskirts\nunpopular\nworsen\nchosen\ndevour\naged\ntasty\nsimplify\nhaircut\nenvy\nsensory\nhefty\nnoticeable\ncrushed\npry\ndenomination\ncock\ndictionary\nyep\nhandkerchief\ncomplementary\nthicken\nconsolidation\nradiate\nwhereby\nbitterly\nboycott\ncuriously\ndresser\nhumane\ncustomary\nskim\nalas\ndigit\nmystical\nmetallic\nstigma\ndeceased\nrestrictive\npudding\nintuition\ngrate\nreferee\ngranddaughter\naccustomed\ncanon\nsociologist\nreckon\neccentric\noverhear\nenthusiast\nvolcanic\ngracious\ndissatisfaction\ncharismatic\ndamaged\nentertainer\nrefrigerate\ntransparency\ncontinuum\nzoning\nnebula\nquake\nguided\ndiversify\nathletics\noverthrow\nmuffin\ndoctorate\nfort\ndrawback\ndazzling\nfreight\nstink\ndemeanor\nclout\nreckless\ninsurgency\nape\ntempting\nglossy\ngrumble\nforeground\ninflux\nannouncer\nthickness\nvengeance\nsalsa\nbacterial\nghetto\nsprint\nmar\ntoxin\ndrastically\nheavyweight\nterrifying\nrooftop\nlighten\nabsorption\nhousewife\napprentice\nmoth\noutward\nsizable\nallude\nhemisphere\nhandicap\nnormative\nphony\nfurnishings\ncatfish\ncavalry\ncleric\naffective\nfig\nepic\nrogue\npiss\nentrepreneurial\nseduce\nstarving\namaze\nwig\nsupernatural\nseating\namenities\nrenovate\ncoax\nmeteor\neh\nzoom\nrein\nattest\nclimber\nelectorate\nmutation\ncommercially\nminus\neyewitness\ngrievance\npneumonia\nbrutality\nduct\nthriller\npulp\nstuffed\nwoo\nnostril\nhelm\nmonarch\nseep\neyelid\ncradle\nparanoid\nlending\nuniquely\ncurry\npathogen\neruption\nstomp\ncrook\nranger\nscalp\ncherish\nrelish\nthou\nspacious\ncrank\ncensorship\nunravel\nsmuggle\nannoyed\nmint\nsoothing\ncommonplace\nmislead\npersuasive\nclassified\nincidentally\nphd\nderegulation\ngeneralization\ncontraction\navid\nmythology\nemanate\nfarmland\nmunicipality\nboredom\nunrealistic\ninaccurate\ncommemorate\ngroom\nfilthy\ndefer\nexceptionally\nrampant\nchile\noutweigh\nnanny\nstylish\nabrupt\ndemographics\nsimultaneous\ntabloid\nnonexistent\nfulfillment\nantiquity\nattacker\nnestle\nveer\ndownside\nautomotive\namazingly\nshred\ngunfire\nrefreshing\nnuisance\nailment\ntier\nheater\nreunite\nfugitive\nrecorded\nintrusion\nversatile\ncaucus\nwhore\ndizzy\nlutheran\nunchanged\nrumble\nhired\nvisualize\nbattalion\nsemiconductor\nsymphony\nputt\ncatholicism\ngrowl\njuicy\npurity\ngel\nsag\nintentional\ncontestant\nvomit\nbrokerage\nfrantically\nreiterate\nexterior\nrhythmic\nmakeshift\nendlessly\ndelightful\nskeptic\nbuffer\nconditioner\nanticipated\nhandgun\ncovert\nwrongdoing\naerobic\ngoodwill\ncandidacy\nperpetual\nbaseman\nimprovise\nfacet\ncollegiate\nbeckon\nassortment\nnavajo\nsubside\nillicit\nbuddhist\nslipper\nchallenger\ndisarm\nquiz\nimpede\nfreelance\naerospace\nmole\npreoccupation\nantibody\ninternally\ngeological\nclench\nbarren\nsuicidal\nneedy\nhinge\npetal\nhierarchical\ngraffiti\nbilling\noutspoken\nrestricted\nbob\ntimetable\nhypothesize\nwince\ncliche\nforefront\nchuck\npresbyterian\nspokesperson\ndifferential\nobservatory\nmundane\nwreckage\nliberalization\nraspberry\nprudent\ncelestial\nlest\nunanimous\nflute\ntavern\ncontinuation\nbarracks\nassassin\nnipple\ncedar\nsmear\ndangerously\nintellect\npopcorn\nbeginner\nflex\netch\nnightly\npersecution\nworthless\npreoccupied\ninspired\nrake\noutright\nquotation\nassassinate\nchestnut\ncilantro\nplumbing\nperennial\ntremendously\nlongevity\noverlap\nmuse\ninflate\nstunned\ninfuse\ntrickle\nvariant\nkinship\nanomaly\nintellectually\nmogul\nwindy\nhandler\nobsolete\ngreatness\nculprit\ndiffering\nzip\nbankrupt\ninsignificant\njointly\ncausal\nrecycled\novertake\ncoping\nwonderfully\ncache\nwatcher\narbitration\nintroductory\nbunk\nsweaty\nbedside\nexcavation\ngreedy\nsalvage\nsequel\ndisparate\nwail\nsurrogate\ndisadvantaged\npunitive\nstorytelling\nblender\nhelper\nyearly\nmisconduct\nshepherd\nscissors\nanecdote\nsophistication\ntoken\nadmittedly\nnegotiating\nsoybean\ndismissal\nautograph\nplywood\napparel\ncontentious\naccomplished\nfrail\ntrumpet\nentree\norchestrate\nrash\ndisgusting\nuniversally\nparticipating\njack\nhone\ngunshot\ncongestion\nverb\ncontinental\nsever\nindispensable\ncocoa\nancestral\nintently\nclearance\nwashing\ndye\nprocedural\nrevolt\nfactual\npamphlet\nbuckle\ndiscredit\nfern\nsalute\npajamas\nbun\nooh\njudaism\ninscription\noriental\nclasp\nmitigate\nfreak\nstepfather\ntidal\nhardwood\nchronicle\nswarm\nasbestos\nmixer\ncitrus\ngroundwater\nblockbuster\ndeterioration\nalteration\nintended\ngrit\nvantage\ntow\ninterruption\nraisin\nunrest\npuddle\nobstruction\nsoothe\nexperimentation\npeninsula\nvisionary\nduo\nblush\ncalling\ndespise\nenjoyable\ndismay\nmailbox\nfend\nemulate\nintruder\nuntouched\nlavish\npilgrim\ndoubtful\nshutter\nsymbolism\nrefrain\njelly\nchecklist\npointed\naffected\noutgoing\nmidwestern\nclone\nballroom\nlogging\nknuckle\ncurtail\nbladder\nmilestone\nceremonial\nhamper\nretrospective\nconfidentiality\nlineage\nreappear\nbooming\namusing\nherbal\nvegetarian\nbanquet\nfrost\nmotto\nchina\nluxurious\nratify\nequilibrium\ngravy\nsaid\nguaranteed\nseasoning\nfragrant\nupheaval\nwalker\nlava\nballpark\nirresistible\nphenomenal\ndamned\nsustainability\ntuberculosis\npeacefully\nfluorescent\nfireman\nsparkling\nimposing\nwomb\ninadvertently\nbouquet\nmurky\nsighting\nenclave\nbourgeois\nchalk\ndemanding\npsychologically\ntutor\npigment\npineapple\nfurnace\ndepressing\nanthrax\nleftist\nmediator\ntrek\ngadget\nstunt\nintuitive\ncaption\nfortress\nalcoholism\naugment\nracer\nnuance\nlifting\nwisely\ndevastation\nsafeguard\nundercut\ntouching\nshun\nbinding\neradicate\nunderwater\nmalaria\ndisplacement\nscam\ninterdisciplinary\ncrossroads\nfallout\nhorrific\nlarva\nraising\nrapper\ncartridge\nheed\nallergic\nlurch\ninsulin\nmidday\nbarber\nunsafe\nindonesian\nscant\nrocker\nliken\ngamble\nlicensed\nconsole\narabic\nreaffirm\nflea\nbrisk\nheave\nsolemn\njumper\nglaze\nbounty\ncramped\nconcur\nfatty\navoidance\nauthoritative\ncoma\nhymn\nfinn\ntolerant\nirritation\nostensibly\nhound\nblindness\nlivelihood\nchemist\ndread\ncamper\ndisregard\nrainfall\npaddle\ncranberry\ncrib\ngala\ninflammation\noutnumber\nsyllable\ninscribe\ndeprivation\nrevealing\nproxy\nclumsy\nalphabet\npunctuate\nspaghetti\nexpansive\nstringent\ninstinctively\nlimestone\npollute\nprod\nsliding\nportal\nenergize\nhandwriting\nmotivational\nmotherhood\nsingular\nhypocrisy\nfederally\namused\nautism\novert\ncovered\nbelongings\nmourning\nguru\nbacker\noutpost\ncaptive\ntextual\ncartel\ncurly\nmartian\ngin\nduplicate\ncoil\ninfer\nbedtime\nunreasonable\nconservatism\nreprint\nrename\nhunch\ngaming\nfundamentalist\nlineman\nredeem\nrichness\nhysterical\nfraternity\nfolly\ngerm\nunofficial\nbutcher\nchic\nstray\naffinity\ndrugstore\nstrangle\nhaitian\nelude\nappetizer\nreplica\nsprawl\ncontingent\ndaring\nfirsthand\nadvancing\ntwitch\npup\ntanker\nfellowship\noverflow\ncarton\nengender\nsponsorship\nbrigade\nshriek\nelegance\ndreadful\nartisan\nparamount\nshoreline\nsuffice\nglamour\naesthetics\nsponge\npowerless\ntowering\nlimo\nburgeoning\ndissertation\npreferably\nfridge\nneedless\ninconsistency\nterminology\nmenace\nopaque\nrewarding\nnausea\nacademically\nasparagus\nediting\noptics\nhorseback\nfuss\nfalter\norchid\ncracked\nhumiliate\nmultilateral\nhastily\ncactus\nnumb\npluralism\nhebrew\nwarden\nfamously\nracially\nwillingly\nmiraculous\nsocialization\ntyranny\nheavenly\npouch\ngravitational\ncupboard\nunnoticed\ncrackdown\nbreadth\namazement\nextinct\ngangster\nvividly\norphanage\nmuted\ncloning\nsterile\nnetworking\ngorilla\nrefinery\ncherokee\nimpetus\nlad\nscurry\nfutile\ncaring\nresidency\ncutter\nsalty\nhanging\nassimilation\nconspicuous\ninvasive\nplump\nbowel\naccused\nsatin\nidol\ncultivation\nasshole\nunilateral\nbraid\nhustle\nballad\nreshape\nstud\nbarefoot\nposit\nordinarily\ntenor\nplatoon\nplacebo\nshady\nlosing\nruthless\nmagician\nwaver\nemptiness\ncarcass\ncripple\noutlaw\necstasy\nradius\nfooting\nprophecy\nbroom\ntrendy\nscreenplay\nunison\nmotorist\nunthinkable\nlining\nbeet\nframed\nbanish\ngloom\nsalient\nbestow\ncandid\nintimidating\nhoist\nbandage\nundertaking\nassimilate\nupbeat\ntangle\nflier\ncounting\nmisconception\nwaiver\nsolving\nfairway\ndysfunction\nrearrange\nhasten\nprolong\njagged\ndigest\ndoughnut\nplume\nhesitant\nrelinquish\nnoteworthy\nflurry\ndismal\ncommence\napprehension\nclog\ninfantry\nsloppy\ntangled\npredicament\nalgae\ngarnish\nunmarried\nsweetness\noverride\nperish\nhealer\nattentive\nnotch\ndealership\ndonkey\nlocus\nblueberry\ntranscribe\nvicinity\nmotionless\nhumility\npleasing\nbillionaire\ntickle\njockey\nmango\nstuck\nlimp\nbiotechnology\ntraveling\nbony\nanthem\nvanity\nscour\ncaffeine\ndilute\ntelevised\ntwig\nbulky\nfreshwater\nskyline\nwaterway\nkite\nultraviolet\nwizard\nascend\nborrower\nexempt\ncompress\nmortal\nashore\ndownhill\npageant\neldest\novershadow\nlimiting\nrectangular\nlunge\nunhealthy\nreed\nalligator\nensue\nhavoc\nsulfur\nrum\nintimately\nterrified\nrepeal\nevade\ninference\npersuasion\nmonarchy\nchlorine\nriches\nhalo\nwed\nsane\npromotional\ncolonist\nsomber\ncontainment\nrobber\nengulf\nunsettle\nmalpractice\nsubtly\ngenerating\nmagnify\nadmirer\nbilingual\nmisguided\nmailing\ndeity\nsinister\nmetabolism\noutburst\nascertain\nwarranty\nauditorium\njuggle\nplainly\ncasket\ndeflect\ndefiance\npoisoning\nstarvation\nplentiful\ncaretaker\nmicroscopic\ndefining\nmower\nlofty\nrusty\nstaggering\nincarnation\nlimousine\namplify\nhorrify\nmeager\npollen\ngrunt\nfume\nshear\nterrestrial\nseeker\nsnowy\nluminous\nguitarist\ninauguration\nmaritime\ndryer\nfoyer\nbreaking\ndent\nmodernist\nrot\npermeate\nremotely\nalienation\npollster\nbash\nloophole\njug\nacquaint\nperk\nstatistic\nskater\nafflict\ndefiant\namass\nmanaged\napiece\nslum\ntaxation\nbrowse\nsoaring\nlicensing\nswollen\ntraverse\ntan\nprotector\ninefficient\nimplicitly\nprominently\nunto\ncyclist\noppressive\nthermometer\nsavvy\narousal\nfinite\nmow\ndisdain\ncape\nunnatural\ntrafficking\nimpart\nparachute\nvibrate\ncomer\npoignant\nprecursor\ndiscontent\nswoop\nmarketer\nspeedy\nhippie\ncleansing\nstatutory\namuse\neclectic\nvinyl\nunderline\nintimidation\ndissident\nhiker\nmileage\ncoaster\ntreadmill\nrelegate\nfaintly\nmotivated\nbrowser\ncentralized\nsnag\ngeologist\npundit\nstained\nnewfound\nabdomen\nspeculative\nconspire\nprescribed\nbearded\npartition\nuniformed\nshadowy\noust\ndeterrent\nreserved\nswelling\nsly\nhairy\npioneering\nentice\nsquarely\nquantify\npostseason\ncommunion\nrecurring\nsilicon\ninterpretive\nprom\nmarrow\ndenote\norbital\noccupied\nplatinum\nradiant\ntimeless\nstoryteller\nstitch\ndemolish\nbackbone\nnope\nberth\nsemifinal\ntransnational\nseminary\nloaded\ncheckpoint\nauthorization\nreceptor\nfuriously\ngreasy\nbonding\npopulist\ndevoid\nchaplain\narmchair\nimmoral\ngrieve\nbathtub\nwalkway\nsupernova\nassorted\nreceptive\nvoltage\nfinale\nheading\nvigor\nscarcity\ndarkened\nstiffen\nquarry\npediatrician\nuninsured\nincompetent\nharness\ndissipate\nleftover\nmahogany\npublicize\ndrizzle\nwallpaper\nfatality\nobscene\nvisibly\noxide\nbulge\ncoercion\nlocale\nreimbursement\ndiocese\nventilation\nensuing\nsubordinate\nmanure\nbidding\ntenet\npessimistic\nturbulent\nlongitudinal\ncynicism\nethnographic\naffirmation\ncombustion\ninviting\nrustic\ninvader\nholistic\ndiscrete\nstraddle\nmantle\naggravate\nnorwegian\ninsanity\nexaggerated\ncornerstone\ngeometric\nseductive\nluncheon\ncalled\nwreath\nproprietary\ntroublesome\nenclosure\ndisposable\ngloomy\nscribble\nwarhead\nsling\nkinda\nwooded\nflop\ntypewriter\namidst\nannoy\nmolest\nambivalence\nnighttime\npara\nflux\nquery\ntorn\nblizzard\ncondemnation\nindicative\numpire\nmanagerial\nimprisonment\ngothic\ntidy\nrevel\nhumorous\nblackness\nimpaired\nvista\nmelon\nlagoon\nworn\nunavailable\ndysfunctional\nforgotten\nbuyout\nscorer\nunmistakable\ndivisive\nsensational\nsoundtrack\nbeware\ncondominium\npertinent\nwrath\nshimmering\ndecor\nwiring\ninsofar\npresumption\nsmoky\nusefulness\nunanswered\nvocation\nbullshit\npulpit\ndownplay\nvineyard\nworldview\nconnected\nobedience\ntart\nendow\nequitable\nlogistics\nflinch\nphoton\nutilization\ndisseminate\nacknowledgment\nwitty\nracket\nrounded\nfavored\nwaterfront\nanyhow\ninjunction\nfret\nmoss\nrapist\ncareless\nrigor\nabandonment\nmarking\nobserved\nsuspended\nflatter\naltered\nstale\nfinishing\nshowing\nserum\nfetal\nrunaway\nlapse\nerrand\nballistic\nlevee\nsucker\nfrying\nkitten\ntraitor\nbarge\nunconventional\nenvoy\nchromosome\ndriven\nrealist\npsychiatry\nchopper\nrehab\njudiciary\nanalog\nespouse\nshowdown\nlame\nscientifically\ngraveyard\nmidtown\njournalistic\nimprovisation\niceberg\nrodent\nmarkedly\nmike\nyeast\npowdered\nthy\nthump\nparrot\ndivinity\ntraction\ntempo\nenrichment\nhegemony\nadherence\nstrew\nparalysis\nwilt\nflowing\ntermination\nfaulty\nunfairly\nacquit\npromised\nforceful\nbland\npediatric\nemblem\nconvergence\nhomage\ngateway\ndeserted\ntemplate\ncongratulations\nbotanical\ntack\npassword\nsailing\nthriving\nfed\naboriginal\nunification\nwane\nadjustable\ndisplaced\nstakeholder\nwillow\nsavage\nclipping\nmashed\nclinician\nstyling\nmantra\npickle\nimmensely\npatronage\nwatchdog\nstationary\nimagined\npalpable\nvirgin\nperiphery\ncosmetics\ncontinual\npitching\nimperfect\nrectangle\nwhim\nstern\nridicule\nengaging\nmobilization\nstatesman\nmarxist\ndj\ndenim\ncomparatively\nangular\nvilla\nproactive\nulcer\nstimulating\nhoof\ninvaluable\nrevert\nspotted\nringing\nbikini\ninfusion\nsensual\nappointee\nhalve\nhospitalize\ntranslucent\nzest\nfitting\npsychosocial\npoisonous\nstartled\ncoordinated\nbrutally\napproved\ncontaminated\nnumerical\ngrassy\nwinding\ntriumphant\nshampoo\nmosaic\nchandelier\nenthusiastically\nprecarious\navalanche\nconcentrated\nsanitation\nbiker\nsquadron\nrosy\nrepetitive\ncoupon\nrobotic\nunpaid\nshredded\npassionately\nbaker\nfootnote\nclam\ndownstream\nbreathtaking\nfestive\ngrope\nfolding\nfluffy\nvector\nsluggish\nmicrobe\nramification\nnotation\nengaged\nvenerable\ngust\nneutron\npurchasing\nseventeenth\npathology\nserene\nincompatible\nhungarian\nminced\nvain\nfir\nhearty\nsuppression\ncider\nholler\nblurt\nretarded\nvigil\ntaking\nbroke\nmodernism\nstairway\nintrude\northodoxy\ncerebral\ndope\nexcavate\ncrocodile\nparishioner\nmetric\nsnail\ncornerback\nosteoporosis\ndearly\nexemplary\nmapping\neuro\nfavorably\ngleam\ngait\nsymmetry\ncolombian\nzeal\nrejoin\nlocked\nresurrection\nacoustic\nearthly\ndecipher\nstressor\ncaravan\ninnate\nfinalist\nobsessive\nsincerely\nperverse\nhandmade\nelectronically\nsubsistence\nfragmented\nbabe\nlegion\nproficiency\ndeplete\nrhyme\ncoronary\nshattered\nmartini\nunresolved\nsect\nadept\ngambler\npatriarchal\nhandicapped\noutdated\nkosher\ncoastline\nforay\naccreditation\nanalogous\nbrittle\ncloudy\nscold\ntorque\ninstallment\nnecessitate\nslug\nho\nrebuilding\ncurricular\nsubtract\nunderstandably\nslowdown\nsectarian\nnourish\nupbringing\nsixteenth\nhysteria\nstrategically\nminivan\nprecipitate\nfestivity\nlikeness\nbarrage\ndrinker\ninspiring\nsavior\nhacker\npolymer\nthrift\nsubgroup\nreflex\nconsolation\nspaniard\nintolerance\nrust\nnicotine\ninsulate\nconglomerate\nhonorary\nreceptionist\ntransmitter\nivy\ncheerleader\nsealed\ndisproportionate\nbailout\naudition\nportuguese\noperative\ntownship\ndissatisfied\nanthology\nnotoriously\nherring\nvacancy\nregiment\nunbearable\nimprint\neloquent\nsupplemental\naddictive\npacking\nion\nseedling\nwares\nquaint\nnigger\nskid\nprehistoric\ntofu\nprojector\nascent\nfederation\nabuser\nhospice\nglobally\nbeta\nbrilliance\noasis\nthirsty\nmisfortune\nanecdotal\nreverence\nsmoked\ntapestry\ntelling\nobese\nhostess\nbalk\nthoughtfully\nestimation\nclad\nmonstrous\nprofess\naquarium\nscarlet\nadjective\ninception\njihad\nrosemary\nunintended\nfeud\nmonologue\nsquirm\nlecturer\ndisgrace\nbeaten\nmoratorium\nsprig\nembryonic\ncontaminant\nresurgence\nbrilliantly\nconvertible\nwinery\nanew\ngrad\nfledgling\naudible\nfuse\ndisapproval\nfabricate\nsow\nmodernize\npharmacist\nhardy\nstoop\npantry\navocado\nbrandy\ngetaway\ntrusted\nunused\ncasserole\npredictive\ncollateral\nsublime\ncomplexion\ndecency\nplaid\nnotwithstanding\ninternship\nforestry\ninfiltrate\ntestosterone\nparamedic\nwrench\ntendon\naccessibility\npixel\nenlightened\ninterrogate\nzucchini\necstatic\ngrieving\nwaive\nchatter\ndisintegrate\nheadnote\nconceivable\nobliterate\nthaw\nvisitation\nhypertension\nzipper\ndetach\nextravagant\nrover\nbrew\nbiopsy\nbelgian\nexploratory\nclientele\nsnore\nzinc\nmediocre\nheartland\nentrust\nadrenaline\nsparse\nendowment\ncutback\nbeacon\nreorganization\naye\nsacrament\nincremental\nremedial\nnarrate\ninflammatory\ntaut\ncaste\nglisten\nspeck\nunanimously\ngymnastics\ngritty\ncompleted\npleasantly\nsaloon\nrift\ncurfew\ntattered\ncourtship\nrendition\norgasm\nobjectivity\nundecided\ngracefully\nkuwaiti\nencyclopedia\npreseason\nshortfall\npentagon\ncellphone\nprogressively\nmelting\nadmirable\nsatire\nbiomass\nvictimization\ndues\nextraction\naffidavit\nprincipally\nbehold\nbeforehand\ncubicle\nproportional\nremorse\nwring\nyen\nmargarine\nlookout\npew\nneural\naustrian\nsewing\npedestal\nbatting\ntedious\ncot\nnostalgic\ndignified\nrelentlessly\nfolded\nscroll\nscripture\nmakeover\nhumanities\nomission\nturbulence\nreptile\nemeritus\nconfound\nparody\nalternatively\nmathematician\nrebate\nethiopian\nfleeting\nannoyance\ndiarrhea\nparanoia\ncadre\nabdominal\ndifferentiation\ninsecure\nbiographer\nrelocation\nspew\nmajestic\ncleanse\nsurreal\nidentifiable\nadopted\nindividualism\namnesty\ndisgusted\ndelineate\ncommend\nrink\nconfiscate\nneuron\nrafter\nparadoxically\ndeli\nresilience\nencircle\ngenerously\nhydraulic\ncoroner\nmeasured\nboldly\nlotion\ndelicately\nimpediment\nburglary\ndynasty\nrediscover\nwatery\ndisco\ndownsize\nbuttocks\nforcefully\nbewildered\nresurrect\nthee\nelectromagnetic\nforeclosure\npreferable\nbackfire\nindividuality\ncaptivity\ndefeated\nreassurance\ndownright\nderail\nsteward\nrevitalize\nbumper\nremake\nmanageable\nreciprocal\ntentatively\nkayak\nstorefront\nguise\nviral\nbipolar\nanxiously\nmenopause\nelectrode\nsparkle\nstylistic\ndisciplined\nornate\nrefinement\nneurological\noutpatient\nawkwardly\nedible\nthrilling\nneutralize\nchute\nfocused\nskyscraper\nthunderstorm\nbooklet\ninexperienced\nfunky\nschoolteacher\npronouncement\nyugoslav\ntheorize\nerratic\nstronghold\nexpend\nresilient\nmormon\ndispel\nhilarious\neggplant\nredesign\nairy\nrevere\nwiggle\ntaunt\nsyringe\nrenounce\nhandshake\nenvelop\npointer\nemigrate\ndistrust\nbribe\noverstate\ninvesting\nswath\nwhichever\ndisapprove\nkindly\nyawn\nlore\ngag\nhearth\nemphatically\ncloseness\ngal\nobstruct\nsimplistic\nimprobable\ncringe\nclimax\ntrudge\nczar\nbreeder\nsmuggler\nroadway\nmemorabilia\nfaucet\nunearth\nproclamation\ncaliber\nvictimize\nconfinement\nshard\nsharing\nglean\nupdated\nhumid\nvarsity\ncontributing\nhumiliating\nchoral\ntestament\nanthropological\ninduction\nambivalent\nwrapper\nworldly\nfillet\nunreliable\nfeeding\ntutoring\ndwindle\nstash\nshortstop\nrejoice\nunequal\nsuggestive\narid\nattributable\ndoorstep\nbiased\ncentimeter\nukrainian\nflyer\ndialect\nperuvian\nbungalow\nevergreen\npositioning\nwelcoming\nunspoken\nrecruiter\nsubstitution\ninconvenience\nkettle\nmisdemeanor\npatriarch\nsaucer\nrecurrence\nsleeper\ngeneralize\ntransient\ncaricature\nfoothill\nloot\nadoptive\nlegalize\nattire\ninfo\nracing\nderivative\nmacho\ncolonialism\nfrontal\nstrained\nviability\nmare\nsynonymous\nclothe\nabstinence\ntwirl\npicket\nbackcountry\npropulsion\nsub\nspreading\nblatant\noverboard\ninformative\nfunnel\nemmy\nstated\ncombatant\ndistorted\nfanatic\noutfielder\nfamilial\nhopelessly\nnominal\nfrivolous\nrecapture\nporn\nremembrance\nupstate\ngoing\nattainment\nrepercussion\nexceedingly\nmussels\nwrinkled\ndetachment\ntame\nrendering\nthirst\nmindful\nancestry\npictorial\nbison\ngenus\nflashy\ncohesion\ndebacle\nhygiene\nprovisional\nvial\nfunded\ncentennial\naccelerated\ndeport\ndweller\nardent\nrelive\namen\noversized\ndecoy\nrighteous\nnarration\nblare\ngobble\njolt\nmend\nsubpoena\nteller\nnaturalist\ndetrimental\nspiritually\ndemolition\ninternalize\nnoted\nmetaphysical\nunprepared\nappalling\nvaluation\nreorganize\nleafy\ntweak\ncheerfully\nponytail\nboiler\npowerfully\nlearned\nproprietor\nexaggeration\nailing\nunjust\naccentuate\nstrife\ndevout\npenetration\nfielder\nbaggy\nvalidation\nprimer\nadventurous\ngrimace\ngutter\nleash\nreinstate\ncolonization\npane\nprivatize\njordanian\nexporter\nbottled\nspecified\nstabilization\nfeeder\nstandoff\ntrainee\nchildbirth\nsmother\nrefund\nislamist\nbackstage\nstairwell\npropensity\nhorde\njeep\nauditory\nsynthesize\nalternately\nbreathless\ninfancy\nuncanny\nsolidify\nintersect\neyeball\ncraftsman\nforgiving\nmethodological\ndelusion\nhideous\naspiring\nmute\nphysiology\nascribe\ndampen\ntrafficker\nrouse\ndormitory\nhassle\nsincerity\nquirky\nplutonium\nstricken\nprofessionalism\neject\nunauthorized\nflatly\nmarshal\nstaffing\nremarry\nstipulate\noatmeal\nwatermelon\nadultery\nundesirable\natm\nescalating\ntreacherous\nforeman\nmemorandum\nfragmentation\nchanged\nmoderation\noutstretched\nrearview\nmulch\nmythical\nmover\nembodiment\nleukemia\ndwindling\nintrusive\nconfidently\ninfinitely\npowerhouse\nsyndicated\noverdue\nmetabolic\nshabby\ndetermining\noverhaul\nwarmly\nunnamed\ntrough\ngladly\nprolific\ngeneralized\nupwards\nmarginalize\ntenderness\ncognition\nbeige\nnigerian\nsidebar\nconducive\ndefective\nmammoth\npredatory\ntreasurer\ndisable\ncensor\nludicrous\narticulation\nchiefly\noptimum\ntreasury\ntrappings\ndagger\nthicket\nconceptualize\nrevolver\nsweatshirt\ndeterminant\nsanity\nidealism\nconstrue\nsuggested\nburglar\nscoff\nthrong\nprep\nspecificity\nbooze\ncampfire\nfervor\ntaiwanese\nveggie\npitfall\nshrewd\nabduction\noverlapping\nrevolutionize\nsubtlety\nclerical\nooze\nmommy\ncavern\nprerequisite\nhem\nprowess\ninvoluntary\ndugout\nsteaming\nantisocial\nastonished\nspearhead\npadded\nhamstring\nargentine\nmulticulturalism\nshortcut\nquad\nsimulated\nmagistrate\ntruce\nthreatening\nscowl\ntimer\nbeak\nbristle\nmistakenly\nrepository\nverification\nshallot\nsweetie\nlocality\ndiffusion\ntenuous\nmisty\ncollage\nunderside\nsplendor\nfalling\nrelational\nperjury\nhanger\nshingle\nknowingly\ncanister\nreassuring\nstrikingly\nmeticulous\npedagogical\nrefute\nspontaneously\npee\nsympathize\niris\nshowroom\nstillness\nneglected\nonslaught\ngarner\nschoolchild\nmilitarily\nblah\neminent\nrichly\nsubmerge\nrealistically\ndecorated\nbackseat\npastime\nfraudulent\nsinner\nvaccination\npebble\nhousekeeper\nblister\ninstitutionalize\nhindsight\nsputter\nbudge\nsaturate\njut\nincorrectly\nusable\nimposition\nmethane\nbiotech\nwhereabouts\nbedding\nraging\npeacekeeper\nimperialism\nrebellious\nthrottle\nshrinking\nillumination\nsliver\ndiscreet\nuniformly\nnewsroom\nallusion\ndivergent\nswivel\nforage\nbinary\ndated\ndane\nantioxidant\nthorn\nblackout\ninward\nquarrel\ntopping\npricey\nignition\ngrandma\narabian\nmurderous\nheady\nrestored\nrepel\nbookshelf\nfad\nespionage\nprenatal\ncensored\ncondone\nferocious\nbulldozer\ncontemplation\ngraphite\nhitch\nrehabilitate\ngulp\nsubdued\nethos\nhomecoming\ngaping\nrationality\nbloated\nwoodland\nhomogeneous\nheadset\nprofitability\ndementia\nsociological\nspeaking\npertaining\niced\nbogus\ndelicacy\ntitanium\nseismic\nspree\nmasculinity\nflair\ndelve\nhandcuff\ninland\ntroll\nunpublished\ngiddy\nadamant\ncashier\nafloat\ngalley\npuree\nfella\nfrigid\nitinerary\noverrun\njig\nhepatitis\necologist\ngloss\ninsistent\ndisturbed\neconomical\nimaginable\ncovenant\ngush\nwildflower\nflipping\ninfinity\ndichotomy\nnibble\nfurther\nastonishment\nconvent\nghostly\nstylist\ncorpus\nmini\nexpulsion\nundocumented\nesteem\ntinker\ncontextual\nquartet\nbarricade\ntaint\ntruthful\nhomelessness\nconcerted\ntrample\ndummy\nsubversive\nbog\nrut\nriding\nmadden\ntimid\nlandslide\nfieldwork\ndeduct\nrummage\nacademia\ntandem\ndoze\nurgently\npenalize\nvice\nvulgar\nimproperly\ndestabilize\nedgy\nwrongly\nsemantic\nwrestler\nupstream\nentourage\nborrowing\naccompaniment\nax\nobligate\nambush\ncreepy\ncroatian\nanglo\nincorporation\ntaboo\nsymposium\nneutrino\nbirdie\nclarification\ndeference\nfelon\nchancellor\nrecourse\nsunscreen\njanitor\npurport\nadversity\nslit\nmedically\nkernel\ncorroborate\ndeserving\nincite\nhamlet\nimpatience\nremodel\nartificially\nanarchy\nroadblock\nquicker\ndiscriminatory\ncoerce\neyepiece\naxe\nprimate\ncumin\nassertive\nimmortal\nyolk\npicturesque\nparchment\nnoticeably\noats\nterrorize\noily\nmaternity\nflagship\nwreak\nascii\nrecurrent\nacutely\nunsuccessfully\npalate\nconnotation\ncampsite\ndepressive\nrented\nwhack\nwasher\nseminal\nbidder\nskeletal\nmenacing\ndebilitating\nrainforest\nrelieved\ngeopolitical\ncustomize\ncaveat\narithmetic\nspore\npatterned\ntargeted\nfolklore\nbustling\npublicist\nsubvert\ngruesome\nredirect\nmeasurable\nquarterly\naw\nhospitalization\nwad\nliter\nravine\ntributary\nstately\npenchant\nquicken\nrepressive\nabnormality\nabduct\ncrumbling\nunpack\ndepress\nboon".split("\n");
  let freqSet = new Set();
  function rebuildFreqSet() { freqSet = new Set(FREQ_ALL.slice(0, settings.freqCutoff || 8000)); }

  function buildBadge() {
    badgeEl = document.createElement('div');
    badgeEl.dataset.swcUi = '1';
    badgeEl.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483646;display:none;cursor:pointer;' +
      'background:#f9690e;color:#fff;font:bold 13px/1 system-ui,sans-serif;padding:10px 12px;border-radius:20px;' +
      'box-shadow:0 4px 14px rgba(0,0,0,.25);user-select:none;';
    badgeEl.onclick = () => {
      if (!panelEl) buildPanel();
      panelEl.style.display = panelEl.style.display === 'none' ? 'flex' : 'none';
      refreshPanel();
    };
    document.documentElement.appendChild(badgeEl);
  }

  function registerMenus() {
    GM_registerMenuCommand('生词面板', () => {
      if (!panelEl) buildPanel();
      panelEl.style.display = 'flex'; refreshPanel();
    });
    GM_registerMenuCommand('设置', showSettings);
    GM_registerMenuCommand('重新同步 Anki 已收藏词', async () => {
      try { const n = await syncAnkiWords(); toast('同步完成：' + n + ' 条笔记已纳入', 3000); }
      catch (e) { toast('同步失败：' + e.message, 4000); }
    });
    GM_registerMenuCommand('导出词表', exportKnown);
    GM_registerMenuCommand('导入词表', importKnown);
    GM_registerMenuCommand('备份词表到云', backupToCloud);
    GM_registerMenuCommand('从云恢复词表（合并）', restoreFromCloud);
    GM_registerMenuCommand('测试 AnkiConnect', testConnection);
  }

  function start() {
    injectCSS();
    rebuildFreqSet();
    buildBadge();
    updateBadge();
    registerMenus();
    rescan();
    mo.observe(document.body, { childList: true, subtree: true });
    if (!settings.inited) {
      settings.inited = true; saveSettings();
      toast('SWC 已启用：生词高亮→点击收录→右下角徽标一键入库。菜单里可打开设置。', 5000);
    }
    const stale = !settings.lastSync || Date.now() - settings.lastSync > 3 * 86400000;
    if (stale) {
      syncAnkiWords().then((n) => toast('已从 Anki 同步 ' + n + ' 条已收藏生词', 3000))
        .catch(() => toast('Anki 生词同步失败（Anki 没开？稍后可在菜单手动同步）', 4000));
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
