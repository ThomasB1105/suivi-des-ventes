/* eslint-disable */
// Reporting closers complet à partir des appels iClosed (iclosed:calls).
//   GET /api/closers -> stats funnel/outcomes/no-sale/objections/closers/events/questions

const { cmd, isConfigured } = require("../lib/kv");
const { checkAuth } = require("../lib/auth");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-token");
  if (!checkAuth(req)) { res.status(401).json({ error: "Non autorisé." }); return; }
  if (!isConfigured()) { res.status(200).json({ totalCalls: 0, configured: false }); return; }

  try {
    const raw = (await cmd(["LRANGE", "iclosed:calls", "0", "4999"])) || [];
    const hashRaw = (await cmd(["HGETALL", "iclosed:calls_h"])) || [];
    const byId = new Map();
    const add = (c) => { const k = c.id || `${c.email}|${c.date}|${c.status}`; byId.set(k, c); };
    raw.forEach((s) => { try { add(JSON.parse(s)); } catch {} });
    for (let i = 1; i < hashRaw.length; i += 2) { try { add(JSON.parse(hashRaw[i])); } catch {} }
    const calls = [...byId.values()];

    const tally = {};
    const bump = (obj, key, n = 1) => { const k = key || "—"; obj[k] = (obj[k] || 0) + n; };

    const out = { won: 0, lost: 0, pending: 0, noshow: 0, cancelled: 0, rescheduled: 0, booked: 0, show: 0, other: 0 };
    const byCloser = {};
    const byEvent = {};
    const reasons = {};
    const objections = {};
    const qmap = {};
    let revenue = 0;

    calls.forEach((c) => {
      const st = c.status || "other";
      if (out[st] !== undefined) out[st] += 1; else out.other += 1;
      if (st === "won") revenue += Number(c.amount || 0);

      // par closer
      const ck = c.closer || "Non attribué";
      if (!byCloser[ck]) byCloser[ck] = { closer: ck, calls: 0, won: 0, lost: 0, noshow: 0, show: 0, pending: 0, cancelled: 0, revenue: 0 };
      const g = byCloser[ck];
      g.calls += 1;
      if (g[st] !== undefined) g[st] += 1;
      if (st === "won") g.revenue += Number(c.amount || 0);

      // par événement
      if (c.event) {
        if (!byEvent[c.event]) byEvent[c.event] = { event: c.event, booked: 0, rescheduled: 0, cancelled: 0, won: 0 };
        const e = byEvent[c.event];
        e.booked += 1;
        if (st === "rescheduled") e.rescheduled += 1;
        if (st === "cancelled") e.cancelled += 1;
        if (st === "won") e.won += 1;
      }

      if (st === "lost" && c.reason) bump(reasons, c.reason);
      if (c.objection) bump(objections, c.objection);

      // conversion par réponse
      if (c.answers && typeof c.answers === "object") {
        Object.entries(c.answers).forEach(([q, a]) => {
          const ans = String(a == null ? "—" : a);
          if (!qmap[q]) qmap[q] = {};
          if (!qmap[q][ans]) qmap[q][ans] = { answer: ans, n: 0, won: 0 };
          qmap[q][ans].n += 1;
          if (st === "won") qmap[q][ans].won += 1;
        });
      }
    });

    const held = out.won + out.lost + out.show;        // appels honorés
    const heldOrNo = held + out.noshow;
    const closers = Object.values(byCloser).map((g) => ({
      ...g,
      showRate: (g.won + g.lost + g.show + g.noshow) ? (g.won + g.lost + g.show) / (g.won + g.lost + g.show + g.noshow) : 0,
      closingRate: (g.won + g.lost) ? g.won / (g.won + g.lost) : 0,
    })).sort((a, b) => b.revenue - a.revenue || b.won - a.won);

    const toArr = (obj) => Object.entries(obj).map(([k, v]) => ({ label: k, n: v })).sort((a, b) => b.n - a.n);
    const questions = Object.entries(qmap).map(([q, ans]) => ({
      question: q,
      answers: Object.values(ans).map((a) => ({ ...a, rate: a.n ? a.won / a.n : 0 })).sort((x, y) => y.n - x.n),
    }));

    res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=120");
    res.status(200).json({
      totalCalls: calls.length,
      outcomes: out,
      totals: {
        scheduled: calls.length,
        sales: out.won, noSale: out.lost, pending: out.pending,
        showRate: heldOrNo ? held / heldOrNo : 0,
        noShowRate: heldOrNo ? out.noshow / heldOrNo : 0,
        closingRate: (out.won + out.lost) ? out.won / (out.won + out.lost) : 0,
        revenue,
      },
      closers,
      events: Object.values(byEvent).sort((a, b) => b.booked - a.booked),
      reasons: toArr(reasons),
      objections: toArr(objections),
      questions,
    });
  } catch (e) {
    res.status(200).json({ totalCalls: 0, error: String(e.message || e) });
  }
};
