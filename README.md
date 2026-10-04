# Saladict Word Capture

网页阅读时**高亮英文生词 → 点击收录单词+上下文 → 读完后一键批量生成 Anki 卡片**（Saladict Word 卡片形态，自动带有道美音发音）。

## 文件

| 文件 | 说明 |
|---|---|
| `saladict-word-capture.user.js` | 油猴脚本本体（词表已内嵌，无需其他依赖） |
| `tests/core.test.mjs` | 核心逻辑单元测试（30 用例）：`node tests/core.test.mjs` |
| `coca10k.json` | COCA 高频词表源文件（已内嵌进脚本，仅留档，可删） |

## 安装

1. 浏览器（Edge/Chrome）安装 [Tampermonkey](https://www.tampermonkey.net/) 扩展
2. Tampermonkey 面板 → 添加新脚本 → 粘贴 `saladict-word-capture.user.js` 全文并保存（或把 `.user.js` 文件拖进浏览器）
3. 确认 Anki 桌面版在运行（AnkiConnect 已装）

首次打开任意网页，脚本会自动从 Anki 同步已收藏的 633+ 生词，之后：
- **生词**：黄底高亮；**已收藏过的词**：灰底弱高亮；熟词不标
- **任何单词都能点击**（链接/按钮/划选文字时不会劫持）→ 浮层显示有道释义和将入卡的句子
  - 生词/已收藏词浮层：**【生成卡片/再建一张卡】** 收进待办队列、**【我认识，不再问】** 加入熟词表
  - 熟词浮层（频率表判"熟"但你其实不认识）：**【其实不认识，加入生词】** —— 该词移出熟词判定，此后黄底高亮
- 读完后点右下角 **📚 徽标** 打开面板 → **【全部入库】** 批量建卡（带成功/失败清单）
- 队列里每条待办可点 **✎ 编辑上下文**——站点元信息（Rated/Chapters/Words 之类）混进句子时，入库前手动删掉即可，保存时自动重新生成挖空

> 如果整体词汇量低于频率表档位，直接在 设置 → 频率表截断 里调低（3000/5000/8000/10000），比逐词标记省事；逐词标记适合零星纠正。

## 卡片去向

- deck：`english_learning`（可在设置里改）
- 模型：**`Saladict Word Cloze`** —— 这是原 `Saladict Word` 模型的逐字节克隆（字段/模板/CSS 完全一致），仅把底层的笔记类型改成了真正的 cloze

### 为什么需要克隆模型

实测发现：原 `Saladict Word` 模型是 **type=0 标准模型**，但其模板和全部 633 张旧卡的 `ContextCloze` 字段都在用 `{{c1::…}}` 语法。当前 Anki 后端在 `addNote` 时会**拒绝**"非 cloze 模型的字段里出现 cloze 标记"的笔记；而这台机器的 AnkiConnect 版本较老（无 `updateModel` 动作），API 改不了原模型类型。克隆成真 cloze 模型后新卡可以正常入库，旧卡不受任何影响。

- 回退：删除 `Saladict Word Cloze` 模型即可（无卡片引用时无副作用）
- 统一：想合并的话，在 Anki 浏览器里选中旧笔记 → 右键"更改笔记类型"迁移到新模型（Anki 自带功能，手动操作）
- 原模型背面模板有 `{{{{type:cloze:` 多两层大括号的笔误，按你的要求**原样保留**（新模型同样保留），介意的话在模板编辑器里删掉两个大括号即可

## 设置（油猴菜单）

| 菜单项 | 说明 |
|---|---|
| 生词面板 | 打开待办队列 |
| 设置 | AnkiConnect 地址、deck、模型名、词频档位（前 N 词视为已认识，默认 8000）、发音类型（美/英音）、**排除元素**、LLM 配置 |
| — 排除元素 | CSS 选择器（逗号分隔），匹配元素内的文字不扫描、不高亮、不会被收进上下文。例如 fanfiction.net 的故事统计行填 `.xgray`，侧边栏广告填 `.sidebar, #ads` |
| 重新同步 Anki 已收藏词 | 把 Anki 里的生词重新拉进"已收藏"高亮集合 |
| 导出/导入词表 | 熟词表 + 个人生词表 JSON 备份，不锁死在浏览器里 |
| 备份词表到云 / 从云恢复（合并） | WebDAV（坚果云）或 S3 兼容（阿里 OSS 等）云端备份，见下方"云备份"章节 |
| 测试 AnkiConnect | 检查连通性、模型名、deck 名 |

## 词典与 LLM（可选）

- **释义**：有道非官方 jsonapi（词性+中文释义+音标），失效时自动落到 FreeDictionaryAPI（英文释义）。接口是 unofficial 的，坏了可换。
- **发音**：有道 `dictvoice`（默认美音），由 Anki 通过 addNote 的 audio 参数自行下载进 `collection.media`，离线可复习。
- **LLM**（可选）：OpenAI 兼容接口，填 Base URL / Key / 模型名后启用——每次入库一次调用，产出整句中文翻译（存 Note 字段）并核验词典义是否贴合语境（不贴合时改写 Translation）。**不配置则词典义直填、句翻留空，功能不受影响。**

## 云备份（WebDAV / S3 兼容）

油猴菜单 → **备份词表到云** / **从云恢复词表（合并）**；配置在 设置 → 云备份。

- **WebDAV（坚果云 / Nextcloud / Alist）**：坚果云网页版 → 账户信息 → 安全选项 → 添加**应用密码**；先在网页上建个文件夹（如 `SWCBackup`），设置里填 `https://dav.jianguoyun.com/dav/SWCBackup` + 注册邮箱 + 应用密码。目录不存在时脚本会自动尝试创建。
- **S3 兼容（阿里 OSS / 腾讯 COS / Cloudflare R2 / MinIO）**：填含 bucket 的 Endpoint（虚拟主机式 `https://bucket.oss-cn-hangzhou.aliyuncs.com` 或路径式 `https://<accountid>.r2.cloudflarestorage.com/<bucket>` 都支持）、Region（OSS 填 `oss-cn-hangzhou`，R2 填 `auto`）、AccessKey/Secret。签名用 AWS SigV4（已用 AWS 官方测试向量验证），S3 签名要求当前页面是 HTTPS。
- **备份内容**：熟词表、已收藏词、个人生词表、待办队列、设置（**LLM key 不上传**）。存为单个 `swc-backup.json`。
- **恢复 = 合并**：词表取并集、队列按 id 去重追加，**不覆盖本机设置**——适合多设备互备，不会互相冲掉数据。
- **自动备份**：勾选「入库成功后自动备份到云」后，每次批量入库成功会自动上传一份。

## 数据与隐私

所有状态（熟词表、待办队列、设置）存本机 Tampermonkey 存储；外部请求仅：有道词典、（可选的）你配置的 LLM、AnkiConnect 本机回环。

## 已知限制

- 仅在顶层页面生效（`@noframes`），不支持 shadow DOM 内的正文
- 划选短语建卡（多词表达）留作二期
- 网页结构极端的站点（强 CSP/动态渲染）如高亮失效，可在 Tampermonkey 里对该站单独关闭
