/* eslint-disable */
// Import de l'historique des appels depuis l'API iClosed.
//   GET /api/iclosed-import?secret=XXXX&debug=1   -> échantillon brut (caler le mapping)
//   GET /api/iclosed-import?secret=XXXX           -> importe tout dans iclosed:calls_h
//
// Variables d'env : ICLOSED_API_KEY (clé iClosed, commence par iclosed_), INGEST_SECRET.

const { cmd, isConfigured } = require("../lib/kv");

const ICLOSED_BASE = "https://public.api.iclosed.io/v1";

async function icGet(path, key, params = {}) {
  const url = new URL(ICLOSED_BASE + path);
  Object.entries(params).forEach(([k, v]) => { if (v != null && v !== "") url.searchParams.set(k, v); });
  const r = await fetch(url, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
  const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; }
  if (!r.ok) { const e = new Error("iClosed " + r.status); e.status = r.status; e.body = b; throw e; }
  return b;
}

const pick = (o, ...ks) => { for (const k of ks) if (o && o[k] != null && o[k] !== "") return o[k]; return undefined; };
const num = (v) => { if (v == null) return 0; const n = parseFloat(String(v).replace(/[^\d.,-]/g, "").replace(",", ".")); return isNaN(n) ? 0 : n; };
function deepEmail(o, d = 0) { if (!o || typeof o !== "object" || d > 6) return undefined; for (const v of Object.values(o)) { if (typeof v === "string" && /^[\w.+-]+@[\w.-]+\.\w{2,}$/.test(v)) return v; if (v && typeof v === "object") { const r = deepEmail(v, d + 1); if (r) return r; } } return undefined; }
function normStatus(s) { const t = String(s || "").toLowerCase(); if (/no.?show|absent/.test(t)) return "noshow"; if (/won|gagn|sold|signed|deposit|closed.?won/.test(t)) return "won"; if (/lost|perdu|no.?sale|refus|closed.?lost/.test(t)) return "lost"; if (/cancel|annul/.test(t)) return "cancelled"; if (/reschedul|report/.test(t)) return "rescheduled"; if (/pending|attente|follow/.test(t)) return "pending"; if (/show|present|complete|held|attended/.test(t)) return "show"; if (/book|schedul|upcoming|planned/.test(t)) return "booked"; return t || "other"; }

function mapCall(c) {
  const contact = c.contact || {};
  const host = c.host || c.owner || c.assignee || {};
  const email = String(pick(c, "email", "contactEmail", "inviteeEmail") || pick(contact, "email") || deepEmail(c) || "").toLowerCase();
  const closer = pick(host, "name", "fullName", "firstName") || pick(c, "closer", "host", "owner", "rep", "hostName", "ownerName") || "Non attribué";
  const answers = pick(c, "answers", "questions", "qualification", "formAnswers", "customFields");
  return {
    id: "ic-" + (pick(c, "id", "uuid", "callId", "eventCallId", "_id") || `${email}-${pick(c, "startTime", "scheduledAt", "date", "createdAt") || ""}`),
    email,
    closer: String(closer),
    status: normStatus(pick(c, "outcome", "status", "callOutcome", "disposition", "result", "callStatus", "eventType")),
    date: pick(c, "startTime", "scheduledAt", "date", "callDate", "createdAt") || new Date().toISOString(),
    answers: (answers && typeof answers === "object") ? answers : undefined,
    reason: pick(c, "noSaleReason", "reason", "lostReason") || undefined,
    objection: pick(c, "objection", "mainObjection") || undefined,
    event: pick(c, "eventName", "callType") || pick(c.event || {}, "name", "title") || undefined,
    amount: num(pick(c, "amount", "dealValue", "revenue", "value")) || undefined,
    source: pick(c, "source", "leadSource", "utmSource") || undefined,
    at: new Date().toISOString(),
  };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const secret = process.env.INGEST_SECRET;
  const provided = (req.query && req.query.secret) || req.headers["x-ingest-secret"];
  if (secret && provided !== secret) { res.status(401).json({ error: "Secret invalide." }); return; }
  const key = process.env.ICLOSED_API_KEY;
  if (!key) { res.status(500).json({ error: "ICLOSED_API_KEY manquante (Vercel → Settings → Environment Variables)." }); return; }
  if (!isConfigured()) { res.status(500).json({ error: "Base KV non configurée." }); return; }

  try {
    if (req.query && (req.query.debug === "1" || req.query.debug === "true")) {
      const samples = {};
      for (const et of ["PAST", "UPCOMING", ""]) {
        try { samples[et || "ALL"] = await icGet("/eventCalls", key, { limit: 3, eventType: et || undefined }); }
        catch (e) { samples[et || "ALL"] = { _error: e.status, _body: e.body }; }
      }
      res.status(200).json({ debug: true, samples });
      return;
    }

    // Import complet (pagination défensive : limit + offset).
    const all = [];
    let guard = 0;
    for (const et of ["PAST", "UPCOMING"]) {
      let offset = 0, seen = -1;
      while (guard++ < 300) {
        let page; try { page = await icGet("/eventCalls", key, { eventType: et, limit: 100, offset }); } catch (e) { break; }
        const arr = Array.isArray(page) ? page : (page.items || page.data || page.eventCalls || page.results || []);
        if (!arr.length || arr.length === seen && offset === 0) break;
        all.push(...arr);
        if (arr.length < 100) break;
        offset += 100; seen = arr.length;
      }
    }
    const recs = all.map(mapCall);
    let stored = 0;
    for (let i = 0; i < recs.length; i += 40) {
      const batch = recs.slice(i, i + 40);
      const args = ["HSET", "iclosed:calls_h"];
      batch.forEach((r) => { args.push(r.id, JSON.stringify(r)); });
      if (args.length > 2) { await cmd(args); stored += batch.length; }
    }
    res.status(200).json({ ok: true, fetched: all.length, stored, sample: recs[0] || null });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e), detail: e.body });
  }
};
