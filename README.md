# 全国酒店项目情报官 · hotel-board

纯静态 GitHub Pages 站点，用于查询全国酒店项目情报（拟建/签约、在建、试营业、已开业）。

## 目录结构

```
hotel-board/
├── index.html              # 查询页面（唯一需要 StatiCrypt 加密的文件）
├── robots.txt              # 禁止搜索引擎收录
├── config/
│   └── sites-config.json   # 采集规则配置（可独立更新，无需重新加密）
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
- **更新 `config/sites-config.json` 或 `data/*.json` 时无需重新加密。**
- 加密步骤（任选一种）：
  - 在线版：访问 https://robinmoisson.github.io/staticrypt/ ，上传 `index.html`，设置密码，下载加密后的文件覆盖 `index.html`。
  - 命令行版：`npx staticrypt index.html -p 你的密码`（会生成 `index_encrypted.html`，改名覆盖 `index.html` 后推送）。
- 兼容说明：本页为单文件内联 CSS/JS，无外部资源依赖，加密后解密脚本可正常注入；CSP 中 `script-src` 保留了 `'unsafe-inline'`，用于兼容 StatiCrypt 解密脚本，请勿移除。

## 安全

- 页面头部已加 `noindex, nofollow`，且 `robots.txt` 全禁，防止搜索引擎收录。
- 已通过 `<meta http-equiv="Content-Security-Policy">` 增加 CSP 加固（GitHub Pages 不支持自定义响应头，故用 meta 方式）。
- 代码中不硬编码任何 token/密钥；如需接入采集服务，凭据走环境变量或外部配置。

## 数据字段

见 `config/sites-config.json` 与仓库根 README（情报系统方案文档 `全国酒店项目情报系统_搭建方案.md`）。核心字段：
`id, name, name_en, brand, group, stage, tier, chain_type, province, city, district, address, rooms, investment_yi, building_area_wan, owner, operator, management_mode, expected_open, actual_open, milestones, tags, sources, credibility, lead_score, status, remark, created_at, updated_at, version`

## 采集规则

- 采集规则集中在 `config/sites-config.json`，支持时间筛选：当天 / 1 个月 / 3 个月 / 半年。
- 防爬限流：单并发、同域间隔 8-15s、单域 ≤30 次/晚、全局 ≤200 次/晚、ETag/Last-Modified 条件请求、429 退避、403/连续失败熔断、遵守 robots.txt。
- 原则：只用公开信息；不采个人信息；原文只留 URL + 摘要；单源一律标注「待核实」。

## 说明

本页面数据来自公开信息源的自动化采集与 AI 抽取，仅供决策参考，**以官方公告为准**。
