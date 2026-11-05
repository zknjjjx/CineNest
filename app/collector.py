"""读取用户设置的影视源接口 + 每日本地测速
- 接口在首页「设置」里填（/data/settings.json），可多个，启用的合并去重；/data/extra.txt 可手动补充
- 用本机网络逐个测速：分类列表 + 视频列表 + m3u8 可达。测不通的不删除，只排到后面
  （家里联通不通的源，换到单位电信可能能用；播放时会自动跳过连不上的源）
- 输出 /data/sites.json（能通的按速度在前，不通的在后）和 /data/status.json
- 每天 RUN_AT(默认 04:00 Asia/Shanghai) 跑一次；/data/trigger 文件出现时立即重跑（保存设置时会触发）
"""
import asyncio, json, os, re, time, datetime, random
from urllib.parse import urlparse
import aiohttp

DATA = os.environ.get("DATA_DIR", "/data")
RUN_AT = os.environ.get("RUN_AT", "04:00")
TIMEOUT = float(os.environ.get("CHECK_TIMEOUT", "15"))
ALLOW_ADULT = os.environ.get("ALLOW_ADULT", "0") == "1"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

API_RE = re.compile(r"https?://[A-Za-z0-9._-]+(?::\d+)?(?:/[A-Za-z0-9._-]+)*?/api\.php/provide/vod", re.I)
NAME_RE = re.compile(r"""["']?name["']?\s*[:=]\s*["']([^"'\n]{1,30})["']""")
ADULT_WORDS = ["伦理", "福利", "成人", "写真", "三级", "里番", "AV", "无码", "有码", "SM", "色情", "18+", "国产自拍", "强奸", "乱伦", "制服"]


def log(*a):
    print(datetime.datetime.now().strftime("%m-%d %H:%M:%S"), *a, flush=True)


def norm(api):
    api = api.strip().rstrip("/")
    return api


def key_of(api):
    p = urlparse(api)
    return (p.hostname or "").lower().removeprefix("www.") + p.path.lower()


async def fetch_text(session, url, timeout=15):
    async with session.get(url, timeout=aiohttp.ClientTimeout(total=timeout), headers={"User-Agent": UA}) as r:
        return await r.text(errors="replace")


async def gather_candidates(session):
    import conf
    cands, up_stats = {}, {}
    cfg = conf.load()
    for it in conf.interfaces(cfg):
        if it.get("on") is False:
            continue
        url = it["url"].strip()
        got = None
        for u in conf.mirrors(url, cfg.get("gh_proxy")):
            try:
                text = await fetch_text(session, u, 12)
                got = conf.parse(text)
                if got:
                    conf.cache_put(url, got)
                    break
            except Exception:
                continue
        if not got:
            c = conf.cache_get(url)
            got = (c or {}).get("sites") or []
            up_stats[it.get("name") or url] = f"拉取失败，用缓存 {len(got)}" if got else "拉取失败"
        else:
            up_stats[it.get("name") or url] = len(got)
        for s in got:
            if s.get("adult") and not ALLOW_ADULT:
                continue
            cands.setdefault(key_of(s["api"]), {"api": norm(s["api"]), "name": s["name"]})
    try:
        for line in open(os.path.join(DATA, "extra.txt"), encoding="utf-8"):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            parts = line.split(",", 1)
            api = parts[-1].strip(); name = parts[0].strip() if len(parts) > 1 else ""
            cands[key_of(api)] = {"api": norm(api), "name": name or urlparse(api).hostname}
    except FileNotFoundError:
        pass
    log("候选接口", len(cands), up_stats)
    return list(cands.values()), up_stats


def dead(site):
    return {"name": site["name"], "api": site["api"], "latency": None, "total": 0, "updated": "", "adult": False, "ok": False}


async def check_site(session, site, sem):
    r = await _check_site(session, site, sem)
    return r


async def _check_site(session, site, sem):
    async with sem:
        api = site["api"]
        t0 = time.time()
        try:
            async with session.get(api + "/?ac=list", timeout=aiohttp.ClientTimeout(total=TIMEOUT), headers={"User-Agent": UA}) as r:
                if r.status != 200:
                    return None
                data = json.loads(await r.text(errors="replace"))
            classes = [c.get("type_name", "") for c in data.get("class", []) or []]
            if not isinstance(data.get("list"), list) or not classes:
                return None
            latency = int((time.time() - t0) * 1000)
            adult_hits = sum(1 for c in classes if any(w.lower() in c.lower() for w in ADULT_WORDS))
            adult = adult_hits >= 3 or adult_hits / max(1, len(classes)) > 0.3
            if adult and not ALLOW_ADULT:
                return "adult"
            async with session.get(api + "/?ac=videolist&pg=1", timeout=aiohttp.ClientTimeout(total=TIMEOUT), headers={"User-Agent": UA}) as r:
                vd = json.loads(await r.text(errors="replace"))
            vlist = vd.get("list") or []
            m3u8 = None
            for v in vlist[:10]:
                mm = re.search(r"https?://[^\s$#]+?\.m3u8[^\s$#]*", v.get("vod_play_url") or "")
                if mm:
                    m3u8 = mm.group(0); break
            if not m3u8:
                return None
            async with session.get(m3u8, timeout=aiohttp.ClientTimeout(total=TIMEOUT), headers={"User-Agent": UA}) as r:
                body = (await r.content.read(2048)).decode(errors="replace")
                if r.status != 200 or "#EXTM3U" not in body:
                    return None
            total = int(vd.get("total") or data.get("total") or 0)
            return {"name": site["name"], "api": api, "latency": latency, "total": total,
                    "updated": max((v.get("vod_time", "") for v in vlist), default=""),
                    "adult": adult, "ok": True}
        except Exception:
            return None


async def probe_classes(session, site):
    """拉分类并统计每个分类的片量，空分类剔除（大类若子分类有片则保留）"""
    try:
        async with session.get(site["api"] + "/?ac=list", timeout=aiohttp.ClientTimeout(total=TIMEOUT), headers={"User-Agent": UA}) as r:
            d = json.loads(await r.text(errors="replace"))
        cls = [{"id": str(x.get("type_id")), "pid": str(x.get("type_pid", 0) or 0), "name": x.get("type_name") or ""}
               for x in d.get("class") or []]
    except Exception:
        return
    sem = asyncio.Semaphore(3)
    async def cnt(c):
        async with sem:
            for _ in range(3):
                try:
                    async with session.get(f'{site["api"]}/?ac=list&t={c["id"]}&pg=1', timeout=aiohttp.ClientTimeout(total=TIMEOUT), headers={"User-Agent": UA}) as r:
                        j = json.loads(await r.text(errors="replace"))
                    return int(j.get("total") or len(j.get("list") or []))
                except Exception:
                    await asyncio.sleep(1)
            return -1
    ns = await asyncio.gather(*[cnt(c) for c in cls])
    for c, n in zip(cls, ns):
        c["n"] = n
    if not ALLOW_ADULT:
        cls = [c for c in cls if not any(w.lower() in c["name"].lower() for w in ADULT_WORDS)]
    has_kid = lambda c: any(k["pid"] == c["id"] and k["n"] != 0 for k in cls)
    site["classes"] = [c for c in cls if c["n"] > 0 or (c["n"] != 0 and c["pid"] != "0") or has_kid(c)]


async def run_once():
    started = time.time()
    conn = aiohttp.TCPConnector(ssl=False, limit=40)
    async with aiohttp.ClientSession(connector=conn) as session:
        cands, up_stats = await gather_candidates(session)
        sem = asyncio.Semaphore(20)
        results = await asyncio.gather(*[check_site(session, s, sem) for s in cands])
        # 失败的再试一次（采集站偶发慢/抖动）
        retry = [s for s, r in zip(cands, results) if not r]
        sem2 = asyncio.Semaphore(10)
        results2 = await asyncio.gather(*[check_site(session, s, sem2) for s in retry])
    final = {}
    for s_, r in zip(cands, results):
        final[s_["api"]] = r
    for s_, r in zip(retry, results2):
        final[s_["api"]] = r
    valid = [r for r in final.values() if isinstance(r, dict)]
    bad = [dead(s_) for s_ in cands if final.get(s_["api"]) is None]
    # 同名去重：保留更快的
    valid.sort(key=lambda x: x["latency"])
    used, hosts, uniq = set(), set(), []
    for r in valid + bad:
        host = (urlparse(r["api"]).hostname or "").removeprefix("www.")
        fp = (r["total"], r["updated"])
        if host in hosts or (r["total"] and fp in hosts):
            continue  # 同一域名或同一后端(片量+更新时间相同)只留最快的
        hosts.add(host); hosts.add(fp)
        if r["name"] in used:
            r["name"] = f'{r["name"]}·{host.split(".")[0]}'
        used.add(r["name"])
        uniq.append(r)
    valid = [r for r in uniq if r["ok"]]
    bad = [r for r in uniq if not r["ok"]]
    conn2 = aiohttp.TCPConnector(ssl=False, limit=30)
    async with aiohttp.ClientSession(connector=conn2) as session:
        sem3 = asyncio.Semaphore(6)
        async def pc(site):
            async with sem3:
                await probe_classes(session, site)
        await asyncio.gather(*[pc(v) for v in valid])
    log("分类统计完成")
    os.makedirs(DATA, exist_ok=True)
    tmp = os.path.join(DATA, "sites.json.tmp")
    json.dump(valid + bad, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    os.replace(tmp, os.path.join(DATA, "sites.json"))
    status = {"last_run": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
              "candidates": len(cands), "valid": len(valid), "dead": len(bad),
              "interfaces": len(up_stats),
              "seconds": round(time.time() - started, 1), "upstreams": up_stats}
    json.dump(status, open(os.path.join(DATA, "status.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    log(f"完成：候选 {len(cands)}，能通 {len(valid)}，不通 {len(bad)}，用时 {status['seconds']}s")


def seconds_until(hhmm):
    now = datetime.datetime.now()
    h, m = map(int, hhmm.split(":"))
    t = now.replace(hour=h, minute=m, second=0, microsecond=0)
    if t <= now:
        t += datetime.timedelta(days=1)
    return (t - now).total_seconds()


async def main():
    trigger = os.path.join(DATA, "trigger")
    sj = os.path.join(DATA, "sites.json")
    cfg = os.path.join(DATA, "settings.json")
    fresh = os.path.exists(sj) and time.time() - os.path.getmtime(sj) < 20 * 3600
    if fresh and os.path.exists(cfg) and os.path.getmtime(cfg) > os.path.getmtime(sj):
        fresh = False
    if fresh and not os.path.exists(trigger):
        log("已有近期检测结果，跳过启动时检测")
    else:
        await run_once()
    while True:
        wait = seconds_until(RUN_AT)
        log(f"下次自动检测：{RUN_AT}（{int(wait/3600)} 小时后）")
        while wait > 0:
            if os.path.exists(trigger):
                break
            await asyncio.sleep(min(15, wait)); wait -= 15
        if os.path.exists(trigger):
            try: os.remove(trigger)
            except Exception: pass
            log("收到手动刷新")
        try:
            await run_once()
        except Exception as e:
            log("运行出错", e)


if __name__ == "__main__":
    asyncio.run(main())
