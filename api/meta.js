/* eslint-disable */
// ---------------------------------------------------------------------------
// Récupère la dépense publicitaire Meta (Facebook/Instagram Ads) sur une période.
//
//   GET /api/meta?since=YYYY-MM-DD&until=YYYY-MM-DD
//
// Variables d'env (Vercel → Settings → Environment Variables) :
//   META_ACCESS_TOKEN     token d'accès Meta avec la permission ads_read
//   META_AD_ACCOUNT_ID    id du compte publicitaire (avec ou sans préfixe act_)
//   META_API_VERSION      (option) version Graph API, défaut v21.0
//
// La dépense est lue via l'endpoint Insights du compte publicitaire.
// ---------------------------------------------------------------------------

const { checkAuth } = require("../lib/auth");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-token");
  if (!checkAuth(req)) { res.status(401).json({ error: "Non autorisé." }); return; }
  const token = process.env.META_ACCESS_TOKEN;
  const acct = process.env.META_AD_ACCOUNT_ID;
  if (!token || !acct) {
    res.status(200).json({ configured: false, spend: 0, note: "Meta non configuré (META_ACCESS_TOKEN / META_AD_ACCOUNT_ID)." });
    return;
  }

  const v = process.env.META_API_VERSION || "v21.0";
  const acctId = String(acct).startsWith("act_") ? acct : `act_${acct}`;
  const today = new Date().toISOString().slice(0, 10);
  const since = (req.query && req.query.since) || today;
  const until = (req.query && req.query.until) || today;
  const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
  const url = `https://graph.facebook.com/${v}/${acctId}/insights?fields=spend&time_range=${timeRange}&access_token=${encodeURIComponent(token)}`;

  try {
    const r = await fetch(url);
    const d = await r.json();
    if (d.error) {
      res.status(200).json({ configured: true, spend: 0, error: d.error.message || "Erreur Meta" });
      return;
    }
    const row = d.data && d.data[0];
    const spend = row && row.spend != null ? parseFloat(row.spend) : 0;
    res.setHeader("Cache-Control", "s-maxage=300, stale-while-revalidate=900");
    res.status(200).json({ configured: true, spend, currency: row && row.account_currency, since, until });
  } catch (e) {
    res.status(200).json({ configured: true, spend: 0, error: String(e.message || e) });
  }
};
