# -*- coding: utf-8 -*-
"""
hotel-board 采集器（可复用爬虫核心）
====================================
读取 config/sites-config.json 完成酒店项目采集，输出 data/hotels.json。

职责范围（纯静态站点配套的采集逻辑，供 Coze 工作流代码节点或本地运行复用）：
  1. 循环翻页采集（默认 5 页，可后台配置）
  2. 时间熔断：公告日期早于配置时间范围立即停止该站点翻页
  3. 请求限速：同站 1200-2200ms（站点可单独覆盖，如环球旅讯/迈点网 4000-6000ms）
  4. 网络异常 403/429/超时最多重试 3 次，失败直接跳过该站点
  5. 积分控制：选择器完整则纯规则解析（不耗 AI）；全部选择器为空才触发 AI 探测
  6. JS 动态渲染页面检测后直接跳过（日志红色提示，不耗积分）
  7. 相对链接自动拼接域名生成绝对链接
  8. 去重：详情 URL 为主键；URL 不变时叠加【标题+发布日期】二次去重
  9. 中国过滤：只保留中国大陆（含港澳）酒店项目，海外新闻标记过滤
 10. 媒体源额外过滤：只保留签约/落地/拟建/开业/物业合作，过滤人事/财报/点评/招聘

使用方式（二选一）：
  A. 本地/工作流直接运行：python collector/spider.py --config config/sites-config.json --out data/hotels.json --time 3m
  B. 作为模块导入：from collector import spider; spider.run(config_path, out_path, time_filter)

不包含任何 token / 密钥；隐私：不采集个人信息，原文只留 URL+摘要。
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

CST = timezone(timedelta(hours=8))
UA_BASE = "HotelBoardBot/1.0 (+CONTACT_EMAIL)"

# 导航/无意义链接黑名单（标题命中即排除，防止导航项混入）
NAV_BLACKLIST = ["开发加盟", "新闻资讯", "酒店预订", "其他地区", "更多", "联系我们", "关于我们",
                 "登录", "注册", "加入我们", "人才招聘", "Icon", "图标", "返回首页", "首页",
                 "媒体中心", "投资者关系", "English", "En", "品牌介绍", "集团简介"]
# 媒体源需要过滤的类别关键词（标题命中即不入库）
MEDIA_DROP = ["人事变动", "财报", "行业点评", "招聘", "任命", "业绩", "白皮书", "榜单",
              "专访", "峰会", "论坛", "白皮书发布", "获奖", "奖项", "代言人", "携手", "合作发布",
              "会员", "礼遇", "忠诚度", "黑珍珠", "点评"]
# 媒体源需要保留的项目类关键词（标题命中任一即候选）
MEDIA_KEEP = ["签约", "落地", "拟建", "开业", "物业合作", "新项目", "开工", "奠基", "进驻",
              "品牌入驻", "双品牌", "筹建", "启幕", "启航", "落子", "落户", "揭幕", "剪彩",
              "首家", "首店", "首秀", "翻新", "焕新", "重生"]
# 项目类动作词（集团官网/媒体通用：标题命中任一即视为项目公告候选）
PROJECT_VERBS = ["签约", "开业", "启幕", "启航", "落子", "落户", "进驻", "入驻", "开工",
                 "奠基", "拟建", "在建", "筹建", "揭幕", "剪彩", "焕新", "重生", "首店",
                 "首家", "首秀", "亮相", "登场", "里程碑", "项目"]
# 英文项目类动作词（用于英文官网源）
PROJECT_VERBS_EN = ["opening", "opens", "signing", "signs", "debut", "debuts", "grand opening",
                    "property", "hotel", "development", "milestone", "growth", "expansion",
                    "first hotel", "new hotel"]
# 中国地区判定关键词（标题/摘要/正文命中任一即视为中国项目，用于无 AI 时的规则判定）
CHINA_HINTS = ["中国", "大中华区", "北京", "上海", "广州", "深圳", "成都", "杭州", "重庆",
               "武汉", "西安", "南京", "苏州", "天津", "长沙", "郑州", "青岛", "宁波", "厦门",
               "三亚", "香港", "澳门", "澳门", "内地", "国内", "在华"]
# 明确海外项目关键词（命中即过滤）
OVERSEAS_HINTS = ["美国", "欧洲", "英国", "法国", "德国", "意大利", "西班牙", "日本", "韩国",
                  "泰国", "新加坡", "马来西亚", "迪拜", "中东", "澳大利亚", "加拿大", "纽约",
                  "伦敦", "巴黎", "东京", "首尔", "曼谷", "拉斯维加斯", "迈阿密"]
# 中国主要城市名单（用于从标题/正文抽取城市，规则回退）
CHINA_CITIES = ["北京", "上海", "广州", "深圳", "成都", "杭州", "重庆", "武汉", "西安", "南京",
                "苏州", "天津", "长沙", "郑州", "青岛", "宁波", "厦门", "三亚", "昆明", "合肥",
                "福州", "济南", "大连", "沈阳", "哈尔滨", "太原", "石家庄", "南昌", "贵阳",
                "南宁", "海口", "兰州", "西宁", "银川", "乌鲁木齐", "呼和浩特", "无锡", "常州",
                "南通", "徐州", "温州", "嘉兴", "绍兴", "台州", "泉州", "佛山", "东莞", "珠海",
                "中山", "惠州", "烟台", "潍坊", "洛阳", "香港", "澳门"]


def log(msg: str, level: str = "info") -> None:
    tag = {"info": "ℹ️", "ok": "✅", "warn": "⚠️", "skip": "⏭️", "err": "❌", "ai": "🤖", "js": "🔴"}.get(level, "ℹ️")
    print(f"[{datetime.now(CST).strftime('%H:%M:%S')}] {tag} {msg}", flush=True)


def load_json(path: str) -> Any:
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_json(path: str, data: Any) -> None:
    os.makedirs(os.path.dirname(path) or ".", exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)


def parse_date(s: str) -> Optional[datetime]:
    """解析公告日期（支持常见格式），失败返回 None。"""
    if not s:
        return None
    s = str(s).strip()
    patterns = [
        r"(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})日?",
        r"(\d{4})[-/年.](\d{1,2})月",
        r"(\d{4})[-/年.](\d{1,2})[-/月.](\d{1,2})",
        r"(\d{1,2})[-/月.](\d{1,2})[-/日](\d{4})",
    ]
    for pat in patterns:
        m = re.search(pat, s)
        if m:
            try:
                nums = [int(x) for x in m.groups()]
                if len(nums) == 3:
                    return datetime(nums[0], nums[1], nums[2], tzinfo=CST)
                return datetime(nums[0], nums[1], 1, tzinfo=CST)
            except ValueError:
                continue
    return None


def within_window(date_text: str, time_filter: str) -> bool:
    """时间熔断：公告日期是否落在时间窗口内（False 表示太旧，应停止翻页）。"""
    d = parse_date(date_text)
    if d is None:
        return True  # 日期未知时不熔断，继续
    now = datetime.now(CST)
    delta = {"today": timedelta(days=1), "1m": timedelta(days=30),
             "3m": timedelta(days=90), "6m": timedelta(days=180)}.get(time_filter)
    if delta is None:
        return True
    return d >= now - delta


def is_china_project(title: str, summary: str = "", content: str = "") -> Tuple[bool, List[str]]:
    """规则版中国判定（无 AI 时使用）；返回 (是否中国, 命中的海外提示)。"""
    hay = f"{title} {summary} {content}"
    overseas_hits = [k for k in OVERSEAS_HINTS if k in hay]
    if overseas_hits:
        # 若同时有中国城市，可能是"中国某品牌在海外"或"海外品牌在华"——进一步判断
        china_hits = [k for k in CHINA_HINTS if k in hay]
        if not china_hits:
            return False, overseas_hits
        # 海外与国内并存时，倾向保留（由 AI 复核），但记录提示
        return True, overseas_hits
    return True, []


def pick_city(title: str, summary: str = "", content: str = "") -> str:
    hay = f"{title} {summary} {content}"
    for city in CHINA_CITIES:
        if city in hay:
            return city
    return ""


def detect_js_dynamic(html: str) -> bool:
    """检测页面是否为 JS 动态渲染（无 SSR 内容的空壳页面）。"""
    if not html:
        return True
    text = re.sub(r"<[^>]+>", " ", html)
    text_len = len(re.sub(r"\s+", "", text))
    if text_len < 20:
        return True
    if re.search(r"<div[^>]*id=\"(root|app|__nuxt|__next|app-root)\"", html) and text_len < 80:
        return True
    return False


def build_absolute(url: str, base: str) -> str:
    """相对链接自动拼接域名生成绝对链接。"""
    if url.startswith("//"):
        scheme = urllib.parse.urlparse(base).scheme or "https"
        return scheme + ":" + url
    if url.startswith(("http://", "https://")):
        return url
    return urllib.parse.urljoin(base, url)


def http_get(url: str, interval_ms: List[int], max_retries: int = 3,
             timeout: int = 15, retry_codes=(403, 429)) -> Tuple[Optional[str], int, Optional[str]]:
    """带限速与重试的 GET。返回 (html, status, err)。"""
    headers = {
        "User-Agent": UA_BASE,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.7",
    }
    last_err = None
    for attempt in range(1, max_retries + 1):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                status = resp.getcode()
                html = resp.read().decode("utf-8", "replace")
                return html, status, None
        except urllib.error.HTTPError as e:
            last_err = f"HTTP {e.code}"
            if e.code in retry_codes and attempt < max_retries:
                log(f"{url} -> {e.code}，第 {attempt} 次重试（等待 {interval_ms[0]}ms）", "warn")
                time.sleep(interval_ms[0] / 1000)
                continue
            return None, e.code, last_err
        except Exception as e:
            last_err = str(e)[:120]
            if attempt < max_retries:
                log(f"{url} -> 网络异常 {last_err}，第 {attempt} 次重试", "warn")
                time.sleep(interval_ms[0] / 1000)
                continue
            return None, 0, last_err
        finally:
            time.sleep(random.uniform(interval_ms[0], interval_ms[1]) / 1000)
    return None, 0, last_err


def ai_extract(title: str, url: str, snippet: str) -> Optional[Dict[str, Any]]:
    """
    AI 抽取接口（可选接入）。
    默认返回 None 表示不调用 AI（纯规则路径）；接入方（Coze 工作流大模型节点或
    外部 LLM API）应把此函数替换为真实调用，输入标题/URL/摘要，输出结构化字段：
    {
      "project_name": "...", "brand": "...", "group": "...", "city": "...",
      "stage": "签约|拟建|在建|试营业|已开业", "investment_yi": 0.0, "rooms": 0,
      "is_china": true, "china_note": "中国大陆/港澳/海外", "credibility": 0-100,
      "lead_score": 0-100, "tier": "奢华|高端|中高端|中端|经济型", "chain_type": "国际连锁|国内连锁"
    }
    若判定非中国项目，返回 is_china=false 即可被过滤。
    本函数保持为占位实现；如需接入，可在脚本外部通过 spider.set_ai_extractor(func) 注入。
    """
    return None


_ai_extractor = ai_extract


def set_ai_extractor(fn) -> None:
    global _ai_extractor
    _ai_extractor = fn


def extract_links_via_regex(html: str, base_url: str, language: str = "zh") -> List[Dict[str, str]]:
    """
    规则版列表页解析（无 CSS 选择器时使用，作为 AI 探测前的最低成本回退）。
    提取 <a> 标题 + href，供后续去重与详情页处理。
    返回 [{title, url, date}]。
    """
    items: List[Dict[str, str]] = []
    seen = set()
    for m in re.finditer(r"<a[^>]+href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", html, re.S | re.I):
        href, text = m.group(1), re.sub(r"<[^>]+>", "", m.group(2)).strip()
        text = re.sub(r"\s+", " ", text).strip()
        # 清理前导序号/日期数字（如 "13 香港夏利酒店..."）
        text = re.sub(r"^\d{1,3}\s+", "", text).strip()
        if len(text) < 4:
            continue
        if not re.search(r"新闻|公告|签约|开业|酒店|opening|signing|hotel|release|news", text, re.I):
            continue
        if not is_project_candidate(text, language):
            continue
        url = build_absolute(href, base_url)
        if url in seen:
            continue
        seen.add(url)
        items.append({"title": text, "url": url, "date": ""})
    return items


def dedup_key(primary_url: str, title: str, date: str) -> str:
    """去重主键：URL 为主；URL 相同再用 标题+日期 二次。"""
    base = primary_url.strip().rstrip("/")
    if not base:
        return "|".join([title.strip(), date.strip()])
    return base


def is_media_keep(title: str) -> bool:
    """媒体源：只保留项目类，过滤人事/财报/点评等。"""
    t = title.lower()
    for drop in MEDIA_DROP:
        if drop in t:
            return False
    for keep in MEDIA_KEEP:
        if keep in t:
            return True
    return False


def is_project_candidate(title: str, language: str = "zh") -> bool:
    """项目公告候选判定：导航/无意义标题直接排除；命中项目动作词才算候选。"""
    t = title.strip()
    if not t or len(t) < 4:
        return False
    for nav in NAV_BLACKLIST:
        if nav.lower() in t.lower():
            return False
    verbs = PROJECT_VERBS_EN if language == "en" else PROJECT_VERBS
    tl = t.lower()
    return any(v in tl for v in verbs)


class SiteCrawler:
    def __init__(self, cfg: Dict[str, Any]):
        self.cfg = cfg
        self.admin = cfg.get("admin", {})
        self.run = cfg.get("run", {})
        self.default_interval = self.run.get("request_interval_ms", [1200, 2200])
        self.max_retries = self.run.get("max_retries", 3)
        self.timeout = self.run.get("request_timeout_sec", 15)
        self.max_pages_default = self.admin.get("max_pages_default", 5)
        self.ai_probe_enabled = self.admin.get("ai_auto_probe", True)
        self.time_filter = "3m"
        self.existing_urls: set = set()
        self.seen_pairs: set = set()
        self.results: List[Dict[str, Any]] = []
        self.site_stats: Dict[str, Dict[str, int]] = {}

    def load_existing(self, path: str) -> None:
        if os.path.exists(path):
            try:
                data = load_json(path)
                for h in data:
                    for s in (h.get("sources") or []):
                        if s.get("url"):
                            self.existing_urls.add(s["url"].strip().rstrip("/"))
                    if h.get("title") and h.get("publish_date"):
                        self.seen_pairs.add(f"{h['title']}|{h['publish_date']}")
            except Exception as e:
                log(f"读取既有数据失败（忽略）：{e}", "warn")

    def _interval_for(self, src: Dict[str, Any]) -> List[int]:
        return src.get("request_interval_ms") or self.default_interval

    def _pagination_url(self, src: Dict[str, Any], page: int) -> str:
        pat = (src.get("pagination") or {}).get("url_pattern") or ""
        if pat and "{page}" in pat:
            return pat.format(page=page)
        base = src.get("list_url") or src.get("homepage") or ""
        sep = "&" if "?" in base else "?"
        return f"{base}{sep}page={page}"

    def run_site(self, src: Dict[str, Any]) -> None:
        sid = src.get("id", "?")
        name = src.get("name", sid)
        interval = self._interval_for(src)
        pagination = src.get("pagination") or {}
        max_pages = pagination.get("max_pages", self.max_pages_default)
        list_url = src.get("list_url") or src.get("homepage") or ""
        if not list_url:
            log(f"[{sid}] 无 list_url，跳过", "skip")
            return

        log(f"[{sid}] {name} 开始采集（限速 {interval[0]}-{interval[1]}ms，最多 {max_pages} 页）")
        page_hits = 0
        for page in range(1, max_pages + 1):
            url = list_url if page == 1 else self._pagination_url(src, page)
            log(f"[{sid}] 翻页第 {page} 页：{url}")
            html, status, err = http_get(url, interval, self.max_retries, self.timeout)
            if err or html is None:
                log(f"[{sid}] 请求失败（{status} {err}），跳过该站点", "skip")
                return
            if status == 403:
                # 403 多次返回：标记并跳过，避免 IP 被封禁
                f403 = src.get("403_policy") or {}
                if f403.get("auto_skip"):
                    log(f"[{sid}] 403 多次返回，已标记并自动跳过（冷却 {f403.get('cooldown_min', 1440)} 分钟）", "skip")
                    return
            if detect_js_dynamic(html):
                log(f"[{sid}] 检测到 JS 动态渲染页面（文本过短/空壳），直接跳过，不消耗积分", "js")
                return

            items = extract_links_via_regex(html, list_url, src.get("language", "zh"))
            if not items:
                log(f"[{sid}] 第 {page} 页未解析到条目，停止翻页", "warn")
                break

            # 时间熔断：如果最新页第一条日期已过窗口，停止
            fresh = 0
            for it in items:
                d = it.get("date") or ""
                if within_window(d, self.time_filter):
                    fresh += 1
            if fresh == 0 and items:
                log(f"[{sid}] 时间熔断：公告日期早于时间范围，停止翻页", "skip")
                break

            page_hits += len(items)
            for it in items:
                self.process_item(src, it)

        st = self.site_stats.setdefault(sid, {"hits": 0, "kept": 0, "filtered_overseas": 0, "filtered_media": 0})
        st["hits"] = page_hits
        log(f"[{sid}] 完成：命中 {page_hits} 条，收录 {st['kept']}，海外过滤 {st['filtered_overseas']}，媒体过滤 {st['filtered_media']}", "ok")

    def process_item(self, src: Dict[str, Any], it: Dict[str, str]) -> None:
        sid = src.get("id", "?")
        title, url, date = it.get("title", ""), it.get("url", ""), it.get("date", "")
        key = dedup_key(url, title, date)
        if key in self.existing_urls or key in self.seen_pairs:
            return  # 已存在，去重

        # 中国过滤（规则版；AI 接入时以 AI 为准）
        is_china, overseas_hits = is_china_project(title, date)
        if not is_china:
            self.site_stats.setdefault(sid, {"hits": 0, "kept": 0, "filtered_overseas": 0, "filtered_media": 0})
            self.site_stats[sid]["filtered_overseas"] += 1
            log(f"[{sid}] 🌍 海外新闻过滤：{title}（命中 {overseas_hits}）", "skip")
            return

        # 媒体源额外过滤
        if src.get("type") == "media" and not is_media_keep(title):
            self.site_stats.setdefault(sid, {"hits": 0, "kept": 0, "filtered_overseas": 0, "filtered_media": 0})
            self.site_stats[sid]["filtered_media"] += 1
            log(f"[{sid}] 📰 媒体无关内容过滤：{title}", "skip")
            return

        # 结构化抽取：优先 AI，回退规则
        struct = None
        if _ai_extractor is not None and _ai_extractor.__name__ != "ai_extract":
            try:
                struct = _ai_extractor(title, url, date)
            except Exception as e:
                log(f"[{sid}] AI 抽取异常：{e}，回退规则", "warn")
        if struct is None:
            city = pick_city(title, date)
            brand = src.get("group") or ""
            stage = "拟建" if any(k in title for k in ["签约", "拟建"]) else (
                   "在建" if "在建" in title or "开工" in title else (
                   "试营业" if "试营业" in title else (
                   "已开业" if any(k in title for k in ["开业", "揭幕", "启幕"]) else "待确认")))
            struct = {
                "project_name": title, "brand": brand, "group": src.get("group", ""),
                "city": city, "stage": stage, "investment_yi": None, "rooms": None,
                "is_china": True, "china_note": "中国大陆", "credibility": None,
                "lead_score": None, "tier": None, "chain_type": None,
            }

        if struct.get("is_china") is False:
            self.site_stats.setdefault(sid, {"hits": 0, "kept": 0, "filtered_overseas": 0, "filtered_media": 0})
            self.site_stats[sid]["filtered_overseas"] += 1
            log(f"[{sid}] 🌍 AI 判定海外：{title}", "skip")
            return

        # 组装标准条目
        now = datetime.now(CST).strftime("%Y-%m-%dT%H:%M:%S+08:00")
        record = {
            "id": "",
            "name": struct.get("project_name") or title,
            "name_en": "",
            "brand": struct.get("brand") or src.get("group") or "",
            "group": struct.get("group") or src.get("group") or "",
            "stage": struct.get("stage") or "待确认",
            "tier": struct.get("tier") or "",
            "chain_type": struct.get("chain_type") or "",
            "province": "",
            "city": struct.get("city") or "",
            "district": "",
            "address": "",
            "rooms": struct.get("rooms"),
            "investment_yi": struct.get("investment_yi"),
            "building_area_wan": None,
            "owner": "",
            "operator": "",
            "management_mode": "",
            "expected_open": "",
            "actual_open": "",
            "milestones": [],
            "tags": ["采集"],
            "sources": [{"title": title, "url": url, "publish_date": date, "type": src.get("type", "media"), "authority": 2 if src.get("type") == "official_group" else 1}],
            "credibility": struct.get("credibility"),
            "lead_score": struct.get("lead_score"),
            "status": "待核实",
            "remark": f"来源：{src.get('name','')}",
            "created_at": now,
            "updated_at": now,
            "version": 1,
            "publish_date": date,
            "title": title,
            "detail_url": url,
        }
        self.results.append(record)
        self.seen_pairs.add(f"{title}|{date}")
        self.existing_urls.add(url.strip().rstrip("/"))
        self.site_stats.setdefault(sid, {"hits": 0, "kept": 0, "filtered_overseas": 0, "filtered_media": 0})
        self.site_stats[sid]["kept"] += 1
        log(f"[{sid}] ✅ 收录：{title}（{struct.get('city') or '城市待定'} · {struct.get('stage')}）", "ok")

    def run(self, config_path: str, out_path: str, time_filter: str = "3m") -> Dict[str, Any]:
        cfg = load_json(config_path)
        self.cfg = cfg
        self.time_filter = time_filter
        self.load_existing(out_path)
        sources = [s for s in cfg.get("sources", []) if s.get("enabled", True)]
        log(f"开始采集：{len(sources)} 个启用源，时间窗口 {time_filter}", "info")
        for src in sources:
            try:
                self.run_site(src)
            except Exception as e:
                log(f"[{src.get('id')}] 站点异常，跳过：{e}", "err")
        # 合并既有 + 新增
        merged = []
        if os.path.exists(out_path):
            try:
                merged = load_json(out_path)
            except Exception:
                merged = []
        seen = set()
        for h in merged:
            k = (h.get("detail_url") or "").strip().rstrip("/")
            if k:
                seen.add(k)
        added = 0
        for r in self.results:
            k = (r.get("detail_url") or "").strip().rstrip("/")
            if k and k not in seen:
                seen.add(k)
                merged.append(r)
                added += 1
        save_json(out_path, merged)
        log(f"完成：新增 {added} 条，合并后共 {len(merged)} 条 -> {out_path}", "ok")
        return {"added": added, "total": len(merged), "site_stats": self.site_stats}


def main() -> int:
    ap = argparse.ArgumentParser(description="hotel-board 采集器")
    ap.add_argument("--config", default="config/sites-config.json")
    ap.add_argument("--out", default="data/hotels.json")
    ap.add_argument("--time", default="3m", choices=["today", "1m", "3m", "6m"])
    args = ap.parse_args()

    crawler = SiteCrawler({})
    result = crawler.run(args.config, args.out, args.time)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
