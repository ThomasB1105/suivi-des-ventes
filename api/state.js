/* eslint-disable */
// État applicatif partagé (synchro multi-appareils) en base KV :
// ventes corrigées (attribution, impayés, overlay…), coûts, budget Ads, clients supprimés.
//
//   GET  /api/state           -> { sales, costs, ads, deletedSales }
//   POST /api/state  body:{sales,costs,ads,deletedSales}

const { cmd, isConfigured } = require("../lib/kv");
const { checkAuth } = require("../lib/auth");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-token");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (!checkAuth(req)) { res.status(401).json({ error: "Non autorisé." }); return; }
  if (!isConfigured()) { res.status(200).json({ configured: false }); return; }

  try {
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
      body = body || {};
      // État existant : on ne remplace JAMAIS un champ rempli par du vide (anti-perte).
      let prev = {};
      try { const raw = await cmd(["GET", "app:state"]); if (raw) prev = JSON.parse(raw) || {}; } catch (e) { /* ignore */ }
      const arr = (a) => Array.isArray(a) ? a : null;
      const data = {
        sales: (arr(body.sales) && body.sales.length) ? body.sales : (prev.sales || []),
        costs: (arr(body.costs) && body.costs.length) ? body.costs : (prev.costs || []),
        ads: (body.ads && Object.keys(body.ads).length) ? body.ads : (prev.ads || {}),
        deletedSales: arr(body.deletedSales) ? body.deletedSales : (prev.deletedSales || []),
        savedAt: new Date().toISOString(),
      };
      await cmd(["SET", "app:state", JSON.stringify(data)]);
      res.status(200).json({ ok: true, kept: { costs: data.costs.length, sales: data.sales.length } });
      return;
    }
    const raw = await cmd(["GET", "app:state"]);
    let data = null;
    if (raw) { try { data = JSON.parse(raw); } catch { /* corrupted */ } }
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ configured: true, found: !!data, ...(data || { sales: [], costs: [], ads: {}, deletedSales: [] }) });
  } catch (e) {
    res.status(200).json({ configured: true, error: String(e.message || e) });
  }
};
