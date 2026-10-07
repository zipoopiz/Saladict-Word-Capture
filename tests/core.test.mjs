// 从 userscript 抽出 //<<CORE ... //CORE>> 纯逻辑区做单元测试
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { webcrypto, createHash, createHmac } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto; // Node 18 下的 WebCrypto

const src = fs.readFileSync(new URL('../saladict-word-capture.user.js', import.meta.url), 'utf8');
const core = src.split('//<<CORE')[1].split('//CORE>>')[0];
const fns = new Function(core + `
return { genCandidates, classifyToken, splitSentences, findWordBounds, extractSentenceAt,
  clozeify, parseYoudaoEc, parseFreeDict, safeFilename, hashStr, yyyymmdd, buildNoteFields,
  sha256Hex, sigv4Headers, amzDateNow, parseS3Endpoint, s3RegionService, buildBackupDump, mergeBackup, xmlErr,
  ossPresignV2, isOssHost, bytesToB64, SWC_MODEL };`)();

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
    'Note', 'Title', 'Url', 'Favicon', 'Audio']); // 字段顺序与模型一致
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

// ---- 内嵌模型定义（首次入库一键创建用） ----
t('SWC_MODEL: 字段与 buildNoteFields 输出顺序一致', () => {
  const f = fns.buildNoteFields({ word: 'x', dateAdded: 1 });
  assert.deepEqual(fns.SWC_MODEL.fields, Object.keys(f));
});
t('SWC_MODEL: 背面模板自带发音行且无大括号笔误', () => {
  assert.ok(fns.SWC_MODEL.back.startsWith('{{#Audio}}'));
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
