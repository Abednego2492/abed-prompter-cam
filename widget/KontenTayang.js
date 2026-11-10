// Variables used by Scriptable.
// icon-color: deep-gray; icon-glyph: chart-line;
// =====================================================================
// KONTEN TAYANG · Temu Prompter Cam x Zernio
// Widget iOS (Scriptable): konten yang udah tayang (IG + Threads) + views,
// likes, komen, dan post terjadwal berikutnya. Data langsung dari Zernio
// lewat https://temu-prompter-cam.netlify.app/api/posted (publik, read-only).
// Key Zernio gak disimpan di HP, cuma di server.
// Ukuran: kecil = total + post terakhir, sedang = total + 2 post,
//         besar = total + 5 post + jadwal berikutnya.
// Parameter widget (opsional): jumlah hari, mis. "3" atau "30". Default 7.
// =====================================================================

const BASE = "https://temu-prompter-cam.netlify.app";
const LIME = new Color("#C6FF00");
const INK = new Color("#05070B");
const CARD = new Color("#0C0F15");
const MUT = new Color("#8A93A3");
const RED = new Color("#FF6B60");
const WHITE = Color.white();
const PLAT = { instagram: ["IG", new Color("#E1306C")], threads: ["TH", new Color("#DADDE3")], tiktok: ["TT", new Color("#25F4EE")], youtube: ["YT", new Color("#FF3D3D")] };
const fm = FileManager.local();
const DAYS = Math.max(1, Math.min(45, parseInt(args.widgetParameter || "7", 10) || 7));
const CACHE = fm.joinPath(fm.documentsDirectory(), "konten-tayang-" + DAYS + ".json");

async function load() {
  try {
    const r = new Request(BASE + "/api/posted?days=" + DAYS + "&limit=12&t=" + Date.now());
    r.timeoutInterval = 15;
    const j = await r.loadJSON();
    if (!j || !Array.isArray(j.posts)) throw new Error("format");
    j._fetched = Date.now();
    fm.writeString(CACHE, JSON.stringify(j));
    return { data: j, stale: false };
  } catch (e) {
    if (fm.fileExists(CACHE)) { try { return { data: JSON.parse(fm.readString(CACHE)), stale: true }; } catch (_) {} }
    return { data: null, stale: true, err: String(e) };
  }
}

const z = (n) => String(n).padStart(2, "0");
function hhmm(ts) { const d = new Date(ts); return z(d.getHours()) + "." + z(d.getMinutes()); }
function ago(iso) {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (isNaN(m)) return "";
  if (m < 60) return Math.max(1, m) + "m";
  if (m < 48 * 60) return Math.round(m / 60) + "j";
  return Math.round(m / 1440) + "h";
}
function until(iso) {
  const d = new Date(iso), now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const tmr = new Date(now.getTime() + 864e5).toDateString() === d.toDateString();
  return (sameDay ? "" : tmr ? "besok " : d.getDate() + "/" + (d.getMonth() + 1) + " ") + hhmm(d);
}
function num(n) {
  if (n === null || n === undefined) return "–";
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, "") + "jt";
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, "") + "rb";
  return String(n);
}
function cut(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1).trim() + "…" : s; }

function chip(stack, text, fg, bg) {
  const s = stack.addStack();
  s.backgroundColor = bg; s.cornerRadius = 6; s.setPadding(2, 6, 2, 6);
  const t = s.addText(text); t.font = Font.boldMonospacedSystemFont(9); t.textColor = fg;
  return s;
}

function header(w, data, stale) {
  const h = w.addStack(); h.centerAlignContent();
  const t = h.addText("● KONTEN TAYANG"); t.font = Font.boldMonospacedSystemFont(10); t.textColor = LIME;
  h.addSpacer();
  const err = data && data.zernio && !data.zernio.ok;
  const c = h.addText(stale ? "offline" : err ? "zernio error" : DAYS + " hari");
  c.font = Font.mediumMonospacedSystemFont(10); c.textColor = stale || err ? RED : MUT;
}

function stat(row, label, val, big) {
  const s = row.addStack(); s.layoutVertically();
  const v = s.addText(val); v.font = Font.boldRoundedSystemFont(big ? 20 : 16); v.textColor = WHITE; v.minimumScaleFactor = 0.6;
  const l = s.addText(label); l.font = Font.mediumMonospacedSystemFont(8); l.textColor = MUT;
}

function totals(w, t, big) {
  const row = w.addStack(); row.centerAlignContent();
  stat(row, "VIEWS", num(t.views), big); row.addSpacer();
  stat(row, "LIKE", num(t.likes), big); row.addSpacer();
  stat(row, "KOMEN", num(t.comments), big); row.addSpacer();
  stat(row, "POST", String(t.posts || 0), big);
}

function postRow(w, p, big) {
  const s = w.addStack(); s.layoutVertically();
  s.backgroundColor = CARD; s.cornerRadius = 12; s.setPadding(big ? 8 : 6, 10, big ? 8 : 6, 10);
  if (p.url) s.url = p.url;
  const top = s.addStack(); top.centerAlignContent();
  const pl = PLAT[p.platform] || [String(p.platform || "?").slice(0, 2).toUpperCase(), MUT];
  chip(top, pl[0], INK, pl[1]); top.addSpacer(5);
  if (p.keyword) { chip(top, cut(p.keyword, 10), LIME, new Color("#1C2230")); top.addSpacer(5); }
  const a = top.addText(ago(p.published_at)); a.font = Font.mediumMonospacedSystemFont(9); a.textColor = MUT;
  top.addSpacer();
  const m = top.addText((p.views === null && p.sync === "pending") ? "nunggu data" : "▶ " + num(p.views) + "  ♥ " + num(p.likes) + "  💬 " + num(p.comments));
  m.font = Font.mediumMonospacedSystemFont(9); m.textColor = p.views === null ? MUT : WHITE;
  s.addSpacer(3);
  const t = s.addText(cut(p.title, big ? 72 : 54)); t.font = Font.semiboldSystemFont(big ? 12 : 11); t.textColor = WHITE; t.lineLimit = big ? 2 : 1;
}

async function build() {
  const fam = config.widgetFamily || "large";
  const { data, stale } = await load();
  const w = new ListWidget();
  w.backgroundColor = INK; w.setPadding(12, 12, 12, 12);
  w.refreshAfterDate = new Date(Date.now() + 15 * 60 * 1000);
  w.url = "https://www.instagram.com/";
  header(w, data, stale);
  w.addSpacer(8);

  if (!data) {
    const t = w.addText("Belum bisa ambil data. Cek koneksi."); t.font = Font.systemFont(12); t.textColor = MUT; return w;
  }
  if (data.zernio && !data.zernio.ok && !data.posts.length) {
    const t = w.addText(data.zernio.error === "key Zernio belum di-set" ? "Key Zernio belum di-set di server. Minta Claude: \"set key Zernio\"." : "Zernio: " + cut(data.zernio.error, 80));
    t.font = Font.systemFont(12); t.textColor = MUT; return w;
  }

  const t = data.totals || {};
  if (fam === "small") {
    stat(w.addStack(), "VIEWS " + DAYS + "H", num(t.views), true);
    w.addSpacer(2);
    const s2 = w.addText("♥ " + num(t.likes) + "  💬 " + num(t.comments) + "  · " + (t.posts || 0) + " post");
    s2.font = Font.mediumMonospacedSystemFont(9); s2.textColor = MUT;
    w.addSpacer();
    const p = data.posts[0];
    if (p) {
      const k = w.addText((PLAT[p.platform] || [p.platform])[0] + " · " + ago(p.published_at) + " · ▶ " + num(p.views));
      k.font = Font.boldMonospacedSystemFont(9); k.textColor = LIME;
      const tt = w.addText(cut(p.title, 46)); tt.font = Font.semiboldSystemFont(11); tt.textColor = WHITE; tt.lineLimit = 2;
      if (p.url) w.url = p.url;
    }
    return w;
  }

  totals(w, t, fam !== "medium");
  w.addSpacer(8);
  const max = fam === "medium" ? 2 : 5;
  if (!data.posts.length) {
    const e = w.addText("Belum ada post tayang " + DAYS + " hari ini."); e.font = Font.systemFont(12); e.textColor = MUT;
  }
  data.posts.slice(0, max).forEach((p, i) => { if (i) w.addSpacer(5); postRow(w, p, fam !== "medium"); });
  w.addSpacer();

  const foot = w.addStack(); foot.centerAlignContent();
  const nx = (data.next || [])[0];
  let left;
  if (nx) left = foot.addText("berikutnya " + until(nx.scheduled_for) + " · " + cut(nx.keyword || nx.title, fam === "medium" ? 16 : 26));
  else left = foot.addText(t.scheduled ? t.scheduled + " terjadwal" : "gak ada jadwal");
  left.font = Font.mediumMonospacedSystemFont(9); left.textColor = nx ? LIME : MUT;
  if (t.failed_3d) { foot.addSpacer(6); const f = foot.addText(t.failed_3d + " gagal"); f.font = Font.boldMonospacedSystemFont(9); f.textColor = RED; }
  foot.addSpacer();
  const right = foot.addText((stale ? "cache " : "update ") + hhmm(data._fetched || Date.now()));
  right.font = Font.mediumMonospacedSystemFont(9); right.textColor = MUT;
  return w;
}

const widget = await build();
if (config.runsInWidget) Script.setWidget(widget);
else await widget.presentLarge();
Script.complete();
