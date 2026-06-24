# Obsidian 论文笔记管理插件 — 开发说明与指引

> 本文件是独立开发上下文的完整输入：包含数据模型、分区数据源、功能需求（含优先级与验收标准）、技术架构与实现细节。开发时不需要再读论文笔记流程模板，但建议参考两个现成实现：`venue_rankings.py`（分区匹配逻辑）与 `notes-web/server.py`（同一数据模型的 Web 端实现）。

## 1. 项目目标

为个人 Obsidian 论文笔记库开发一个**浏览、筛选、管理**插件。核心场景：

1. 按 **论文等级（star）、期刊/会议、CCF 等级、JCR/中科院分区、大方向、小方向、年份、论文类型** 等维度组合筛选论文；
2. 表格/卡片形式浏览全部论文，点击进入论文详情（同目录多份子笔记以 tab 切换）；
3. 常驻的元数据质量检查（缺字段、分区匹配失败、产物缺失）。

插件名建议：`paper-vault`（暂定，开发者可改）。语言：界面简体中文。

## 2. 数据现状

### 2.1 Vault 与目录结构

- Vault 路径：`/Users/zky/Library/CloudStorage/Dropbox/应用/remotely-save/科研与论文/科研与论文`
- 论文库根目录（vault 内相对路径）：`论文笔记/`
- 目录层级即分类信息：

```text
论文笔记/
├── <大方向>/                    # 如：深度伪造检测、图像压缩感知、多模态大模型
│   ├── <小方向>/                # 如：图像、音频、视频检测、漏洞检测（可能不存在，论文直接放大方向下）
│   │   └── <File Stem>/         # 一篇论文一个文件夹，文件夹名 = 清洗后的论文标题
│   │       ├── <File Stem>.md                 # 主笔记（type: FolderNote）★索引入口
│   │       ├── <File Stem>-简报.md
│   │       ├── <File Stem>-方法介绍.md
│   │       ├── <File Stem>-实验结果.md
│   │       ├── <File Stem>-审阅建议.md
│   │       ├── <File Stem>-后续灵感.md
│   │       ├── <File Stem>-marp.md            # Marp 演示稿源码
│   │       ├── <File Stem>-NotebookLM简报.md  # 可选
│   │       ├── <File Stem>-NotebookLM博文.md  # 可选
│   │       ├── <File Stem>_infographic_zh.png # 可选，视觉信息图（banner）
│   │       ├── <File Stem>_slides_zh.pdf      # 可选，slide deck（旧论文可能是 .pptx）
│   │       ├── plan.md                        # 流程文件，索引时忽略
│   │       └── images/                        # 可选，原论文插图
```

- 当前规模：约 60 篇论文、586 个文件、7 个大方向。注意**部分论文没有小方向层**（如 `图像压缩感知/Physics-Inspired Compressive Sensing.../` 直接在大方向下），层级深度 2 或 3 都合法。
- 综述类论文的子笔记文件名与常规论文**相同**（仍叫 -方法介绍/-实验结果），内容模板不同，靠 `paper-kind` 字段区分。

### 2.2 主笔记 frontmatter schema（索引数据源）

每篇论文唯一的 `type: "FolderNote"` 笔记是索引单元。真实示例（节选）：

```yaml
---
banner: "SSD - Making Face Forgery Clues Evident Again With Self-Steganographic Detection_infographic_zh.png"
uid: "20260611132216"            # 14 位时间戳，可作"收录时间"排序
type: "FolderNote"               # ★索引判定条件
desc: "提出自隐写检测 SSD：……"     # 一句话定位
tags:
  - "Area/Paper/深度伪造检测"      # 第一个 Area/Paper/* 标签 = 大方向
  - "Area/Paper/图像隐写"          # 后续 = 次要方向
technique:
  - "自隐写（Self-Steganography）"
category-path: "图像"             # 小方向（领域内分类，可能为多级 "A / B"）
method-category: "deep-learning" # survey|traditional|deep-learning|theory|benchmark|system|other
zotero-key: "V688FSWQ"
zotero-url: "zotero://select/library/items/V688FSWQ"
title: "SSD: Making Face Forgery Clues Evident Again With Self-Steganographic Detection"
citekey: "XiaSSD2026"
paperType: "journalArticle"      # conferencePaper|journalArticle|reviewArticle|preprint
paper-kind: "regular"            # regular|survey|ambiguous
publication-year: "2026"
author:
  - "[[Ruiyang Xia]]"            # 注意：作者是 wikilink 字符串，需剥掉 [[ ]]
venue: "IEEE Transactions on Pattern Analysis and Machine Intelligence"
venue-abbrev: "TPAMI"
star: "⭐⭐⭐⭐"                  # 1–5 个 ⭐ 字符，按字符数解析为等级
file-stem: "SSD - Making Face Forgery Clues Evident Again..."  # ★主键
---
```

字段健壮性约定（必须容错）：

- 缺失值可能是 `""`、`[]`，或显式降级文案：`"论文未报告"`、`"无法从文中确认"`、`"未提供公开链接"`、`"未执行外部检索，无法确认"`——这些都视为"无值"。
- 早期论文可能缺少部分字段（如无 `paper-kind`、无 `star`）；缺字段不能让索引崩溃，应进 QA 面板。
- 子笔记的 frontmatter 有 `parentNote: "[[<File Stem>]]"` 指回主笔记，可用于反向聚合。

### 2.3 分区/等级数据源（随插件打包或放 vault 固定目录）

源文件位于流程仓库 `data/` 下，开发时复制进插件资源目录：

| 文件 | 内容 | 关键结构 |
|------|------|---------|
| `data/ccf/ccf_2026_lookup.json` | CCF 2026 目录 | 顶层键：`version`、`by_short_name`、`by_full_name`、`by_normalized_key`。`by_normalized_key` 的值是数组，元素含 `short_name`、`full_name`、`rank`（"A"/"B"/"C"）、`kind`（conference/journal）、`area`（CCF 学科领域，中文） |
| `data/JCR2024-UTF8.csv` | JCR 2024 | 列：`Journal,ISSN,eISSN,Category,IF(2024),IF Quartile(2024),IF Rank(2024)`，分区取 `IF Quartile(2024)`（"Q1"–"Q4"） |
| `data/FQBJCR2025-UTF8.csv` | 中科院分区 2025 | 列含 `Journal`、`大类`、`大类分区`、`Top`、`小类1/小类1分区`…；分区取 `大类分区` 中的数字（正则 `[1-4]` → "1区"–"4区"），`Top` 列可作附加标记 |

**匹配算法**（从 `venue_rankings.py` 移植到 TypeScript，行为必须一致）：

```text
normalize(value) = value.toLowerCase() 后删除所有非 [0-9a-z一-鿿] 字符
查询顺序：先用 venue 全称 normalize 后查，未命中再用 venue-abbrev 查
CCF：查 by_normalized_key，命中取数组第一个元素的 rank
JCR / 中科院：按 normalize(Journal) 建内存字典后查
输出：{ ccf_rank, jcr_quartile, cas_quartile }，未命中为空串（UI 显示"未收录"）
```

注意：两个 CSV 都是 `utf-8-sig`（带 BOM），解析时要剥 BOM；CSV 字段含逗号需用正经 CSV parser（建议 papaparse 或手写带引号处理的解析器）。**分区结果只在运行时计算与展示，绝不写回 frontmatter**（分区年年更新，数据与笔记解耦是既有设计原则）。

## 3. 功能需求

### P0 — MVP（先做这些，做完即可用）

| # | 功能 | 验收标准 |
|---|------|---------|
| 0.1 | **索引器**：扫描 vault 内所有 `type: "FolderNote"` 的 md，抽取 2.2 全部字段 + 文件夹路径推导的大/小方向，建内存索引；监听 `metadataCache.on("changed")` / `vault.on("rename"/"delete")` 增量更新 | 启动后 1s 内完成 60 篇索引；改一篇 frontmatter 后视图自动刷新 |
| 0.2 | **分区解析器**：打包三个数据文件，实现 2.3 匹配算法 | TPAMI → CCF A + JCR Q1 + 中科院分区正确返回；乱填 venue 返回"未收录"不报错 |
| 0.3 | **表格视图**（自定义 `ItemView`，左侧 ribbon 图标 + 命令面板打开）：列 = 标题、年份、venue-abbrev、CCF、JCR、中科院、star、大方向、小方向、kind；列头点击排序；行点击在新 leaf 打开主笔记 | 全部列可排序；点击行能打开笔记 |
| 0.4 | **筛选栏**：大方向（下拉，与小方向级联）、小方向、CCF 等级、JCR 分区、中科院分区、star（≥N）、年份范围、paper-kind、paperType——全部 AND 叠加；显示当前命中数 / 总数 | 任意组合筛选结果正确；清空一键复位 |
| 0.5 | **关键词搜索框**：对 title、desc、citekey、author、technique 做不分大小写包含匹配，中英文均可 | 搜 "隐写" 与 "SSD" 均能命中示例论文 |

### P1 — 第二阶段

| # | 功能 | 说明 |
|---|------|------|
| 1.1 | **论文详情面板**：点击论文打开右侧面板（或独立 view），把同目录子笔记按固定顺序渲染成 tab：主笔记/简报/方法介绍/实验结果/审阅建议/后续灵感（+NotebookLM 简报/博文若存在）。用 `MarkdownRenderer.render()` 渲染，wikilink/图片嵌入须正常显示 | tab 顺序固定；缺的子笔记不显示 tab |
| 1.2 | **卡片视图**：与表格共用筛选状态，卡片 = banner 缩略图（无 banner 用占位色块）+ 标题 + desc + 分区徽章 + star | 表格/卡片一键切换 |
| 1.3 | **Zotero 跳转**：表格行与详情面板提供按钮，`window.open(zotero-url)` 唤起 Zotero | 无 zotero-url 时按钮隐藏 |
| 1.4 | **筛选预设**：当前筛选组合可命名保存（存 plugin settings），下拉切换 | 重启 Obsidian 后预设仍在 |
| 1.5 | **排序扩展**：按 uid（收录时间）排序；多级排序（先分区后年份） | — |

### P2 — 第三阶段

| # | 功能 | 说明 |
|---|------|------|
| 2.1 | **统计仪表盘**：各大方向论文数（条形）、年份分布（柱状）、CCF/中科院构成（环形）、star 分布；点击图表区块 = 应用对应筛选 | 可用轻量 SVG 手绘，不必引 chart 库 |
| 2.2 | **QA 面板**：列出 ① 缺关键字段（star/venue/paper-kind/desc）的论文 ② venue 三库全部未命中的论文 ③ 缺 infographic/slides/某份子笔记的论文 ④ citekey 重复的论文 | 每条可点击跳转对应笔记 |
| 2.3 | **批量操作**：表格多选 → 批量改 star / 批量移动到另一个小方向（移动 = 改文件夹路径 + 同步更新 frontmatter 的 category-path 与 tags） | 移动后 wikilink 不断（Obsidian 自动处理） |
| 2.4 | **导出**：当前筛选结果导出为 Markdown 表格 / CSV / BibTeX 片段（citekey + title + venue + year） | — |

## 4. UI 布局建议

```text
┌─────────────────────────────────────────────────────────────┐
│ [搜索框..........] [大方向▾] [小方向▾] [CCF▾] [JCR▾] [中科院▾] │
│ [star≥▾] [年份 từ—đến] [kind▾] [预设▾] [清空]  命中 12 / 60   │
├─────────────────────────────────────────────────────────────┤
│ 标题▾            年份▾ 期刊▾   CCF▾ JCR▾ 中科院▾ ⭐▾  方向    │
│ SSD: Making...   2026  TPAMI   A    Q1   1区Top  ⭐⭐⭐⭐ 深伪/图像│
│ SafeEar: ...     2024  CCS     A    —    —      ⭐⭐⭐  深伪/音频│
│ ...                                                          │
├─────────────────────────────────────────────────────────────┤
│ [表格|卡片|统计|QA]                          底部视图切换 tab │
└─────────────────────────────────────────────────────────────┘
```

分区徽章配色建议：CCF A 红 / B 橙 / C 蓝；Q1·1区 绿 / Q2·2区 黄绿 / 其他灰；未收录 = 灰色虚线框。

## 5. 技术架构

### 5.1 技术选型

- **语言/构建**：TypeScript + esbuild，从官方 [obsidian-sample-plugin](https://github.com/obsidianmd/obsidian-sample-plugin) 模板起步。
- **零外部运行时依赖**优先；CSV 解析可引 papaparse（打包进 bundle）。
- **不依赖 Dataview**：直接用 `app.metadataCache.getFileCache(file).frontmatter` 读字段，性能更好且无插件耦合。

### 5.2 模块划分

```text
src/
├── main.ts              # 插件入口：注册 view、命令、ribbon、settings
├── indexer.ts           # 索引器：扫描 + 增量更新 + PaperRecord 类型定义
├── rankings.ts          # 分区解析：normalize + 三库查询（数据文件经 esbuild 打包或放 plugin 目录运行时读）
├── views/
│   ├── PaperListView.ts # 主视图（表格/卡片/统计/QA 四个子模式）
│   └── PaperDetailView.ts # 详情 tab 面板
├── filter.ts            # 筛选状态机 + 预设持久化
└── settings.ts          # 设置页：论文库根目录（默认"论文笔记"）、默认排序、列配置
data/                    # ccf_2026_lookup.json、JCR2024-UTF8.csv、FQBJCR2025-UTF8.csv
```

### 5.3 PaperRecord 核心类型（建议）

```typescript
interface PaperRecord {
  fileStem: string;          // ★主键，来自 frontmatter file-stem，缺失时用文件 basename
  path: string;              // 主笔记 TFile.path
  folder: string;            // 论文文件夹路径
  title: string;
  desc: string;
  year: number | null;
  venue: string;
  venueAbbrev: string;
  star: number;              // ⭐ 字符计数，0 = 未评级
  paperKind: "regular" | "survey" | "ambiguous" | null;
  paperType: string | null;
  areaPrimary: string;       // 大方向：文件夹第一级（论文库根之下）
  areaSecondary: string;     // 小方向：文件夹第二级（若论文文件夹直接在大方向下则为 ""）
  categoryPath: string;      // frontmatter category-path（与 areaSecondary 可能不一致 → QA）
  methodCategory: string;
  techniques: string[];
  authors: string[];         // 已剥 [[ ]]
  citekey: string;
  zoteroUrl: string | null;
  uid: string;               // 收录时间戳
  bannerExists: boolean;     // infographic png 是否实际存在
  slidesExist: boolean;      // slides pdf/pptx 是否实际存在
  subNotes: Record<string, string>; // {"简报": path, "方法介绍": path, ...}
  rankings: { ccf: string; jcr: string; cas: string }; // 运行时计算，可缓存
}
```

### 5.4 关键实现细节与坑

1. **主键用 `file-stem` 不要拼路径**：中文标题文件夹 + 长文件名接近路径长度极限，且方向调整会移动文件夹；fileStem 全库唯一且稳定。
2. **大小方向以文件夹为准**：`论文笔记/<大方向>/<小方向>/<论文>/`。判定方法：从论文文件夹向上回溯到论文库根，中间 1 段 = 只有大方向，2 段 = 大方向+小方向。`tags`/`category-path` 仅作交叉校验（不一致进 QA），因为用户拖动文件夹时不会同步改 frontmatter。
3. **star 解析**：`(frontmatter.star?.match(/⭐/g) ?? []).length`。
4. **frontmatter 键名带连字符**：`paper-kind`、`category-path`、`venue-abbrev`、`zotero-key`、`file-stem`、`publication-year`、`method-category`——TS 里必须用 `fm["paper-kind"]` 方式访问。
5. **降级文案过滤**：建一个 `MISSING_VALUES` 集合（见 2.2），读任何字符串字段先过滤。
6. **子笔记发现**：列出论文文件夹内 `<fileStem>-<suffix>.md`，按后缀白名单（简报/方法介绍/实验结果/审阅建议/后续灵感/NotebookLM简报/NotebookLM博文）归类；`plan.md`、`-marp.md` 不进详情 tab（marp 可单列一个"演示稿"入口）。
7. **渲染子笔记**：`MarkdownRenderer.render(app, content, el, sourcePath, component)`——`sourcePath` 必须传子笔记自身路径，否则 `![[images/...]]` 相对嵌入解析不到。
8. **banner 字段**是文件名不是 wikilink，显示缩略图时拼 `论文文件夹/<banner>` 并用 `vault.adapter.getResourcePath()` 转 URL；文件不存在时优雅降级。
9. **性能**：60–500 篇规模全内存即可，索引器做防抖（300ms）批量刷新；不要每次筛选都重读文件。
10. **CSV BOM**：`utf-8-sig`，JS 读出来开头可能有 `﻿`，记得 strip。
11. **旧数据兼容**：slides 可能是 `.pptx`（旧目录）；个别论文文件夹缺某些子笔记；有论文（如 SSD 这篇）infographic 尚未生成——一切"产物存在性"都要实测文件而非假设。
12. **调试安全**：开发期先复制一个小型测试 vault（拷 3–5 个论文文件夹）调试，避免直接在生产 vault 上试 2.3 批量移动这类写操作；写操作必须先实现 dry-run 日志。

### 5.5 Obsidian API 速查（本项目用到的）

| 用途 | API |
|------|-----|
| 注册自定义视图 | `this.registerView(VIEW_TYPE, leaf => new PaperListView(leaf))` + `workspace.getLeaf().setViewState()` |
| 读 frontmatter | `app.metadataCache.getFileCache(tfile)?.frontmatter` |
| 监听变更 | `metadataCache.on("changed")`、`vault.on("rename" / "delete" / "create")`（注意用 `this.registerEvent` 包裹） |
| 打开笔记 | `workspace.getLeaf(newLeaf).openFile(tfile)` |
| 渲染 markdown | `MarkdownRenderer.render(...)` |
| 改 frontmatter（批量操作用） | `app.fileManager.processFrontMatter(tfile, fm => { fm.star = "⭐⭐⭐" })` |
| 移动文件夹 | `app.fileManager.renameFile(tfolder, newPath)`（自动更新反链） |
| 设置持久化 | `this.loadData()` / `this.saveData()` |
| 图片资源 URL | `app.vault.adapter.getResourcePath(path)` |

## 6. 设置项（settings tab）

- 论文库根目录：默认 `论文笔记`（相对 vault 根）
- 默认视图（表格/卡片）与默认排序
- 表格列显示/隐藏配置
- 分区数据文件来源：内置 / 指定 vault 内目录（便于以后更新 CCF/JCR 数据不用重装插件）
- 是否在状态栏显示论文总数

## 7. 验收清单（整体）

- [ ] 冷启动索引 60 篇 < 1s，无任何一篇导致报错（含字段残缺的旧论文）
- [ ] TPAMI / CCS / ICASSP 等常见 venue 的 CCF/JCR/中科院解析正确；解析结果与 `notes-web` 页面显示一致（行为基准）
- [ ] 筛选六个维度任意组合正确，与手工 grep frontmatter 结果一致
- [ ] 详情面板内 wikilink、`![[images/...]]` 插图、callout、数学公式渲染正常
- [ ] 修改/新增/删除/移动论文文件夹后视图自动更新，无需重启
- [ ] 插件停用时正确 detach 所有自定义 view，无 console 报错

## 8. 参考实现位置

- 分区匹配逻辑（Python 原版，移植基准）：`/Users/zky/Library/CloudStorage/Dropbox/01-Windows-Macos同步/03-prompts/paper_reading/venue_rankings.py`
- 同数据模型的 Web 端（功能与渲染参考）：`.../paper_reading/notes-web/server.py` 与 `notes-web/static/`
- 分区数据文件：`.../paper_reading/data/`（开发时复制，发布时打包进插件）
- 笔记生成流程与 frontmatter 约定出处：`.../paper_reading/paper-notes.md`、`paper-note-main.md`
