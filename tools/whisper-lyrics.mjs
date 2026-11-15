#!/usr/bin/env node
// 播客/有声书 → whisper 转写 → 带 时间戳 的静态「歌词页」，SWC 在页面上照常高亮/收录（CONTEXT.md 决策 3）。
// 用法：
//   node tools/whisper-lyrics.mjs <audio>                          # 走 whisper.cpp 转写
//   node tools/whisper-lyrics.mjs <audio> --srt 已有.srt           # 跳过转写，直接从 SRT 生成
//   可选：--model base.en  --whisper-bin /path/to/whisper-cli  -o out.html
// 依赖（仅转写路径需要）：whisper.cpp 的 whisper-cli（PATH 或 --whisper-bin）+ ffmpeg（mp3 转 16k wav）。
// 输出页与音频放同一目录，挂 http://localhost 静态服务打开（file:// 油猴不注入）。
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// ---- SRT 解析：块 = 序号行 + 时间行 + 文本行；返回 [{t, text}]（t 秒，毫秒精度） ----
export function parseSrt(srt) {
  const out = [];
  const blocks = String(srt || '').replace(/\r/g, '').split(/\n\n+/);
  for (const b of blocks) {
    const m = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*\d{1,2}:\d{2}:\d{2}[,.]\d{1,3}/.exec(b);
    if (!m) continue;
    const t = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4].padEnd(3, '0')) / 1000;
    const text = b.split('\n')
      .filter((l) => !/^\s*\d+\s*$/.test(l) && !l.includes('-->'))
      .join(' ').trim();
    if (text) out.push({ t, text });
  }
  return out;
}

// ---- 歌词页模板：零网络依赖的静态页；点句跳播；正文是顶层 DOM 文本，SWC 直接接管 ----
export function renderLyricsHtml(title, audioSrc, segments) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const src = String(audioSrc).split('/').map(encodeURIComponent).join('/'); // 逐段编码，保留路径分隔符
  const items = segments.map((s) => '<p data-t="' + Number(s.t).toFixed(1) + '">' + esc(s.text) + '</p>').join('\n');
  return '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">\n' +
    '<title>' + esc(title) + '</title>\n' +
    '<style>body{margin:0;background:#faf9f7;color:#333;font:16px/1.8 Georgia,"Songti SC",serif}' +
    'header{position:sticky;top:0;z-index:10;display:flex;gap:12px;align-items:center;flex-wrap:wrap;' +
    'padding:10px 16px;background:#f9690e;color:#fff;font:13px/1.4 system-ui,sans-serif}' +
    'audio{width:min(520px,92vw)} main{max-width:42em;margin:0 auto;padding:24px 20px 60vh}' +
    'p{cursor:pointer}p:hover{background:#fff3e0;border-radius:6px}</style>\n</head>\n<body>\n' +
    '<header><b>🎧 ' + esc(title) + '</b><audio controls preload="none" src="' + esc(src) + '"></audio></header>\n' +
    '<main>\n' + items + '\n</main>\n' +
    '<script>\n' +
    "document.addEventListener('click', (e) => {\n" +
    "  const p = e.target.closest('p[data-t]');\n" +
    "  if (!p) return;\n" +
    "  if (document.querySelector('.swc-popup')) return; // 点词查词时不抢跳播\n" +
    "  const a = document.querySelector('audio');\n" +
    "  a.currentTime = parseFloat(p.dataset.t);\n" +
    "  a.play();\n" +
    '});\n' +
    '</script>\n</body>\n</html>\n';
}

// ===================== CLI（薄壳，测试只覆盖上面两个纯函数） =====================

function parseArgs(argv) {
  const opts = { model: 'base.en', whisperBin: '', srt: '', out: '', input: '' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--model') opts.model = argv[++i];
    else if (a === '--whisper-bin') opts.whisperBin = argv[++i];
    else if (a === '--srt') opts.srt = argv[++i];
    else if (a === '-o' || a === '--out') opts.out = argv[++i];
    else if (!opts.input) opts.input = a;
  }
  return opts;
}

function fail(msg) {
  console.error('失败：' + msg);
  process.exit(1);
}

function transcribe(input, opts) {
  const bin = opts.whisperBin || 'whisper-cli';
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'swc-whisper-'));
  const wav = path.join(work, 'in.wav');
  const ff = spawnSync('ffmpeg', ['-y', '-i', input, '-ar', '16000', '-ac', '1', wav], { encoding: 'utf8' });
  if (ff.error || ff.status !== 0) fail('ffmpeg 转码 16k wav 失败（装了吗？）。也可以跳过转写：--srt 已有字幕.srt');
  const prefix = path.join(work, 'out');
  const w = spawnSync(bin, ['-m', opts.model, '-f', wav, '-of', prefix, '-osrt'], { encoding: 'utf8' });
  if (w.error || w.status !== 0) fail('whisper 转写失败（' + bin + '）。可 --whisper-bin 指定路径，或 --srt 跳过转写');
  const srtPath = prefix + '.srt';
  if (!fs.existsSync(srtPath)) fail('whisper 未产出 SRT（检查 --model 路径）');
  return fs.readFileSync(srtPath, 'utf8');
}

function main(argv) {
  const opts = parseArgs(argv);
  if (!opts.input) {
    console.log('用法: node tools/whisper-lyrics.mjs <audio> [--srt 已有.srt] [--model base.en] [--whisper-bin 路径] [-o out.html]');
    process.exit(0);
  }
  if (!fs.existsSync(opts.input)) fail('找不到输入文件 ' + opts.input);
  const srtText = opts.srt
    ? fs.readFileSync(opts.srt, 'utf8')
    : transcribe(opts.input, opts);
  const segments = parseSrt(srtText);
  if (!segments.length) fail('SRT 里没有可用的字幕块');
  const audioName = path.basename(opts.input);
  const html = renderLyricsHtml(path.basename(audioName, path.extname(audioName)), audioName, segments);
  const outPath = opts.out || opts.input.replace(/\.[^.]+$/, '') + '.html';
  fs.writeFileSync(outPath, html);
  console.log('已生成 ' + outPath + '（' + segments.length + ' 句）');
  console.log('与音频放同目录，用 http://localhost 静态服务打开本页（file:// 油猴不注入），SWC 高亮/收录照常可用。');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2));
}
