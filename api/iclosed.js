/* eslint-disable */
// Réception des données iClosed (via Make/Zapier) : closer + source du lead.
//   POST /api/iclosed?secret=XXXX   body:{ email, closer, source, channel }
// Stocké par email ; /api/sales enrichit les clients correspondants.

const { cmd, isConfigured } = require("../lib/kv");

const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k]; return undefined; };
function deepEmail(obj, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 6) return undefined;
  for (const v of Object.values(obj)) {
    if (typeof v === "string" && /^[\w.+-]+@[\w.-]+\.\w{2,}$/.test(v)) return v;
    if (v && typeof v === "object") { const r = deepEmail(v, depth + 1); if (r) return r; }
  }
  return undefined;
}
const inferChannel = (src) => {
  const s = String(src || "").toLowerCase();
  if (/(ads?|meta|facebook|fb|google|tiktok|sea|paid|pub)/.test(s)) return "paid";
  if (s) return "organic";
  return undefined;
};

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-ingest-secret");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (!isConfigured()) { res.status(500).json({ error: "Base KV non configurée." }); return; }

  const secret = process.env.INGEST_SECRET;
  const provided = (req.query && req.query.secret) || req.headers["x-ingest-secret"];

  // POST : on capture TOUJOURS le payload brut (avant le contrôle du secret) pour pouvoir
  // diagnostiquer ce qu'iClosed envoie réellement, même si le secret ne passe pas.
  if (req.method === "POST") {
    let pbody = req.body;
    if (typeof pbody === "string") { try { pbody = JSON.parse(pbody); } catch { pbody = { _raw: req.body }; } }
    const hdr = {};
    try { Object.keys(req.headers || {}).forEach((h) => { if (/secret|sign|auth|token|iclosed|webhook/i.test(h)) hdr[h] = req.headers[h]; }); } catch (e) {}
    try {
      await cmd(["LPUSH", "iclosed:raw", JSON.stringify({ at: new Date().toISOString(), auth: (!secret || provided === secret), query: req.query || {}, headers: hdr, body: pbody || {} })]);
      await cmd(["LTRIM", "iclosed:raw", "0", "19"]);
    } catch (e) { /* ignore */ }
  }

  if (secret && provided !== secret) { res.status(200).json({ ok: true, ignored: "secret" }); return; }

  try {
    if (req.method === "GET") { // debug : voir ce qui est stocké
      if (req.query && (req.query.debug === "1" || req.query.debug === "true")) {
        const raw = (await cmd(["LRANGE", "iclosed:raw", "0", "9"])) || [];
        res.status(200).json({ debug: true, raw: raw.map((s) => { try { return JSON.parse(s); } catch { return s; } }) });
        return;
      }
      const flat = (await cmd(["HGETALL", "iclosed:contacts"])) || [];
      const out = {};
      for (let i = 0; i < flat.length; i += 2) { try { out[flat[i]] = JSON.parse(flat[i + 1]); } catch {} }
      const ncalls = (await cmd(["LLEN", "iclosed:calls"])) || 0;
      res.status(200).json({ contacts: Object.keys(out).length, calls: ncalls, data: out });
      return;
    }

    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};
    const data = body.data || body.payload || body;

    const email = String(pick(data, "email", "contactEmail", "invitee_email", "inviteeEmail") || deepEmail(body) || "").toLowerCase();
    if (!email) { res.status(400).json({ error: "Email manquant." }); return; }
    const closer = pick(data, "closer", "closerName", "owner", "rep", "assignee", "host") || undefined;
    const source = pick(data, "source", "leadSource", "lead_source", "utm_source", "utmSource", "origin", "channelSource") || undefined;
    const channel = pick(data, "channel") || inferChannel(source);

    const record = {};
    if (closer) record.closer = String(closer);
    if (source) record.source = String(source);
    if (channel) record.channel = channel;
    record.at = new Date().toISOString();
    await cmd(["HSET", "iclosed:contacts", email, JSON.stringify(record)]);

    // Si l'événement porte un statut d'appel / des réponses → on stocke un "call" pour les stats closers.
    const rawStatus = pick(data, "status", "outcome", "callStatus", "disposition", "result", "callOutcome", "callStage");
    const answers = pick(data, "answers", "questions", "qualification", "customFields", "fields");
    const reason = pick(data, "noSaleReason", "no_sale_reason", "reason", "lostReason", "cancelReason");
    const objection = pick(data, "objection", "objections", "mainObjection");
    const eventName = pick(data, "event", "eventName", "callType", "eventType", "funnel");
    const amount = pick(data, "amount", "dealValue", "revenue", "price", "total", "value");
    const normStatus = (s) => {
      const t = String(s || "").toLowerCase();
      if (/no.?show|absent/.test(t)) return "noshow";
      if (/won|gagn|closed.?won|sold|vente|signed|deposit|acompte/.test(t)) return "won";
      if (/lost|perdu|closed.?lost|refus|no.?sale|pas de vente|disqualif|unqualif|not.?interest/.test(t)) return "lost";
      if (/cancel|annul/.test(t)) return "cancelled";
      if (/reschedul|replanif|report/.test(t)) return "rescheduled";
      if (/show|present|complete|done|held|attended/.test(t)) return "show";
      if (/pending|attente|follow|relance/.test(t)) return "pending";
      if (/book|schedul|reserv|upcoming|planned/.test(t)) return "booked";
      return t || "other";
    };
    const ns = normStatus(rawStatus);
    // On ne crée un "appel" QUE sur un vrai résultat d'appel. Les changements de
    // statut de contact (Strategy Call Booked / Disqualified / Potential...) NE sont
    // PAS des appels : les bookings et annulations viennent de l'import (source de
    // vérité), sinon le webhook gonflait le compte avec des faux appels.
    const REAL_OUTCOME = ["noshow", "won", "lost", "show", "rescheduled", "cancelled"];
    const isCall = (rawStatus && REAL_OUTCOME.includes(ns)) || !!reason || !!objection;
    let stored = false;
    if (isCall) {
      const num = (v) => { if (v == null) return 0; const n = parseFloat(String(v).replace(/[^\d.,-]/g, "").replace(",", ".")); return isNaN(n) ? 0 : n; };
      const callId = "ic-" + (pick(data, "id", "callId", "eventCallId", "uuid", "_id") || `${email}-${pick(data, "date", "callDate", "scheduledAt", "createdAt") || ""}-${ns}`);
      const call = {
        id: callId,
        email, closer: closer ? String(closer) : "Non attribué",
        status: ns, source: source ? String(source) : undefined,
        date: (pick(data, "date", "callDate", "scheduledAt", "createdAt") || new Date().toISOString()),
        answers: (answers && typeof answers === "object") ? answers : undefined,
        reason: reason ? String(reason) : undefined,
        objection: objection ? String(objection) : undefined,
        event: eventName ? String(eventName) : undefined,
        amount: amount != null ? num(amount) : undefined,
        at: new Date().toISOString(),
      };
      // hash dédupliqué par id (cohérent avec l'import API)
      await cmd(["HSET", "iclosed:calls_h", callId, JSON.stringify(call)]);
      stored = true;
    }
    res.status(200).json({ ok: true, email, record, call: stored });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
