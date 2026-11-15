// 从 userscript 抽出 //<<CORE ... //CORE>> 纯逻辑区做单元测试
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { webcrypto, createHash, createHmac } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto; // Node 18 下的 WebCrypto

const src = fs.readFileSync(new URL('../saladict-word-capture.user.js', import.meta.url), 'utf8');
const core = src.split('//<<CORE')[1].split('//CORE>>')[0];
const fns = new Function(core + `
return { genCandidates, classifyToken, splitSentences, findWordBounds, extractSentenceAt,
  clozeify, buildClozeFromContext, parseTimestamp, statsLine, parseYoudaoEc, parseFreeDict, safeFilename, hashStr, yyyymmdd, buildNoteFields,
  sha256Hex, sigv4Headers, amzDateNow, parseS3Endpoint, s3RegionService, buildBackupDump, mergeBackup, xmlErr,
  ossPresignV2, isOssHost, bytesToB64, SWC_MODEL, normPhrase, parsePhraseSelection };`)();

let passed = 0;
const pending = [];
function t(name, fn) {
  pending.push((async () => {
    try { await fn(); passed++; console.log('  ok -', name); }
    catch (e) { console.error('  FAIL -', name, '\n    ', e.message); process.exitCode = 1; }
  })());
}

// ---- 屈折还原 ----
t('candidates: running -> run', () => {
  assert.ok(fns.genCandidates('running').includes('run'));
});
t('candidates: fulfilled -> fulfil/fulfill', () => {
  const c = fns.genCandidates('fulfilled');
  assert.ok(c.includes('fulfil') && c.includes('fulfill'));
});
t('candidates: studies -> study', () => {
  assert.ok(fns.genCandidates('studies').includes('study'));
});
t('candidates: went -> go (irregular)', () => {
  assert.ok(fns.genCandidates('went').includes('go'));
});
t('candidates: tufts -> tuft', () => {
  assert.ok(fns.genCandidates('tufts').includes('tuft'));
});
t('candidates: men -> man (irregular plural)', () => {
  assert.ok(fns.genCandidates('men').includes('man'));
});
t('candidates: happily -> happy', () => {
  assert.ok(fns.genCandidates('happily').includes('happy'));
});
t('candidates: classes -> class', () => {
  assert.ok(fns.genCandidates('classes').includes('class'));
});

// ---- 三态分类 ----
const freq = new Set(['run', 'study', 'cat']);
const saved = new Set(['fulfil', 'fulfill', 'tuft']);
const known = new Set(['myword']);
const personal = new Set();
t('classify: running -> known (freq)', () => {
  assert.equal(fns.classifyToken('running', known, saved, freq, personal), 'known');
});
t('classify: fulfilled -> saved (已收藏优先于 freq)', () => {
  const f2 = new Set(['fulfil']);
  assert.equal(fns.classifyToken('fulfilled', known, saved, f2, personal), 'saved');
});
t('classify: known 显式表优先于 saved', () => {
  const s2 = new Set(['myword']);
  assert.equal(fns.classifyToken('mywords', known, s2, freq, personal), 'known');
});
t('classify: xqzzjk -> unknown', () => {
  assert.equal(fns.classifyToken('xqzzjk', known, saved, freq, personal), 'unknown');
});

// ---- 手动标识生词（个人生词表覆盖频率表/显式熟词） ----
t('classify: freq 熟词 + 个人生词标记 -> unknown', () => {
  const p = new Set(['run']);
  assert.equal(fns.classifyToken('running', known, saved, freq, p), 'unknown');
});
t('classify: 个人生词标记覆盖显式熟词', () => {
  const k = new Set(['myword']);
  const p = new Set(['myword']);
  assert.equal(fns.classifyToken('mywords', k, saved, freq, p), 'unknown');
});
t('classify: 词形变化命中个人生词表', () => {
  const p = new Set(['tuft']);
  assert.equal(fns.classifyToken('tufts', known, new Set(), freq, p), 'unknown');
});

// ---- 分句 ----
t('sentences: Mr. 缩写不切分', () => {
  const r = fns.splitSentences('Mr. Smith went to Washington. He liked it.');
  assert.equal(r.length, 2);
  assert.equal(r[0].start, 0);
});
t('sentences: 小数点不切分', () => {
  assert.equal(fns.splitSentences('It costs 3.5 dollars. Fine.').length, 2);
});
t('sentences: 引号内叹号后正确切分', () => {
  const r = fns.splitSentences('She said "Stop!" Then left.');
  assert.equal(r.length, 2);
  assert.ok(fns.splitSentences('She said "Stop!" Then left.')[0].end <= 17);
});
t('sentences: 缩写词 e.g.', () => {
  assert.equal(fns.splitSentences('Use tools, e.g. hammers. Done.').length, 2);
});
t('sentences: 单句完整', () => {
  const r = fns.splitSentences('One two three.');
  assert.equal(r.length, 1);
  assert.equal(r[0].end, 14);
});

// ---- 句子提取与挖空 ----
const novel = 'First sentence here. Tom ran quickly to the store, and then he ran back home before dinner. Last one!';
t('extract: 命中第二句且 occurrence=1', () => {
  const idx = novel.indexOf('ran back');
  const r = fns.extractSentenceAt(novel, idx);
  assert.ok(r.sentence.startsWith('Tom ran quickly'));
  assert.ok(r.sentence.endsWith('dinner.'));
  assert.equal(r.occurrence, 1);
});
t('clozeify: 同句多个同词全部挖空（同一 c1）', () => {
  const r = fns.extractSentenceAt(novel, novel.indexOf('ran back'));
  const c = fns.clozeify(r.sentence, r.word);
  assert.ok(c.includes('{{c1::ran}} quickly'));
  assert.ok(c.includes('{{c1::ran}} back'));
  assert.equal(c.match(/\{\{c1::/g).length, 2);
});
t('clozeify: 基本形态', () => {
  assert.equal(fns.clozeify('The cat sat.', 'cat'), 'The {{c1::cat}} sat.');
});
t('clozeify: 保留原大小写', () => {
  const c = fns.clozeify('Tom Ran fast.', 'ran');
  assert.equal(c, 'Tom {{c1::Ran}} fast.');
});
t('clozeify: 不同词形不误挖', () => {
  assert.equal(fns.clozeify('He runs daily.', 'ran'), 'He runs daily.');
});
t('clozeify: 词尾标点不干扰', () => {
  assert.equal(fns.clozeify('He ran, and ran.', 'ran'), 'He {{c1::ran}}, and {{c1::ran}}.');
});
t('extract: 超长句子截断后仍含词且长度受限', () => {
  const long = 'A'.repeat(400) + ' hallucination ' + 'B'.repeat(400) + '. End.';
  const r = fns.extractSentenceAt(long, long.indexOf('hallucination'));
  assert.ok(r.sentence.length <= 330);
  assert.ok(r.sentence.includes('hallucination'));
  assert.ok(fns.clozeify(r.sentence, r.word).includes('{{c1::hallucination}}'));
});

// ---- 短语划词 ----
t('phrase: parsePhraseSelection 基本形态', () => {
  assert.equal(fns.parsePhraseSelection('put off'), 'put off');
  assert.equal(fns.parsePhraseSelection('"Put Off."'), 'put off');
  assert.equal(fns.parsePhraseSelection('  look   forward to '), 'look forward to');
  assert.equal(fns.parsePhraseSelection('well-known figures are'), 'well-known figures are');
});
t('phrase: 弯引号归一化', () => {
  assert.equal(fns.parsePhraseSelection('don’t give up'), "don't give up");
});
t('phrase: 单词/超长/含内部标点拒绝', () => {
  assert.equal(fns.parsePhraseSelection('put'), null);
  assert.equal(fns.parsePhraseSelection('one two three four five six'), null);
  assert.equal(fns.parsePhraseSelection('put, off'), null);
  assert.equal(fns.parsePhraseSelection(''), null);
});
t('phrase: 2-5 词句子片段按规则放行', () => {
  assert.equal(fns.parsePhraseSelection('I put it off.'), 'i put it off');
});
t('phrase: normPhrase 折叠空白剥标点', () => {
  assert.equal(fns.normPhrase('  Put   Off. '), 'put off');
  assert.equal(fns.normPhrase('’Round the Bend'), 'round the bend');
});
t('phrase: extractSentenceAt 带 endIdx 提取短语与出现序号', () => {
  const text = 'We put off the meeting. They put off the trip and put off the rest.';
  // 选中同句最后一处 "put off"（前一句的 meeting 不应混入）
  const start = text.lastIndexOf('put off');
  const r = fns.extractSentenceAt(text, start, 320, start + 'put off'.length);
  assert.equal(r.word, 'put off');
  assert.equal(r.occurrence, 1); // 同句前面已出现一次
  assert.ok(r.sentence.includes('put off the rest'));
  assert.ok(!r.sentence.includes('meeting'));
  assert.ok(fns.clozeify(r.sentence, r.word).split('{{c1::put off}}').length - 1 === 2);
});
t('phrase: clozeify 短语多处出现全挖空', () => {
  assert.equal(fns.clozeify('They put off and put off the trip.', 'put off'),
    'They {{c1::put off}} and {{c1::put off}} the trip.');
});
t('phrase: mergeBackup 短语表并集', () => {
  const r = fns.mergeBackup(
    { known: [], saved: [], personal: [], queue: [], phrases: ['put off'] },
    { phrases: ['Put  Off.', 'look forward to'] }
  );
  assert.deepEqual(r.phrases.sort(), ['look forward to', 'put off']);
});
t('phrase: buildBackupDump 带 phrases 字段', () => {
  const d = fns.buildBackupDump([], [], [], [], {}, ['put off']);
  assert.deepEqual(d.phrases, ['put off']);
});

// ---- 词典解析（真实响应夹具） ----
t('youdao: fulfilled 双词性释义+音标', () => {
  const d = JSON.parse(fs.readFileSync('/tmp/youdao_fulfilled.json', 'utf8'));
  const r = fns.parseYoudaoEc(d);
  assert.equal(r.phonetic, 'fʊlˈfɪld');
  assert.equal(r.glosses[0], 'adj. 有成就感的，感到满足的');
  assert.ok(r.glosses[1].startsWith('v.'));
});
t('youdao: tufts 单词性释义', () => {
  const d = JSON.parse(fs.readFileSync('/tmp/youdao_tufts.json', 'utf8'));
  const r = fns.parseYoudaoEc(d);
  assert.ok(r.glosses[0].startsWith('n. 塔夫茨'));
});
t('youdao: amateur 多义项', () => {
  const d = JSON.parse(fs.readFileSync('/tmp/youdao_amateur.json', 'utf8'));
  const r = fns.parseYoudaoEc(d);
  assert.ok(r.glosses.length >= 2);
});
t('youdao: ec 缺失返回 null', () => {
  assert.equal(fns.parseYoudaoEc({ web_trans: {} }), null);
});
t('freedict: 英文释义解析', () => {
  const r = fns.parseFreeDict([{
    phonetic: '/test/',
    phonetics: [],
    meanings: [{ partOfSpeech: 'noun', definitions: [{ definition: 'a thing' }] }]
  }]);
  assert.equal(r.phonetic, '/test/');
  assert.equal(r.glosses[0], 'noun. a thing');
});

// ---- 卡片字段组装（对齐现有 633 张卡的惯例） ----
t('buildNoteFields: 惯例与字段完整性', () => {
  const f = fns.buildNoteFields({
    word: 'amateur', translation: 'adj. 业余的', sentence: 'He is an amateur.',
    cloze: 'He is an {{c1::amateur}}.', note: '他是业余的。',
    title: 'Test Page', url: 'https://example.com/a#frag', favicon: 'https://example.com/f.ico',
    dateAdded: 1710000000000
  });
  assert.equal(f.Date, '1710000000000');            // 毫秒时间戳字符串
  assert.equal(f.Text, 'amateur');
  assert.equal(f.Audio, '');                        // 留空，由 addNote audio 参数追加 [sound:..]
  assert.equal(f.ContextCloze, 'He is an {{c1::amateur}}.');
  assert.equal(f.Url, 'https://example.com/a#frag');
  assert.deepEqual(Object.keys(f), ['Date', 'Text', 'Translation', 'Context', 'ContextCloze',
    'Note', 'Title', 'Url', 'Favicon', 'Audio', 'Picture']); // 字段顺序与模型一致
});
t('safeFilename: 非法字符替换', () => {
  assert.equal(fns.safeFilename("don't"), 'SW_don_t.mp3');
});
t('hashStr: 稳定且区分输入', () => {
  assert.equal(fns.hashStr('abc'), fns.hashStr('abc'));
  assert.notEqual(fns.hashStr('abc'), fns.hashStr('abd'));
});

// ---- 云备份 ----
const AV = { access: 'AKIDEXAMPLE', secret: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY' };
t('sigv4: AWS 官方 get-vanilla 测试向量', async () => {
  const h = await fns.sigv4Headers({
    method: 'GET', url: 'https://example.amazonaws.com/', body: '',
    accessKey: AV.access, secretKey: AV.secret,
    region: 'us-east-1', service: 'service',
    amzDate: '20150830T123600Z', s3Compat: false
  });
  assert.equal(h.Authorization,
    'AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, ' +
    'SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
});
t('sigv4: S3 兼容模式带 content-sha256 头', async () => {
  const body = '{"a":1}';
  const h = await fns.sigv4Headers({
    method: 'PUT', url: 'https://bucket.oss-cn-hangzhou.aliyuncs.com/swc-backup.json', body,
    accessKey: 'AK', secretKey: 'SK', region: 'oss-cn-hangzhou', service: 's3',
    amzDate: '20261004T000000Z', s3Compat: true
  });
  const expected = createHash('sha256').update(body).digest('hex'); // 独立实现交叉验证
  assert.equal(h['x-amz-content-sha256'], expected);
  assert.match(h.Authorization, /SignedHeaders=host;x-amz-content-sha256;x-amz-date/);
});
t('amzDateNow: 格式 YYYYMMDDTHHMMSSZ', () => {
  assert.match(fns.amzDateNow(), /^\d{8}T\d{6}Z$/);
});
t('parseS3Endpoint: 虚拟主机式与路径式', () => {
  assert.deepEqual(fns.parseS3Endpoint('https://mybk.oss-cn-hangzhou.aliyuncs.com'),
    { host: 'mybk.oss-cn-hangzhou.aliyuncs.com', bucket: 'mybk', pathStyle: false });
  assert.deepEqual(fns.parseS3Endpoint('https://acc.r2.cloudflarestorage.com/mybk'),
    { host: 'acc.r2.cloudflarestorage.com', bucket: 'mybk', pathStyle: true });
});
t('buildBackupDump: 剔除 llmKey 且字段齐全', () => {
  const d = fns.buildBackupDump(['a'], ['b'], ['c'], [{ id: 'x' }], { llmKey: 'sk-secret', deckName: 'd' });
  assert.equal(d.settings.llmKey, undefined);
  assert.equal(d.settings.deckName, 'd');
  assert.equal(d.app, 'swc');
  assert.deepEqual(d.personalUnknown, ['c']);
});
t('mergeBackup: 并集合并+队列去重', () => {
  const r = fns.mergeBackup(
    { known: ['a', 'b'], saved: [], personal: ['p'], queue: [{ id: 'q1' }] },
    { known: ['b', 'c'], saved: ['s'], personalUnknown: [], queue: [{ id: 'q1' }, { id: 'q2' }] }
  );
  assert.deepEqual(r.known.sort(), ['a', 'b', 'c']);
  assert.deepEqual(r.saved, ['s']);
  assert.equal(r.queue.length, 2);
  assert.deepEqual(r.counts, { known: 2, saved: 1, personal: 0, queueAdded: 1 });
});
t('mergeBackup: 墓碑拦掉已入库词，恢复不复活旧队列', () => {
  const r = fns.mergeBackup(
    { known: [], saved: [], personal: [], queue: [] },
    { queue: [{ id: 'done1' }, { id: 'done2' }, { id: 'fresh' }] },
    ['done1', 'done2']
  );
  assert.deepEqual(r.queue.map((q) => q.id), ['fresh']);
  assert.equal(r.counts.queueAdded, 1);
});
t('s3RegionService: 阿里OSS 用 service=oss 且 region 自动补 oss- 前缀', () => {
  assert.deepEqual(fns.s3RegionService('mybk.oss-cn-hangzhou.aliyuncs.com', 'cn-hangzhou'),
    { region: 'oss-cn-hangzhou', service: 'oss' });
  assert.deepEqual(fns.s3RegionService('mybk.oss-cn-hangzhou.aliyuncs.com', 'oss-cn-hangzhou'),
    { region: 'oss-cn-hangzhou', service: 'oss' });
});
t('s3RegionService: 非 OSS 服务保持标准 s3', () => {
  assert.deepEqual(fns.s3RegionService('acc.r2.cloudflarestorage.com', 'auto'),
    { region: 'auto', service: 's3' });
  assert.deepEqual(fns.s3RegionService('s3.amazonaws.com', ''),
    { region: 'us-east-1', service: 's3' });
});
t('xmlErr: 提取 OSS 错误码与消息', () => {
  const xml = '<?xml version="1.0" encoding="UTF-8"?><Error><Code>SignatureDoesNotMatch</Code><Message>The request signature we calculated does not match</Message><RequestId>x</RequestId></Error>';
  assert.equal(fns.xmlErr(xml), 'SignatureDoesNotMatch: The request signature we calculated does not match');
});
t('xmlErr: 无 Code 时原样截断', () => {
  assert.equal(fns.xmlErr('<html>oops</html>'), '<html>oops</html>');
  assert.equal(fns.xmlErr(''), '');
  assert.equal(fns.xmlErr(null), '');
});

// ---- YouTube 点句跳播 ----
t('ts: 秒/分/时 三种形态', () => {
  assert.equal(fns.parseTimestamp('0:15'), 15);
  assert.equal(fns.parseTimestamp('15:20'), 920);
  assert.equal(fns.parseTimestamp('1:02:33'), 3753);
});
t('ts: 带空白容忍，非法拒绝', () => {
  assert.equal(fns.parseTimestamp(' 2:05 '), 125);
  assert.equal(fns.parseTimestamp('1:2'), null);
  assert.equal(fns.parseTimestamp('12:3:4'), null);
  assert.equal(fns.parseTimestamp('abc'), null);
  assert.equal(fns.parseTimestamp(''), null);
  assert.equal(fns.parseTimestamp(null), null);
});

// ---- 面板统计行 ----
t('stats: 三项齐备', () => {
  assert.equal(fns.statsLine(12, 34, 633), '熟词 12 · 已收藏 34 · Anki 卡 633');
});
t('stats: Anki 未连接以 — 占位', () => {
  assert.equal(fns.statsLine(12, 34, null), '熟词 12 · 已收藏 34 · Anki 卡 —');
  assert.equal(fns.statsLine(0, 0, undefined), '熟词 0 · 已收藏 0 · Anki 卡 —');
});

// ---- EPUB 阅读页纯逻辑（epub-viewer.html 同款 CORE 抽取） ----
const epubCore = fs.readFileSync(new URL('../epub-viewer.html', import.meta.url), 'utf8')
  .split('//<<CORE')[1].split('//CORE>>')[0];
const ev = new Function(epubCore + `
return { parseContainerXml, parseOpfXml, zipPathResolve, extractBodyHtml, decodeBytes, attrOf };`)();

t('epub: container.xml 提取 OPF 路径', () => {
  const xml = '<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">' +
    '<rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>';
  assert.equal(ev.parseContainerXml(xml), 'OEBPS/content.opf');
  assert.equal(ev.parseContainerXml('<rootfiles/>'), null);
});
t('epub: OPF 解析 manifest+spine，顺序保留', () => {
  const opf = '<?xml version="1.0"?><package>' +
    '<manifest>' +
    '<item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>' +
    '<item id="c1" href="text/chapter1.xhtml" media-type="application/xhtml+xml"/>' +
    '<item id="c2" href="text/chapter%20two.xhtml" media-type="application/xhtml+xml"/>' +
    '</manifest>' +
    '<spine toc="ncx"><itemref idref="c1"/><itemref idref="c2"/></spine></package>';
  const r = ev.parseOpfXml(opf);
  assert.deepEqual(r.spine, ['c1', 'c2']);
  assert.equal(r.manifest.c1.href, 'text/chapter1.xhtml');
  assert.equal(r.manifest.c2.mediaType, 'application/xhtml+xml');
  assert.equal(ev.parseOpfXml('<package/>').spine.length, 0);
});
t('epub: zip 路径解析（相对/向上/百分号编码）', () => {
  assert.equal(ev.zipPathResolve('OEBPS/text', 'chapter1.xhtml'), 'OEBPS/text/chapter1.xhtml');
  assert.equal(ev.zipPathResolve('OEBPS/text', '../styles/main.css'), 'OEBPS/styles/main.css');
  assert.equal(ev.zipPathResolve('', 'a/b%20c.xhtml'), 'a/b c.xhtml');
  assert.equal(ev.zipPathResolve('OEBPS', './x.xhtml'), 'OEBPS/x.xhtml');
  assert.equal(ev.zipPathResolve('', '/root.xhtml'), 'root.xhtml');
});
t('epub: 内文清洗——剥 script/style/link/img 与事件属性', () => {
  const x = '<html><head><style>p{}</style></head><body>' +
    '<h1>Hi</h1><script>alert(1)</script><img src="a.png" onclick="x()"/>' +
    '<p onmouseover="y()" style="color:red">Text with <a href="javascript:evil()">link</a> and <a href="https://ok.example">ok</a>.</p>' +
    '</body></html>';
  const out = ev.extractBodyHtml(x);
  assert.ok(out.includes('<h1>Hi</h1>'));
  assert.ok(!out.includes('script'));
  assert.ok(!out.includes('img'));
  assert.ok(!out.includes('onclick'));
  assert.ok(!out.includes('javascript:'));
  assert.ok(out.includes('https://ok.example'));
});
t('epub: UTF-8 优先，损坏回退 GB18030', () => {
  assert.equal(ev.decodeBytes(new TextEncoder().encode('中文正文')), '中文正文');
  assert.equal(ev.decodeBytes(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4])), '中文'); // GBK 字节
});

// ---- AWS V2 签名（OSS 主用） ----
t('isOssHost: 识别 OSS 虚拟主机/路径式/加速端点', () => {
  assert.ok(fns.isOssHost('mybk.oss-cn-hangzhou.aliyuncs.com'));
  assert.ok(fns.isOssHost('oss-cn-beijing.aliyuncs.com'));
  assert.ok(fns.isOssHost('mybk.oss-accelerate.aliyuncs.com'));
  assert.ok(!fns.isOssHost('acc.r2.cloudflarestorage.com'));
});
t('v2 预签名: 虚拟主机式 PUT，签名与 node:crypto 独立实现一致', async () => {
  const signed = await fns.ossPresignV2({
    method: 'PUT', url: 'https://mybk.oss-cn-hangzhou.aliyuncs.com/swc-backup.json',
    endpoint: 'https://mybk.oss-cn-hangzhou.aliyuncs.com',
    contentType: 'application/json', expires: 1780000000,
    accessKey: 'AK', secretKey: 'SK'
  });
  const sts = 'PUT\n\napplication/json\n1780000000\n/mybk/swc-backup.json';
  const sig = createHmac('sha1', 'SK').update(sts).digest('base64');
  assert.equal(signed,
    'https://mybk.oss-cn-hangzhou.aliyuncs.com/swc-backup.json' +
    '?OSSAccessKeyId=AK&Expires=1780000000&Signature=' + encodeURIComponent(sig));
});
t('v2 预签名: 路径式 GET 资源含 bucket 且无 Content-Type 段内容', async () => {
  const signed = await fns.ossPresignV2({
    method: 'GET', url: 'https://acc.r2.cloudflarestorage.com/mybk/swc-backup.json',
    endpoint: 'https://acc.r2.cloudflarestorage.com/mybk',
    contentType: '', expires: 1780000000,
    accessKey: 'AK', secretKey: 'SK'
  });
  const sts = 'GET\n\n\n1780000000\n/mybk/swc-backup.json';
  const sig = createHmac('sha1', 'SK').update(sts).digest('base64');
  assert.equal(signed,
    'https://acc.r2.cloudflarestorage.com/mybk/swc-backup.json' +
    '?OSSAccessKeyId=AK&Expires=1780000000&Signature=' + encodeURIComponent(sig));
});
t('xmlErr: 提取兄弟元素里的 StringToSign', () => {
  const xml = '<Error><Code>SignatureDoesNotMatch</Code><Message>does not match</Message>' +
    '<StringToSign>PUT\n\napplication/json\n123\n/mybk/x.json</StringToSign></Error>';
  assert.ok(fns.xmlErr(xml).includes('StringToSign="PUT\\n\\napplication/json\\n123\\n/mybk/x.json"'));
});
t('bytesToB64: 分块转换与 Buffer 一致', () => {
  const small = new Uint8Array([0, 1, 2, 254, 255]);
  assert.equal(fns.bytesToB64(small), Buffer.from(small).toString('base64'));
  const big = new Uint8Array(200000).map((_, i) => i % 256);
  assert.equal(fns.bytesToB64(big), Buffer.from(big).toString('base64'));
});

// ---- 视频卡补全（asbplayer 桥）----
t('bridge: 原样定位，同句多处全挖空', () => {
  const r = fns.buildClozeFromContext('He ran, and ran fast.', 'ran');
  assert.equal(r.cloze, 'He {{c1::ran}}, and {{c1::ran}} fast.');
  assert.equal(r.matched, 'ran');
});
t('bridge: 忽略大小写且保留句中大小写', () => {
  const r = fns.buildClozeFromContext('Poisonous mushrooms.', 'poisonous');
  assert.equal(r.cloze, '{{c1::Poisonous}} mushrooms.');
});
t('bridge: 短语跨空白弹性', () => {
  const r = fns.buildClozeFromContext('They put  off the trip.', 'put off');
  assert.equal(r.cloze, 'They {{c1::put  off}} the trip.');
});
t('bridge: 屈折兜底 met -> meet，挖句中真实词形', () => {
  const r = fns.buildClozeFromContext('I met him yesterday.', 'meet');
  assert.equal(r.cloze, 'I {{c1::met}} him yesterday.');
  assert.equal(r.matched, 'met');
});
t('bridge: 屈折兜底 putting -> put', () => {
  const r = fns.buildClozeFromContext('He is putting off the meeting.', 'put');
  assert.equal(r.cloze, 'He is {{c1::putting}} off the meeting.');
});
t('bridge: 屈折兜底不规则变形 children -> child', () => {
  const r = fns.buildClozeFromContext('Children like it.', 'child');
  assert.equal(r.cloze, '{{c1::Children}} like it.');
});
t('bridge: 词边界不误伤（cat≠category）', () => {
  assert.equal(fns.buildClozeFromContext('The category is new.', 'cat'), null);
});
t('bridge: 短语屈折不兜底，进人工清单', () => {
  assert.equal(fns.buildClozeFromContext('She is putting it off.', 'put off'), null);
});
t('bridge: 找不到/空输入返回 null', () => {
  assert.equal(fns.buildClozeFromContext('Nothing relevant here.', 'xylophone'), null);
  assert.equal(fns.buildClozeFromContext('', 'x'), null);
  assert.equal(fns.buildClozeFromContext('ctx', ''), null);
});

// ---- 内嵌模型定义（首次入库一键创建用） ----
t('SWC_MODEL: 字段与 buildNoteFields 输出顺序一致', () => {
  const f = fns.buildNoteFields({ word: 'x', dateAdded: 1 });
  assert.deepEqual(fns.SWC_MODEL.fields, Object.keys(f));
});
t('SWC_MODEL: 背面模板顶部图片区+发音行且无大括号笔误', () => {
  assert.ok(fns.SWC_MODEL.back.startsWith('{{#Picture}}')); // v0.6.0 配图：图片区在模板顶部
  assert.ok(fns.SWC_MODEL.back.includes('{{Audio}}'));
  assert.ok(fns.SWC_MODEL.back.includes('{{type:cloze:ContextCloze}}'));
  assert.ok(!fns.SWC_MODEL.back.includes('{{{{'));
});
t('SWC_MODEL: 正面是 cloze 模板', () => {
  assert.ok(fns.SWC_MODEL.front.includes('{{cloze:ContextCloze}}'));
  assert.ok(fns.SWC_MODEL.front.includes('{{type:cloze:ContextCloze}}'));
});

await Promise.all(pending);
console.log(process.exitCode ? '\n有失败用例' : `\n全部通过：${passed} 用例`);
