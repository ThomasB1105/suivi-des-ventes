/* eslint-disable */
// Import de l'historique des appels depuis l'API iClosed.
//   GET /api/iclosed-import?secret=XXXX&debug=1   -> échantillon brut (caler le mapping)
//   GET /api/iclosed-import?secret=XXXX           -> importe tout dans iclosed:calls_h
//
// Variables d'env : ICLOSED_API_KEY (clé iClosed, commence par iclosed_), INGEST_SECRET.

const { cmd, isConfigured } = require("../lib/kv");
const { checkAuth } = require("../lib/auth");

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
  const email = String(pick(c, "inviteeEmail", "email", "contactEmail") || deepEmail(c) || "").toLowerCase();

  // Closer : le nom réel est dans c.user (firstName/lastName) — plus fiable que l'id.
  const u = c.user || {};
  const uname = [u.firstName, u.lastName].filter(Boolean).join(" ").trim();
  const uid = pick(c, "userId", "ownerId", "hostId") || u.id;
  const closer = uname || (userMap && (userMap[uid] || userMap[String(uid)])) || pick(c, "closerName", "hostName") || (uid ? `Closer ${uid}` : "Non attribué");

  // Résultat de l'appel : il est dans c.task[0] (outcome / noSaleReason / objection),
  // PAS dans c.outcome. C'est ce qui empêchait les no-show/ventes de remonter.
  const task = (Array.isArray(c.task) ? c.task[0] : c.task) || {};
  const outcomeAns = String(task.outcome || qa["Call Outcome"] || qa["Outcome"] || "").toUpperCase();
  const isCancelled = !!(c.cancelReason || c.cancelledBy);
  const isRescheduled = !!(c.rescheduledBy || c.rescheduleReason);
  const isUpcoming = String(c.__eventType || c.eventType || "").toUpperCase() === "UPCOMING";
  let status;
  if (isCancelled) status = "cancelled";
  else if (/NO.?SHOW/.test(outcomeAns)) status = "noshow";
  else if (/NO.?SALE|LOST|PERDU|REFUS|NOT.?INTEREST|UNQUALIF|DISQUALIF/.test(outcomeAns)) status = "lost";
  else if (/\bSALE\b|WON|GAGN|DEPOSIT|ACOMPTE|CLOSED.?WON|PAID|CUSTOMER|WIN/.test(outcomeAns)) status = "won";
  else if (/FOLLOW|RELANCE|SHOW.?UP|PRESENT|COMPLETE|ATTEND|HELD|DONE/.test(outcomeAns)) status = "show";
  else if (isRescheduled && !outcomeAns) status = "rescheduled";
  else if (isUpcoming) status = "booked";
  else status = "pending"; // appel passé sans résultat renseigné

  const reason = task.noSaleReason || qa["No Sale Reason"] || undefined;
  const objection = task.objection || qa["Objection"] || undefined;
  // réponses de qualif (on retire les méta)
  const answers = {};
  Object.entries(qa).forEach(([k, v]) => { if (!META_Q.includes(k)) answers[k] = v; });

  const ev = c.event || {};
  const callId = pick(c, "callId", "id", "uuid", "_id");
  const date = pick(c, "dateTimeUTC", "dateTime", "startTime", "scheduledAt", "date", "createdAt") || new Date().toISOString();
  return {
    id: "ic-" + (callId || `${email}-${date}`),
    email,
    closer: String(closer),
    status,
    date,
    callType: c.callType || undefined,        // STRATEGY_EVENT / DISCOVERY...
    answers: Object.keys(answers).length ? answers : undefined,
    reason: reason ? String(reason) : undefined,
    objection: objection ? String(objection) : undefined,
    event: pick(ev, "name", "title") || c.callType || undefined,
    amount: num(pick((c.deals && c.deals[0]) || {}, "amount", "value", "price", "dealValue") || pick(c, "amount", "dealValue", "revenue")) || undefined,
    upcoming: isUpcoming || undefined,
    outcome: task.outcome ? String(task.outcome) : undefined, // libellé brut pour transparence
    at: new Date().toISOString(),
  };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  // Auth : soit le secret d'ingestion (URL/cron), soit un token d'app valide
  // (bouton "Actualiser" dans l'interface, utilisateur connecté).
  const secret = process.env.INGEST_SECRET;
  const provided = (req.query && req.query.secret) || req.headers["x-ingest-secret"];
  const okSecret = secret && provided === secret;
  if (!okSecret && !checkAuth(req)) { res.status(401).json({ error: "Non autorisé." }); return; }
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

    // Le nom du closer est lu directement dans c.user (cf. mapCall) — pas besoin
    // d'interroger /users (ces endpoints renvoient 404 et faisaient timeout).
    // Override optionnel : Vercel → ICLOSED_USER_MAP = {"22743":"Melo", ...}
    const userMap = {};
    try {
      const ov = JSON.parse(process.env.ICLOSED_USER_MAP || "{}");
      Object.entries(ov).forEach(([id, nm]) => { if (nm) userMap[String(id)] = String(nm); });
    } catch (e) { /* JSON invalide -> ignoré */ }

    // Import complet (pagination défensive : limit + offset).
    const all = [];
    let guard = 0;
    for (const et of ["PAST", "UPCOMING"]) {
      let offset = 0, seen = -1;
      while (guard++ < 300) {
        let page; try { page = await icGet("/eventCalls", key, { eventType: et, limit: 100, offset }); } catch (e) { break; }
        const arr = Array.isArray(page) ? page : (page.eventCalls || (page.data && (page.data.eventCalls || page.data.items || (Array.isArray(page.data) ? page.data : null))) || page.items || page.results || []);
        if (!Array.isArray(arr) || !arr.length || (arr.length === seen && offset === 0)) break;
        arr.forEach((x) => { if (x && typeof x === "object") x.__eventType = et; }); // PAST / UPCOMING
        all.push(...arr);
        if (arr.length < 100) break;
        offset += 100; seen = arr.length;
      }
    }
    const recs = all.map((c) => mapCall(c, userMap));
    // Purge avant réécriture : l'import est la source de vérité (toute l'historique
    // iClosed). Sans ça, les anciens "à venir" devenus passés et les doublons
    // s'accumulaient (ex. 9 "à venir" au lieu de 2). On repart d'une base propre.
    if (recs.length) { try { await cmd(["DEL", "iclosed:calls_h"]); } catch (e) {} }
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
