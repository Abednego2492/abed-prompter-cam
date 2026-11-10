// Abed Prompter Cam: endpoint ide harian + feedback.
// GET  /api/ideas            -> {generated_at, rows:[...], feedback:{id:{...}}}  (publik, read-only)
// POST /api/ideas            -> simpan ideas.json baru            (header x-token)
// GET  /api/feedback         -> semua feedback                     (header x-token); ?pending=1 cuma yang belum ditangani
// POST /api/feedback         -> {id, status, reason?, note?, handled?} (header x-token)
// Token gak disimpan di mana pun: cuma SHA-256-nya di bawah ini.
import { getStore } from "@netlify/blobs";

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
      const rows = Array.isArray(ideas.rows) ? ideas.rows : [];
      const byId = new Map(rows.map((r) => [r.id, r]));
      const listed = (q.order || []).filter((id) => byId.has(id));
      const rest = rows.filter((r) => !listed.includes(r.id)).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || String(a.id).localeCompare(String(b.id))).map((r) => r.id);
      const items = [], done = [];
      for (const id of [...listed, ...rest]) {
        const r = byId.get(id), st = (fb[id] && fb[id].status) || "baru";
        const base = { id, title: r.title || id, hook: r.hook || "", keyword: r.keyword || "", durasi: r.durasi || "", date: r.date || "" };
        if (st === "direkam") { done.push({ ...base, takes: fb[id].takes || 1, at: fb[id].at }); continue; }
        if (st === "tolak") continue;
        const txt = (r.script || []).map((b) => b && b.l ? b.l : "").join(" ");
        items.push({ ...base, pos: items.length + 1, needs_fill: /\[[A-Z0-9 ,.'-]{4,}\]/.test(txt), note: (q.notes && q.notes[id]) || "", link: "https://temu-prompter-cam.netlify.app/#ide=" + encodeURIComponent(id) });
      }
      return json({ updated_at: q.updated_at || ideas.generated_at || null, items, done: done.slice(0, 10) });
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

export const config = { path: ["/api/ideas", "/api/feedback", "/api/queue"] };
