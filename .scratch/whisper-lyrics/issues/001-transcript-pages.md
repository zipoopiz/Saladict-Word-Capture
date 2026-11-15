# 001 whisper 转写歌词页（播客/有声书）

**状态**：待开工
**阻塞**：无

## 背景

音文对齐是 LingQ 全产品工程量最大的一块，overlay 做不了「真·同步器」，但可以做**网页化**：本地音频转写成带时间戳的静态「歌词页」，SWC 在上面照常高亮/收录（对话决策 Q12：(b) 路线）。YouTube 连 whisper 都不用，本 ticket 只管本地音频。

## 方案

- 离线 CLI 脚本（`tools/whisper-lyrics.mjs`，node）：faster-whisper 或 whisper.cpp 转写 → 生成单文件 HTML
- HTML 形态：`<audio src="...">` + `<p data-t="12.3">sentence</p>` 列表 + 三行内联 JS（点击句子 `audio.currentTime = data-t` 并播放）
- 页面是普通静态页 → 挂在 `http://localhost:PORT` 下（同 epub-viewer 的约束：油猴不进 file://）
- SWC 在页面上的高亮/收录/入库全链路零改动

## 规格

- CLI：`node tools/whisper-lyrics.mjs <audio> [--model base.en]` → 输出同名 `.html`
- 时间戳精度：句级（whisper segments）；转写质量差时允许 `--srt` 从外部 SRT 生成（跳过 whisper）
- 生成页不依赖网络（whisper 模型/CDN 之外零依赖）

## 验收标准

- [ ] 一个 30 分钟 mp3 → HTML，localhost 打开，生词高亮正常
- [ ] 点句子跳播对应时间点
- [ ] 收录的词入库后，卡 Context 来自歌词句，正常复习

## 明确不做

不做同步滚动高亮（跟着音频逐句点亮）——那是「同步器」，属 LingQ 最贵的那块；歌词页 + 手动点播已覆盖 90% 场景。真要了再开新 ticket。
