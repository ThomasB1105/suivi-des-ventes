/* eslint-disable */
// Réception des paiements Whop (webhook).
//   POST /api/whop?secret=XXXX
// Whop (Dashboard → Developer → Create Webhook) envoie un événement à CHAQUE
// paiement, renouvellements récurrents compris. On stocke le montant BRUT
// (avant frais Whop) dans sales:events → /api/sales le regroupe par client,
// exactement comme les ventes systeme.io.
//
//   GET /api/whop?debug=1   -> derniers payloads bruts reçus (calibration)
//
// Variable d'env : INGEST_SECRET (le même que systeme.io ; mis dans ?secret=…).

const { cmd, isConfigured } = require("../lib/kv");

const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k]; return undefined; };
const num = (v) => { if (v == null) return 0; const n = parseFloat(String(v).replace(/[^\d.,-]/g, "").replace(",", ".")); return isNaN(n) ? 0 : n; };
function deepFind(obj, keys, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 7) return undefined;
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  for (const v of Object.values(obj)) { if (v && typeof v === "object") { const r = deepFind(v, keys, depth + 1); if (r !== undefined) return r; } }
  return undefined;
}
function deepEmail(obj, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 7) return undefined;
  for (const v of Object.values(obj)) {
    if (typeof v === "string" && /^[\w.+-]+@[\w.-]+\.\w{2,}$/.test(v)) return v;
    if (v && typeof v === "object") { const r = deepEmail(v, depth + 1); if (r) return r; }
  }
  return undefined;
}
const toISODate = (v) => {
  if (!v) return undefined;
  // Whop envoie souvent un timestamp unix (secondes ou ms).
  let d;
  if (typeof v === "number" || /^\d+$/.test(String(v))) { const n = Number(v); d = new Date(n < 1e12 ? n * 1000 : n); }
  else d = new Date(v);
  return isNaN(d) ? undefined : d.toISOString().slice(0, 10);
};

// Détail d'un plan Whop (échéancier) : cache KV, sinon API (si clé présente).
async function fetchPlan(planId) {
  if (!planId || !process.env.WHOP_API_KEY) return null;
  try { const s = await cmd(["HGET", "whop:plans", planId]); if (s) return JSON.parse(s); } catch (e) { /* ignore */ }
  const headers = { Authorization: `Bearer ${process.env.WHOP_API_KEY}`, Accept: "application/json" };
  if (process.env.WHOP_COMPANY_ID) headers["x-company-id"] = process.env.WHOP_COMPANY_ID;
  for (const base of ["https://api.whop.com/api/v2/plans/", "https://api.whop.com/api/v5/company/plans/"]) {
    try {
      const r = await fetch(base + planId, { headers });
      if (!r.ok) continue;
      const j = await r.json();
      const pl = (j && (j.data || j)) || null;
      if (pl && (pl.id || pl.renewal_price !== undefined)) {
        try { await cmd(["HSET", "whop:plans", planId, JSON.stringify(pl)]); } catch (e) { /* ignore */ }
        return pl;
      }
    } catch (e) { /* endpoint suivant */ }
  }
  return null;
}

// Champs d'échéancier (mêmes conventions que systeme.io : planCount / planAmount /
// planInterval ; planOpen = mensualités actives mais nombre total inconnu).
function planFieldsFrom(pl) {
  if (!pl) return {};
  const renewal = num(pick(pl, "renewal_price", "renewalPrice"));
  const period = Number(pick(pl, "billing_period", "billingPeriod")) || 0;
  if (!(renewal > 0) || !(period > 0)) return {};
  const out = { planAmount: renewal, planInterval: period >= 300 ? "year" : "month" };
  let count = Number(pick(pl, "split_pay_required_payments", "required_payments", "payments_required", "number_of_payments", "installments", "payment_count")) || 0;
  const expDays = Number(pick(pl, "expiration_days", "expirationDays")) || 0;
  if (!count && expDays && period) count = Math.max(1, Math.round(expDays / period));
  if (count > 1) out.planCount = count;
  else out.planOpen = true;
  return out;
}
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-ingest-secret, whop-signature");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (!isConfigured()) { res.status(500).json({ error: "Base KV non configurée." }); return; }

  const secret = process.env.INGEST_SECRET;
  const provided = (req.query && req.query.secret) || req.headers["x-ingest-secret"];

  // On capture TOUJOURS le payload brut (avant le contrôle du secret) pour
  // pouvoir caler le mapping sur du réel, même si le secret ne passe pas.
  if (req.method === "POST") {
    let pbody = req.body;
    if (typeof pbody === "string") { try { pbody = JSON.parse(pbody); } catch { pbody = { _raw: req.body }; } }
    try {
      await cmd(["LPUSH", "whop:raw", JSON.stringify({ at: new Date().toISOString(), auth: (!secret || provided === secret), body: pbody || {} })]);
      await cmd(["LTRIM", "whop:raw", "0", "19"]);
    } catch (e) { /* ignore */ }
  }

  if (req.method === "GET") {
    if (req.query && (req.query.debug === "1" || req.query.debug === "true")) {
      const raw = (await cmd(["LRANGE", "whop:raw", "0", "9"])) || [];
      res.status(200).json({ debug: true, raw: raw.map((s) => { try { return JSON.parse(s); } catch { return s; } }) });
      return;
    }
    res.status(200).json({ ok: true, hint: "POST les webhooks Whop ici (?secret=…). GET ?debug=1 pour voir les payloads bruts." });
    return;
  }

  // Secret invalide : on renvoie 200 (pour que Whop ne désactive pas le webhook)
  // mais on n'enregistre rien.
  if (secret && provided !== secret) { res.status(200).json({ ok: true, ignored: "secret" }); return; }

  try {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};
    const type = pick(body, "type", "action", "event") || "";
    const data = body.data || body.payload || body;

    // On ne crée une vente que pour un paiement RÉELLEMENT encaissé ou un
    // remboursement/litige. Les autres événements (payment_created,
    // payment_pending, payment_failed, chat, membership…) sont ignorés :
    // un paiement "créé" ou "en attente" n'est PAS du revenu.
    const t = String(type).toLowerCase();
    const isRefund = /(refund|dispute|chargeback)/.test(t);
    const isSucceeded = /succeed|success|paid/.test(t);
    if (!isRefund && !isSucceeded) { res.status(200).json({ ok: true, ignored: "event non encaissé", type }); return; }

    const status = isRefund ? "cancelled" : "paid";
    const email = String(pick(data, "email", "user_email") || deepEmail(data) || deepEmail(body) || "").toLowerCase();
    const name = pick(data, "name", "username", "full_name") || deepFind(data, ["name", "username", "full_name"]) || email || "Client Whop";
    // Montant BRUT (avant frais Whop) : final_amount / amount / subtotal en priorité.
    const grossRaw = deepFind(data, ["final_amount", "amount", "subtotal", "total", "amount_after_fees"]);
    const amount = num(grossRaw);
    const currency = String(pick(data, "currency", "currency_code") || deepFind(data, ["currency", "currency_code"]) || "").toUpperCase() || undefined;
    const date = toISODate(pick(body, "timestamp") || deepFind(data, ["created_at", "paid_at", "createdAt", "date", "timestamp"])) || toISODate(Date.now());
    const offer = pick(data, "product", "plan", "product_name", "plan_name") || deepFind(data, ["product_title", "plan_name", "product_name", "title", "name"]) || "Whop";
    const id = "whop-" + (pick(data, "id", "payment_id", "receipt_id") || deepFind(body, ["id"]) || `${email}-${date}-${Math.round(amount * 100)}`);

    const rec = {
      id,
      email,
      name: String(name),
      amount,
      currency,
      date,
      offer: typeof offer === "object" ? (offer.name || offer.title || "Whop") : String(offer),
      type: "whop",
      status,                       // paid / cancelled
      processor: "whop",
      receivedAt: new Date().toISOString(),
    };
    // Échéancier : le webhook embarque parfois l'objet plan complet ; sinon on
    // le résout via l'API Whop (caché en KV). -> mensualités projetées côté /api/sales.
    try {
      const rawPlan = data.plan;
      let planObj = (rawPlan && typeof rawPlan === "object" && (rawPlan.renewal_price !== undefined || rawPlan.billing_period !== undefined)) ? rawPlan : null;
      if (!planObj) {
        const planId = (typeof rawPlan === "string" && rawPlan) || (rawPlan && rawPlan.id) || data.plan_id || deepFind(data, ["plan_id"]);
        planObj = await fetchPlan(planId);
      }
      Object.assign(rec, planFieldsFrom(planObj));
    } catch (e) { /* sans plan : paiement simple */ }
    await cmd(["HSET", "sales:events", id, JSON.stringify(rec)]);
    res.status(200).json({ ok: true, stored: true, record: rec });
  } catch (e) {
    res.status(200).json({ ok: false, error: String(e.message || e) });
  }
};
