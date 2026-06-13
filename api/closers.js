/* eslint-disable */
// Stats closers à partir des appels iClosed (iclosed:calls).
//   GET /api/closers   -> { closers:[...], questions:[...], totalCalls }

const { cmd, isConfigured } = require("../lib/kv");
const { checkAuth } = require("../lib/auth");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-token");
  if (!checkAuth(req)) { res.status(401).json({ error: "Non autorisé." }); return; }
  if (!isConfigured()) { res.status(200).json({ closers: [], questions: [], totalCalls: 0, configured: false }); return; }

  try {
    const raw = (await cmd(["LRANGE", "iclosed:calls", "0", "4999"])) || [];
    const calls = [];
    raw.forEach((s) => { try { calls.push(JSON.parse(s)); } catch {} });

    const byCloser = {};
    const qmap = {}; // question -> answer -> {n, won}
    calls.forEach((c) => {
      const k = c.closer || "Non attribué";
      if (!byCloser[k]) byCloser[k] = { closer: k, calls: 0, show: 0, noshow: 0, won: 0, lost: 0, cancelled: 0, booked: 0 };
      const g = byCloser[k];
      g.calls += 1;
      if (g[c.status] !== undefined) g[c.status] += 1;
      const showed = c.status === "won" || c.status === "lost" || c.status === "show";
      // réponses aux questions
      if (c.answers && typeof c.answers === "object") {
        Object.entries(c.answers).forEach(([q, a]) => {
          const ans = String(a == null ? "—" : a);
          if (!qmap[q]) qmap[q] = {};
          if (!qmap[q][ans]) qmap[q][ans] = { answer: ans, n: 0, won: 0 };
          qmap[q][ans].n += 1;
          if (c.status === "won") qmap[q][ans].won += 1;
        });
      }
    });

    const closers = Object.values(byCloser).map((g) => {
      const showed = g.won + g.lost + g.show;
      const heldOrNo = showed + g.noshow;
      return {
        ...g,
        showRate: heldOrNo ? showed / heldOrNo : 0,
        noShowRate: heldOrNo ? g.noshow / heldOrNo : 0,
        closingRate: (g.won + g.lost) ? g.won / (g.won + g.lost) : 0,
      };
    }).sort((a, b) => b.won - a.won);

    const questions = Object.entries(qmap).map(([q, answers]) => ({
      question: q,
      answers: Object.values(answers).map((a) => ({ ...a, rate: a.n ? a.won / a.n : 0 })).sort((x, y) => y.n - x.n),
    }));

    res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=120");
    res.status(200).json({ closers, questions, totalCalls: calls.length });
  } catch (e) {
    res.status(200).json({ closers: [], questions: [], totalCalls: 0, error: String(e.message || e) });
  }
};
