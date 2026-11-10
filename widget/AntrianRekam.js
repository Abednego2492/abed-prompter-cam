// Variables used by Scriptable.
// icon-color: deep-gray; icon-glyph: video;
// =====================================================================
// ANTRIAN REKAM · Temu Prompter Cam
// Widget iOS (Scriptable) yang nunjukin naskah yang belum lo shoot,
// urut sesuai antrian. Tap widget = buka kamera dengan naskah #1.
// Data: https://temu-prompter-cam.netlify.app/api/queue (publik, read-only,
// gak butuh kode/key). Cocok dipasang di samping widget Content Monitor.
// Ukuran: kecil = #1 aja, sedang = 3 teratas, besar = 6 teratas.
// =====================================================================

const BASE = "https://temu-prompter-cam.netlify.app";
const LIME = new Color("#C6FF00");
const INK = new Color("#05070B");
const CARD = new Color("#0C0F15");
const MUT = new Color("#8A93A3");
const RED = new Color("#FF6B60");
const WHITE = Color.white();
const fm = FileManager.local();
const CACHE = fm.joinPath(fm.documentsDirectory(), "antrian-rekam-cache.json");

async function load() {
  try {
    const r = new Request(BASE + "/api/queue?t=" + Date.now());
    r.timeoutInterval = 12;
    const j = await r.loadJSON();
    if (!j || !Array.isArray(j.items)) throw new Error("format");
    j._fetched = Date.now();
    fm.writeString(CACHE, JSON.stringify(j));
    return { data: j, stale: false };
  } catch (e) {
    if (fm.fileExists(CACHE)) {
      try { return { data: JSON.parse(fm.readString(CACHE)), stale: true }; } catch (_) {}
    }
    return { data: null, stale: true, err: String(e) };
  }
}

function hhmm(ts) {
  const d = new Date(ts);
  const z = (n) => String(n).padStart(2, "0");
  return z(d.getHours()) + "." + z(d.getMinutes());
}

function cut(s, n) { s = String(s || ""); return s.length > n ? s.slice(0, n - 1).trim() + "…" : s; }

function header(w, data, stale) {
  const h = w.addStack();
  h.centerAlignContent();
  const t = h.addText("● ANTRIAN REKAM");
  t.font = Font.boldMonospacedSystemFont(10);
  t.textColor = LIME;
  h.addSpacer();
  const n = data ? data.items.length : 0;
  const c = h.addText(stale ? "offline" : (n ? n + " antri" : "kosong"));
  c.font = Font.mediumMonospacedSystemFont(10);
  c.textColor = stale ? RED : MUT;
}

function chip(stack, text, fg, bg) {
  const s = stack.addStack();
  s.backgroundColor = bg;
  s.cornerRadius = 6;
  s.setPadding(2, 6, 2, 6);
  const t = s.addText(text);
  t.font = Font.boldMonospacedSystemFont(9);
  t.textColor = fg;
  return s;
}

function row(w, it, big) {
  const s = w.addStack();
  s.layoutVertically();
  s.backgroundColor = CARD;
  s.cornerRadius = 12;
  s.setPadding(big ? 9 : 7, 10, big ? 9 : 7, 10);
  s.url = it.link;

  const top = s.addStack();
  top.centerAlignContent();
  chip(top, "#" + it.pos, INK, LIME);
  top.addSpacer(6);
  if (it.keyword) chip(top, it.keyword, LIME, new Color("#1C2230"));
  if (it.needs_fill) { top.addSpacer(4); chip(top, "ISI HASIL TES", WHITE, new Color("#5A1F1B")); }
  top.addSpacer();
  if (it.durasi) { const d = top.addText(it.durasi); d.font = Font.mediumMonospacedSystemFont(9); d.textColor = MUT; }

  s.addSpacer(4);
  const t = s.addText(cut(it.title, big ? 70 : 52));
  t.font = Font.semiboldSystemFont(big ? 14 : 12);
  t.textColor = WHITE;
  t.lineLimit = 2;
  if (big && it.hook) {
    s.addSpacer(2);
    const k = s.addText(cut(it.hook, 80));
    k.font = Font.systemFont(11);
    k.textColor = MUT;
    k.lineLimit = 1;
  }
  if (it.note) {
    s.addSpacer(2);
    const n = s.addText("↳ " + cut(it.note, 60));
    n.font = Font.italicSystemFont(10);
    n.textColor = LIME;
    n.lineLimit = 1;
  }
}

async function build() {
  const fam = config.widgetFamily || "large";
  const { data, stale } = await load();
  const w = new ListWidget();
  w.backgroundColor = INK;
  w.setPadding(12, 12, 12, 12);
  w.refreshAfterDate = new Date(Date.now() + 30 * 60 * 1000);
  w.url = BASE + "/#next";

  header(w, data, stale);
  w.addSpacer(8);

  if (!data) {
    const t = w.addText("Belum bisa ambil antrian. Cek koneksi, atau API kamera belum ke-deploy.");
    t.font = Font.systemFont(12); t.textColor = MUT;
    return w;
  }
  if (!data.items.length) {
    const t = w.addText("Semua naskah udah direkam. Ide baru masuk jam 06.15.");
    t.font = Font.semiboldSystemFont(13); t.textColor = WHITE;
    if (data.done && data.done[0]) {
      w.addSpacer(6);
      const d = w.addText("terakhir: " + cut(data.done[0].title, 48));
      d.font = Font.systemFont(11); d.textColor = MUT;
    }
    return w;
  }

  if (fam === "small") {
    const it = data.items[0];
    const k = w.addText("#1 · " + (it.keyword || ""));
    k.font = Font.boldMonospacedSystemFont(11); k.textColor = LIME;
    w.addSpacer(4);
    const t = w.addText(cut(it.title, 60));
    t.font = Font.semiboldSystemFont(13); t.textColor = WHITE; t.lineLimit = 4;
    w.addSpacer();
    const f = w.addText(it.needs_fill ? "isi hasil tes dulu" : "tap = rekam");
    f.font = Font.mediumMonospacedSystemFont(10); f.textColor = it.needs_fill ? RED : MUT;
    w.url = it.link;
    return w;
  }

  const max = fam === "medium" ? 2 : 5;
  data.items.slice(0, max).forEach((it, i) => {
    if (i) w.addSpacer(6);
    row(w, it, fam !== "medium");
  });
  w.addSpacer();
  const foot = w.addStack();
  const left = foot.addText(data.items.length > max ? "+" + (data.items.length - max) + " lagi" : "tap kartu = buka di kamera");
  left.font = Font.mediumMonospacedSystemFont(9); left.textColor = MUT;
  foot.addSpacer();
  const right = foot.addText((stale ? "cache " : "update ") + hhmm(data._fetched || Date.now()));
  right.font = Font.mediumMonospacedSystemFont(9); right.textColor = MUT;
  return w;
}

const widget = await build();
if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  await widget.presentLarge();
}
Script.complete();
