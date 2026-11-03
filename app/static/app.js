"use strict";
const REMOTE = location.protocol === "https:"; // 经隧道访问时链路更长，放宽超时，避免过早换源
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const app = $("#app");
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const J = (u, opt) => fetch(u, opt).then(r => r.json());
const enc = encodeURIComponent;
const go = h => { location.hash = h; };
let routeToken = 0;
const UA_ = navigator.userAgent;
const IS_IOS = /iPad|iPhone|iPod/.test(UA_) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
const IS_SAFARI = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(UA_);

/* ---------- 工具 ---------- */
function toast(t, ms = 2600) { const el = $("#toast"); el.textContent = t; el.classList.add("on"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("on"), ms); }
function img(src, alt = "") {
  if (!src) return `<img alt="" class="">`;
  return `<img loading="lazy" referrerpolicy="no-referrer" alt="${esc(alt)}" src="${esc(src)}" onload="this.classList.add('ld')" onerror="if(!this.dataset.p){this.dataset.p=1;this.src='/img?url='+encodeURIComponent('${esc(src)}')}else{this.style.display='none'}">`;
}
const ICON_PLAY = `<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>`;
const fmtT = s => { s = Math.floor(s || 0); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60; return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0"); };
const canon = t => String(t || "").replace(/[\s·:：,，.。!！?？'"“”‘’()（）\[\]【】\-_—]/g, "").toLowerCase();

/* ---------- 观看记录 ---------- */
const H = {
  all() { try { return JSON.parse(localStorage.h2 || "[]"); } catch (e) { return []; } },
  get(k) { return H.all().find(x => x.key === k); },
  put(it) { const a = H.all().filter(x => x.key !== it.key); a.unshift(it); localStorage.h2 = JSON.stringify(a.slice(0, 60)); },
  del(k) { localStorage.h2 = JSON.stringify(H.all().filter(x => x.key !== k)); },
};

/* ---------- 卡片 ---------- */
function card(it) {
  const href = it.href || (it.id ? `#/d/${it.type || "movie"}/${it.id}` : `#/v/${enc(it.title)}/${enc(it.year || "")}`);
  return `<a class="card" href="${href}" style="--i:${(it._i ?? 0) % 14}"><div class="ph">${img(it.pic, it.title)}${it.rate ? `<span class="badge">${it.rate}</span>` : ""}${it.ep ? `<span class="epi">${esc(it.ep)}</span>` : ""}${it.prog ? `<span class="prog" style="width:${it.prog}%"></span>` : ""}</div><div class="t">${esc(it.title)}</div><div class="s">${esc(it.s || it.sub || "")}</div></a>`;
}
const skelRow = n => Array.from({ length: n }, () => `<div class="card"><div class="ph skel"></div><div class="t skel" style="height:14px;width:70%;margin-top:10px"></div></div>`).join("");
const short = sub => (sub || "").split(" / ").slice(0, 3).join(" · ");

/* ---------- 首页 ---------- */
const ROWS = [
  ["热门电影", "movie", "热门", "全部"],
  ["热门剧集", "tv", "tv", "tv"],
  ["国产剧", "tv", "tv", "tv_domestic"],
  ["欧美剧", "tv", "tv", "tv_american"],
  ["韩剧", "tv", "tv", "tv_korean"],
  ["日剧", "tv", "tv", "tv_japanese"],
  ["动漫", "tv", "tv", "tv_animation"],
  ["综艺", "tv", "show", "show"],
  ["最新电影", "movie", "最新", "全部"],
  ["豆瓣高分", "movie", "豆瓣高分", "全部"],
];
const dbList = (kind, cat, type, start = 0, limit = 20) => J(`/api/db/list?kind=${kind}&category=${enc(cat)}&type=${enc(type)}&start=${start}&limit=${limit}`);

async function home(tok) {
  const hist = H.all().slice(0, 12);
  app.innerHTML = `<section class="hero" id="hero"><div class="slide on"><div class="txt"><div class="skel" style="height:40px;width:260px;margin-bottom:12px"></div></div></div></section>
  ${hist.length ? `<section class="row"><div class="row-h"><h3>继续观看</h3><a href="#/history">全部</a></div><div class="scroller">${hist.map((h, _i) => card({ _i, title: h.title, pic: h.pic, href: h.href, ep: h.epName ? `看到 ${h.epName}` : "", prog: h.dur ? Math.min(100, h.t / h.dur * 100) : 0, s: h.year })).join("")}</div></section>` : ""}
  ${ROWS.map((r, i) => `<section class="row"><div class="row-h"><h3>${r[0]}</h3><a href="#/more/${r[1]}/${enc(r[2])}/${enc(r[3])}/${enc(r[0])}">更多</a></div><div class="scroller" id="row${i}">${skelRow(8)}</div></section>`).join("")}`;
  ROWS.forEach((r, i) => dbList(r[1], r[2], r[3], 0, 20).then(d => {
    if (tok !== routeToken) return;
    const el = $("#row" + i); if (!el) return;
    el.innerHTML = d.items.length ? d.items.map((it, _i) => card({ ...it, _i, type: it.type === "tv" || r[1] === "tv" ? "tv" : "movie", s: short(it.sub) || it.ep })).join("") : `<div class="empty">暂时拿不到豆瓣数据</div>`;
    if (i === 0) hero(d.items.slice(0, 8), tok);
  }));
}

function hero(items, tok) {
  const el = $("#hero"); if (!el || !items.length) return;
  el.innerHTML = items.map((it, i) => `<div class="slide${i ? "" : " on"}"><div class="bgp" style="background-image:url('/img?url=${enc(it.pic)}')"></div><div class="shade"></div>
    <a class="pp" href="#/d/movie/${it.id}">${img(it.pic, it.title)}</a>
    <div class="txt"><div class="tag">今日推荐 · ${i + 1}/${items.length}</div><h2>${esc(it.title)}</h2><div class="m">${it.rate ? `<span class="rate">${it.rate}</span>` : ""}<span>${esc(short(it.sub))}</span></div>
    <div class="acts" style="justify-content:inherit"><a class="btn pri" href="#/d/movie/${it.id}/play">${ICON_PLAY}立即播放</a><a class="btn sec" href="#/d/movie/${it.id}">详情</a></div></div></div>`).join("") +
    `<div class="thumbs">${items.map((it, i) => `<a class="th${i ? "" : " on"}" data-i="${i}" title="${esc(it.title)}">${img(it.pic, it.title)}<span>${esc(it.title)}</span><b></b></a>`).join("")}</div>` +
    `<div class="dots">${items.map((_, i) => `<i class="${i ? "" : "on"}" data-i="${i}"></i>`).join("")}</div>` +
    `<div class="spark">${Array.from({ length: 26 }, () => `<i style="left:${(Math.random() * 100).toFixed(1)}%;top:${(Math.random() * 100).toFixed(1)}%;--d:${(3 + Math.random() * 4).toFixed(1)}s;--w:${(Math.random() * 5).toFixed(1)}s"></i>`).join("")}</div>`;
  let cur = 0;
  const show = n => { const prev = cur; cur = (n + items.length) % items.length; $$(".slide", el).forEach((s, i) => { s.classList.toggle("prev", i === prev && prev !== cur); s.classList.toggle("on", i === cur); }); clearTimeout(window._heroP); window._heroP = setTimeout(() => $$(".slide.prev", el).forEach(s => s.classList.remove("prev")), 2000); $$(".dots i,.thumbs .th", el).forEach(s => s.classList.toggle("on", +s.dataset.i === cur)); const tb = $(".thumbs", el), a = $(".thumbs .th.on", el); if (tb && a && tb.offsetParent) tb.scrollLeft = a.offsetLeft - tb.clientWidth / 2 + a.offsetWidth / 2; restart(); };
  const restart = () => { clearInterval(window._heroT); window._heroT = setInterval(() => { if (tok !== routeToken) return clearInterval(window._heroT); show(cur + 1); }, 8000); };
  $$(".dots i,.thumbs .th", el).forEach(d => d.onclick = e => { e.preventDefault(); if (+d.dataset.i === cur) location.hash = `#/d/movie/${items[cur].id}`; else show(+d.dataset.i); });
  restart();
  let x0 = null; el.ontouchstart = e => x0 = e.touches[0].clientX; el.ontouchend = e => { if (x0 === null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 40) show(cur + (dx < 0 ? 1 : -1)); x0 = null; };
}

/* ---------- 更多（网格 + 无限滚动） ---------- */
const CHIPS = [
  [["movie", "热门", "全部", "热门"], ["movie", "最新", "全部", "最新"], ["movie", "豆瓣高分", "全部", "高分"], ["movie", "冷门佳片", "全部", "冷门佳片"], ["movie", "热门", "华语", "华语"], ["movie", "热门", "欧美", "欧美"], ["movie", "热门", "韩国", "韩国"], ["movie", "热门", "日本", "日本"]],
  [["tv", "tv", "tv", "综合"], ["tv", "tv", "tv_domestic", "国产剧"], ["tv", "tv", "tv_american", "欧美剧"], ["tv", "tv", "tv_korean", "韩剧"], ["tv", "tv", "tv_japanese", "日剧"], ["tv", "rec", "电视剧,香港", "港剧"], ["tv", "cms", "shorts", "短剧"], ["tv", "tv", "tv_documentary", "纪录片"]],
  [["tv", "tv", "tv_animation", "热播"], ["tv", "rec", "动画,日本", "日漫"], ["tv", "rec", "动画,中国大陆", "国漫"], ["tv", "rec", "动画,美国", "欧美动画"], ["movie", "rec", "动画", "动画电影"]],
  [["tv", "show", "show", "综合"], ["tv", "show", "show_domestic", "国内"], ["tv", "show", "show_foreign", "国外"], ["tv", "rec", "综艺,真人秀", "真人秀"], ["tv", "rec", "综艺,脱口秀", "脱口秀"], ["tv", "rec", "综艺,音乐", "音乐"]],
];
const chipGroup = (kind, cat, type) => CHIPS.find(g => g.some(c => c[0] === kind && c[1] === cat && c[2] === type)) || CHIPS[kind === "tv" ? 1 : 0];
const setNav = k => $$(".tabs-d a,.tabs-m a").forEach(a => a.classList.toggle("on", a.dataset.k === k));
const navKey = (kind, cat, type) => ["movie", "tv", "anime", "show"][CHIPS.indexOf(chipGroup(kind, cat, type))];
async function more(tok, kind, cat, type, title) {
  const chips = chipGroup(kind, cat, type), gname = ["电影", "剧集", "动漫", "综艺"][CHIPS.indexOf(chips)];
  const inGroup = chips.some(c => c[0] === kind && c[1] === cat && c[2] === type);
  app.innerHTML = `<div class="pagehead"><h2>${esc(inGroup && title !== gname ? gname : title)}</h2></div><div class="chips" style="margin-bottom:18px">${chips.map(c => `<a class="chip${c[0] === kind && c[1] === cat && c[2] === type ? " on" : ""}" href="#/more/${c[0]}/${enc(c[1])}/${enc(c[2])}/${enc(c[3])}">${esc(c[3])}</a>`).join("")}</div><div class="grid" id="g">${skelRow(12)}</div><div id="sent" class="loading"></div>`;
  let start = 0, busy = false, end = false; const g = $("#g");
  const con = $(".chip.on"); if (con) con.parentElement.scrollLeft = con.offsetLeft - 16;
  const load = async () => {
    if (busy || end) return; busy = true; $("#sent").innerHTML = `<div class="spin"></div>`;
    if (cat === "cms") {  // 短剧：来自采集站分类，按片名在各源匹配播放
      const pg = (g._pg || 0) + 1, d = await J(`/api/shorts?pg=${pg}`); if (tok !== routeToken) return;
      if (start === 0) { g.innerHTML = ""; g.classList.add("shorts"); }
      g._pg = pg;
      g.insertAdjacentHTML("beforeend", d.items.map((it, _i) => card({ title: it.title, year: it.year, pic: it.pic, ep: it.ep, s: it.sub, _i })).join(""));
      start += d.items.length; end = !d.more || (!d.items.length && pg > 3); busy = false;
      $("#sent").innerHTML = end ? (start ? "到底了" : "暂无内容") : "";
      if (!end && !d.items.length) { busy = false; load(); }
      return;
    }
    const d = await dbList(kind, cat, type, start, 30); if (tok !== routeToken) return;
    if (start === 0) g.innerHTML = "";
    g.insertAdjacentHTML("beforeend", d.items.map((it, _i) => card({ ...it, _i, type: kind === "tv" ? "tv" : "movie", s: short(it.sub) || it.ep })).join(""));
    start += d.items.length; end = !d.items.length || start >= (d.total || 0); busy = false;
    $("#sent").innerHTML = end ? (start ? "到底了" : "暂无内容") : "";
  };
  const io = new IntersectionObserver(es => { if (es[0].isIntersecting) load(); }, { rootMargin: "600px" });
  io.observe($("#sent")); load();
}

/* ---------- 搜索 ---------- */
async function search(tok, wd) {
  $("#q").value = wd || "";
  if (!wd) { app.innerHTML = `<div class="pagehead"><h2>搜索</h2></div><div class="empty">在顶部输入片名，同时搜索所有影视源</div>`; setTimeout(() => $("#q").focus(), 50); return; }
  app.innerHTML = `<div class="pagehead"><h2>「${esc(wd)}」</h2></div><div class="loading"><div class="spin"></div>正在所有源中搜索…</div>`;
  const d = await J("/api/search?wd=" + enc(wd)); if (tok !== routeToken) return;
  if (!d.list.length) { app.innerHTML = `<div class="pagehead"><h2>「${esc(wd)}」</h2></div><div class="empty">没有找到，换个关键词试试</div>`; return; }
  app.innerHTML = `<div class="pagehead"><h2>「${esc(wd)}」</h2><span class="srcstat">${d.list.length} 个结果 · ${d.sites} 个源</span></div><div class="grid">${d.list.map((v, _i) => card({ _i, title: v.name, year: v.year, pic: v.pic, ep: v.remarks, s: [v.year, v.type].filter(Boolean).join(" · "), href: `#/v/${enc(v.name)}/${enc(v.year || "")}` })).join("")}</div>`;
}

/* ---------- 记录 ---------- */
function historyPage() {
  const a = H.all();
  app.innerHTML = `<div class="pagehead"><h2>观看记录</h2>${a.length ? `<button class="chip" id="clr">清空</button>` : ""}</div>` +
    (a.length ? `<div class="grid">${a.map((h, _i) => card({ _i, title: h.title, pic: h.pic, href: h.href, ep: h.epName ? `看到 ${h.epName}` : "", prog: h.dur ? Math.min(100, h.t / h.dur * 100) : 0, s: new Date(h.at).toLocaleDateString() })).join("")}</div>` : `<div class="empty">还没有看过任何内容</div>`) +
    `<div style="margin-top:40px;text-align:center"><a class="chip" href="#/sites">影视源状态</a></div>`;
  if ($("#clr")) $("#clr").onclick = () => { if (confirm("清空全部观看记录？")) { localStorage.h2 = "[]"; historyPage(); } };
}

/* ---------- 源状态 ---------- */
async function sitesPage() {
  const { sites, status } = await J("/api/sites");
  app.innerHTML = `<div class="pagehead"><h2>影视源状态</h2></div><div class="srcstat" style="margin-bottom:12px">上次检测 ${esc(status.last_run || "—")} · 候选 ${status.candidates ?? "—"} · 有效 ${status.valid ?? sites.length} · 每天 04:00 自动检测</div>
  <button class="btn sec" id="rf" style="margin-bottom:16px">立即重新检测</button>
  <table class="tbl"><tr><th>#</th><th>名称</th><th>延迟</th><th>片量</th></tr>${sites.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.name)}</td><td>${s.latency}ms</td><td>${s.total || "—"}</td></tr>`).join("")}</table>`;
  $("#rf").onclick = async () => { await fetch("/api/refresh", { method: "POST" }); toast("已开始检测，几分钟后刷新查看"); };
}

/* ---------- 详情 ---------- */
async function detailDouban(tok, type, id, autoplay) {
  app.innerHTML = `<div class="loading"><div class="spin"></div></div>`;
  const d = await J(`/api/db/detail?type=${type}&id=${id}`); if (tok !== routeToken) return;
  if (d.error) { app.innerHTML = `<div class="empty">豆瓣详情获取失败</div>`; return; }
  { const g = (d.genres || []).join(","), tv = type === "tv" || d.episodes > 1; setNav(/动画/.test(g) ? "anime" : tv && /真人秀|脱口秀/.test(g) ? "show" : tv ? "tv" : "movie"); }
  renderDetail(tok, {
    title: d.title, year: d.year, pic: d.pic, rate: d.rate, votes: d.votes, original: d.original !== d.title ? d.original : "",
    metas: [d.year, d.countries.join(" / "), d.durations[0], d.episodes ? `${d.episodes} 集` : ""].filter(Boolean),
    tags: d.genres, intro: d.intro, cast: d.cast, href: `#/d/${type}/${id}`,
  }, autoplay);
  loadRelated(tok, type, id, d.title);
}
async function loadRelated(tok, type, id, title) {
  const slot = $("#relsec"); if (!slot) return;
  slot.innerHTML = `<section class="row"><div class="row-h"><h3>相关推荐</h3></div><div class="scroller">${skelRow(6)}</div></section>`;
  let r; try { r = await J(`/api/db/related?type=${type}&id=${id}&title=${enc(title)}`); } catch (e) { r = {}; }
  if (tok !== routeToken || !$("#relsec")) return;
  const row = (h, list) => list && list.length ? `<section class="row"><div class="row-h"><h3>${h}</h3></div><div class="scroller">${list.map((it, _i) => card({ ...it, _i, s: it.sub || it.year })).join("")}</div></section>` : "";
  const html = row(type === "tv" ? "全部季 / 系列" : "系列作品", r.series) + row(r.series && r.series.length ? "你可能也喜欢" : "相关推荐", r.recs);
  $("#relsec").innerHTML = html;
}
async function detailCms(tok, name, year, autoplay) {
  renderDetail(tok, { title: name, year, pic: "", metas: [year].filter(Boolean), tags: [], intro: "", cast: [], href: `#/v/${enc(name)}/${enc(year || "")}`, fromCms: true }, autoplay);
}

function renderDetail(tok, m, autoplay) {
  const key = canon(m.title) + "|" + (m.year || "");
  const h = H.get(key);
  app.innerHTML = `<div class="dt-wrap"><div class="dt"><div class="bgbox"><div class="bgp" id="bgp" style="${m.pic ? `background-image:url('/img?url=${enc(m.pic)}')` : ""}"></div></div>
   <div id="pslot"></div>
   <div class="dt-top"><div class="ps" id="ps">${img(m.pic, m.title)}</div><div class="info">
     <h1>${esc(m.title)}</h1>${m.original ? `<div class="og">${esc(m.original)}</div>` : ""}
     <div class="metas" id="metas">${m.rate ? `<span class="rate">${m.rate}</span>${m.votes ? `<span>${m.votes} 人评分</span>` : ""}` : ""}${m.metas.map(x => `<span>${esc(x)}</span>`).join("")}</div>
     <div class="tags" id="tags">${m.tags.map(t => `<span>${esc(t)}</span>`).join("")}</div>
     ${m.intro ? `<div class="intro fold" id="intro">${esc(m.intro)}</div><button class="more-t" id="moret">展开</button>` : `<div class="intro" id="intro"></div>`}
        </div>
   <div class="acts" id="acts"><button class="btn pri" id="playbtn">${ICON_PLAY}${h ? `继续播放 ${esc(h.epName || "")}` : "播放"}</button><span class="srcstat" id="sst"><i class="lamp wait"></i>正在查找片源…</span></div>
   <aside class="side">
   ${m.cast.length ? `<div class="sec-h">演职员</div><div class="cast">${m.cast.map((c, i) => `<div style="--i:${i}"><div class="av">${c.avatar ? img(c.avatar, c.name) : esc((c.name || "?")[0])}</div><p><b>${esc(c.name)}</b><span>${esc(c.role)}</span></p></div>`).join("")}</div>` : `<div id="castslot"></div>`}
   </aside></div>
   <div id="epsec"></div>
   <div id="relsec"></div>
  </div></div>`;
  if ($("#moret")) $("#moret").onclick = e => { const f = $("#intro").classList.toggle("fold"); e.target.textContent = f ? "展开" : "收起"; };
  window.scrollTo(0, 0);
  const P = window._P = new Player(tok, m, key);
  $("#playbtn").onclick = () => P.start(h);
  P.resolve().then(() => { if (autoplay && tok === routeToken) P.start(h); });
}

/* ---------- 页面 / 悬浮 / 全屏 切换 ---------- */
const Modes = {
  pipOK(v) { return (document.pictureInPictureEnabled && !v.disablePictureInPicture) || typeof v.webkitSetPresentationMode === "function"; },
  inPip(v) { return document.pictureInPictureElement === v || v.webkitPresentationMode === "picture-in-picture"; },
  fsEl() { return document.fullscreenElement || document.webkitFullscreenElement; },
  async lockLandscape(v) {
    try { if (screen.orientation && screen.orientation.lock && (!v.videoWidth || v.videoWidth >= v.videoHeight)) await screen.orientation.lock("landscape"); } catch (e) { }
  },
  unlock() { try { screen.orientation && screen.orientation.unlock && screen.orientation.unlock(); } catch (e) { } },
  async pip(v) {
    try {
      if (this.inPip(v)) { if (document.exitPictureInPicture && document.pictureInPictureElement) await document.exitPictureInPicture(); else v.webkitSetPresentationMode("inline"); return; }
      if (this.fsEl()) await this.exitFs();
      this.mark(v);
      if (v.requestPictureInPicture) await v.requestPictureInPicture(); else v.webkitSetPresentationMode("picture-in-picture");
    } catch (e) {
      const standalone = navigator.standalone || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
      if (standalone && (IS_IOS || IS_SAFARI)) toast("从主屏幕图标打开时，iOS 不允许悬浮播放。想用悬浮，请在 Safari 里打开本站", 5000);
      else if (!v.currentSrc) toast("视频开始播放后才能悬浮");
      else toast("当前浏览器不支持悬浮播放");
    }
  },
  async exitFs() { try { if (document.exitFullscreen) await document.exitFullscreen(); else if (document.webkitExitFullscreen) document.webkitExitFullscreen(); } catch (e) { } },
  // iPhone Safari 不支持网页全屏和锁定横屏：用"旋转铺满"模拟横屏全屏，不依赖系统自动转屏
  rfsOn() { return document.body.classList.contains("rfs"); },
  enterRfs(v) {
    this.mark(v); document.body.classList.toggle("rfsv", v.videoHeight > v.videoWidth); document.body.classList.add("rfs"); window.scrollTo(0, 0);
    if (v._wasPlaying) this.resume(v);
  },
  exitRfs(v) { if (!this.rfsOn()) return; this.mark(v); document.body.classList.remove("rfs"); if (v) this.resume(v); },
  async fullscreen(v, wrap) {
    if (this.rfsOn()) return this.exitRfs(v);
    if (this.fsEl()) return this.exitFs();
    if (!wrap.requestFullscreen && !wrap.webkitRequestFullscreen && v.webkitEnterFullscreen) {
      if (this.inPip(v)) v.webkitSetPresentationMode("inline");
      return this.enterRfs(v);
    }
    this.mark(v);
    try {
      if (this.inPip(v)) { if (document.exitPictureInPicture && document.pictureInPictureElement) await document.exitPictureInPicture(); else v.webkitSetPresentationMode("inline"); }
      if (wrap.requestFullscreen) await wrap.requestFullscreen({ navigationUI: "hide" });
      else if (wrap.webkitRequestFullscreen) wrap.webkitRequestFullscreen();
      else if (v.webkitEnterFullscreen) { v.webkitEnterFullscreen(); return; } // iPhone：系统播放器全屏
      await this.lockLandscape(v);
    } catch (e) { if (v.webkitEnterFullscreen) v.webkitEnterFullscreen(); }
  },
  // 记录切换前是否在播放；切换后浏览器自己暂停了就续播
  mark(v) { v._wasPlaying = !v.paused && !v.ended; v._markAt = Date.now(); },
  resume(v) {
    setTimeout(() => {
      if (v._wasPlaying && v.paused && !v.ended && Date.now() - (v._pauseAt || 0) < 2500) { const p = v.play(); if (p && p.catch) p.catch(() => { }); }
    }, 250);
  },
  bind(v) {
    if (v._modesBound) return; v._modesBound = 1;
    v.addEventListener("pause", () => { v._pauseAt = Date.now(); });
    const fitV = () => { const w = $("#pwrap"), vert = v.videoHeight > v.videoWidth; if (w) w.classList.toggle("vert", vert); if (this.rfsOn()) document.body.classList.toggle("rfsv", vert); };
    v.addEventListener("loadedmetadata", fitV); v.addEventListener("resize", fitV);
    v.addEventListener("play", () => { v._wasPlaying = true; });
    const onFs = () => {
      const el = this.fsEl();
      if (el && (el === v || el.contains(v))) { if (!v._markAt || Date.now() - v._markAt > 1500) this.mark(v); this.lockLandscape(v); document.body.classList.add("fs"); }
      else if (document.body.classList.contains("fs")) { document.body.classList.remove("fs"); this.unlock(); this.resume(v); }
    };
    document.addEventListener("fullscreenchange", onFs);
    document.addEventListener("webkitfullscreenchange", onFs);
    v.addEventListener("webkitbeginfullscreen", () => { this.mark(v); document.body.classList.remove("rfs"); });      // iPhone 系统全屏
    v.addEventListener("webkitendfullscreen", () => this.resume(v));
    v.addEventListener("enterpictureinpicture", () => { if (!v._markAt || Date.now() - v._markAt > 1500) this.mark(v); });
    v.addEventListener("leavepictureinpicture", () => this.resume(v));
    v.addEventListener("webkitpresentationmodechanged", () => { if (v.webkitPresentationMode === "inline") this.resume(v); else this.mark(v); });
    // 手机横过来时自动全屏（安卓支持；iPhone 由系统处理）
    const mq = window.matchMedia && matchMedia("(orientation: landscape)");
    const onRot = () => {
      if (!mq || !mq.matches || innerWidth > 1000 || v.paused || this.fsEl() || this.inPip(v)) return;
      const w = $("#pwrap"); if (w && w.requestFullscreen) w.requestFullscreen({ navigationUI: "hide" }).catch(() => { });
    };
    if (mq && mq.addEventListener) mq.addEventListener("change", onRot);
  },
};

/* 只认国内 IP 的片源 CDN（海外/代理出口直连会 403）。PROXIED：服务器看到的访客出口不在国内 */
let PROXIED = false;
// 按接口地址和播放地址一起判断：CDN 域名会轮换（如 dytt-live → dytt-film），只看播放地址会漏判
const GEO_LOCKED = /dytt|ffzy/i;
// 服务器学到的结论优先（s.lock：1 需中转 / 0 可直连），没学到时才用内置名单兜底
const geoLocked = s => { if (s.lock === 1 || s.lock === 0) return s.lock; const e = s.groups && s.groups[0] && s.groups[0].eps[0]; return GEO_LOCKED.test(s.api || "") || (e && GEO_LOCKED.test(e.url)) ? 1 : 0; };
// 开代理时把每次直连的成败报给服务器，用于学习（每个片源每次打开页面最多报一次成功）
const _learned = new Set();
const learnSend = (o, beacon) => { const b = JSON.stringify(o);
  if (beacon && navigator.sendBeacon) navigator.sendBeacon("/api/learn", new Blob([b], { type: "application/json" }));
  else fetch("/api/learn", { method: "POST", headers: { "Content-Type": "application/json" }, body: b, keepalive: true }).catch(() => { }); };
const learn = (api, ok) => { if (!PROXIED || !api) return; if (ok) { if (_learned.has(api)) return; _learned.add(api); } learnSend({ api, ok }); };
/* 流畅度：公网播放时统计起播耗时、观看与卡顿时长，换源/离开时上报（服务器只用直连的数据给线路排序） */
const QS = {
  cur: null,
  begin(api, relay) { this.flush(); if (REMOTE) this.cur = { api, relay, t0: Date.now(), ttff: null, watch: 0, stall: 0, ws: 0, lt: 0 }; },
  playing() { const c = this.cur; if (!c) return; const n = Date.now(); if (c.ttff == null) c.ttff = n - c.t0; if (c.ws) { c.stall += n - c.ws; c.ws = 0; } c.lt = n; },
  waiting() { const c = this.cur; if (c && c.ttff != null && !c.ws) c.ws = Date.now(); },
  tick() { const c = this.cur; if (!c || c.ttff == null || c.ws) return; const n = Date.now(); if (c.lt) c.watch += Math.min(n - c.lt, 2000); c.lt = n; },
  flush(beacon) { const c = this.cur; this.cur = null; if (!c || c.ttff == null) return; if (c.ws) c.stall += Date.now() - c.ws;
    if (c.watch + c.stall < 20000) return; learnSend({ api: c.api, relay: c.relay, ttff: c.ttff, watch: c.watch / 1000, stall: c.stall / 1000 }, beacon); }
};
addEventListener("pagehide", () => QS.flush(true));
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") QS.flush(true); });

/* 记住哪些片源直连不通、需要服务器中转（7 天） */
const Relay = {
  m() { try { return JSON.parse(localStorage.relay || "{}"); } catch (e) { return {}; } },
  // 按网络环境分开记：同一台设备开代理时要中转的站，关掉代理后往往又能直连
  k(api) { return (PROXIED ? "px|" : "") + api; },
  get(api) { const t = this.m()[this.k(api)]; return t && Date.now() - t < 7 * 864e5; },
  set(api, on) { const m = this.m(), k = this.k(api); if (on) m[k] = Date.now(); else delete m[k]; localStorage.relay = JSON.stringify(m); }
};

/* ---------- 播放器：自动选最快源 + 故障自动换源 ---------- */
class Player {
  constructor(tok, meta, key) { Object.assign(this, { tok, meta, key, sources: [], si: 0, ei: 0, proxy: false, bad: new Set(), dbad: new Set(), hls: null, started: false, resolved: false }); }
  alive() { return this.tok === routeToken; }
  async resolve() {
    const q = `/api/resolve?name=${enc(this.meta.title)}&year=${enc(this.meta.year || "")}`;
    const d = await J(q).catch(() => ({ sources: [] })); if (!this.alive()) return;
    PROXIED = REMOTE && !!d.geo && d.geo !== "CN" && d.geo !== "XX"; this.merge(d.sources); this.resolved = true; this.status();
    if (!d.done) J(q + "&full=1").then(f => { if (this.alive()) { this.merge(f.sources); this.status(); this.fillPres(); } }).catch(() => { }); else this.fillPres();
  }
  async fillPres() { // 解析时没来得及探完的分辨率，后台再补一次（服务端读分片 SPS）
    const ep1 = s => { const u = s.groups[0]?.eps[0]?.url || ""; return /\.m3u8/i.test(u) ? u : ""; };
    const urls = this.sources.filter(s => !s.pres && ep1(s)).map(ep1); if (!urls.length) return;
    const r = await J("/api/pres", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ urls }) }).catch(() => ({}));
    if (!this.alive()) return; let n = 0;
    for (const s of this.sources) { const h = r[ep1(s)]; if (h && !s.pres) { s.pres = h; n++; } }
    if (!n) return;
    if (!this.started) this.merge([]);
    if ($(".sheet.on")) this.sheet();
  }
  merge(list) {
    const have = new Set(this.sources.map(s => s.api));
    const cur = this.sources[this.si];
    for (const s of list || []) if (!have.has(s.api)) this.sources.push(s); else { const o = this.sources.find(x => x.api === s.api); if (o && s.pres && !o.pres) o.pres = s.pres; }
    if (!this.started) { // 还没开播时按后端顺序（集数全 + 最快）
      const order = new Map((list || []).map((s, i) => [s.api, i]));
      this.sources.sort((a, b) => (order.get(a.api) ?? 99) - (order.get(b.api) ?? 99));
      // 设备开着代理时，优先不挑 IP 的线路，只认国内 IP 的放后面（要用时自动经服务器中转）
      // 公网访问时按“流畅”排序：能直连的优先（中转占家里上行、带宽小），其次集数全，再按学到的流畅度 q（没数据按中等算，顺便试探）
      // 画质：1080P 及以上优先，其次 720P（没数据按 720 算），再低的往后（按片源学到的分辨率）
      {
        const maxE = Math.max(0, ...this.sources.map(s => s.groups[0].eps.length));
        const late = s => !REMOTE || !PROXIED ? 0 : s.lock === 0 ? 0 : (geoLocked(s) || (Relay.get(s.api) ? 1 : 0));
        const tier = s => { const h = s.pres || s.res; return !h ? 1 : h >= 1000 ? 0 : h >= 700 ? 1 : 2; }; // 先看预探到的本片分辨率，没有再用学到的片源平均
        const key = s => [late(s), s.groups[0].eps.length < maxE ? 1 : 0, tier(s), REMOTE ? s.q ?? 5 : 0];
        this.sources.sort((a, b) => { const x = key(a), y = key(b); return x[0] - y[0] || x[1] - y[1] || x[2] - y[2] || x[3] - y[3]; });
      }
    } else if (cur) this.si = this.sources.indexOf(cur);
    const s0 = this.sources[0];
    if (s0 && this.meta.fromCms && !this._filled) { // 搜索进来的：用片源信息补全详情
      this._filled = true; const i = s0.info;
      if (i.pic) { $("#ps").innerHTML = img(i.pic, this.meta.title); $("#bgp").style.backgroundImage = `url('/img?url=${enc(i.pic)}')`; this.meta.pic = i.pic; }
      $("#metas").innerHTML = [i.year, i.area, i.type, s0.remarks].filter(Boolean).map(x => `<span>${esc(x)}</span>`).join("");
      if (i.content) { $("#intro").textContent = i.content; $("#intro").classList.add("fold"); $("#intro").insertAdjacentHTML("afterend", `<button class="more-t" onclick="const f=$('#intro').classList.toggle('fold');this.textContent=f?'展开':'收起'">展开</button>`); }
      if (i.actor && $("#castslot")) $("#castslot").outerHTML = `<div class="sec-h">演职员</div><div class="cast">${[["导演", i.director], ...i.actor.split(/[,，\/]/).slice(0, 15).map(a => ["演员", a])].filter(x => x[1]).map(([r, n]) => `<div><div class="av">${esc(n.trim()[0] || "?")}</div><p><b>${esc(n.trim())}</b><span>${r}</span></p></div>`).join("")}</div>`;
    }
    this.renderEps();
  }
  eps() { const s = this.sources[this.si]; return s ? s.groups[0].eps : []; }
  status(text) {
    const el = $("#sst"); if (!el) return;
    if (text) { el.innerHTML = text; return; }
    const n = this.sources.length - this.bad.size;
    if (!this.resolved) el.innerHTML = `<i class="lamp wait"></i>正在查找片源…`;
    else if (!this.sources.length) el.innerHTML = `<i class="lamp"></i>暂未找到可播放的片源`;
    else el.innerHTML = `<i class="lamp ok"></i>${n} 条线路可用`;
  }
  renderEps() {
    const sec = $("#epsec"); if (!sec) return;
    const eps = this.eps();
    const tot = ((this.meta && this.meta.metas) || []).join(" ").match(/(\d+)\s*集/), totN = tot ? +tot[1] : 0;
    const series = totN > 1 || location.hash.includes("/d/tv/") || eps.some(e => /集|EP|E\d/i.test(e.name || ""));
    if (!eps.length || (eps.length === 1 && !series)) { sec.innerHTML = ""; return; }
    const upd = totN > eps.length ? `已更新 ${eps.length} 集 · 共 ${totN} 集` : `共 ${eps.length} 集`;
    const seen = new Set((H.get(this.key) || {}).seen || []);
    const PAGE = 50, pages = Math.ceil(eps.length / PAGE);
    const pg = this._pg ?? Math.floor(this.ei / PAGE);
    sec.innerHTML = `<div class="sec-h">选集 <small>${upd}</small></div>
      ${pages > 1 ? `<div class="epnav">${Array.from({ length: pages }, (_, i) => `<button class="chip${i === pg ? " on" : ""}" data-p="${i}">${i * PAGE + 1}-${Math.min(eps.length, (i + 1) * PAGE)}</button>`).join("")}</div>` : ""}
      <div class="eps">${eps.slice(pg * PAGE, (pg + 1) * PAGE).map((e, j) => { const i = pg * PAGE + j; return `<button class="ep${this.started && i === this.ei ? " on" : ""}${seen.has(i) ? " seen" : ""}" data-i="${i}" title="${esc(e.name)}">${esc(e.name)}</button>`; }).join("")}</div>`;
    $$(".epnav .chip", sec).forEach(b => b.onclick = () => { this._pg = +b.dataset.p; this.renderEps(); });
    $$(".ep", sec).forEach(b => b.onclick = () => { this._pg = undefined; this.play(+b.dataset.i, 0); });
  }
  async start(h) {
    if (!this.resolved) { this.status(`<i class="lamp wait"></i>正在查找片源…`); toast("正在查找片源，稍等"); await new Promise(r => { const t = setInterval(() => { if (this.resolved || !this.alive()) { clearInterval(t); r(); } }, 200); }); }
    if (!this.sources.length) { toast("暂未找到可播放的片源"); return; }
    if (h && h.title) { // 续播
      const i = this.sources.findIndex(s => s.api === h.api); if (i >= 0) this.si = i;
      this.play(Math.min(h.ei || 0, this.eps().length - 1), h.t || 0);
    } else this.play(0, 0);
  }
  ensurePlayer() {
    if ($("#pwrap")) return $("#pv");
    $("#pslot").innerHTML = `<div class="pwrap" id="pwrap"><video id="pv" controls playsinline webkit-playsinline x5-playsinline x5-video-player-type="h5-page" x-webkit-airplay="allow" preload="auto"></video><button class="rfs-x" id="rfsx" aria-label="退出全屏"><svg viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg></button><div class="pmask" id="pmask"><div class="spin"></div><span id="pmt">加载中…</span></div></div>
      <div class="pbar"><span class="now" id="pnow"></span><span id="psrc"></span><span class="pinfo" id="pinfo"></span><span class="sp"></span><button class="pill" id="pprev">上一集</button><button class="pill" id="pnext">下一集</button><button class="pill" id="pswitch">换源</button><button class="pill ic" id="ppip" title="悬浮播放"><svg viewBox="0 0 24 24"><path d="M3 5h18v14H3z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 11h7v6h-7z"/></svg><span>悬浮</span></button><button class="pill ic" id="pfs" title="全屏"><svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2"/></svg><span>全屏</span></button></div>`;
    $("#pprev").onclick = () => this.ei > 0 && this.play(this.ei - 1, 0);
    $("#pnext").onclick = () => this.ei + 1 < this.eps().length && this.play(this.ei + 1, 0);
    $("#pswitch").onclick = () => this.sheet();
    const v0 = $("#pv");
    $("#pfs").onclick = () => Modes.fullscreen(v0, $("#pwrap"));
    $("#rfsx").onclick = () => Modes.exitRfs(v0);
    if (Modes.pipOK(v0)) $("#ppip").onclick = () => Modes.pip(v0); else $("#ppip").style.display = "none";
    Modes.bind(v0);
    $("#acts").style.display = "none";
    $("#pslot").classList.add("stick");
    const fixTop = () => { const w = $("#pslot"); if (w) w.style.top = $(".top").offsetHeight + "px"; };
    fixTop(); window.addEventListener("resize", fixTop);
    if (innerWidth <= 760) setTimeout(() => window.scrollTo({ top: 0, behavior: "smooth" }), 50);
    return $("#pv");
  }
  mask(t) { const m = $("#pmask"); if (!m) return; if (t) { m.classList.remove("hide"); $("#pmt").textContent = t; } else m.classList.add("hide"); }
  play(ei, at, keepMode) {
    const v = this.ensurePlayer();
    this.started = true; this.ei = ei;
    let eps = this.eps();
    if (ei >= eps.length) { // 当前源没有这一集，找一个有的
      const j = this.sources.findIndex((s, k) => !this.bad.has(k) && s.groups[0].eps.length > ei);
      if (j < 0) { toast("还没有这一集"); return; } this.si = j; eps = this.eps();
    }
    const ep = eps[ei], src = this.sources[this.si];
    if (!keepMode) this.proxy = REMOTE && (PROXIED ? (src.lock === 0 ? false : (!!Relay.get(src.api) || !!geoLocked(src))) : !!Relay.get(src.api)); // 记住了“直连不通”的站点，直接走中转
    this.cleanup();
    $("#pnow").textContent = eps.length > 1 ? ep.name : "正片";
    $("#psrc").textContent = `· ${src.site}`;
    $("#pprev").style.display = $("#pnext").style.display = eps.length > 1 ? "" : "none";
    this.mask(`正在连接 ${src.site}…`); this.renderEps();
    const mixed = !REMOTE || /^http:\/\//i.test(ep.url); // 局域网访问时一律经 N1 中转（家里设备走代理会被片源 CDN 拒绝）；https 页面里的 http 资源也必须中转
    const url = /\.m3u8/i.test(ep.url) ? `/m3u8?url=${enc(ep.url)}${this.proxy ? "&proxy=1" : ""}${localStorage.noad === "0" ? "&noad=0" : ""}` : ((this.proxy || mixed) ? `/seg?url=${enc(ep.url)}` : ep.url);
    let ok = false;
    const fail = why => { if (this._failing) return; this._failing = true; setTimeout(() => this._failing = false, 500); this.failover(why, v.currentTime > 1 ? v.currentTime : at); };
    this.watch = setTimeout(() => { if (!ok) fail("连接超时"); }, REMOTE ? 25000 : 15000);
    QS.begin(src.api, this.proxy || mixed);
    this._relay = this.proxy || mixed; this._bw = 0; this._okAt = 0; this._maxH = 0; this._resSent = false; this._api = src.api; this.showInfo(); this.infoT = setInterval(() => this.showInfo(), 1500);
    const onPlaying = () => { if (!this._okAt) this._okAt = Date.now(); QS.playing(); if (!ok && !this.proxy) learn(src.api, true); ok = true; clearTimeout(this.watch); clearTimeout(this.stall); this.mask(""); };
    v.onplaying = onPlaying;
    v.onwaiting = () => { if (!ok) return; if (!v.seeking) QS.waiting(); this.mask("缓冲中…"); clearTimeout(this.stall); this.stall = setTimeout(() => fail("卡顿太久"), REMOTE ? 30000 : 20000); };
    v.ontimeupdate = () => { if (ok) { QS.tick(); clearTimeout(this.stall); this.save(v); } };
    v.onended = () => { if (this.ei + 1 < this.eps().length) this.play(this.ei + 1, 0); };
    const begin = () => {
      if (at > 3) { try { v.currentTime = at; } catch (e) { } }
      const p = v.play();
      if (p && p.catch) p.catch(err => { if (err && err.name === "NotAllowedError") { clearTimeout(this.watch); this.mask(""); toast("点一下画面开始播放"); v.addEventListener("play", () => { if (!ok) this.watch = setTimeout(() => { if (!ok) fail("连接超时"); }, REMOTE ? 25000 : 15000); }, { once: true }); } });
    };
    const isM3u8 = /\.m3u8/i.test(ep.url);
    const nativeHls = !!v.canPlayType("application/vnd.apple.mpegurl") && (IS_IOS || IS_SAFARI || !(window.Hls && Hls.isSupported()));
    if (isM3u8 && !nativeHls && window.Hls && Hls.isSupported()) {
      const hls = this.hls = new Hls({ maxBufferLength: 45, enableWorker: true, manifestLoadingMaxRetry: 1, levelLoadingMaxRetry: 1, fragLoadingMaxRetry: 2 });
      let mediaErr = 0;
      hls.on(Hls.Events.ERROR, (e, d) => {
        if (!d.fatal) return;
        if (d.type === Hls.ErrorTypes.MEDIA_ERROR && mediaErr++ < 2) { hls.recoverMediaError(); return; }
        fail(d.details || "播放错误");
      });
      hls.on(Hls.Events.MANIFEST_PARSED, begin);
      hls.on(Hls.Events.FRAG_LOADED, (e, d) => { const st = d.frag && d.frag.stats || d.stats; if (!st) return; const ms = (st.loading ? st.loading.end - st.loading.start : st.tload - st.trequest) || 0, b = st.loaded || st.total || 0; if (ms > 30 && b > 20000) { const r = b / ms * 1000; this._bw = this._bw ? this._bw * .6 + r * .4 : r; } });
      hls.loadSource(url); hls.attachMedia(v);
      const p0 = v.play(); if (p0 && p0.catch) p0.catch(() => { });
    } else { v.src = url; v.onloadedmetadata = begin; v.onerror = () => fail("播放错误"); v.load(); const p0 = v.play(); if (p0 && p0.catch) p0.catch(() => { }); }
    this.save(v, true);
  }
  failover(why, at) {
    if (!this.alive()) return;
    // 策略：先把所有线路都直连试一遍（视频不经过 NAS），全部直连失败后才走 NAS 代理保底
    const cur = this.sources[this.si];
    const has = k => this.sources[k].groups[0].eps.length > this.ei;
    const go = (next, proxy) => {
      const name = this.eps()[this.ei]?.name; this.si = next;
      const k = this.eps().findIndex(e => e.name === name); if (k >= 0) this.ei = k;
      this.proxy = proxy; this.status(); this.play(this.ei, at, true);
    };
    // 策略：先直连（切片不经过家里上行）；直连失败先让服务器中转同一线路再试（不少片源 CDN 只认国内家宽 IP，
    // 设备挂了代理/在海外时直连会 403），中转也不行才换下一条线路
    if (REMOTE && !this.proxy) {
      this.dbad.add(this.si); Relay.set(cur.api, 1); learn(cur.api, false);
      this.mask(`${cur.site} 直连不通，改由服务器中转…`); toast(`${cur.site} 直连${why}，改由服务器中转`);
      go(this.si, true); return;
    }
    if (this.proxy) Relay.set(cur.api, 0);
    this.bad.add(this.si);
    const nx = this.sources.findIndex((s, k) => !this.bad.has(k) && has(k));
    if (nx >= 0) { const r = REMOTE && !!Relay.get(this.sources[nx].api); toast(`${cur.site} ${why}，已切到 ${this.sources[nx].site}`); go(nx, r); return; }
    this.cleanup(); this.mask("所有线路都无法播放，稍后再试"); this.status(); toast("所有线路都无法播放");
  }
  showInfo() {
    const el = $("#pinfo"), v = $("#pv"); if (!el || !v) return;
    const lab = h => !h ? "" : h >= 2000 ? "4K" : h >= 1400 ? "2K" : h >= 1000 ? "1080P" : h >= 700 ? "720P" : h + "P";
    const h = v.videoHeight, lv = this.hls && this.hls.levels || [], mx = Math.max(0, ...lv.map(l => l.height || 0));
    this._maxH = Math.max(this._maxH || 0, h || 0, mx);
    if (this._okAt && !this._resSent && this._maxH && Date.now() - this._okAt > 30000) { this._resSent = true; learnSend({ api: this._api, h: this._maxH }); }
    const res = h ? (mx > h + 40 ? `${lab(h)}（最高 ${lab(mx)}）` : lab(h)) : "";
    const bw = this._bw, spd = bw ? (bw >= 1048576 ? (bw / 1048576).toFixed(1) + " MB/s" : Math.round(bw / 1024) + " KB/s") : "";
    el.innerHTML = `<i class="${this._relay ? "rl" : "dr"}"></i>${this._relay ? "中转" : "直连"}${res ? `<em class="${h && h < 700 ? "low" : ""}" title="片源视频本身的分辨率">${res}</em>` : ""}${spd ? `<em class="spd">${spd}</em>` : ""}`;
  }
  cleanup() { clearInterval(this.infoT); QS.flush(); clearTimeout(this.watch); clearTimeout(this.stall); if (this.hls) { this.hls.destroy(); this.hls = null; } }
  save(v, force) {
    const now = Date.now(); if (!force && now - (this._sv || 0) < 4000) return; this._sv = now;
    const old = H.get(this.key) || {}; const seen = new Set(old.seen || []); seen.add(this.ei);
    const src = this.sources[this.si] || {};
    H.put({ key: this.key, title: this.meta.title, year: this.meta.year, pic: this.meta.pic, href: this.meta.href, api: src.api, ei: this.ei,
      epName: this.eps().length > 1 ? this.eps()[this.ei]?.name : "", t: force ? (old.ei === this.ei ? old.t : 0) : v.currentTime, dur: v.duration || old.dur || 0, seen: [...seen], at: now });
  }
  sheet() {
    let bg = $(".sheet-bg"); if (!bg) { document.body.insertAdjacentHTML("beforeend", `<div class="sheet-bg"></div><div class="sheet"></div>`); bg = $(".sheet-bg"); }
    const sh = $(".sheet");
    const close = () => { bg.classList.remove("on"); sh.classList.remove("on"); };
    sh.innerHTML = `<div class="grab"></div><h4>选择线路</h4>${this.sources.map((s, i) => `<div class="srow${i === this.si ? " on" : ""}${this.bad.has(i) ? " bad" : ""}" data-i="${i}"><span>${esc(s.site)}</span><small>${s.groups[0].eps.length > 1 ? s.groups[0].eps.length + " 集" : ""} ${esc(s.remarks || "")}</small><span class="sp"></span>${s.pres || s.res ? `<small>${(h => h >= 2000 ? "4K" : h >= 1400 ? "2K" : h >= 1000 ? "1080P" : h >= 700 ? "720P" : h + "P")(s.pres || s.res)}</small>` : ""}<small>${s.ms}ms</small></div>`).join("")}
      <label class="switch"><span>自动去除插播广告</span><input type="checkbox" id="noad" ${localStorage.noad === "0" ? "" : "checked"}></label>`;
    $$(".srow", sh).forEach(r => r.onclick = () => { const i = +r.dataset.i; this.bad.delete(i); this.dbad.delete(i); const at = $("#pv").currentTime; this.si = i; close(); this.play(Math.min(this.ei, this.eps().length - 1), at); });
    $("#noad", sh).onchange = e => { localStorage.noad = e.target.checked ? "1" : "0"; close(); this.play(this.ei, $("#pv").currentTime); };
    bg.onclick = close;
    requestAnimationFrame(() => { bg.classList.add("on"); sh.classList.add("on"); });
  }
}

/* ---------- 路由 ---------- */
const navStack = [];
function backNav() { if (navStack.length > 1) window.history.back(); else { navStack.length = 0; location.hash = "#/"; } }
function route() {
  const tok = ++routeToken;
  const cur = location.hash || "#/";
  if (navStack.length > 1 && navStack[navStack.length - 2] === cur) navStack.pop();
  else if (navStack[navStack.length - 1] !== cur) navStack.push(cur);
  if (window._P) { window._P.cleanup(); window._P = null; }
  document.body.classList.remove("rfs", "rfsv");
  document.querySelectorAll(".sheet-bg.on,.sheet.on").forEach(e => e.classList.remove("on"));
  const h = location.hash.slice(1) || "/";
  const p = h.split("/").map(x => { try { return decodeURIComponent(x); } catch (e) { return x; } });
  let k = "home";
  if (p[1] === "more") k = navKey(p[2], p[3], p[4]);
  else if (p[1] === "d") k = p[2] === "tv" ? "tv" : "movie";
  else if (p[1] && p[1] !== "v") k = p[1];
  $$(".tabs-d a,.tabs-m a").forEach(a => a.classList.toggle("on", a.dataset.k === k));
  $(".top").classList.toggle("sub", h !== "/" && h !== "");
  if (p[1] !== "search") $("#q").value = "";
  window.scrollTo(0, 0);
  if (p[1] === "more") return more(tok, p[2], p[3], p[4], p[5] || "");
  if (p[1] === "d") return detailDouban(tok, p[2], p[3], p[4] === "play");
  if (p[1] === "v") return detailCms(tok, p[2], p[3], p[4] === "play");
  if (p[1] === "search") return search(tok, p[2]);
  if (p[1] === "history") return historyPage();
  if (p[1] === "sites") return sitesPage();
  return home(tok);
}
$("#sform").onsubmit = e => { e.preventDefault(); const v = $("#q").value.trim(); if (v) { $("#q").blur(); go("#/search/" + enc(v)); } };
window.addEventListener("hashchange", route);
$("#back").onclick = backNav;
route();
