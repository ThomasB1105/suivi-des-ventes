/* eslint-disable */
// ---------------------------------------------------------------------------
// Renvoie les ventes à l'app, reconstruites depuis les événements stockés par
// /api/ingest (webhooks systeme.io).
//
//   GET /api/sales            -> { sales: [...] } pour l'app
//   GET /api/sales?debug=1     -> derniers payloads bruts reçus (calibration)
//
// On regroupe les transactions par client (email) : chaque paiement = une
// échéance encaissée, chaque paiement échoué = une échéance impayée.
// ---------------------------------------------------------------------------

const { cmd, isConfigured } = require("../lib/kv");

const slug = (s) => String(s || "").replace(/[^a-z0-9]/gi, "").slice(0, 40).toLowerCase();

function groupIntoSales(events) {
  const byClient = {};
  events.forEach((e) => {
    const key = e.email || e.name || e.id;
    if (!byClient[key]) byClient[key] = { email: e.email, name: e.name, offer: e.offer, events: [] };
    byClient[key].events.push(e);
    if (e.offer) byClient[key].offer = e.offer; // dernier libellé d'offre connu
  });

  return Object.values(byClient).map((c, idx) => {
    const evs = c.events
      .filter((e) => e.status !== "cancelled")
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));

    const schedule = evs.map((e) => ({
      id: `inst-${e.id}`,
      dueDate: e.date,
      amount: e.amount,
      paid: e.status === "paid",
      method: "auto",
    }));

    const total = schedule.reduce((a, s) => a + s.amount, 0);
    return {
      id: `sio-${slug(c.email || c.name || idx)}`,
      client: c.name || c.email || "Client",
      email: c.email || "",
      phone: "",
      closer: "—",
      source: "À attribuer",   // attribution organique/paid faite à la main
      channel: "organic",
      offer: c.offer || "—",
      closeDate: (evs[0] && evs[0].date) || (schedule[0] && schedule[0].dueDate),
      total,
      schedule: schedule.length ? schedule : [{ id: `inst-${slug(c.email)}-0`, dueDate: (evs[0] && evs[0].date), amount: 0, paid: false, method: "auto" }],
    };
  });
}

module.exports = async (req, res) => {
  if (!isConfigured()) {
    res.status(200).json({ sales: [], count: 0, configured: false, note: "Base KV non configurée." });
    return;
  }
  try {
    if (req.query && (req.query.debug === "1" || req.query.debug === "true")) {
      const raw = await cmd(["LRANGE", "sales:raw", "0", "9"]);
      res.status(200).json({
        debug: true,
        hint: "payloads bruts reçus des webhooks — sert à finaliser le mapping des champs.",
        raw: (raw || []).map((s) => { try { return JSON.parse(s); } catch { return s; } }),
      });
      return;
    }

    const flat = (await cmd(["HGETALL", "sales:events"])) || [];
    const events = [];
    for (let i = 1; i < flat.length; i += 2) {
      try { events.push(JSON.parse(flat[i])); } catch {}
    }
    const sales = groupIntoSales(events);
    res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=60");
    res.status(200).json({ sales, count: sales.length, events: events.length, syncedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
