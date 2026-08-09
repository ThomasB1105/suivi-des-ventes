/* eslint-disable */
// Réception des paiements Stripe (webhook).
//   POST /api/stripe?secret=XXXX
//
// Stripe envoie PLUSIEURS événements pour un même paiement -> pour éviter les
// doublons on ne traite que :
//   • checkout.session.completed  (paiement unique, mode != subscription)
//   • invoice.payment_succeeded   (abonnements : 1er paiement ET renouvellements)
//   • charge.refunded / *.refunded (remboursement -> annulé)
// Le montant BRUT (avant frais Stripe) est stocké dans sales:events, comme
// systeme.io / Whop -> /api/sales le regroupe par client.
//
//   GET /api/stripe?debug=1   -> derniers payloads bruts reçus
//
// Variable d'env : INGEST_SECRET (mis dans ?secret=…).
// (Vérif de signature Stripe possible plus tard via STRIPE_WEBHOOK_SECRET +
//  body brut ; ici on s'appuie sur le secret d'URL, suffisant et simple.)

const { cmd, isConfigured } = require("../lib/kv");

const pick = (o, ...keys) => { for (const k of keys) if (o && o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k]; return undefined; };
const num = (v) => { if (v == null) return 0; const n = parseFloat(String(v).replace(/[^\d.,-]/g, "").replace(",", ".")); return isNaN(n) ? 0 : n; };
function deepFind(obj, keys, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 8) return undefined;
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  for (const v of Object.values(obj)) { if (v && typeof v === "object") { const r = deepFind(v, keys, depth + 1); if (r !== undefined) return r; } }
  return undefined;
}
function deepEmail(obj, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 8) return undefined;
  for (const v of Object.values(obj)) {
    if (typeof v === "string" && /^[\w.+-]+@[\w.-]+\.\w{2,}$/.test(v)) return v;
    if (v && typeof v === "object") { const r = deepEmail(v, depth + 1); if (r) return r; }
  }
  return undefined;
}
const toISODate = (v) => {
  if (!v) return undefined;
  let d;
  if (typeof v === "number" || /^\d+$/.test(String(v))) { const n = Number(v); d = new Date(n < 1e12 ? n * 1000 : n); }
  else d = new Date(v);
  return isNaN(d) ? undefined : d.toISOString().slice(0, 10);
};

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-ingest-secret, stripe-signature");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (!isConfigured()) { res.status(500).json({ error: "Base KV non configurée." }); return; }

  const secret = process.env.INGEST_SECRET;
  const provided = (req.query && req.query.secret) || req.headers["x-ingest-secret"];

  if (req.method === "POST") {
    let pbody = req.body;
    if (typeof pbody === "string") { try { pbody = JSON.parse(pbody); } catch { pbody = { _raw: req.body }; } }
    try {
      await cmd(["LPUSH", "stripe:raw", JSON.stringify({ at: new Date().toISOString(), auth: (!secret || provided === secret), type: pbody && pbody.type, body: pbody || {} })]);
      await cmd(["LTRIM", "stripe:raw", "0", "19"]);
    } catch (e) { /* ignore */ }
  }

  if (req.method === "GET") {
    if (req.query && (req.query.debug === "1" || req.query.debug === "true")) {
      const raw = (await cmd(["LRANGE", "stripe:raw", "0", "9"])) || [];
      res.status(200).json({ debug: true, raw: raw.map((s) => { try { return JSON.parse(s); } catch { return s; } }) });
      return;
    }
    res.status(200).json({ ok: true, hint: "POST les webhooks Stripe ici (?secret=…). GET ?debug=1 pour voir les payloads bruts." });
    return;
  }

  // Secret invalide -> 200 (pour ne pas faire échouer/désactiver le webhook Stripe)
  if (secret && provided !== secret) { res.status(200).json({ received: true, ignored: "secret" }); return; }

  try {
    let body = req.body;
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    body = body || {};
    const type = String(body.type || "");
    const obj = (body.data && body.data.object) || body.object || body;

    // Remboursement -> annulé
    if (/refund/i.test(type)) {
      const email = String(deepFind(obj, ["email", "receipt_email", "customer_email"]) || deepEmail(obj) || "").toLowerCase();
      const cents = deepFind(obj, ["amount_refunded", "amount"]) || 0;
      const id = "stripe-rf-" + (pick(obj, "id") || `${email}-${Date.now()}`);
      const rec = { id, email, name: email || "Client Stripe", amount: num(cents) / 100, date: toISODate(obj.created || body.created) || toISODate(Date.now()), offer: "Stripe", type: "stripe", status: "cancelled", processor: "stripe", receivedAt: new Date().toISOString() };
      await cmd(["HSET", "sales:events", id, JSON.stringify(rec)]);
      res.status(200).json({ received: true, refund: true });
      return;
    }

    // Encaissements : on ne garde QUE ces deux types (anti double-comptage).
    const isCheckout = type === "checkout.session.completed";
    const isInvoice = type === "invoice.payment_succeeded" || type === "invoice.paid";
    if (!isCheckout && !isInvoice) { res.status(200).json({ received: true, ignored: "type", type }); return; }
    // Un checkout d'abonnement est déjà couvert par invoice.payment_succeeded.
    if (isCheckout && String(obj.mode || "").toLowerCase() === "subscription") {
      res.status(200).json({ received: true, ignored: "subscription-checkout (couvert par invoice)" });
      return;
    }

    // Montant BRUT en centimes -> euros.
    const cents = isCheckout
      ? deepFind(obj, ["amount_total", "amount_subtotal", "amount"])
      : deepFind(obj, ["amount_paid", "amount_due", "total", "amount"]);
    const amount = num(cents) / 100;
    const currency = String(pick(obj, "currency") || deepFind(obj, ["currency"]) || "").toUpperCase() || undefined;
    const email = String(
      (obj.customer_details && obj.customer_details.email) ||
      pick(obj, "customer_email", "receipt_email") ||
      deepFind(obj, ["email", "customer_email", "receipt_email"]) || deepEmail(obj) || ""
    ).toLowerCase();
    const name =
      (obj.customer_details && obj.customer_details.name) ||
      pick(obj, "customer_name") ||
      deepFind(obj, ["name", "customer_name"]) || email || "Client Stripe";
    const date = toISODate(obj.created || body.created) || toISODate(Date.now());
    const offer =
      deepFind(obj, ["description"]) ||
      (obj.lines && obj.lines.data && obj.lines.data[0] && obj.lines.data[0].description) ||
      "Stripe";
    const id = "stripe-" + (pick(obj, "id", "payment_intent", "invoice", "subscription") || `${email}-${date}-${Math.round(amount * 100)}`);

    if (!(amount > 0)) { res.status(200).json({ received: true, ignored: "no-amount", type }); return; }

    const rec = {
      id, email, name: String(name), amount, currency, date,
      offer: String(offer), type: "stripe", status: "paid", processor: "stripe",
      receivedAt: new Date().toISOString(),
    };
    await cmd(["HSET", "sales:events", id, JSON.stringify(rec)]);
    res.status(200).json({ received: true, stored: true, record: rec });
  } catch (e) {
    res.status(200).json({ received: false, error: String(e.message || e) });
  }
};
