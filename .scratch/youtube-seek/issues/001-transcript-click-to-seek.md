# 001 YouTube 字幕面板点句跳播

**状态**：待开工
**阻塞**：无

## 背景

LingQ 的视频课 = 字幕文本化 + 逐句同步，但它自己拉字幕转写对齐，长期漂移。YouTube 原生字幕自带时间戳——**同步精度白嫖**（见 CONTEXT.md 决策 3）。词级交互（高亮/查词）已随主脚本在 YouTube 可用（v0.5.3 修过其 CSP/Trusted Types）；本 ticket 只补「点句跳播」。

## 关键约束

- transcript 面板（`ytd-transcript-segment-renderer`）是顶层 DOM，词级扫描已覆盖
- YT 播放器 API（`#movie_player` 的 `seekTo/playVideo`）在**页面上下文**，content script 隔离 world 碰不到 → 需注入 script 元素或 postMessage 桥
- 点击段落里的词 = 查词浮层（主脚本行为），**不能劫持成 seek**

## 规格

- 在 transcript 每段注入一个小 ▶ 按钮（`[data-swc-ui]` 隔离），点 ▶ → 播放器 seek 到该段时间戳并播放
- 时间戳来源：段落自身的时间戳文本（如 `0:15`）解析为秒
- 词点击行为不变（▶ 按钮拦截自己的 click，不冒泡）
- 油猴菜单加开关（部分用户不想要 UI 注入）

## 验收标准

- [ ] 带字幕视频 → 打开 transcript → 点 ▶ 跳句播放
- [ ] 段内点词查词、划选短语收录不受影响
- [ ] YouTube 改版导致选择器失效时静默降级（不报错刷屏）

## 风险

YouTube DOM 频繁改版，选择器会脆——失效时 fallback 是「对着时间戳手动拖进度条」，可接受，不为此做自适应 DOM 爬取。
