# 全国酒店项目情报官 · hotel-board

纯静态 GitHub Pages 站点，用于查询全国酒店项目情报（拟建/签约、在建、试营业、已开业）。
抓取各大酒店集团中国区域官宣新闻（签约/拟建/在建/新开业），只收录中国相关酒店项目，过滤全球海外无关新闻。

## 目录结构

```
hotel-board/
├── index.html              # 查询页面（唯一需要 StatiCrypt 加密的文件）
├── robots.txt              # 禁止搜索引擎收录
├── assets/
│   └── app.js              # 前端逻辑（外部 JS，改它无需重新加密 index.html）
├── collector/
│   └── spider.py           # 采集器核心（翻页/限速/熔断/重试/去重/中国过滤/AI 接口）
├── config/
│   └── sites-config.json   # 采集规则配置 v2（12 个预置源，可独立更新，无需重新加密）
└── data/
    ├── hotels.json         # 主库数据（页面读取）
    └── hotels.csv          # 镜像
```

## 部署（GitHub Pages）

1. 推送本目录内容到 GitHub 仓库 `kennykaipro/hotel-board`（main 分支）。
2. 仓库 Settings → Pages → Source: Deploy from a branch → 选 `main` / `/ (root)` → Save。
3. 等待 1-2 分钟，访问 `https://kennykaipro.github.io/hotel-board/`。

> 仓库内已放置 `.nojekyll`，避免 Jekyll 处理，确保文件原样发布。

## StatiCrypt 加密（可选，推荐）

- **加密对象：仅 `index.html`。**
- **更新 `assets/app.js`、`config/sites-config.json` 或 `data/*.json` 时无需重新加密。**
- 加密步骤（任选一种）：
  - 在线版：访问 https://robinmoisson.github.io/staticrypt/ ，上传 `index.html`，设置密码，下载加密后的文件覆盖 `index.html`。
  - 命令行版：`npx staticrypt index.html -p 你的密码`（会生成 `index_encrypted.html`，改名覆盖 `index.html` 后推送）。
- 兼容说明：JS 已抽离到外部文件 `assets/app.js`，内联脚本仅剩必要部分；CSP 中 `script-src` 保留了 `'unsafe-inline'` 且含 `'self'`，可加载外部脚本并兼容 StatiCrypt 解密脚本，请勿移除。

## 安全

- 页面头部已加 `noindex, nofollow`，且 `robots.txt` 全禁，防止搜索引擎收录。
- 已通过 `<meta http-equiv="Content-Security-Policy">` 增加 CSP 加固（GitHub Pages 不支持自定义响应头，故用 meta 方式）。
- 代码中不硬编码任何 token/密钥；如需接入采集服务，凭据走环境变量或外部配置。

## 预置数据源（12 个）

**酒店集团官网（8）**：洲际 IHG 大中华区开发新闻、万豪新闻中心（大中华区扩张）、希尔顿中国区新闻、锦江酒店中国区企业新闻、凯悦中国新闻、雅高中国新闻、华住集团新闻中心、首旅如家新闻。
**行业媒体（4）**：环球旅讯酒店栏目、酒管财经、酒店高参、迈点网酒店投资。

全部在 `config/sites-config.json` 的 `sources` 中预置；页面「采集配置」按钮可查看每个源的状态、采集间隔、翻页上限、AI 状态与 403 策略。

## 采集规则（v2）

- **翻页**：循环翻页，默认 5 页（后台 `max_pages` 可配）。
- **时间熔断**：公告日期早于配置时间范围（当天/1月/3月/半年）即停止该站点翻页。
- **限速**：同站 1200–2200ms；全局并发 ≤2 站点。**环球旅讯、迈点网已单独调慢到 4000–6000ms**。
- **异常**：403/429/超时最多重试 3 次，失败跳过该站点不卡死；多次 403 自动标记跳过（环球旅讯/迈点网冷却更长），避免 IP 被封禁。
- **积分控制**：选择器完整 → 纯规则解析不耗 AI；全部选择器为空 → 才触发 AI 探测（可后台关闭 `admin.ai_auto_probe`）；JS 动态渲染页面直接跳过并红色日志提示。
- **链接**：相对链接自动拼接域名生成绝对链接。
- **去重**：详情 URL 为主键；URL 不变时叠加【标题+发布日期】二次去重。
- **中国过滤**：只保留中国大陆（含港澳）酒店项目；海外新闻在采集日志标记并过滤。
- **媒体过滤**：媒体文章只保留签约/落地/拟建/开业/物业合作；人事、财报、点评、招聘全部过滤。

## 采集器使用

```bash
python collector/spider.py --config config/sites-config.json --out data/hotels.json --time 3m
```

支持 `--time today|1m|3m|6m`。AI 抽取可通过 `spider.set_ai_extractor(fn)` 注入（Coze 工作流大模型节点或外部 LLM API）；未注入时使用内置规则解析（中国判定、城市抽取、阶段识别）。

## 数据字段

见 `config/sites-config.json`。核心字段：
`id, name, name_en, brand, group, stage, tier, chain_type, province, city, district, address, rooms, investment_yi, building_area_wan, owner, operator, management_mode, expected_open, actual_open, milestones, tags, sources, credibility, lead_score, status, remark, created_at, updated_at, version`

## 说明

本页面数据来自公开信息源的自动化采集与 AI 抽取，仅供决策参考，**以官方公告为准**。
