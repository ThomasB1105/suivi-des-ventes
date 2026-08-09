/* eslint-disable */
// Import de l'historique des paiements depuis l'API Stripe.
//   GET /api/stripe-import?secret=XXXX          -> importe tout dans sales:events
//   GET /api/stripe-import?secret=XXXX&debug=1  -> échantillon brut (calage)
//   (aussi appelable avec un token d'app valide, depuis l'interface)
//
// Variables d'env : STRIPE_SECRET_KEY (sk_live_… ou sk_test_…), INGEST_SECRET.
//
// On récupère les "charges" (couvre paiements uniques ET renouvellements
// d'abonnement) et on stocke le montant BRUT dans sales:events. Le
// dédoublonnage cross-source (systeme.io ↔ Stripe) est fait à la lecture par
// /api/sales (même montant à ±1 jour) : aucun double comptage.

const { cmd, isConfigured } = require("../lib/kv");
const { checkAuth } = require("../lib/auth");

const STRIPE_BASE = "https://api.stripe.com/v1";

async function stripeGet(path, key, params = {}) {
  const url = new URL(STRIPE_BASE + path);
  Object.entries(params).forEach(([k, v]) => { if (v != null && v !== "") url.searchParams.set(k, v); });
  const r = await fetch(url, { headers: { Authorization: `Bearer ${key}`, Accept: "application/json" } });
  const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; }
  if (!r.ok) { const e = new Error("Stripe " + r.status); e.status = r.status; e.body = b; throw e; }
  return b;
}

const toISODate = (unix) => { const d = new Date(Number(unix) * 1000); return isNaN(d) ? undefined : d.toISOString().slice(0, 10); };

function mapCharge(ch) {
  const bd = ch.billing_details || {};
  const cust = (ch.customer && typeof ch.customer === "object") ? ch.customer : {};
  const email = String(bd.email || ch.receipt_email || cust.email || "").toLowerCase();
  // Sans email, impossible de rattacher le paiement à un client : on IGNORE la
  // charge (sinon tout finissait aggloméré dans une fausse fiche "Client Stripe",
  // en doublon des paiements systeme.io qui passent par le même compte Stripe).
  if (!email) return null;
  const refunded = ch.refunded || (ch.amount_refunded && ch.amount_refunded >= ch.amount);
  return {
    id: "stripe-" + ch.id,
    email,
    name: bd.name || cust.name || email,
    amount: Number(ch.amount || 0) / 100,           // BRUT, centimes -> euros/devise
    currency: String(ch.currency || "").toUpperCase() || undefined,
    date: toISODate(ch.created) || toISODate(Date.now() / 1000),
    offer: ch.description || (ch.calculated_statement_descriptor) || "Stripe",
    type: "stripe",
    status: refunded ? "cancelled" : "paid",
    processor: "stripe",
    receivedAt: new Date().toISOString(),
  };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-token, x-ingest-secret");
  const secret = process.env.INGEST_SECRET;
  const provided = (req.query && req.query.secret) || req.headers["x-ingest-secret"];
  const okSecret = secret && provided === secret;
  if (!okSecret && !checkAuth(req)) { res.status(401).json({ error: "Non autorisé." }); return; }
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) { res.status(500).json({ error: "STRIPE_SECRET_KEY manquante (Vercel → Settings → Environment Variables)." }); return; }
  if (!isConfigured()) { res.status(500).json({ error: "Base KV non configurée." }); return; }

  try {
    if (req.query && (req.query.debug === "1" || req.query.debug === "true")) {
      let sample; try { sample = await stripeGet("/charges", key, { limit: 3 }); } catch (e) { sample = { _error: e.status, _body: e.body }; }
      res.status(200).json({ debug: true, sample });
      return;
    }

    // Pagination par curseur (starting_after), garde-fou strict.
    // expand=data.customer : l'email est souvent absent de la charge elle-même,
    // il faut le lire sur le customer -> c'est LA clé du matching par email.
    const all = [];
    let startingAfter = null, guard = 0;
    while (guard++ < 200) {
      const params = { limit: 100, "expand[]": "data.customer" };
      if (startingAfter) params.starting_after = startingAfter;
      let page; try { page = await stripeGet("/charges", key, params); } catch (e) { if (guard === 1) throw e; break; }
      const data = (page && page.data) || [];
      if (!data.length) break;
      all.push(...data);
      startingAfter = data[data.length - 1].id;
      if (!page.has_more) break;
    }

    // On ne garde que les paiements réellement encaissés (ou remboursés -> annulé),
    // ET rattachables à un email (sinon fiche poubelle + doublons systeme.io).
    const recs = all.filter((ch) => ch.paid && ch.status === "succeeded").map(mapCharge).filter(Boolean);

    // Purge des anciennes entrées Stripe avant réécriture (l'import est la source
    // de vérité pour Stripe) : élimine la fausse fiche "Client Stripe" cumulée.
    try {
      const keys = (await cmd(["HKEYS", "sales:events"])) || [];
      const toDel = keys.filter((k) => String(k).startsWith("stripe-"));
      for (let i = 0; i < toDel.length; i += 100) {
        await cmd(["HDEL", "sales:events", ...toDel.slice(i, i + 100)]);
      }
    } catch (e) { /* purge best-effort */ }
    let stored = 0;
    for (let i = 0; i < recs.length; i += 40) {
      const batch = recs.slice(i, i + 40);
      const args = ["HSET", "sales:events"];
      batch.forEach((r) => { args.push(r.id, JSON.stringify(r)); });
      if (args.length > 2) { await cmd(args); stored += batch.length; }
    }
    const eligible = all.filter((ch) => ch.paid && ch.status === "succeeded").length;
    res.status(200).json({ ok: true, fetched: all.length, stored, skippedNoEmail: eligible - recs.length, sample: recs[0] || null });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e), detail: e.body });
  }
};
