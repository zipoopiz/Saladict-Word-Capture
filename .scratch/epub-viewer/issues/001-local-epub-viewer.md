# 001 本地 EPUB 阅读页

**状态**：待开工
**阻塞**：无

## 背景

overlay 架构做不了「内容容器」，但 EPUB 可以用一个极小的本地阅读页解决：脚本在顶层 DOM 接管高亮/收录，几乎白嫖（见 CONTEXT.md 决策 1）。

## 关键约束（决定方案取舍）

- 油猴 `@match *://*/*` 只匹配 http(s)，**file:// 不注入** → 阅读页必须跑在 `http://localhost:PORT` 下（现有 @match 已覆盖，无需改元数据）
- **epub.js 默认把内容渲染进 iframe，与 `@noframes` 冲突** → 不用 epub.js

## 方案（推荐 b）

- (a) ~~epub.js~~：iframe 渲染，脚本进不去，废弃
- (b) **自写渲染**：epub 本质是 zip——fflate/jszip（CDN 引入）解压 → 解析 container.xml 取 spine 顺序 → 逐章把 (X)HTML 内文清理后注入顶层 `<div>`（滚动阅读，不做精确分页）

## 规格

- 单 HTML 文件 + 本地静态服务（`python -m http.server` 即可，ticket 不写服务代码）
- 拖入/选择 `.epub` → 按章节列表渲染；章节切换 + localStorage 记进度
- 正文是顶层 DOM 文本节点 → SWC 的高亮/点词/短语收录/面板入库全链路可用，零脚本改动
- 样式：只设阅读宽度/行高/字号，宿主 CSS 污染由 `[data-swc-ui]` 隔离机制反着保证（页面自身样式自己管）

## 验收标准

- [ ] 打开一本 epub，生词黄底、熟词灰底
- [ ] 点词建卡 → 面板入库成功，Url/Title 字段合理（localhost 页面）
- [ ] 关掉重开，进度还在
