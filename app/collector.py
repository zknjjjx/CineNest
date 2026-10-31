"""CMS 采集接口搜集 + 每日验活
- 从种子列表和上游页面(GitHub gist / 博客 / 配置编辑器)中提取 api.php/provide/vod 接口
- 用本机网络(家里宽带)逐个验活：分类列表 + 视频列表 + m3u8 可达
- 输出 /data/sites.json（按速度排序）和 /data/status.json
- 每天 RUN_AT(默认 04:00 Asia/Shanghai) 跑一次；/data/trigger 文件出现时立即重跑
"""
import asyncio, json, os, re, time, datetime, random
from urllib.parse import urlparse
import aiohttp

DATA = os.environ.get("DATA_DIR", "/data")
RUN_AT = os.environ.get("RUN_AT", "04:00")
TIMEOUT = float(os.environ.get("CHECK_TIMEOUT", "15"))
ALLOW_ADULT = os.environ.get("ALLOW_ADULT", "0") == "1"
UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"

UPSTREAMS = [
    "https://vodtv.github.io/api/",
    "https://gist.githubusercontent.com/lunatickochiya/748774c05c68c0bdf6cd078d88f5112b/raw",
    "https://gist.githubusercontent.com/zyd16888/e186acbadc39a044b61a5361a1d5eb7c/raw",
    "https://gist.githubusercontent.com/gagadesu/de299ec941c940e9596bb5745a24bd6f/raw",
    "https://www.071058.com/index.php/archives/619/",
    "https://github.com/waifu-project/movie/issues/45",
    "https://gist.liushen.fun/LiuShen/backup-moontv-config",
]

SEEDS = {
    "https://cj.lziapi.com/api.php/provide/vod": "量子资源",
    "https://cj.ffzyapi.com/api.php/provide/vod": "非凡资源",
    "https://api.ffzyapi.com/api.php/provide/vod": "非凡资源",
    "https://api.maoyanapi.top/api.php/provide/vod": "猫眼资源",
    "https://www.hongniuzy3.com/api.php/provide/vod": "红牛资源",
    "https://bfzyapi.com/api.php/provide/vod": "暴风资源",
    "https://wolongzyw.com/api.php/provide/vod": "卧龙资源",
    "https://jszyapi.com/api.php/provide/vod": "极速资源",
    "https://api.zuidapi.com/api.php/provide/vod": "最大资源",
    "https://m3u8.apiyhzy.com/api.php/provide/vod": "樱花资源",
    "https://ikunzyapi.com/api.php/provide/vod": "iKun资源",
    "https://www.mdzyapi.com/api.php/provide/vod": "魔都资源",
    "https://caiji.maotaizy.cc/api.php/provide/vod": "茅台资源",
    "https://dbzy.tv/api.php/provide/vod": "豆瓣资源",
    "https://mozhuazy.com/api.php/provide/vod": "魔爪资源",
    "https://wwzy.tv/api.php/provide/vod": "旺旺短剧",
    "https://tyyszyapi.com/api.php/provide/vod": "天涯影视",
    "https://cj.yayazy.net/api.php/provide/vod": "丫丫资源",
    "https://api.guangsuapi.com/api.php/provide/vod": "光速资源",
    "https://360zy.com/api.php/provide/vod": "360资源",
    "https://www.hongniuzy2.com/api.php/provide/vod": "红牛资源",
    "https://sdzyapi.com/api.php/provide/vod": "闪电资源",
    "https://jyzyapi.com/api.php/provide/vod": "金鹰资源",
    "https://api.apibdzy.com/api.php/provide/vod": "百度资源",
    "http://caiji.dyttzyapi.com/api.php/provide/vod": "电影天堂",
    "https://suoniapi.com/api.php/provide/vod": "索尼资源",
    "https://api.ukuapi.com/api.php/provide/vod": "U酷资源",
}

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
    cands = {}
    for api, name in SEEDS.items():
        cands[key_of(api)] = {"api": norm(api), "name": name}
    # 保留上次有效的站点，避免上游消失后丢失
    try:
        for s in json.load(open(os.path.join(DATA, "sites.json"), encoding="utf-8")):
            cands.setdefault(key_of(s["api"]), {"api": s["api"], "name": s["name"]})
    except Exception:
        pass
    # 用户手工添加
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
    up_stats = {}
    for u in UPSTREAMS:
        try:
            text = await fetch_text(session, u, 20)
            n = 0
            for m in API_RE.finditer(text):
                api = norm(m.group(0))
                k = key_of(api)
                lb, rb = text.rfind("{", 0, m.start()), text.find("}", m.end())
                name = ""
                if lb != -1 and rb != -1 and rb - lb < 600 and "{" not in text[m.end():rb]:
                    nm = NAME_RE.findall(text[lb:rb])
                    name = nm[0].strip() if nm else ""
                if not name:
                    names = NAME_RE.findall(text[max(0, m.start() - 200):m.start()])
                    name = names[-1].strip() if names else ""
                name = re.sub(r"^[^\w\u4e00-\u9fff]+", "", name)  # 去掉 emoji/符号前缀
                if k not in cands:
                    cands[k] = {"api": api, "name": name or (urlparse(api).hostname or api)}
                    n += 1
                elif name and cands[k]["name"] == urlparse(cands[k]["api"]).hostname:
                    cands[k]["name"] = name
            up_stats[u] = n
        except Exception as e:
            up_stats[u] = f"error: {type(e).__name__}"
    log("候选接口", len(cands), up_stats)
    return list(cands.values()), up_stats


async def check_site(session, site, sem):
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
                return None
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
                    "adult": adult}
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
    valid = [r for r in list(results) + list(results2) if r]
    # 同名去重：保留更快的
    valid.sort(key=lambda x: x["latency"])
    used, hosts, uniq = set(), set(), []
    for r in valid:
        host = (urlparse(r["api"]).hostname or "").removeprefix("www.")
        fp = (r["total"], r["updated"])
        if host in hosts or (r["total"] and fp in hosts):
            continue  # 同一域名或同一后端(片量+更新时间相同)只留最快的
        hosts.add(host); hosts.add(fp)
        if r["name"] in used:
            r["name"] = f'{r["name"]}·{host.split(".")[0]}'
        used.add(r["name"])
        uniq.append(r)
    valid = uniq
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
    json.dump(valid, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    os.replace(tmp, os.path.join(DATA, "sites.json"))
    status = {"last_run": datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
              "candidates": len(cands), "valid": len(valid),
              "seconds": round(time.time() - started, 1), "upstreams": up_stats}
    json.dump(status, open(os.path.join(DATA, "status.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    log(f"完成：候选 {len(cands)}，有效 {len(valid)}，用时 {status['seconds']}s")


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
    if os.path.exists(sj) and time.time() - os.path.getmtime(sj) < 20 * 3600 and not os.path.exists(trigger):
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
