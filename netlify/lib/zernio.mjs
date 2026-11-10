// Sinkron Zernio -> app kamera.
// Baca post (terjadwal/tayang/gagal) + analytics + comment automation dari Zernio,
// cache 5 menit di Netlify Blobs, lalu cocokkan ke ide (id / tag / keyword komen / judul).
// Key Zernio: env ZERNIO_API_KEY (Netlify > Site config > Environment variables)
// atau blob secrets.json (diset lewat POST /api/zernio-key, header x-token). Key gak pernah dikirim balik.

const BASE = "https://zernio.com/api/v1";
const TTL_MS = 5 * 60 * 1000;
const MIN_FRESH_MS = 60 * 1000;

export async function getKey(store) {
  if (process.env.ZERNIO_API_KEY) return process.env.ZERNIO_API_KEY.trim();
  const s = (await store.get("secrets.json", { type: "json" })) || {};
  return s.zernio_key || "";
}

async function zget(key, path, params = {}) {
  const u = new URL(BASE + path);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 8000);
  try {
    const r = await fetch(u, { headers: { authorization: "Bearer " + key, accept: "application/json" }, signal: ctl.signal });
    if (!r.ok) throw new Error(path + " HTTP " + r.status);
    return await r.json();
  } finally { clearTimeout(t); }
}

const ymd = (d) => d.toISOString().slice(0, 10);

function normPost(p) {
  const plats = (p.platforms || []).map((x) => ({
    platform: x.platform || "",
    status: x.status || "",
    url: x.platformPostUrl || "",
    published_at: x.publishedAt || "",
    platform_post_id: x.platformPostId || "",
  }));
  return {
    zid: p._id,
    title: p.title || "",
    content: String(p.content || "").slice(0, 600),
    status: p.status || "",
    scheduled_for: p.scheduledFor || "",
    created_at: p.createdAt || "",
    updated_at: p.updatedAt || "",
    tags: Array.isArray(p.tags) ? p.tags : [],
    platforms: plats,
  };
}

function normAnalytics(a) {
  // satu baris per platform
  const out = [];
  const base = {
    zid: a.latePostId || "",
    aid: a._id || "",
    content: String(a.content || "").slice(0, 300),
    published_at: a.publishedAt || "",
    thumb: a.thumbnailUrl || (a.mediaItems && a.mediaItems[0] && (a.mediaItems[0].thumbnail || a.mediaItems[0].url)) || "",
    media: a.mediaProductType || a.mediaType || "",
    external: !!a.isExternal,
  };
  const plats = Array.isArray(a.platforms) && a.platforms.length ? a.platforms : [{ platform: a.platform, platformPostUrl: a.platformPostUrl, analytics: a.analytics, status: a.status }];
  for (const p of plats) {
    if (p.status && p.status !== "published") continue;
    const m = p.analytics || a.analytics || {};
    out.push({
      ...base,
      platform: p.platform || a.platform || "",
      account: p.accountUsername || "",
      url: p.platformPostUrl || a.platformPostUrl || "",
      views: m.views ?? null, reach: m.reach ?? null, impressions: m.impressions ?? null,
      likes: m.likes ?? null, comments: m.comments ?? null, shares: m.shares ?? null, saves: m.saves ?? null,
      sync: p.syncStatus || "",
    });
  }
  return out;
}

async function pull(key) {
  const from = ymd(new Date(Date.now() - 45 * 864e5));
  const errors = [];
  const posts = [];
  for (const status of ["scheduled", "published", "publishing", "failed", "draft", "partial"]) {
    try {
      const j = await zget(key, "/posts", { status, limit: 50, page: 1, sortBy: "scheduled-desc", dateFrom: status === "scheduled" || status === "draft" ? "" : from });
      for (const p of j.posts || []) posts.push(normPost(p));
    } catch (e) { errors.push(String(e.message || e)); }
  }
  let analytics = [];
  try {
    for (let page = 1; page <= 2; page++) {
      const j = await zget(key, "/analytics", { fromDate: from, limit: 50, page, sortBy: "date", order: "desc" });
      for (const a of j.posts || []) analytics.push(...normAnalytics(a));
      const pg = j.pagination || {};
      if (!pg.pages || page >= pg.pages) break;
    }
  } catch (e) { errors.push(String(e.message || e)); }
  let automations = [];
  try {
    const j = await zget(key, "/comment-automations");
    automations = (j.automations || []).map((x) => ({ zid: x.postId || "", ppid: x.platformPostId || "", title: x.postTitle || "", keywords: x.keywords || [], active: x.isActive !== false }));
  } catch (e) { errors.push(String(e.message || e)); }
  // dedupe post
  const seen = new Map();
  for (const p of posts) if (p.zid && !seen.has(p.zid)) seen.set(p.zid, p);
  return { at: new Date().toISOString(), posts: [...seen.values()], analytics, automations, errors };
}

// Ambil snapshot Zernio (cache 5 menit). fresh=true paksa tarik ulang (maks 1x/menit).
export async function snapshot(store, { fresh = false } = {}) {
  const key = await getKey(store);
  if (!key) return { ok: false, error: "key Zernio belum di-set", posts: [], analytics: [], automations: [] };
  const cache = await store.get("zernio-cache.json", { type: "json" });
  const age = cache && cache.at ? Date.now() - Date.parse(cache.at) : Infinity;
  if (cache && (age < TTL_MS && !(fresh && age > MIN_FRESH_MS))) return { ok: true, cached: true, ...cache };
  try {
    const snap = await pull(key);
    if (!snap.posts.length && !snap.analytics.length && snap.errors.length && cache) {
      return { ok: true, cached: true, stale: true, error: snap.errors[0], ...cache };
    }
    await store.setJSON("zernio-cache.json", snap);
    return { ok: true, cached: false, ...snap, error: snap.errors[0] || null };
  } catch (e) {
    if (cache) return { ok: true, cached: true, stale: true, error: String(e.message || e), ...cache };
    return { ok: false, error: String(e.message || e), posts: [], analytics: [], automations: [] };
  }
}

// ---------- pencocokan ide <-> post ----------
const STOP = new Set("yang dan di ke dari ini itu gue lo gw aja juga buat untuk dengan bisa udah ada tapi cuma pake pakai sama atau jadi lebih the a of to".split(" "));
const toks = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}. ]+/gu, " ").split(/\s+/).filter((w) => w.length > 1 && !STOP.has(w));
function sim(a, b) {
  const A = new Set(toks(a)), B = new Set(toks(b));
  if (!A.size || !B.size) return 0;
  if (A.size < 3) return 0;
  let n = 0; for (const w of A) if (B.has(w)) n++;
  return n / A.size; // porsi kata judul ide yang muncul di post
}
const kwList = (k) => String(k || "").split(/[\/,|]+/).map((s) => s.trim()).filter((s) => s.length >= 2);
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function stageOf(status) {
  if (status === "published" || status === "partial") return "tayang";
  if (status === "scheduled" || status === "publishing" || status === "pending_approval") return "terjadwal";
  if (status === "draft") return "draf";
  if (status === "failed") return "gagal";
  return "";
}
const RANK = { tayang: 4, terjadwal: 3, draf: 2, gagal: 1, "": 0 };

// links: {ideaId: zid|"none"} override manual
export function matchIdeas(rows, snap, links = {}) {
  const posts = (snap.posts || []).filter((p) => p.status !== "cancelled");
  const byZid = new Map(posts.map((p) => [p.zid, p]));
  const autoKw = new Map(); // zid -> [keywords]
  for (const a of snap.automations || []) if (a.zid) autoKw.set(a.zid, [...(autoKw.get(a.zid) || []), ...a.keywords.map((k) => String(k).toLowerCase())]);
  const used = new Set();
  const out = {};
  // ide terbaru dulu supaya keyword berulang nempel ke ide yang paling baru
  const order = rows.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  for (const r of order) {
    const link = links[r.id];
    if (link === "none") continue;
    if (link && byZid.has(link)) { out[r.id] = { post: byZid.get(link), how: "manual" }; used.add(link); continue; }
    const ideaDay = Date.parse((r.date || "2000-01-01") + "T00:00:00+07:00") - 864e5;
    let best = null;
    for (const p of posts) {
      if (used.has(p.zid)) continue;
      const when = Date.parse(p.scheduled_for || p.created_at || "") || 0;
      if (when && when < ideaDay) continue;
      let score = 0, how = "";
      if (p.tags.some((t) => t === r.id || t === "ide:" + r.id)) { score = 100; how = "tag"; }
      const kws = kwList(r.keyword);
      const ak = autoKw.get(p.zid) || [];
      if (!score && kws.some((k) => ak.includes(k.toLowerCase()))) { score = 90; how = "automation"; }
      if (!score && kws.length) {
        const txt = p.title + "\n" + p.content;
        if (kws.some((k) => new RegExp("(komen|comment|ketik|tulis|reply)\\s*[\"“'«]?\\s*" + esc(k) + "(?![\\p{L}\\p{N}])", "iu").test(txt))) { score = 80; how = "keyword"; }
      }
      if (!score) {
        const head = p.title + " " + p.content.split("\n").slice(0, 3).join(" ");
        const s = Math.max(sim(r.title, head), sim(r.hook, head));
        if (s >= 0.7) { score = Math.round(50 + s * 20); how = "judul"; }
      }
      if (score && (!best || score > best.score || (score === best.score && RANK[stageOf(p.status)] > RANK[stageOf(best.post.status)]))) best = { post: p, how, score };
    }
    if (best) { out[r.id] = { post: best.post, how: best.how }; used.add(best.post.zid); }
  }
  return out;
}

export function metricsFor(snap, zid) {
  const rows = (snap.analytics || []).filter((a) => a.zid && a.zid === zid);
  if (!rows.length) return null;
  const sum = (k) => rows.reduce((t, r) => t + (Number(r[k]) || 0), 0);
  return { views: sum("views"), likes: sum("likes"), comments: sum("comments"), shares: sum("shares"), saves: sum("saves") };
}

export function summarizeMatch(m, snap) {
  if (!m) return null;
  const p = m.post;
  const pub = p.platforms.filter((x) => x.published_at).map((x) => x.published_at).sort()[0] || "";
  return {
    stage: stageOf(p.status),
    zernio_status: p.status,
    zernio_id: p.zid,
    match: m.how,
    scheduled_for: p.scheduled_for || "",
    published_at: pub,
    platforms: p.platforms.map((x) => x.platform),
    post_url: (p.platforms.find((x) => x.url) || {}).url || "",
    metrics: metricsFor(snap, p.zid),
  };
}
