/* eslint-disable */
// Rejoue les derniers payloads bruts reçus (sales:raw) à travers le mapping
// corrigé, pour réparer les ventes mal ingérées (ex : arrivées à 0 €) SANS
// re-déclencher les webhooks.
//
//   GET /api/reprocess?secret=XXXX
//
// Les payloads bien re-mappés (montant > 0) sont (ré)écrits dans sales:events.

const { cmd, isConfigured } = require("../lib/kv");
const { mapEvent } = require("../lib/mapEvent");

module.exports = async (req, res) => {
  const secret = process.env.INGEST_SECRET;
  const provided = (req.query && req.query.secret) || req.headers["x-ingest-secret"];
  if (secret && provided !== secret) { res.status(401).json({ error: "Secret invalide." }); return; }
  if (!isConfigured()) { res.status(500).json({ error: "Base KV non configurée." }); return; }

  try {
    const raw = (await cmd(["LRANGE", "sales:raw", "0", "49"])) || [];
    let fixed = 0;
    const samples = [];
    for (const s of raw) {
      let entry; try { entry = JSON.parse(s); } catch { continue; }
      const body = entry.body || entry;
      const rec = mapEvent(body);
      if (rec.email && rec.amount > 0) {
        await cmd(["HSET", "sales:events", rec.id, JSON.stringify(rec)]);
        fixed++;
        if (samples.length < 5) samples.push({ id: rec.id, name: rec.name, amount: rec.amount, date: rec.date, offer: rec.offer });
      }
    }
    res.status(200).json({ ok: true, scanned: raw.length, reprocessed: fixed, samples });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
