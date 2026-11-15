# Saladict Word Capture — 项目语境

给 agent 的单向导：术语、已冻结的架构决策、路线图指针。改动前先读这里。

## 这是什么

油猴脚本：网页阅读时高亮英文生词 → 点击收录（单词/2-5 词短语）→ 批量生成 Anki 卡（`Saladict Word Cloze` 模型 + 有道发音 + 可选 LLM 句翻核验）。复习完全外包给 Anki（FSRS）。

## 架构决策（已冻结，勿重新讨论）

1. **overlay 路线，零服务器**：不建阅读站、不导入内容，整个网页即阅读器。所有状态在 Tampermonkey 存储 + Anki。
2. **Anki 是唯一复习端与词库事实源**；本脚本只负责「读时的词状态」。
3. **视频分工**：YouTube = 原生字幕时间戳 + 点句跳播（本脚本自己做）；本地视频/流媒体 = asbplayer 负责挖矿卡（音频+截图），本脚本提供「桥」补文字字段；播客/有声书 = whisper 转写歌词页（`tools/whisper-lyrics.mjs`，网页化而非同步器）。
4. **模板单一**：所有卡统一 `Saladict Word Cloze` 模型（真 cloze 类型；字段含 Picture，媒体字段由 asbplayer 写入）。
5. **词状态判定优先级**：个人生词 > 显式熟词 > 已收藏 > COCA 频率表 > 生词。
6. **失败策略**：词典/LLM/发音失败一律不阻塞主流程，留清单事后补（`repairAudio` / 重试按钮）。

## 术语

- **半成品卡**：asbplayer 落的卡——Audio/Picture/Title/Url 已写好，ContextCloze/Translation/Note 为空
- **桥**：本脚本的「补全视频卡」功能，把半成品卡补成与网页卡同构
- **熟词表**（knownSet）/ **已收藏**（savedSet）/ **个人生词**（personalUnkSet）：三层词状态表
- **墓碑**（ingestedIds）：已入库词条 id，防队列复活重复建卡

## 路线图

ticket 文件在 `.scratch/<feature>/issues/`，按序：
`video-bridge`（已实现 v0.7.0）→ `epub-viewer`（de74d93）→ `youtube-seek`（v0.8.0）→ `stats-badge`（v0.8.1）→ `whisper-lyrics`（e432eab）——均已实现，真机验收项见各 ticket
