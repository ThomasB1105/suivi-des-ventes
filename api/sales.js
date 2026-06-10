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
const pad = (n) => String(n).padStart(2, "0");
const addMonthsISO = (iso, n) => {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  if (!y) return iso;
  const dt = new Date(y, (m - 1) + n, d || 1);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
};

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

    // 1) échéances réellement encaissées (une par transaction)
    const schedule = evs.map((e) => ({
      id: `inst-${e.id}`,
      dueDate: e.date,
      amount: e.amount,
      paid: true,
      method: e.processor === "stripe" ? "auto" : "auto",
    }));

    // 2) projection des échéances restantes d'un plan échelonné (limitOfPayments).
    //    On se base sur l'échéance la plus "plan" (planCount le plus élevé).
    const plan = evs
      .filter((e) => e.planCount > 1 && e.planAmount > 0)
      .sort((a, b) => b.planCount - a.planCount)[0];
    if (plan) {
      const planPaid = evs.filter((e) => Math.abs(e.amount - plan.planAmount) < 0.5);
      const remaining = Math.max(0, plan.planCount - planPaid.length);
      const lastDate = (planPaid.map((e) => e.date).sort().pop()) || plan.date;
      const interval = plan.planInterval === "year" ? 12 : 1; // mensuel par défaut
      for (let i = 1; i <= remaining; i++) {
        schedule.push({
          id: `inst-${plan.id}-f${i}`,
          dueDate: addMonthsISO(lastDate, i * interval),
          amount: plan.planAmount,
          paid: false,
          method: null,
        });
      }
    }

    const total = schedule.reduce((a, s) => a + s.amount, 0);
    const isBadName = (n) => !n || /^(client|date de la transaction)$/i.test(String(n).trim());
    const client = evs.map((e) => e.name).find((n) => !isBadName(n)) || c.email || "Client";
    return {
      id: `sio-${slug(c.email || c.name || idx)}`,
      client,
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
