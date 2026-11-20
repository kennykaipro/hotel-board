/*!
 * hotel-board · 全国酒店项目情报官 前端逻辑（外部 JS，StatiCrypt 兼容）
 * - 本文件独立于 index.html：修改本文件 / config / data 均无需重新加密 index.html
 * - 仅修改 index.html 本身才需要重新执行 StatiCrypt 加密
 * - 不包含任何 token / 密钥；CSP 由 index.html 的 meta 标签控制
 */
(function(){
"use strict";

var LS_URL = "hotelintel.ghUrl";
var state = { data: [], source: "none", updated: null, sort: "lead", view: "list" };
var $ = function(id){ return document.getElementById(id); };
var listEl = $("list");
var DEMO_KEY = "hotelintel.demo.v1";

/* ---------- 演示数据 ---------- */
function demoData(){
  var cached = null;
  try { cached = JSON.parse(localStorage.getItem(DEMO_KEY)); } catch(e){}
  if (cached && Array.isArray(cached)) return cached;
  var now = new Date().toISOString();
  var d = [
    {
      id:"demo-0001", name:"示例·滨江国际酒店（演示数据）", name_en:"Demo Riverside International Hotel",
      brand:"示例品牌", group:"示例集团", stage:"拟建", tier:"高端", chain_type:"国际连锁",
      province:"示例省", city:"示例市", district:"滨江区", address:"示例大道 88 号",
      rooms:280, investment_yi:6.5, building_area_wan:4.2, owner:"示例置业", operator:"示例管理",
      management_mode:"委托管理", expected_open:"2028-06", actual_open:"",
      milestones:["签约","规划公示"], tags:["签约","高端","投资"],
      sources:[], credibility:72, lead_score:86, status:"待核实",
      remark:"演示数据，非真实情报", created_at:now, updated_at:now, version:1
    },
    {
      id:"demo-0002", name:"示例·云岭度假酒店（演示数据）", name_en:"",
      brand:"", group:"", stage:"在建", tier:"中高端", chain_type:"国内连锁",
      province:"示例省", city:"示例市", district:"云岭镇", address:"",
      rooms:180, investment_yi:3.2, building_area_wan:2.6, owner:"示例文旅", operator:"",
      management_mode:"自营", expected_open:"2027-12", actual_open:"",
      milestones:["开工"], tags:["在建","度假"],
      sources:[], credibility:65, lead_score:74, status:"待核实",
      remark:"演示数据，非真实情报", created_at:now, updated_at:now, version:1
    },
    {
      id:"demo-0003", name:"示例·中心商务酒店（演示数据）", name_en:"",
      brand:"示例快捷", group:"", stage:"已开业", tier:"中端", chain_type:"国内连锁",
      province:"示例省", city:"示例市", district:"中心区", address:"中心路 1 号",
      rooms:220, investment_yi:1.8, building_area_wan:1.5, owner:"", operator:"示例运营",
      management_mode:"特许经营", expected_open:"2025-09", actual_open:"2026-03",
      milestones:["试营业","开业"], tags:["开业","中端"],
      sources:[], credibility:88, lead_score:55, status:"已核实",
      remark:"演示数据，非真实情报", created_at:now, updated_at:now, version:1
    }
  ];
  try { localStorage.setItem(DEMO_KEY, JSON.stringify(d)); } catch(e){}
  return d;
}

/* ---------- 渲染 ---------- */
function esc(s){
  return String(s == null ? "" : s)
    .replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;")
    .replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function stageClass(st){
  var m = { "拟建":"stage-p", "签约":"stage-p", "筹备中":"stage-p", "在建":"stage-c", "试营业":"stage-t", "已开业":"stage-o", "建筑标已招":"stage-b" };
  return m[st] || "";
}
function tierClass(t){ return t === "奢华" ? "tier-lux" : ""; }
function statusClass(s){
  return s === "已核实" ? "status-ok" : (s === "待核实" ? "status-wait" : (s === "存疑" ? "status-doubt" : ""));
}
function credClass(c){ return c >= 80 ? "cred-hi" : (c >= 60 ? "cred-mid" : "cred-lo"); }
function fmtNum(v){
  if (v === null || v === undefined || v === "") return "—";
  return Number(v).toLocaleString("zh-CN", {maximumFractionDigits:1});
}
function fact(label, val, unit){
  if (val === null || val === undefined || val === "") {
    return '<div class="fact"><b>'+esc(label)+'</b>：<span class="fact-missing">未知</span></div>';
  }
  return '<div class="fact"><b>'+esc(label)+'</b>：<span class="val">'+esc(val)+(unit?esc(unit):"")+'</span></div>';
}

function renderSources(sources){
  if (!Array.isArray(sources) || !sources.length) {
    return '<div class="src-item">暂无来源链接（演示数据或来源待补录）</div>';
  }
  return sources.map(function(s){
    var title = (s && s.title) ? s.title : "来源";
    var url = s && s.url;
    var meta = [];
    if (s && s.publish_date) meta.push("发布 " + esc(s.publish_date));
    if (s && s.type) meta.push(esc(s.type));
    if (s && s.authority !== undefined && s.authority !== null) meta.push("权威度 " + esc(s.authority));
    var link;
    if (url && /^https?:\/\//i.test(url)) {
      link = '<a href="'+esc(url)+'" target="_blank" rel="noopener noreferrer">'+esc(title)+'</a>';
    } else {
      link = esc(title);
    }
    return '<div class="src-item">'+link+'<span class="src-meta">'+meta.join(" · ")+'</span></div>';
  }).join("");
}

function cardHtml(h){
  var st = h.phase || h.stage || "待确认";
  var cred = (h.credibility !== undefined && h.credibility !== null) ? Number(h.credibility) : null;
  var lead = (h.lead_score !== undefined && h.lead_score !== null) ? Number(h.lead_score) : null;
  var loc = [h.province, h.city, h.district].filter(Boolean).join("·") || "地区未知";
  var brandLine = [];
  if (h.brand) brandLine.push(esc(h.brand));
  if (h.group) brandLine.push("· " + esc(h.group));
  if (h.chain_type) brandLine.push("· " + esc(h.chain_type));

  var badges = [];
  badges.push('<span class="badge '+stageClass(st)+'">'+esc(st)+'</span>');
  if (h.tier) badges.push('<span class="badge '+tierClass(h.tier)+'">'+esc(h.tier)+'</span>');
  if (h.status) badges.push('<span class="badge '+statusClass(h.status)+'">'+esc(h.status)+'</span>');
  if (Array.isArray(h.tags)) h.tags.slice(0,5).forEach(function(t){ badges.push('<span class="badge">'+esc(t)+'</span>'); });

  var facts = [];
  facts.push(fact("城市", loc));
  facts.push(fact("客房数", fmtNum(h.rooms), " 间"));
  facts.push(fact("投资额", h.investment_yi === null || h.investment_yi === undefined || h.investment_yi === "" ? "" : h.investment_yi, " 亿元"));
  facts.push(fact("建筑面积", h.building_area_wan === null || h.building_area_wan === undefined || h.building_area_wan === "" ? "" : h.building_area_wan, " 万㎡"));
  facts.push(fact("业主", h.owner));
  facts.push(fact("运营方", h.operator));
  facts.push(fact("管理模式", h.management_mode));
  facts.push(fact("预计开业", h.expected_open));
  facts.push(fact("实际开业", h.actual_open));
  if (h.address) facts.push(fact("地址", h.address));
  if (h.milestones && h.milestones.length) facts.push(fact("里程碑", h.milestones.join(" → ")));
  if (h.remark) facts.push(fact("备注", h.remark));
  facts.push(fact("版本", h.version !== undefined ? h.version : 1));
  facts.push(fact("更新时间", h.updated_at ? String(h.updated_at).slice(0,10) : ""));

  return '<article class="card">' +
    '<div class="card-top">' +
      '<div class="card-title"><h3>'+esc(h.name || "未命名项目")+'</h3>' +
      (h.name_en ? '<div class="brand-line">'+esc(h.name_en)+'</div>' : '') +
      (brandLine.length ? '<div class="brand-line">'+brandLine.join(" ")+'</div>' : '') +
      '</div>' +
      '<div class="scores">' +
        '<div class="score '+credClass(cred)+'"><div class="v">'+(cred===null?"—":cred)+'</div><div class="k">可信度</div></div>' +
        '<div class="score '+(lead>=70?"lead-hi":"")+'"><div class="v">'+(lead===null?"—":lead)+'</div><div class="k">线索价值</div></div>' +
      '</div>' +
    '</div>' +
    '<div class="badges">'+badges.join("")+'</div>' +
    '<div class="card-body">'+facts.join("")+'</div>' +
    '<details class="sources"><summary>来源（'+((h.sources&&h.sources.length)||0)+'）</summary><div class="src-list">'+renderSources(h.sources)+'</div></details>' +
  '</article>';
}

function filterData(){
  var kw = ($("f-keyword").value || "").trim().toLowerCase();
  var city = ($("f-city").value || "").trim().toLowerCase();
  var stage = $("f-stage").value;
  var phase = $("f-phase").value;
  var tier = $("f-tier").value;
  var status = $("f-status").value;
  var invMin = parseFloat($("f-inv-min").value);
  var invMax = parseFloat($("f-inv-max").value);
  var roomsMin = parseFloat($("f-rooms-min").value);
  var roomsMax = parseFloat($("f-rooms-max").value);
  var credMin = parseFloat($("f-cred").value);
  var leadMin = parseFloat($("f-lead").value);

  return state.data.filter(function(h){
    if (kw) {
      var hay = [h.name,h.name_en,h.brand,h.group,h.city,h.province,h.address].filter(Boolean).join(" ").toLowerCase();
      if (hay.indexOf(kw) === -1) return false;
    }
    if (city) {
      var c = [h.city,h.province].filter(Boolean).join(" ").toLowerCase();
      if (c.indexOf(city) === -1) return false;
    }
    if (stage && (h.stage||"待确认") !== stage) return false;
    if (phase && (h.phase||"待确认") !== phase) return false;
    if (tier && h.tier !== tier) return false;
    if (status && h.status !== status) return false;
    var inv = parseFloat(h.investment_yi);
    if (!isNaN(inv)) {
      if (!isNaN(invMin) && inv < invMin) return false;
      if (!isNaN(invMax) && inv > invMax) return false;
    }
    var rooms = parseFloat(h.rooms);
    if (!isNaN(rooms)) {
      if (!isNaN(roomsMin) && rooms < roomsMin) return false;
      if (!isNaN(roomsMax) && rooms > roomsMax) return false;
    }
    var cred = parseFloat(h.credibility);
    if (!isNaN(credMin) && !isNaN(cred) && cred < credMin) return false;
    if (!isNaN(credMin) && isNaN(cred)) return false;
    var lead = parseFloat(h.lead_score);
    if (!isNaN(leadMin) && !isNaN(lead) && lead < leadMin) return false;
    if (!isNaN(leadMin) && isNaN(lead)) return false;
    return true;
  });
}

function sortData(arr){
  var k = state.sort;
  var key = {
    lead: function(h){ return isNaN(parseFloat(h.lead_score)) ? -1 : parseFloat(h.lead_score); },
    cred: function(h){ return isNaN(parseFloat(h.credibility)) ? -1 : parseFloat(h.credibility); },
    inv:  function(h){ return isNaN(parseFloat(h.investment_yi)) ? -1 : parseFloat(h.investment_yi); },
    rooms:function(h){ return isNaN(parseFloat(h.rooms)) ? -1 : parseFloat(h.rooms); },
    updated:function(h){ return new Date(h.updated_at || 0).getTime(); }
  }[k] || function(){return 0;};
  return arr.slice().sort(function(a,b){ return key(b) - key(a); });
}

function renderStats(all){
  $("st-total").textContent = all.length;
  var high = all.filter(function(h){ return parseFloat(h.lead_score) >= 70; }).length;
  var cred = all.filter(function(h){ return parseFloat(h.credibility) >= 80; }).length;
  var cities = new Set(all.map(function(h){ return h.city; }).filter(Boolean)).size;
  $("st-high").textContent = high;
  $("st-cred").textContent = cred;
  $("st-cities").textContent = cities;
  $("st-high-bar").style.width = all.length ? Math.round(high/all.length*100)+"%" : "0%";
  $("st-cred-bar").style.width = all.length ? Math.round(cred/all.length*100)+"%" : "0%";
}

function renderList(){
  if (state.view === "city") { renderCityView(); return; }
  var filtered = filterData();
  var sorted = sortData(filtered);
  $("result-count").textContent = "共 " + sorted.length + " 条";
  if (!state.data.length) {
    listEl.innerHTML =
      '<div class="empty"><div class="big">🏨</div><h3>还没有数据</h3>' +
      '<p>系统每晚 23:30 自动采集；当前情报库为空。你可以先「载入演示数据」预览界面，或配置数据源 / 导入 JSON。</p>' +
      '<div class="actions"><button class="btn primary" type="button" data-action="demo">载入演示数据</button>' +
      '<button class="btn" type="button" data-action="source">配置数据源</button></div></div>';
    return;
  }
  if (!sorted.length) {
    listEl.innerHTML = '<div class="empty"><div class="big">🔍</div><h3>没有符合筛选条件的项目</h3>' +
      '<p>请调整筛选条件后重试。</p></div>';
    return;
  }
  listEl.innerHTML = sorted.map(cardHtml).join("");
}

/* ---------- 按城市视图 ---------- */
var PHASE_ORDER = ["已开业", "筹备中", "在建", "建筑标已招", "待确认"];

function cityItemHtml(h){
  var ph = h.phase || h.stage || "待确认";
  var meta = [];
  if (h.brand) meta.push('<span class="ci-brand">'+esc(h.brand)+'</span>');
  if (h.tier) meta.push(esc(h.tier));
  if (h.rooms) meta.push(esc(h.rooms)+" 间");
  if (h.expected_open) meta.push("预计 "+esc(h.expected_open));
  if (h.actual_open) meta.push("开业 "+esc(h.actual_open));
  var linkUrl = "";
  if (h.detail_url && /^https?:\/\//i.test(h.detail_url)) linkUrl = h.detail_url;
  else if (Array.isArray(h.sources) && h.sources.length && h.sources[0].url && /^https?:\/\//i.test(h.sources[0].url)) linkUrl = h.sources[0].url;
  var name = esc(h.name || "未命名项目");
  if (linkUrl) {
    name = '<a class="ci-name" href="'+esc(linkUrl)+'" target="_blank" rel="noopener noreferrer" title="打开线索来源">'+name+' ↗</a>';
  } else {
    name = '<span class="ci-name">'+name+'</span>';
  }
  return '<div class="city-item">' +
    name +
    '<span class="ci-meta"><span class="badge '+stageClass(ph)+'">'+esc(ph)+'</span>' + meta.join('<span class="ci-sep">·</span>') + '</span>' +
  '</div>';
}

function renderCityView(){
  var filtered = filterData();
  var sorted = sortData(filtered);
  $("result-count").textContent = "共 " + sorted.length + " 条";
  if (!state.data.length) {
    listEl.innerHTML =
      '<div class="empty"><div class="big">🏨</div><h3>还没有数据</h3>' +
      '<p>系统每晚 23:30 自动采集；当前情报库为空。你可以先「载入演示数据」预览界面，或配置数据源 / 导入 JSON。</p>' +
      '<div class="actions"><button class="btn primary" type="button" data-action="demo">载入演示数据</button>' +
      '<button class="btn" type="button" data-action="source">配置数据源</button></div></div>';
    return;
  }
  if (!sorted.length) {
    listEl.innerHTML = '<div class="empty"><div class="big">🔍</div><h3>没有符合筛选条件的项目</h3>' +
      '<p>请调整筛选条件后重试。</p></div>';
    return;
  }

  // 按城市分组
  var byCity = {};
  sorted.forEach(function(h){
    var c = (h.city || "未标城市").trim() || "未标城市";
    (byCity[c] = byCity[c] || []).push(h);
  });
  var cityNames = Object.keys(byCity).sort(function(a,b){
    if (a === "未标城市") return 1;
    if (b === "未标城市") return -1;
    return byCity[b].length - byCity[a].length;
  });

  var html = cityNames.map(function(city){
    var arr = byCity[city];
    // 城市内按细分阶段分组
    var byPhase = {};
    arr.forEach(function(h){
      var p = h.phase || h.stage || "待确认";
      (byPhase[p] = byPhase[p] || []).push(h);
    });
    var phaseKeys = PHASE_ORDER.filter(function(p){ return byPhase[p]; });
    Object.keys(byPhase).forEach(function(p){
      if (phaseKeys.indexOf(p) === -1) phaseKeys.push(p);
    });
    var summary = phaseKeys.map(function(p){ return esc(p)+" "+byPhase[p].length; }).join(" · ");
    var blocks = phaseKeys.map(function(p){
      return '<div class="phase-block">' +
        '<div class="phase-title"><span class="badge '+stageClass(p)+'">'+esc(p)+'</span><span class="phase-count">'+byPhase[p].length+' 个</span></div>' +
        '<div class="phase-list">'+byPhase[p].map(cityItemHtml).join("")+'</div>' +
      '</div>';
    }).join("");
    return '<section class="panel city-group">' +
      '<div class="city-head"><h3>'+esc(city)+'</h3><span class="city-count">'+arr.length+' 个项目</span></div>' +
      '<div class="city-phase-summary">'+summary+'</div>' +
      blocks +
    '</section>';
  }).join("");

  listEl.innerHTML = html;
}

function updateMeta(){
  var labels = { none:"等待数据", demo:"演示数据", github:"仓库数据", import:"手动导入" };
  $("meta-state").textContent = labels[state.source] || "等待数据";
  $("meta-total").textContent = state.data.length;
  $("meta-updated").textContent = state.updated ? String(state.updated).slice(0,16).replace("T"," ") : "—";
}

function setState(data, source, updated){
  state.data = Array.isArray(data) ? data : [];
  state.source = source;
  state.updated = updated || new Date().toISOString();
  renderStats(state.data);
  renderList();
  updateMeta();
}

/* ---------- 数据加载 ---------- */
function loadDemo(){ setState(demoData(), "demo"); }

function normalize(raw){
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.hotels)) return raw.hotels;
  if (raw && Array.isArray(raw.data)) return raw.data;
  return null;
}

function loadData(url){
  url = (url || "").trim() || "data/hotels.json";
  listEl.innerHTML = '<div class="loading"><div class="spinner"></div><p>正在加载数据…</p></div>';
  fetch(url, {method:"GET", credentials:"omit"})
    .then(function(res){
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function(raw){
      var arr = normalize(raw);
      if (!arr) throw new Error("数据格式不符合：需要酒店项目 JSON 数组");
      setState(arr, "github", new Date().toISOString());
      try { localStorage.setItem(LS_URL, url); } catch(e){}
    })
    .catch(function(err){
      listEl.innerHTML = '<div class="error"><div class="big">⚠️</div><h3>数据加载失败</h3>' +
        '<p>请确认 data/hotels.json 存在且格式正确，或改用「导入 JSON」。</p>' +
        '<div class="err-code">'+esc(err && err.message || "未知错误")+'</div></div>';
    });
}

function importJson(){
  var area = $("import-area");
  var raw = area.value.trim();
  if (!raw) { alert("请先粘贴 JSON 内容"); return; }
  try {
    var arr = normalize(JSON.parse(raw));
    if (!arr) throw new Error("格式不符合");
    setState(arr, "import");
    $("url-form").classList.remove("open");
  } catch(e){
    alert("JSON 解析失败：" + (e && e.message || "格式错误"));
  }
}

/* ---------- 交互绑定 ---------- */
function bindActions(root){
  if (!root) return;
  var demoBtn = root.querySelector('[data-action="demo"]');
  if (demoBtn) demoBtn.addEventListener("click", loadDemo);
  var srcBtn = root.querySelector('[data-action="source"]');
  if (srcBtn) srcBtn.addEventListener("click", function(){ openSourceForm(); });
}

function openSourceForm(){
  $("url-form").classList.add("open");
  var saved = "";
  try { saved = localStorage.getItem(LS_URL) || ""; } catch(e){}
  $("gh-url").value = saved || "data/hotels.json";
  $("gh-url").focus();
  $("import-area").value = "";
}

/* ---------- Admin 采集配置展示（读取 config/sites-config.json） ---------- */
function fmtInterval(ms){
  if (!Array.isArray(ms) || !ms.length) return "—";
  var lo = Math.round(ms[0]/100)/10, hi = Math.round(ms[1]/100)/10;
  return lo + "–" + hi + " s";
}
function selectorState(s){
  if (!s) return {filled:0, empty:0};
  var keys = ["list","item","title","link","date"];
  var filled = keys.filter(function(k){ return s[k] && String(s[k]).trim(); }).length;
  return { filled: filled, empty: keys.length - filled };
}
function sourceCard(s){
  var isMedia = s.type === "media";
  var slow = (s.request_interval_ms && s.request_interval_ms[0] >= 3000);
  var sel = selectorState(s.selectors);
  var p = s.pagination || {};
  var f403 = s["403_policy"] || {};
  var chips = [];
  chips.push('<span class="src-chip '+(isMedia?"chip-media":"chip-group")+'">'+(isMedia?"行业媒体":"集团官网")+'</span>');
  chips.push('<span class="src-chip '+(s.enabled?"chip-on":"chip-off")+'">'+(s.enabled?"启用":"停用")+'</span>');
  if (slow) chips.push('<span class="src-chip chip-slow">⏱ 已调慢</span>');
  if (f403.auto_skip) chips.push('<span class="src-chip chip-403">403 自动跳过×'+ (f403.skip_after||3) +'</span>');

  var selText = sel.filled === 0
    ? '<span class="sel-warn">选择器为空 · 触发 AI 探测</span>'
    : '<span class="sel-ok">选择器已填 · 纯规则不耗 AI</span>';

  return '<article class="src-card">' +
    '<div class="src-card-top">' +
      '<h3>'+esc(s.name)+'</h3>' +
      '<span class="src-lang">'+esc(s.language === "zh" ? "中文" : "英文")+'</span>' +
    '</div>' +
    '<div class="src-chips">'+chips.join("")+'</div>' +
    '<div class="src-meta-row">' +
      '<div><span class="m-key">采集间隔</span><b>'+fmtInterval(s.request_interval_ms)+'</b></div>' +
      '<div><span class="m-key">最大翻页</span><b>'+(p.max_pages != null ? p.max_pages : 5)+' 页</b></div>' +
      '<div><span class="m-key">AI 状态</span>'+selText+'</div>' +
    '</div>' +
    (s.homepage ? '<a class="src-url" href="'+esc(s.homepage)+'" target="_blank" rel="noopener noreferrer">'+esc(s.homepage)+'</a>' : '') +
    (s.note ? '<div class="src-note">'+esc(s.note)+'</div>' : '') +
  '</article>';
}

function renderAdmin(){
  var grid = $("admin-grid");
  var meta = $("admin-meta");
  if (!grid) return;
  fetch("config/sites-config.json", {method:"GET", credentials:"omit"})
    .then(function(res){
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function(cfg){
      var sources = Array.isArray(cfg.sources) ? cfg.sources : [];
      var enabled = sources.filter(function(s){ return s.enabled; }).length;
      var media = sources.filter(function(s){ return s.type === "media"; }).length;
      var groups = sources.filter(function(s){ return s.type !== "media"; }).length;
      var admin = cfg.admin || {};
      if (meta) {
        meta.textContent = "共 " + sources.length + " 个数据源（集团官网 " + groups +
          " · 行业媒体 " + media + "）· 启用 " + enabled +
          " · 并发≤" + (admin.global_concurrency || 2) +
          " · AI自动探测 " + (admin.ai_auto_probe ? "开" : "关");
      }
      grid.innerHTML = sources.map(sourceCard).join("");
    })
    .catch(function(err){
      grid.innerHTML = '<div class="empty"><div class="big">⚙️</div><h3>无法加载采集配置</h3>' +
        '<p>请确认 config/sites-config.json 存在。</p>' +
        '<div class="err-code">'+esc(err && err.message || "未知错误")+'</div></div>';
    });
}

function toggleAdmin(){
  var panel = $("admin-panel");
  if (!panel) return;
  if (panel.classList.contains("open")) {
    panel.classList.remove("open");
  } else {
    panel.classList.add("open");
    renderAdmin();
  }
}

/* ---------- 事件绑定 ---------- */
$("btn-source").addEventListener("click", function(){
  if ($("url-form").classList.contains("open")) {
    $("url-form").classList.remove("open");
  } else {
    openSourceForm();
  }
});
$("btn-apply-url").addEventListener("click", function(){ loadData($("gh-url").value); });
$("gh-url").addEventListener("keydown", function(e){
  if (e.key === "Enter") { e.preventDefault(); loadData(this.value); }
});
$("btn-cancel-url").addEventListener("click", function(){ $("url-form").classList.remove("open"); });
$("btn-import").addEventListener("click", function(){
  var area = $("import-area");
  var wrap = area.parentElement;
  wrap.style.display = (wrap.style.display === "none") ? "block" : "none";
});
$("btn-apply-import").addEventListener("click", importJson);
$("btn-demo").addEventListener("click", loadDemo);
$("btn-reload").addEventListener("click", function(){
  if (state.source === "github") {
    var saved = "";
    try { saved = localStorage.getItem(LS_URL) || ""; } catch(e){}
    loadData(saved || "data/hotels.json");
    return;
  }
  loadDemo();
});
$("btn-reset").addEventListener("click", function(){
  ["f-keyword","f-city","f-inv-min","f-inv-max","f-rooms-min","f-rooms-max","f-cred","f-lead"].forEach(function(id){
    $(id).value = "";
  });
  ["f-stage","f-phase","f-tier","f-status"].forEach(function(id){ $(id).value = ""; });
  $("f-sort").value = "lead";
  state.sort = "lead";
  renderList();
});
$("view-list").addEventListener("click", function(){
  state.view = "list";
  $("view-list").classList.add("active");
  $("view-city").classList.remove("active");
  $("view-list").setAttribute("aria-selected","true");
  $("view-city").setAttribute("aria-selected","false");
  renderList();
});
$("view-city").addEventListener("click", function(){
  state.view = "city";
  $("view-city").classList.add("active");
  $("view-list").classList.remove("active");
  $("view-city").setAttribute("aria-selected","true");
  $("view-list").setAttribute("aria-selected","false");
  renderList();
});
$("btn-copy").addEventListener("click", function(){
  var filtered = sortData(filterData());
  var lines = filtered.slice(0,50).map(function(h){
    var loc = [h.city,h.district].filter(Boolean).join("·") || "地区未知";
    return (h.name||"未命名") + "｜" + (h.stage||"待确认") + "｜" + (h.tier||"") + "｜" + loc +
      "｜投资" + (h.investment_yi||"—") + "亿｜" + (h.rooms||"—") + "间｜可信度" + (h.credibility||"—") + "｜价值" + (h.lead_score||"—");
  });
  var text = "全国酒店项目情报查询结果（" + state.data.length + " 条中筛选 " + filtered.length + " 条）\n" + lines.join("\n") + "\n\n以官方公告为准";
  var done = false;
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function(){}, function(){ fallbackCopy(text); });
      done = true;
    }
  } catch(e){}
  if (!done) fallbackCopy(text);
  alert("结果摘要已复制（前 50 条）");
});
$("btn-export").addEventListener("click", exportExcel);
function fallbackCopy(text){
  try {
    var ta = document.createElement("textarea");
    ta.value = text; ta.style.position="fixed"; ta.style.opacity="0";
    document.body.appendChild(ta); ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  } catch(e){}
}

/* ---------- 导出 Excel（当前筛选结果） ---------- */
function firstSourceUrl(h){
  if (h.detail_url && /^https?:\/\//i.test(h.detail_url)) return h.detail_url;
  if (Array.isArray(h.sources) && h.sources.length && h.sources[0].url) return h.sources[0].url;
  return "";
}
function exportExcel(){
  var filtered = sortData(filterData());
  if (!filtered.length) { alert("当前没有可导出的项目（请调整筛选或先载入数据）"); return; }
  if (!window.XLSX) { alert("Excel 组件未加载，请刷新页面重试"); return; }
  var rows = filtered.map(function(h){
    return {
      "城市": h.city || "",
      "品牌": h.brand || "",
      "集团": h.group || "",
      "项目名称": h.name || "",
      "阶段": h.stage || "",
      "细分阶段": h.phase || "",
      "档次": h.tier || "",
      "客房数(间)": h.rooms || "",
      "投资额(亿元)": h.investment_yi || "",
      "建筑面积(万㎡)": h.building_area_wan || "",
      "预计开业": h.expected_open || "",
      "实际开业": h.actual_open || "",
      "来源链接": firstSourceUrl(h),
      "备注": h.remark || ""
    };
  });
  var ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    {wch:8},{wch:12},{wch:12},{wch:36},{wch:10},{wch:10},{wch:8},
    {wch:10},{wch:12},{wch:14},{wch:10},{wch:10},{wch:60},{wch:40}
  ];
  var wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "酒店项目线索");
  var d = new Date(), stamp = d.getFullYear() + "-" + String(d.getMonth()+1).padStart(2,"0") + "-" + String(d.getDate()).padStart(2,"0");
  XLSX.writeFile(wb, "hotel-projects-" + stamp + ".xlsx");
}

["f-keyword","f-city","f-stage","f-phase","f-tier","f-status","f-inv-min","f-inv-max","f-rooms-min","f-rooms-max","f-cred","f-lead"].forEach(function(id){
  $(id).addEventListener("input", renderList);
  $(id).addEventListener("change", renderList);
});
$("f-sort").addEventListener("change", function(){ state.sort = this.value; renderList(); });
document.addEventListener("click", function(e){
  var t = e.target;
  if (t && t.dataset && t.dataset.action) bindActions(t.closest(".empty"));
});

var adminBtn = $("btn-admin");
if (adminBtn) adminBtn.addEventListener("click", toggleAdmin);

/* ---------- 启动 ---------- */
function init(){
  var saved = "";
  try { saved = localStorage.getItem(LS_URL) || ""; } catch(e){}
  if (saved) { loadData(saved); return; }
  loadData("data/hotels.json");
}
init();

})();
