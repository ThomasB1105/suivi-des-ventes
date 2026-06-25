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

// Valeur d'une réponse iClosed (souvent un tableau [{inputType, answer}]).
const ansVal = (a) => {
  if (Array.isArray(a)) return a.map((x) => (x && (x.answer != null ? x.answer : x.value != null ? x.value : x))).filter((v) => v != null && v !== "").join(", ");
  if (a && typeof a === "object") return a.answer != null ? a.answer : a.value;
  return a;
};
// Aplatit toutes les Q/R (questions de booking + secondaryAnswers).
function collectQA(c) {
  const map = {};
  const put = (st, a) => { if (st) { const v = ansVal(a); if (v != null && v !== "") map[st] = v; } };
  (c.questions || []).forEach((q) => put(q.statement || q.question, q.answer));
  (c.invitee || []).forEach((inv) => (inv.secondaryAnswers || inv.answers || []).forEach((sa) => put(sa.statement || sa.question, sa.answer)));
  (c.secondaryAnswers || []).forEach((sa) => put(sa.statement || sa.question, sa.answer));
  return map;
}

const META_Q = ["Call Outcome", "Outcome", "No Sale Reason", "Objection", "Phone Number", "Téléphone"];

function mapCall(c, userMap) {
  const qa = collectQA(c);
  const email = String(pick(c, "email", "contactEmail", "inviteeEmail") || deepEmail(c) || "").toLowerCase();
  const uid = pick(c, "userId", "ownerId", "hostId");
  const closer = (userMap && (userMap[uid] || userMap[String(uid)])) || pick(c, "closerName", "hostName", "ownerName") || (uid ? `Closer ${uid}` : "Non attribué");

  const outcomeAns = String(qa["Call Outcome"] || qa["Outcome"] || "").toUpperCase();
  const topOutcome = String(pick(c, "outcome") || "").toUpperCase();
  let status;
  if (/NO.?SHOW/.test(outcomeAns) || /NO.?SHOW/.test(topOutcome)) status = "noshow";
  else if (/NO.?SALE|LOST|REFUS/.test(outcomeAns)) status = "lost";
  else if (/SALE|WON|GAGN|DEPOSIT|ACOMPTE|CLOSED.?WON/.test(outcomeAns)) status = "won";
  else if (/CANCEL|ANNUL/.test(topOutcome)) status = "cancelled";
  else if (String(c.eventType || "").toUpperCase() === "UPCOMING") status = "booked";
  else if (topOutcome === "COMPLETED" || c.completed === true) status = "show";
  else status = "pending";

  const reason = qa["No Sale Reason"] || pick(c, "noSaleReason") || undefined;
  const objection = qa["Objection"] || pick(c, "objection") || undefined;
  // réponses de qualif (on retire les méta)
  const answers = {};
  Object.entries(qa).forEach(([k, v]) => { if (!META_Q.includes(k)) answers[k] = v; });

  const ev = c.event || {};
  return {
    id: "ic-" + (pick(c, "callId", "id", "uuid", "_id") || `${email}-${pick(c, "dateTime", "startTime", "date") || ""}`),
    email,
    closer: String(closer),
    status,
    date: pick(c, "dateTime", "startTime", "scheduledAt", "date", "createdAt") || new Date().toISOString(),
    answers: Object.keys(answers).length ? answers : undefined,
    reason: reason ? String(reason) : undefined,
    objection: objection ? String(objection) : undefined,
    event: pick(ev, "name", "title") || pick(c, "eventName", "callType") || undefined,
    amount: num(pick((c.deals && c.deals[0]) || {}, "amount", "value", "price") || pick(c, "amount", "dealValue", "revenue")) || undefined,
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

    // Carte userId -> nom du closer (best effort).
    const userMap = {};
    for (const p of ["/users", "/teamMembers", "/members", "/team", "/account/users"]) {
      try {
        const u = await icGet(p, key, { limit: 200 });
        const list = Array.isArray(u) ? u : (u.users || u.members || u.teamMembers || u.team || (u.data && (u.data.users || u.data.members || u.data.teamMembers || u.data.team || u.data)) || []);
        if (Array.isArray(list) && list.length) {
          list.forEach((m) => {
            const id = pick(m, "id", "userId", "_id", "uuid");
            const nm = pick(m, "name", "fullName", "displayName") || [pick(m, "firstName", "first_name"), pick(m, "lastName", "last_name")].filter(Boolean).join(" ") || pick(m, "email");
            if (id != null && nm) userMap[String(id)] = String(nm);
          });
          if (Object.keys(userMap).length) break;
        }
      } catch (e) { /* endpoint inconnu, on continue */ }
    }
    // Override manuel (l'API n'expose pas toujours les noms) :
    // Vercel → ICLOSED_USER_MAP = {"22743":"Ecom ascension","123":"Diego","456":"saphia"}
    try {
      const ov = JSON.parse(process.env.ICLOSED_USER_MAP || "{}");
      Object.entries(ov).forEach(([id, nm]) => { if (nm) userMap[String(id)] = String(nm); });
    } catch (e) { /* JSON invalide -> ignoré */ }
    if (!userMap["22743"]) userMap["22743"] = "Ecom ascension"; // compte principal connu

    // Import complet (pagination défensive : limit + offset).
    const all = [];
    let guard = 0;
    for (const et of ["PAST", "UPCOMING"]) {
      let offset = 0, seen = -1;
      while (guard++ < 300) {
        let page; try { page = await icGet("/eventCalls", key, { eventType: et, limit: 100, offset }); } catch (e) { break; }
        const arr = Array.isArray(page) ? page : (page.eventCalls || (page.data && (page.data.eventCalls || page.data.items || (Array.isArray(page.data) ? page.data : null))) || page.items || page.results || []);
        if (!Array.isArray(arr) || !arr.length || (arr.length === seen && offset === 0)) break;
        all.push(...arr);
        if (arr.length < 100) break;
        offset += 100; seen = arr.length;
      }
    }
    const recs = all.map((c) => mapCall(c, userMap));
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
