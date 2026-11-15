# 001 补全视频卡（asbplayer 桥）

**状态**：已实现（v0.6.0），单元测试 72 例全绿；验收标准待 asbplayer 真机联调勾选
**阻塞**：无代码阻塞。一次性人工配置见「前置」。

## 背景

视频挖矿走 asbplayer（选字幕、圈词、录音、截图），落下的卡是**半成品**：媒体字段已写好，`ContextCloze`/`Translation`/`Note` 为空——能看但正面不挖空，复习无效。桥把它们补成与网页建卡同构的完整卡。设计全程走对话拷问冻结（见 CONTEXT.md 决策 3/4）。

## 前置（一次性人工配置，约 10 分钟）

asbplayer 扩展设置 → Anki：

```
Deck:      english_learning
Note type: Saladict Word Cloze
wordField=Text   sentenceField=Context   audioField=Audio
imageField=Picture  sourceField=Title     urlField=Url
```

注意是 **Picture**（模型现有字段，原版 Saladict 图片命名 `SW_IMG_*.jpg`），不是 Image。

## 规格

- 入口：📚 面板状态行 + 按钮；油猴菜单「补全视频卡」双入口
- 查询：`note:"<modelName>" ContextCloze:""` —— 只捞半成品卡，天然幂等
- 每张卡依次：
  1. 在 Context 定位 Text → 生成挖空写 `ContextCloze`（纯函数 `buildClozeFromContext`，策略见下）
  2. `Translation` 为空 → 有道/FreeDict 补词典义（前 2 条 `<br>` 连接，与 `ingestOne` 同惯例）
  3. `Note` 为空且配置了 LLM → `llmRefine` 补整句翻译并核验词典义贴语境（失败不阻塞）
  4. `Audio` 无 `[sound:` → 有道 TTS 兜底（storeMediaFile + 写字段；下载失败进 audioRetryList）
  5. `updateNoteFields` 写回；`genCandidates(word)` 进 savedSet（网页阅读即变灰底）
- **媒体字段（Audio 已有值时/Picture/Title/Url）全程只读**
- 不加 tag（asbplayer 自己的 tag 保留）

### buildClozeFromContext 定位策略

1. 原样匹配：`\b` 词边界 + 忽略大小写 + 短语内部空白弹性 → 命中处全部挖空（同一 c1，v0.3.9 惯例）
2. 单词屈折兜底：Context 逐 token 走 `genCandidates` 还原后与 `normPhrase(Text)` 比对（met↔meet、putting↔put、children↔child），命中的 surface 全部挖空；短语不走此策略（组合爆炸），直接失败进清单
3. 都失败 → null → 失败清单：`word（正文中未定位到该词）`，人工去 Anki 浏览器改或重试

## 验收标准

- [ ] asbplayer 建一张半成品卡 → 面板显示「待补全视频卡 1 张」→ 点按钮 → 卡完整（正面挖空、背面音频/截图/释义/句翻）
- [ ] 屈折用例：Text=meet / Context 含 met → 挖中 met；Text=put off / Context 含 putting it off → 进失败清单
- [ ] 重跑无副作用（查询天然只捞空的）
- [ ] `node tests/core.test.mjs` 全绿
- [ ] 同词同句的网页收录被幂等去重拦下（`ingestOne` 查重对桥建的卡同样生效）
