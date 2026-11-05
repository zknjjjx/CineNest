"""TVBox 接口生成与 GitHub 推送
- 设置保存在 /data/tvbox.json（含 token，仅存本机数据卷，接口返回时打码）
- build_config(): 用 /data/sites.json 里验活通过的 CMS 站生成 TVBox 配置（type=1）
- push(): 通过 GitHub Contents API 写入 仓库/分支/路径；内容没变就不推
- collector 每次验活完成后调用 auto_push()
"""
import base64, datetime, hashlib, hmac, json, os, secrets, time
import aiohttp

DATA = os.environ.get("DATA_DIR", "/data")
CFG = os.path.join(DATA, "tvbox.json")
GH = "https://api.github.com"

DEFAULTS = {
    "repo": "", "branch": "main", "path": "tvbox.json", "token": "",
    "auto_push": True, "include_adult": False, "create_repo": True,
    "title": "影巢", "commit_msg": "更新 TVBox 接口",
    "pw_hash": "", "pw_salt": "", "secret": "",
    "last": {},
}


def load():
    d = dict(DEFAULTS)
    try:
        d.update(json.load(open(CFG, encoding="utf-8")))
    except Exception:
        pass
    return d


def save(d):
    os.makedirs(DATA, exist_ok=True)
    tmp = CFG + ".tmp"
    json.dump(d, open(tmp, "w", encoding="utf-8"), ensure_ascii=False, indent=1)
    os.chmod(tmp, 0o600)
    os.replace(tmp, CFG)


def public_view(d):
    v = {k: d.get(k) for k in ("repo", "branch", "path", "auto_push", "include_adult",
                                "create_repo", "title", "commit_msg", "last")}
    t = d.get("token") or ""
    v["token_set"] = bool(t)
    v["token_hint"] = (t[:4] + "…" + t[-4:]) if len(t) > 12 else ("已设置" if t else "")
    v["has_password"] = bool(d.get("pw_hash"))
    v.update(urls(d))
    return v


def urls(d):
    repo, br, p = d.get("repo"), d.get("branch") or "main", (d.get("path") or "tvbox.json").lstrip("/")
    if not repo:
        return {"raw_url": "", "cdn_url": "", "mirror_url": ""}
    raw = f"https://raw.githubusercontent.com/{repo}/{br}/{p}"
    return {"raw_url": raw,
            "cdn_url": f"https://cdn.jsdelivr.net/gh/{repo}@{br}/{p}",
            "mirror_url": f"https://ghfast.top/{raw}"}


# ---------- 密码 ----------
def _hash(pw, salt):
    return hashlib.pbkdf2_hmac("sha256", pw.encode(), bytes.fromhex(salt), 120000).hex()


def set_password(d, pw):
    d["pw_salt"] = secrets.token_hex(16)
    d["pw_hash"] = _hash(pw, d["pw_salt"])
    d["secret"] = secrets.token_hex(32)  # 改密码让旧会话失效


def check_password(d, pw):
    if not d.get("pw_hash"):
        return False
    return hmac.compare_digest(_hash(pw, d["pw_salt"]), d["pw_hash"])


def make_session(d):
    exp = str(int(time.time()) + 30 * 86400)
    sig = hmac.new(bytes.fromhex(d["secret"]), exp.encode(), "sha256").hexdigest()
    return f"{exp}.{sig}"


def check_session(d, tok):
    try:
        exp, sig = (tok or "").split(".", 1)
        if int(exp) < time.time() or not d.get("secret"):
            return False
        good = hmac.new(bytes.fromhex(d["secret"]), exp.encode(), "sha256").hexdigest()
        return hmac.compare_digest(sig, good)
    except Exception:
        return False


# ---------- 生成 ----------
def read_sites():
    try:
        return json.load(open(os.path.join(DATA, "sites.json"), encoding="utf-8"))
    except Exception:
        return []


def build_config(d=None, sites=None):
    d = d or load()
    sites = read_sites() if sites is None else sites
    out = []
    for i, s in enumerate(sites):
        if s.get("adult") and not d.get("include_adult"):
            continue
        api = s["api"].rstrip("/") + "/"
        out.append({"key": "cn_" + hashlib.md5(s["api"].encode()).hexdigest()[:8],
                    "name": f"{s['name']}", "type": 1, "api": api,
                    "searchable": 1, "quickSearch": 1, "filterable": 1, "changeable": 1})
    return {"sites": out, "parses": [], "lives": [], "flags": [],
            "wallpaper": "", "notice": f"{d.get('title') or '影巢'} · {len(out)} 个可用源"}


def render(cfg):
    return json.dumps(cfg, ensure_ascii=False, indent=1)


def _fingerprint(cfg):
    return hashlib.sha1(json.dumps(cfg["sites"], ensure_ascii=False, sort_keys=True).encode()).hexdigest()


# ---------- 推送 ----------
async def _gh(session, method, url, token, body=None):
    h = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
         "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "CineNest"}
    async with session.request(method, url, headers=h, json=body,
                               timeout=aiohttp.ClientTimeout(total=30)) as r:
        try:
            j = await r.json(content_type=None)
        except Exception:
            j = {}
        return r.status, j


async def push(force=False, session=None):
    d = load()
    now = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

    def done(ok, msg, **kw):
        d2 = load()
        d2["last"] = {"time": now, "ok": ok, "msg": msg, **kw}
        save(d2)
        return d2["last"]

    if not d.get("repo") or not d.get("token"):
        return done(False, "未填写仓库或 token")
    cfg = build_config(d)
    if not cfg["sites"]:
        return done(False, "没有可用源，跳过推送")
    fp = _fingerprint(cfg)
    if not force and d.get("last", {}).get("ok") and d["last"].get("fp") == fp:
        return done(True, "源列表没变化，无需推送", fp=fp, count=len(cfg["sites"]))
    repo, br = d["repo"].strip(), d.get("branch") or "main"
    path = (d.get("path") or "tvbox.json").lstrip("/")
    own = session is None
    session = session or aiohttp.ClientSession()
    try:
        url = f"{GH}/repos/{repo}/contents/{path}"
        st, j = await _gh(session, "GET", f"{url}?ref={br}", d["token"])
        sha = j.get("sha") if st == 200 else None
        if st == 404:
            rs, rj = await _gh(session, "GET", f"{GH}/repos/{repo}", d["token"])
            if rs == 404 and d.get("create_repo"):
                owner, name = repo.split("/", 1)
                us, uj = await _gh(session, "GET", f"{GH}/user", d["token"])
                target = f"{GH}/user/repos" if uj.get("login", "").lower() == owner.lower() else f"{GH}/orgs/{owner}/repos"
                cs, cj = await _gh(session, "POST", target, d["token"],
                                   {"name": name, "private": False, "auto_init": True,
                                    "description": "TVBox 接口（CineNest 自动生成）"})
                if cs not in (200, 201):
                    return done(False, f"创建仓库失败 {cs}：{cj.get('message','')}")
                br = cj.get("default_branch") or br
            elif rs != 200:
                return done(False, f"仓库不可访问 {rs}：{rj.get('message','')}")
        elif st not in (200,):
            return done(False, f"读取失败 {st}：{j.get('message','')}")
        body = {"message": f"{d.get('commit_msg') or '更新 TVBox 接口'} {now}（{len(cfg['sites'])} 源）",
                "content": base64.b64encode(render(cfg).encode()).decode(), "branch": br}
        if sha:
            body["sha"] = sha
        ps, pj = await _gh(session, "PUT", url, d["token"], body)
        if ps in (200, 201):
            return done(True, f"已推送 {len(cfg['sites'])} 个源", fp=fp, count=len(cfg["sites"]),
                        commit=(pj.get("commit") or {}).get("sha", "")[:7])
        return done(False, f"推送失败 {ps}：{pj.get('message','')}")
    except Exception as e:
        return done(False, f"推送出错：{e}")
    finally:
        if own:
            await session.close()


async def auto_push():
    d = load()
    if d.get("auto_push") and d.get("repo") and d.get("token"):
        return await push()
    return None
