/* eslint-disable */
// YouClose Pages : réception des événements de suivi envoyés par les pages /p/<slug>.
//   POST /api/t  {vid, slug, type: visit|vsl|cta|booked, data}
// Public (appelé par les visiteurs) : on ne stocke que des données de navigation
// bornées, jamais de contenu libre long.

const { cmd, isConfigured } = require("../lib/kv");
const { VISITOR_TTL } = require("../lib/yc");

const str = (s, n) => String(s == null ? "" : s).slice(0, n);
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "ad_id", "adset_id", "campaign_id", "placement", "fbclid", "gclid"];

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "POST uniquement" }); return; }
  if (!isConfigured()) { res.status(200).json({ ok: false }); return; }
  let b = req.body;
  if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } }
  b = b || {};
  const vid = String(b.vid || "").replace(/[^a-z0-9]/gi, "").slice(0, 40);
  const slug = String(b.slug || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60);
  const type = String(b.type || "");
  const d = b.data && typeof b.data === "object" ? b.data : {};
  if (vid.length < 6 || !slug || !["visit", "vsl", "cta", "booked"].includes(type)) { res.status(400).json({ error: "événement invalide" }); return; }

  try {
    const key = "trk:v:" + vid, skey = "trk:s:" + slug, now = new Date().toISOString();
    let v = null;
    try { const raw = await cmd(["GET", key]); v = raw ? JSON.parse(raw) : null; } catch (e) { v = null; }
    v = v || { vid, createdAt: now, visits: 0, cta: 0, pages: {}, events: [] };
    v.pages = v.pages || {}; v.events = v.events || [];
    const incr = [];
    let detail = "";

    if (type === "visit") {
      const utm = {};
      const src = d.utm && typeof d.utm === "object" ? d.utm : {};
      UTM_KEYS.forEach((k) => { if (src[k]) utm[k] = str(src[k], 200); });
      v.visits = (v.visits || 0) + 1;
      const touch = { at: now, slug, utm, ref: str(d.ref, 300), url: str(d.url, 600), device: str(d.device, 20) };
      if (!v.first) v.first = touch;
      v.last = touch;
      incr.push("visits");
      if (!v.pages[slug]) { v.pages[slug] = now; incr.push("uniq"); }
      detail = utm.utm_source || (touch.ref ? "référent" : "direct");
    } else if (type === "vsl") {
      const sec = Math.max(0, Math.min(36000, Number(d.sec) || 0));
      const dur = Math.max(0, Math.min(36000, Number(d.dur) || 0));
      const pct = dur ? Math.min(100, Math.round((sec / dur) * 100) >= 97 ? 100 : Math.round((sec / dur) * 100)) : 0;
      const prev = v.vsl || { pct: 0, sec: 0 };
      if (sec > (prev.sec || 0)) v.vsl = { sec: Math.round(sec), dur: Math.round(dur), pct, slug, at: now };
      v.vslB = v.vslB || [];
      [25, 50, 75, 100].forEach((p) => { if (pct >= p && !v.vslB.includes(p)) { v.vslB.push(p); incr.push("vsl" + p); detail = p + " %"; } });
      if (!detail) { await cmd(["SET", key, JSON.stringify(v), "EX", String(VISITOR_TTL)]); res.status(200).json({ ok: true }); return; }
    } else if (type === "cta") {
      v.cta = (v.cta || 0) + 1; incr.push("cta"); detail = str(d.text, 60);
    } else if (type === "booked") {
      if (!v.booked) incr.push("booked");
      v.booked = now; detail = "RDV réservé";
    }

    v.events.push({ at: now, type, slug, detail });
    if (v.events.length > 40) v.events = v.events.slice(-40);
    await cmd(["SET", key, JSON.stringify(v), "EX", String(VISITOR_TTL)]);
    for (const f of incr) { await cmd(["HINCRBY", skey, f, "1"]); }

    // Visiteur déjà rattaché à un lead : on tient sa fiche à jour (VSL regardée après le RDV…).
    if (v.lead && (type === "vsl" || type === "cta")) {
      try {
        const raw = await cmd(["HGET", "crm:leads", v.lead]);
        if (raw) {
          const lead = JSON.parse(raw);
          lead.yc = { ...(lead.yc || {}), vid, vslPct: v.vsl ? v.vsl.pct : 0, vslSec: v.vsl ? v.vsl.sec : 0, vslDur: v.vsl ? v.vsl.dur : 0, cta: v.cta || 0, visits: v.visits || 0 };
          await cmd(["HSET", "crm:leads", v.lead, JSON.stringify(lead)]);
        }
      } catch (e) { /* non bloquant */ }
    }
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(200).json({ ok: false });
  }
};
