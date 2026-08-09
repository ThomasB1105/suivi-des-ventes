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
const { checkAuth } = require("../lib/auth");

const slug = (s) => String(s || "").replace(/[^a-z0-9]/gi, "").slice(0, 40).toLowerCase();
const pad = (n) => String(n).padStart(2, "0");
const addMonthsISO = (iso, n) => {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  if (!y) return iso;
  const dt = new Date(y, (m - 1) + n, d || 1);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
};

// Libellés d'offre "génériques" (processeur) qu'on ne veut PAS garder si une
// vraie offre existe pour le même client (ex. un acompte Stripe hérite de
// l'offre systeme.io via l'email).
const GENERIC_OFFER = /^(stripe|whop|import|client|—|-|)$/i;

function groupIntoSales(events) {
  const byClient = {};
  events.filter((e) => Number(e.amount) > 0).forEach((e) => {
    const key = (e.email || e.name || e.id || "").toLowerCase();
    if (!byClient[key]) byClient[key] = { email: e.email, name: e.name, offer: e.offer, events: [] };
    byClient[key].events.push(e);
    // On matche l'email à la vraie offre : une offre réelle prime sur "Stripe"/"Whop".
    if (e.offer && !GENERIC_OFFER.test(String(e.offer).trim())) byClient[key].offer = e.offer;
  });

  return Object.values(byClient).map((c, idx) => {
    // Déduplication cross-source : un même paiement peut arriver via systeme.io
    // (import/webhook) ET via Stripe/Whop (systeme.io encaisse d'ailleurs via Stripe).
    // On dédoublonne par MÊME MONTANT à ±1 jour (Stripe date en UTC, systeme.io en
    // local → parfois un jour d'écart pour la même transaction). En cas de doublon,
    // on garde l'enregistrement le plus riche (celui qui porte le plan échelonné).
    const cents = (e) => Math.round((Number(e.amount) || 0) * 100);
    const dayNum = (e) => { const [y, m, d] = String(e.date || "").split("-").map(Number); return y ? Math.round(Date.UTC(y, m - 1, d || 1) / 864e5) : NaN; };
    const richer = (a, b) => (((b.planCount > 1 ? 2 : 0) + (b.planAmount > 0 ? 1 : 0)) > ((a.planCount > 1 ? 2 : 0) + (a.planAmount > 0 ? 1 : 0)) ? b : a);
    const kept = [];
    c.events
      .filter((e) => e.status !== "cancelled")
      .sort((a, b) => String(a.date).localeCompare(String(b.date)))
      .forEach((e) => {
        const dn = dayNum(e), ct = cents(e);
        const i = kept.findIndex((k) => cents(k) === ct && Math.abs(dayNum(k) - dn) <= 1);
        if (i === -1) kept.push(e);
        else kept[i] = richer(kept[i], e);   // même paiement en double -> on garde le plus complet
      });
    const evs = kept.sort((a, b) => String(a.date).localeCompare(String(b.date)));

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
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-token");
  if (!checkAuth(req)) { res.status(401).json({ error: "Non autorisé." }); return; }
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

    // Enrichissement iClosed (closer + source/canal) par email.
    try {
      const icFlat = (await cmd(["HGETALL", "iclosed:contacts"])) || [];
      const ic = {};
      for (let i = 0; i < icFlat.length; i += 2) { try { ic[icFlat[i]] = JSON.parse(icFlat[i + 1]); } catch {} }
      if (Object.keys(ic).length) {
        sales.forEach((s) => {
          const m = ic[(s.email || "").toLowerCase()];
          if (m) {
            if (m.closer) s.closer = m.closer;
            if (m.source) s.source = m.source;
            if (m.channel) s.channel = m.channel;
          }
        });
      }
    } catch (e) { /* iClosed optionnel */ }

    res.setHeader("Cache-Control", "s-maxage=10, stale-while-revalidate=60");
    res.status(200).json({ sales, count: sales.length, events: events.length, syncedAt: new Date().toISOString() });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
