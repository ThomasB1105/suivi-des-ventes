/* eslint-disable */
// ---------------------------------------------------------------------------
// Endpoint de réception des webhooks systeme.io (ou Make).
//
//   POST /api/ingest?secret=XXXX
//
// systeme.io (Réglages → Webhooks, ou Automatisations → Règles) envoie un
// événement (nouvelle vente, paiement d'abonnement, paiement échoué, vente
// annulée). On le stocke dans la base KV ; /api/sales le restitue à l'app.
//
// Variables d'env (Vercel → Settings → Environment Variables) :
//   INGEST_SECRET        secret partagé, mis dans l'URL du webhook (?secret=…)
//   KV_REST_API_URL      injectées par l'intégration Vercel KV / Upstash
//   KV_REST_API_TOKEN
//
// NB : le format exact du payload systeme.io n'est pas documenté publiquement.
// On extrait de façon tolérante ET on garde les derniers payloads bruts
// (consultables via /api/sales?debug=1) pour finaliser le mapping sur du réel.
// ---------------------------------------------------------------------------

const { cmd, isConfigured } = require("../lib/kv");
const { mapEvent } = require("../lib/mapEvent");

const pick = (o, ...keys) => {
  for (const k of keys) if (o && o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
};
const num = (v) => {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[^\d.,-]/g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
};
const toISODate = (v) => {
  if (!v) return undefined;
  const d = new Date(v);
  return isNaN(d) ? undefined : d.toISOString().slice(0, 10);
};

// Recherche récursive de la 1re clé trouvée (n'importe où dans le payload).
function deepFind(obj, keys, depth = 0) {
  if (!obj || typeof obj !== "object" || depth > 7) return undefined;
  for (const k of keys) if (obj[k] !== undefined && obj[k] !== null && obj[k] !== "") return obj[k];
  for (const v of Object.values(obj)) {
    if (v && typeof v === "object") { const r = deepFind(v, keys, depth + 1); if (r !== undefined) return r; }
  }
  return undefined;
};
const deepEmail = (obj, depth = 0) => {
  if (!obj || typeof obj !== "object" || depth > 7) return undefined;
  for (const v of Object.values(obj)) {
    if (typeof v === "string" && /^[\w.+-]+@[\w.-]+\.\w{2,}$/.test(v)) return v;
    if (v && typeof v === "object") { const r = deepEmail(v, depth + 1); if (r) return r; }
  }
  return undefined;
};

// Classe l'événement à partir de son type/texte.
function classify(type) {
  const t = String(type || "").toLowerCase();
  if (/(fail|échou|echou|declin|refus|unpaid|impay)/.test(t)) return "failed";
  if (/(cancel|annul|refund|rembours|chargeback)/.test(t)) return "cancelled";
  return "paid"; // vente, paiement récurrent réussi, nouvel abonnement payé
}

module.exports = async (req, res) => {
  // 1) sécurité : secret partagé
  const secret = process.env.INGEST_SECRET;
  const provided = (req.query && req.query.secret) || req.headers["x-ingest-secret"];
  if (secret && provided !== secret) {
    res.status(401).json({ error: "Secret invalide." });
    return;
  }
  if (req.method !== "POST") {
    res.status(405).json({ error: "Utilise POST." });
    return;
  }

  // 2) corps (Vercel parse le JSON ; on gère aussi le cas string)
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  // 3) extraction (mapping partagé avec /api/reprocess)
  const record = mapEvent(body);
  const id = record.id;

  // 4) stockage
  try {
    if (isConfigured()) {
      await cmd(["HSET", "sales:events", id, JSON.stringify(record)]);
      // on garde les 50 derniers payloads bruts pour caler le mapping
      await cmd(["LPUSH", "sales:raw", JSON.stringify({ at: record.receivedAt, body })]);
      await cmd(["LTRIM", "sales:raw", "0", "49"]);
    }
    res.status(200).json({ ok: true, stored: isConfigured(), record });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
