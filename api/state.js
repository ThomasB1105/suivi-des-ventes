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
      const data = {
        sales: Array.isArray(body.sales) ? body.sales : [],
        costs: Array.isArray(body.costs) ? body.costs : [],
        ads: (body.ads && typeof body.ads === "object") ? body.ads : {},
        deletedSales: Array.isArray(body.deletedSales) ? body.deletedSales : [],
        savedAt: new Date().toISOString(),
      };
      await cmd(["SET", "app:state", JSON.stringify(data)]);
      res.status(200).json({ ok: true });
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
