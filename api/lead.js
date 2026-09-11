/* eslint-disable */
// Réception des leads entrants pour le CRM.
//   POST /api/lead?secret=XXXX
//
// Deux formats détectés automatiquement :
//   • Calendly (webhook invitee.created / invitee.canceled)  -> call de setting booké/annulé
//   • Générique / systeme.io opt-in VSL ({email, name, phone, source...}) -> nouveau lead
//
// Stockage : hash crm:leads par email. /api/crm agrège avec iClosed + ventes.
//   GET /api/lead?debug=1 -> derniers payloads bruts reçus.

const { cmd, isConfigured } = require("../lib/kv");
const { pickNextAssignee } = require("../lib/crmData");

const pick = (o, ...ks) => { for (const k of ks) if (o && o[k] != null && o[k] !== "") return o[k]; return undefined; };
function deepEmail(obj, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 7) return undefined;
  for (const v of Object.values(obj)) {
    if (typeof v === "string" && /^[\w.+-]+@[\w.-]+\.\w{2,}$/.test(v)) return v;
    if (v && typeof v === "object") { const r = deepEmail(v, depth + 1); if (r) return r; }
  }
  return undefined;
}
function deepFind(obj, keys, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 7) return undefined;
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  for (const v of Object.values(obj)) { if (v && typeof v === "object") { const r = deepFind(v, keys, depth + 1); if (r !== undefined) return r; } }
  return undefined;
}

async function getLead(email) {
  try { const s = await cmd(["HGET", "crm:leads", email]); return s ? JSON.parse(s) : null; } catch { return null; }
}
async function saveLead(lead) {
  lead.updatedAt = new Date().toISOString();
  await cmd(["HSET", "crm:leads", lead.email, JSON.stringify(lead)]);
}
function pushHistory(lead, type, label) {
  lead.history = [...(lead.history || []), { at: new Date().toISOString(), type, label }].slice(-12);
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-ingest-secret");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (!isConfigured()) { res.status(500).json({ error: "Base KV non configurée." }); return; }

  const secret = process.env.INGEST_SECRET;
  const provided = (req.query && req.query.secret) || req.headers["x-ingest-secret"];

  // Capture brute AVANT le contrôle du secret (diagnostic), comme les autres webhooks.
  if (req.method === "POST") {
    let pbody = req.body;
    if (typeof pbody === "string") { try { pbody = JSON.parse(pbody); } catch { pbody = { _raw: req.body }; } }
    try {
      await cmd(["LPUSH", "crm:raw", JSON.stringify({ at: new Date().toISOString(), auth: (!secret || provided === secret), body: pbody || {} })]);
      await cmd(["LTRIM", "crm:raw", "0", "19"]);
    } catch (e) { /* ignore */ }
  }

  if (req.method === "GET") {
    if (req.query && (req.query.debug === "1" || req.query.debug === "true")) {
      const raw = (await cmd(["LRANGE", "crm:raw", "0", "9"])) || [];
      res.status(200).json({ debug: true, raw: raw.map((s) => { try { return JSON.parse(s); } catch { return s; } }) });
      return;
    }
    res.status(200).json({ ok: true, hint: "POST les leads ici (?secret=…) : opt-in VSL (systeme.io) ou webhook Calendly." });
    return;
  }

  if (secret && provided !== secret) { res.status(200).json({ ok: true, ignored: "secret" }); return; }

  try {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};

    // ---- Format Calendly (webhook v2) ----
    const calendlyEvent = String(body.event || "");
    const isCalendly = /^invitee\.(created|canceled)$/.test(calendlyEvent) || (body.payload && body.payload.scheduled_event);
    if (isCalendly) {
      const p = body.payload || {};
      const email = String(p.email || deepEmail(p) || "").toLowerCase();
      if (!email) { res.status(200).json({ ok: true, ignored: "email manquant" }); return; }
      const ev = p.scheduled_event || {};
      const lead = (await getLead(email)) || { email, createdAt: new Date().toISOString(), stage: "new", history: [] };
      lead.name = lead.name || p.name || email;
      // Téléphone : numéro SMS Calendly, ou réponse de formulaire qui y ressemble.
      if (!lead.phone) {
        const qas = Array.isArray(p.questions_and_answers) ? p.questions_and_answers : [];
        const byQ = qas.find((x) => /phone|t[ée]l/i.test(String(x.question || "")));
        const byShape = qas.map((x) => x.answer).find((a) => /^\+?[0-9][0-9 ().-]{6,}$/.test(String(a || "").trim()));
        const ph = p.text_reminder_number || (byQ && byQ.answer) || byShape;
        if (ph) lead.phone = String(ph);
      }
      // Réponses au formulaire Calendly -> fiche lead
      {
        const qas = Array.isArray(p.questions_and_answers) ? p.questions_and_answers : [];
        qas.forEach((x) => {
          if (x && x.question && x.answer != null && String(x.answer) !== "") {
            lead.answers = { ...(lead.answers || {}), [String(x.question)]: String(x.answer) };
          }
        });
      }
      const canceled = /canceled/.test(calendlyEvent) || p.status === "canceled";
      if (canceled) {
        if (!lead.manualStage) lead.stage = "setting"; // le RDV saute -> retour en setting
        pushHistory(lead, "calendly_cancel", `RDV annulé${ev.name ? ` · ${ev.name}` : ""}`);
      } else {
        if (!lead.manualStage && !["won", "lost"].includes(lead.stage)) lead.stage = "booked";
        lead.bookedAt = ev.start_time || new Date().toISOString();
        lead.bookedEvent = ev.name || "Calendly";
        pushHistory(lead, "calendly_booked", `RDV booké${ev.name ? ` · ${ev.name}` : ""}${ev.start_time ? ` (${String(ev.start_time).slice(0, 10)})` : ""}`);
      }
      lead.source = lead.source || "Calendly";
      if (!lead.setter) {
        const s = await pickNextAssignee(cmd, "setter");
        if (s) { lead.setter = s; pushHistory(lead, "assign", `Attribué à ${s} (auto)`); }
      }
      await saveLead(lead);
      res.status(200).json({ ok: true, calendly: true, email, stage: lead.stage });
      return;
    }

    // ---- Format générique / opt-in VSL (systeme.io ou autre) ----
    const data = body.data || body.payload || body.contact || body;
    const email = String(pick(data, "email", "contactEmail", "invitee_email") || deepEmail(body) || "").toLowerCase();
    if (!email) { res.status(400).json({ error: "Email manquant." }); return; }
    const lead = (await getLead(email)) || { email, createdAt: new Date().toISOString(), stage: "new", history: [] };
    const f = data.fields || {};
    lead.name = lead.name || pick(data, "name", "fullName", "full_name") ||
      [pick(f, "first_name", "firstName"), pick(f, "last_name", "surname")].filter(Boolean).join(" ").trim() ||
      deepFind(body, ["first_name", "firstName", "name"]) || email;
    lead.phone = lead.phone || pick(data, "phone", "phone_number", "phoneNumber") || pick(f, "phone_number", "phone") || undefined;
    lead.source = lead.source || pick(data, "source", "utm_source", "funnel", "funnelName") || "VSL";
    const ans = pick(data, "answers", "survey", "questions");
    if (ans && typeof ans === "object" && !Array.isArray(ans)) lead.answers = { ...(lead.answers || {}), ...ans };
    if (pick(data, "utm_campaign", "campaign")) lead.campaign = pick(data, "utm_campaign", "campaign");
    pushHistory(lead, "optin", `Lead entrant (${lead.source})`);
    if (!lead.setter) {
      const s = await pickNextAssignee(cmd, "setter");
      if (s) { lead.setter = s; pushHistory(lead, "assign", `Attribué à ${s} (auto)`); }
    }
    await saveLead(lead);
    res.status(200).json({ ok: true, email, stage: lead.stage });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e.message || e) });
  }
};
