// Abed Prompter Cam: endpoint ide harian + feedback.
// GET  /api/ideas            -> {generated_at, rows:[...], feedback:{id:{...}}}  (publik, read-only)
// POST /api/ideas            -> simpan ideas.json baru            (header x-token)
// GET  /api/feedback         -> semua feedback                     (header x-token); ?pending=1 cuma yang belum ditangani
// POST /api/feedback         -> {id, status, reason?, note?, handled?} (header x-token)
// Token gak disimpan di mana pun: cuma SHA-256-nya di bawah ini.
import { getStore } from "@netlify/blobs";
import { snapshot, matchIdeas, summarizeMatch, stageOf } from "../lib/zernio.mjs";

const TOKEN_SHA256 = "14f189d73d67caf2a4e1eaa5e8d0278d2f6864203e057505882285fd6bd7e0c4";
const STATUSES = new Set(["baru", "cocok", "direkam", "tolak"]);

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function authed(req) {
  const t = req.headers.get("x-token") || "";
  if (!t || t.length > 200) return false;
  return (await sha256Hex(t)) === TOKEN_SHA256;
}

export default async (req) => {
  const url = new URL(req.url);
  const route = url.pathname.replace(/\/+$/, "").split("/").pop(); // "ideas" | "feedback"
  const store = getStore({ name: "prompter", consistency: "strong" });

  if (req.method === "OPTIONS") return new Response("", { status: 204 });

  if (route === "ideas") {
    if (req.method === "GET") {
      const ideas = (await store.get("ideas.json", { type: "json" })) || { generated_at: null, rows: [] };
      const fb = (await store.get("feedback.json", { type: "json" })) || {};
      return json({ ...ideas, feedback: fb });
    }
    if (req.method === "POST") {
      if (!(await authed(req))) return json({ error: "token salah" }, 401);
      let body;
      try { body = await req.json(); } catch { return json({ error: "body bukan JSON" }, 400); }
      if (!body || !Array.isArray(body.rows)) return json({ error: "butuh {generated_at, rows:[]}" }, 400);
      for (const r of body.rows) if (!r || typeof r.id !== "string" || !Array.isArray(r.script)) return json({ error: "baris harus punya id + script[]" }, 400);
      body.generated_at = body.generated_at || new Date().toISOString();
      body.received_at = new Date().toISOString();
      await store.setJSON("ideas.json", body);
      return json({ ok: true, rows: body.rows.length, generated_at: body.generated_at });
    }
    return json({ error: "method" }, 405);
  }

  // ---- antrian rekam (shoot queue) ----
  // GET  /api/queue        -> {updated_at, items:[{pos,id,title,hook,keyword,durasi,date,needs_fill,note,link}], done:[...]}  (publik)
  // POST /api/queue        -> {order:[id,...], notes?:{id:"..."}}  (x-token) urutan manual; ide yang gak disebut ditaruh di belakang, terbaru dulu
  if (route === "queue") {
    if (req.method === "GET") {
      const ideas = (await store.get("ideas.json", { type: "json" })) || { rows: [] };
      const fb = (await store.get("feedback.json", { type: "json" })) || {};
      const q = (await store.get("queue.json", { type: "json" })) || { order: [], notes: {} };
      const links = (await store.get("links.json", { type: "json" })) || {};
      const rows = Array.isArray(ideas.rows) ? ideas.rows : [];
      const snap = await snapshot(store, { fresh: url.searchParams.get("fresh") === "1" });
      const matched = snap.ok ? matchIdeas(rows, snap, links) : {};
      const byId = new Map(rows.map((r) => [r.id, r]));
      const listed = (q.order || []).filter((id) => byId.has(id));
      const rest = rows.filter((r) => !listed.includes(r.id)).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(a.id).localeCompare(String(b.id))).map((r) => r.id);
      const items = [], done = [];
      for (const id of [...listed, ...rest]) {
        const r = byId.get(id), st = (fb[id] && fb[id].status) || "baru";
        const z = summarizeMatch(matched[id], snap);
        const base = { id, title: r.title || id, hook: r.hook || "", keyword: r.keyword || "", durasi: r.durasi || "", date: r.date || "" };
        // udah ada di Zernio (draf/terjadwal/tayang) = pasti udah direkam -> keluar dari antrian
        if (z && z.stage && z.stage !== "gagal") { done.push({ ...base, stage: z.stage, takes: (fb[id] && fb[id].takes) || 0, at: z.published_at || z.scheduled_for || (fb[id] && fb[id].at) || "", zernio: z }); continue; }
        if (st === "direkam") { done.push({ ...base, stage: "direkam", takes: fb[id].takes || 1, at: fb[id].at, zernio: z }); continue; }
        if (st === "tolak") continue;
        const txt = (r.script || []).map((b) => b && b.l ? b.l : "").join(" ");
        items.push({ ...base, pos: items.length + 1, needs_fill: /\[[A-Z0-9 ,.'-]{4,}\]/.test(txt), note: (q.notes && q.notes[id]) || "", link: "https://temu-prompter-cam.netlify.app/#ide=" + encodeURIComponent(id), zernio: z });
      }
      const RK = { tayang: 0, terjadwal: 1, draf: 2, direkam: 3 };
      done.sort((a, b) => (RK[a.stage] ?? 9) - (RK[b.stage] ?? 9) || String(b.at || "").localeCompare(String(a.at || "")));
      return json({
        updated_at: q.updated_at || ideas.generated_at || null,
        zernio: { ok: !!snap.ok, at: snap.at || null, cached: !!snap.cached, error: snap.error || null },
        counts: { antri: items.length, direkam: done.filter((d) => d.stage === "direkam").length, terjadwal: done.filter((d) => d.stage === "terjadwal").length, tayang: done.filter((d) => d.stage === "tayang").length },
        items, done: done.slice(0, 20),
      });
    }
    if (req.method === "POST") {
      if (!(await authed(req))) return json({ error: "token salah" }, 401);
      let b;
      try { b = await req.json(); } catch { return json({ error: "body bukan JSON" }, 400); }
      if (!b || !Array.isArray(b.order) || b.order.some((x) => typeof x !== "string" || x.length > 64)) return json({ error: "butuh {order:[id,...]}" }, 400);
      const notes = {};
      if (b.notes && typeof b.notes === "object") for (const [k, v] of Object.entries(b.notes)) if (b.order.includes(k)) notes[k] = String(v).slice(0, 120);
      const q = { order: b.order.slice(0, 50), notes, updated_at: new Date().toISOString() };
      await store.setJSON("queue.json", q);
      return json({ ok: true, ...q });
    }
    return json({ error: "method" }, 405);
  }

  // ---- konten tayang (dari Zernio) ----
  // GET /api/posted[?days=7&limit=20&fresh=1] -> {zernio, totals, posts:[...], next:[...]}  (publik; cuma post yang udah tayang + judul jadwal berikutnya)
  if (route === "posted") {
    if (req.method !== "GET") return json({ error: "method" }, 405);
    const snap = await snapshot(store, { fresh: url.searchParams.get("fresh") === "1" });
    const days = Math.max(1, Math.min(45, Number(url.searchParams.get("days")) || 7));
    const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit")) || 20));
    const ideas = (await store.get("ideas.json", { type: "json" })) || { rows: [] };
    const links = (await store.get("links.json", { type: "json" })) || {};
    const rows = Array.isArray(ideas.rows) ? ideas.rows : [];
    const matched = snap.ok ? matchIdeas(rows, snap, links) : {};
    const ideaByZid = new Map(Object.entries(matched).map(([id, m]) => [m.post.zid, byIdea(rows, id)]));
    const zTitle = new Map((snap.posts || []).map((p) => [p.zid, p.title || p.content.split("\n")[0]]));
    const since = Date.now() - days * 864e5;
    const all = (snap.analytics || []).filter((a) => a.published_at).sort((a, b) => b.published_at.localeCompare(a.published_at));
    const inWin = all.filter((a) => Date.parse(a.published_at) >= since);
    const sum = (arr, k) => arr.reduce((t, r) => t + (Number(r[k]) || 0), 0);
    const posts = all.slice(0, limit).map((a) => {
      const idea = a.zid ? ideaByZid.get(a.zid) : null;
      return {
        platform: a.platform, account: a.account, url: a.url, published_at: a.published_at, media: a.media, thumb: a.thumb,
        title: (idea && idea.title) || zTitle.get(a.zid) || a.content.split("\n")[0].slice(0, 120),
        keyword: idea ? idea.keyword : "", idea_id: idea ? idea.id : "",
        views: a.views, reach: a.reach, likes: a.likes, comments: a.comments, shares: a.shares, saves: a.saves, sync: a.sync,
      };
    });
    // post yang statusnya published di Zernio tapi analytics belum masuk (baru tayang)
    const haveZ = new Set(all.map((a) => a.zid).filter(Boolean));
    const fresh = (snap.posts || []).filter((p) => stageOf(p.status) === "tayang" && !haveZ.has(p.zid)).flatMap((p) => p.platforms.filter((x) => x.status === "published" || x.published_at).map((x) => {
      const idea = ideaByZid.get(p.zid);
      return { platform: x.platform, account: "", url: x.url, published_at: x.published_at || p.scheduled_for, media: "", thumb: "", title: (idea && idea.title) || p.title || p.content.split("\n")[0].slice(0, 120), keyword: idea ? idea.keyword : "", idea_id: idea ? idea.id : "", views: null, reach: null, likes: null, comments: null, shares: null, saves: null, sync: "pending" };
    }));
    const merged = [...fresh, ...posts].sort((a, b) => String(b.published_at).localeCompare(String(a.published_at))).slice(0, limit);
    const next = (snap.posts || []).filter((p) => stageOf(p.status) === "terjadwal").sort((a, b) => String(a.scheduled_for).localeCompare(String(b.scheduled_for))).slice(0, 5).map((p) => {
      const idea = ideaByZid.get(p.zid);
      return { title: (idea && idea.title) || p.title || p.content.split("\n")[0].slice(0, 120), keyword: idea ? idea.keyword : "", idea_id: idea ? idea.id : "", scheduled_for: p.scheduled_for, platforms: p.platforms.map((x) => x.platform) };
    });
    const failed = (snap.posts || []).filter((p) => p.status === "failed" && Date.parse(p.updated_at || p.scheduled_for || 0) >= Date.now() - 3 * 864e5).length;
    return json({
      zernio: { ok: !!snap.ok, at: snap.at || null, cached: !!snap.cached, error: snap.error || null },
      totals: { days, posts: inWin.length + fresh.filter((f) => Date.parse(f.published_at) >= since).length, views: sum(inWin, "views"), likes: sum(inWin, "likes"), comments: sum(inWin, "comments"), shares: sum(inWin, "shares"), saves: sum(inWin, "saves"), scheduled: (snap.posts || []).filter((p) => stageOf(p.status) === "terjadwal").length, failed_3d: failed },
      posts: merged, next,
    });
  }

  // POST /api/link {id, postId|null|"none"} (x-token): paksa/lepas pasangan ide <-> post Zernio
  if (route === "link") {
    if (!(await authed(req))) return json({ error: "token salah" }, 401);
    const links = (await store.get("links.json", { type: "json" })) || {};
    if (req.method === "GET") return json(links);
    if (req.method !== "POST") return json({ error: "method" }, 405);
    let b; try { b = await req.json(); } catch { return json({ error: "body bukan JSON" }, 400); }
    if (!b || typeof b.id !== "string" || !/^[\w.-]{1,64}$/.test(b.id)) return json({ error: "id" }, 400);
    if (b.postId === null || b.postId === undefined || b.postId === "") delete links[b.id];
    else if (typeof b.postId === "string" && b.postId.length <= 64) links[b.id] = b.postId;
    else return json({ error: "postId" }, 400);
    await store.setJSON("links.json", links);
    return json({ ok: true, links });
  }

  // POST /api/zernio-key {key} (x-token): simpan key Zernio di Blobs (kalau gak pakai env var). GET = cek status, key gak ditampilkan.
  if (route === "zernio-key") {
    if (!(await authed(req))) return json({ error: "token salah" }, 401);
    if (req.method === "GET") {
      const s = (await store.get("secrets.json", { type: "json" })) || {};
      return json({ env: !!process.env.ZERNIO_API_KEY, blob: !!s.zernio_key, set_at: s.set_at || null });
    }
    if (req.method !== "POST") return json({ error: "method" }, 405);
    let b; try { b = await req.json(); } catch { return json({ error: "body bukan JSON" }, 400); }
    const k = b && typeof b.key === "string" ? b.key.trim() : "";
    if (k && (k.length < 10 || k.length > 300)) return json({ error: "key gak valid" }, 400);
    await store.setJSON("secrets.json", k ? { zernio_key: k, set_at: new Date().toISOString() } : {});
    await store.delete("zernio-cache.json");
    const snap = k ? await snapshot(store, { fresh: true }) : { ok: false };
    return json({ ok: true, saved: !!k, test: { ok: !!snap.ok, posts: (snap.posts || []).length, analytics: (snap.analytics || []).length, error: snap.error || null } });
  }

  if (route === "feedback") {
    if (!(await authed(req))) return json({ error: "token salah" }, 401);
    const fb = (await store.get("feedback.json", { type: "json" })) || {};
    if (req.method === "GET") {
      if (url.searchParams.get("pending") === "1") {
        const out = {};
        for (const [id, v] of Object.entries(fb)) if (v.status === "tolak" && !v.handled) out[id] = v;
        return json(out);
      }
      return json(fb);
    }
    if (req.method === "POST") {
      let b;
      try { b = await req.json(); } catch { return json({ error: "body bukan JSON" }, 400); }
      if (!b || typeof b.id !== "string" || !/^[\w.-]{1,64}$/.test(b.id)) return json({ error: "id" }, 400);
      const cur = fb[b.id] || {};
      const next = { ...cur };
      if (b.status !== undefined) { if (!STATUSES.has(b.status)) return json({ error: "status" }, 400); next.status = b.status; }
      if (b.reason !== undefined) next.reason = String(b.reason).slice(0, 80);
      if (b.note !== undefined) next.note = String(b.note).slice(0, 500);
      if (b.handled !== undefined) next.handled = !!b.handled;
      if (b.takes !== undefined) next.takes = Math.max(0, Math.min(99, Number(b.takes) || 0));
      next.at = new Date().toISOString();
      fb[b.id] = next;
      // simpan maksimal 60 entri terbaru
      const keys = Object.keys(fb).sort((a, c) => (fb[c].at || "").localeCompare(fb[a].at || ""));
      const trimmed = {}; for (const k of keys.slice(0, 60)) trimmed[k] = fb[k];
      await store.setJSON("feedback.json", trimmed);
      return json({ ok: true, id: b.id, feedback: next });
    }
    return json({ error: "method" }, 405);
  }
  return json({ error: "not found" }, 404);
};

function byIdea(rows, id) { return rows.find((r) => r.id === id) || null; }

export const config = { path: ["/api/ideas", "/api/feedback", "/api/queue", "/api/posted", "/api/link", "/api/zernio-key"] };
