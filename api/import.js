/* eslint-disable */
// ---------------------------------------------------------------------------
// Import en masse de l'historique des transactions (depuis le navigateur).
//
//   POST /api/import?secret=XXXX
//   body: { records: [ { ... }, ... ] }   ou directement  [ {...}, ... ]
//
// Chaque transaction est stockée comme un événement "paid" dans la base KV,
// exactement comme les webhooks → /api/sales les regroupe par client.
// Tolérant sur les noms de champs (la source vient du dashboard systeme.io).
// ---------------------------------------------------------------------------

const { pipeline, isConfigured } = require("../lib/kv");

const pick = (o, ...keys) => {
  for (const k of keys) if (o && o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  return undefined;
};
const num = (v) => {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(/[^\d.,-]/g, "").replace(/\s/g, "").replace(",", "."));
  return isNaN(n) ? 0 : n;
};
// Gère ISO, timestamps, et le format français "JJ/MM/AAAA[, HH:MM]".
const toISODate = (v) => {
  if (!v) return undefined;
  const s = String(v).trim();
  const fr = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (fr) return `${fr[3]}-${fr[2]}-${fr[1]}`;
  const d = new Date(s);
  return isNaN(d) ? undefined : d.toISOString().slice(0, 10);
};

function normalize(row, i) {
  const email = String(pick(row, "email", "customerEmail", "contactEmail") || "").toLowerCase();
  const name =
    pick(row, "name", "client", "customerName", "fullName") ||
    [pick(row, "firstName", "first_name"), pick(row, "lastName", "surname", "last_name")].filter(Boolean).join(" ").trim() ||
    email || "Client";
  const amount = num(pick(row, "amount", "montant", "total", "price", "value"));
  const date = toISODate(pick(row, "date", "createdAt", "transactionDate", "invoiceDate")) || toISODate(Date.now());
  const offer = pick(row, "offer", "offre", "productName", "product", "funnelName") || "";
  const id = String(pick(row, "id", "invoice", "facture", "invoiceNumber", "transactionId") || `imp-${date}-${email}-${amount}-${i}`);
  return { id, email, name, amount, date, offer, type: "import", status: "paid", receivedAt: new Date().toISOString() };
}

module.exports = async (req, res) => {
  // CORS : ce endpoint est appelé depuis le navigateur (dashboard systeme.io).
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-ingest-secret");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }

  const secret = process.env.INGEST_SECRET;
  const provided = (req.query && req.query.secret) || req.headers["x-ingest-secret"];
  if (secret && provided !== secret) { res.status(401).json({ error: "Secret invalide." }); return; }
  if (req.method !== "POST") { res.status(405).json({ error: "Utilise POST." }); return; }
  if (!isConfigured()) { res.status(500).json({ error: "Base KV non configurée." }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const rows = Array.isArray(body) ? body : (body && (body.records || body.transactions || body.data)) || [];
  if (!Array.isArray(rows) || !rows.length) { res.status(400).json({ error: "Aucun enregistrement (envoie { records: [...] })." }); return; }

  const records = rows.map(normalize);
  try {
    // par lots de 50 commandes HSET
    for (let i = 0; i < records.length; i += 50) {
      const batch = records.slice(i, i + 50).map((r) => ["HSET", "sales:events", r.id, JSON.stringify(r)]);
      await pipeline(batch);
    }
    res.status(200).json({ ok: true, imported: records.length });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
