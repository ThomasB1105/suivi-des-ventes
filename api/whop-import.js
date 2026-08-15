/* eslint-disable */
// Import de l'historique des paiements depuis l'API Whop.
//   GET/POST /api/whop-import?secret=XXXX          -> importe tout dans sales:events
//   GET      /api/whop-import?secret=XXXX&debug=1  -> échantillon brut (calage mapping)
//   (aussi appelable avec un token d'app valide, depuis l'interface)
//
// Variables d'env : WHOP_API_KEY (clé API Whop, Dashboard → Developer), INGEST_SECRET.
//
// Montant BRUT stocké dans sales:events (comme systeme.io/Stripe). Le
// dédoublonnage cross-source est fait à la lecture par /api/sales
// (même montant à ±1 jour) : pas de double comptage.

const { cmd, isConfigured } = require("../lib/kv");
const { checkAuth } = require("../lib/auth");

// Endpoints candidats (l'API Whop a plusieurs versions ; on prend le 1er qui répond).
const CANDIDATES = [
  { base: "https://api.whop.com/api/v2/payments", pageParam: "page" },
  { base: "https://api.whop.com/v2/payments", pageParam: "page" },
  { base: "https://api.whop.com/api/v5/company/payments", pageParam: "page" },
  { base: "https://api.whop.com/v5/company/payments", pageParam: "page" },
  { base: "https://api.whop.com/api/v5/payments", pageParam: "page" },
  { base: "https://api.whop.com/api/v2/receipts", pageParam: "page" },
];

async function whopGet(url, key) {
  const headers = { Authorization: `Bearer ${key}`, Accept: "application/json" };
  // L'API v5 exige le contexte entreprise : Vercel → WHOP_COMPANY_ID = biz_XXXX
  // (visible dans l'URL du dashboard Whop). Sans lui -> 403 sur /v5/company/*.
  if (process.env.WHOP_COMPANY_ID) headers["x-company-id"] = process.env.WHOP_COMPANY_ID;
  const r = await fetch(url, { headers });
  const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; }
  if (!r.ok) { const e = new Error("Whop " + r.status); e.status = r.status; e.body = b; throw e; }
  return b;
}

const pick = (o, ...ks) => { for (const k of ks) if (o && o[k] != null && o[k] !== "") return o[k]; return undefined; };
const num = (v) => { if (v == null) return 0; const n = parseFloat(String(v).replace(/[^\d.,-]/g, "").replace(",", ".")); return isNaN(n) ? 0 : n; };
function deepEmail(obj, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 6) return undefined;
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
const extract = (j) => Array.isArray(j) ? j : ((j && (j.data || j.payments || j.items || j.results)) || []);

function mapPayment(p) {
  const user = p.user || p.member || p.customer || {};
  const email = String(pick(user, "email") || pick(p, "email", "user_email") || deepEmail(p) || "").toLowerCase();
  if (!email) return null; // sans email, pas de rattachement client -> ignoré
  const st = String(pick(p, "status", "state") || "").toLowerCase();
  if (/(fail|declin|unpaid|open|draft|pending)/.test(st)) return null; // pas encaissé
  const refunded = /refund|revers/.test(st) || p.refunded === true || Number(p.refunded_amount || 0) > 0;
  // Montant BRUT : final_amount / total / amount (Whop renvoie des décimaux, pas des cents)
  const amount = num(pick(p, "final_amount", "total", "amount", "subtotal", "usd_amount"));
  if (!(amount > 0)) return null;
  const product = p.product || p.plan || {};
  return {
    id: "whop-" + (pick(p, "id", "receipt_id", "payment_id") || `${email}-${pick(p, "created_at", "paid_at") || ""}`),
    email,
    name: pick(user, "name", "username", "full_name") || email,
    amount,
    currency: String(pick(p, "currency", "currency_code") || "").toUpperCase() || undefined,
    date: toISODate(pick(p, "paid_at", "created_at", "createdAt", "timestamp")) || toISODate(Date.now()),
    offer: (typeof product === "object" ? pick(product, "title", "name") : product) || "Whop",
    type: "whop",
    status: refunded ? "cancelled" : "paid",
    processor: "whop",
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
  const key = process.env.WHOP_API_KEY;
  if (!key) { res.status(500).json({ error: "WHOP_API_KEY manquante (Vercel → Settings → Environment Variables)." }); return; }
  if (!isConfigured()) { res.status(500).json({ error: "Base KV non configurée." }); return; }

  try {
    // 1) trouver l'endpoint qui répond
    let chosen = null, firstPage = null, errors = {};
    for (const c of CANDIDATES) {
      try {
        const j = await whopGet(`${c.base}?${c.pageParam}=1&per=50`, key);
        const arr = extract(j);
        if (Array.isArray(arr)) { chosen = c; firstPage = j; break; }
      } catch (e) {
        // On garde le message renvoyé par Whop : il dit exactement ce qui manque
        // (scope, company id, type de clé...).
        let msg = "";
        try { const b = e.body; msg = (b && (b.message || (b.error && (b.error.message || b.error)) || b.detail)) || ""; } catch {}
        errors[c.base] = `${e.status || "ERR"}${msg ? ` « ${String(msg).slice(0, 120)} »` : ""}`;
      }
    }
    if (!chosen) {
      // On remonte le statut HTTP de chaque endpoint directement dans le message :
      // 401/403 = clé invalide ou mauvais type de clé, 404 = chemin inexistant.
      const summary = Object.entries(errors).map(([u, s]) => `${u.replace("https://api.whop.com", "")}: ${s}`).join(" · ");
      const hint = !process.env.WHOP_COMPANY_ID && Object.values(errors).some((s) => s === 403)
        ? " — 403 : ajoute WHOP_COMPANY_ID (biz_…) dans Vercel puis redéploie."
        : "";
      res.status(502).json({ error: `Aucun endpoint Whop ne répond (${summary})${hint}`, detail: errors });
      return;
    }

    if (req.query && (req.query.debug === "1" || req.query.debug === "true")) {
      res.status(200).json({ debug: true, endpoint: chosen.base, sample: firstPage });
      return;
    }

    // 2) paginer
    const all = [...extract(firstPage)];
    let guard = 1;
    while (guard++ < 100) {
      let j; try { j = await whopGet(`${chosen.base}?${chosen.pageParam}=${guard}&per=50`, key); } catch (e) { break; }
      const arr = extract(j);
      if (!arr.length) break;
      const before = all.length;
      const seen = new Set(all.map((x) => x && x.id));
      arr.forEach((x) => { if (x && !seen.has(x.id)) all.push(x); });
      if (all.length === before) break; // la page ne rapporte rien de neuf
      if (arr.length < 50) break;
    }

    const recs = all.map(mapPayment).filter(Boolean);

    // 3) purge des anciennes entrées Whop avant réécriture (import = source de vérité)
    try {
      const keys = (await cmd(["HKEYS", "sales:events"])) || [];
      const toDel = keys.filter((k) => String(k).startsWith("whop-"));
      for (let i = 0; i < toDel.length; i += 100) await cmd(["HDEL", "sales:events", ...toDel.slice(i, i + 100)]);
    } catch (e) { /* best-effort */ }

    let stored = 0;
    for (let i = 0; i < recs.length; i += 40) {
      const batch = recs.slice(i, i + 40);
      const args = ["HSET", "sales:events"];
      batch.forEach((r) => { args.push(r.id, JSON.stringify(r)); });
      if (args.length > 2) { await cmd(args); stored += batch.length; }
    }
    res.status(200).json({ ok: true, endpoint: chosen.base, fetched: all.length, stored, skipped: all.length - recs.length, sample: recs[0] || null });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e), detail: e.body });
  }
};
