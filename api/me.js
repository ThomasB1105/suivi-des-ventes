/* eslint-disable */
// Espace personnel d'un membre d'équipe (closer/setter) — et de l'admin.
//   GET /api/me -> { me:{role,name}, rate, stats:{calls, showed, noshow, won,
//                    revenue, showRate, closingRate, commission} }
// Les stats sont calculées sur les leads assignés à la personne.

const { cmd, isConfigured } = require("../lib/kv");
const { identify } = require("../lib/auth");
const { buildLeads, personStats } = require("../lib/crmData");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-token");
  if (!isConfigured()) { res.status(200).json({ me: null, configured: false }); return; }
  const me = await identify(req, cmd);
  if (!me) { res.status(401).json({ error: "Non autorisé." }); return; }

  try {
    if (me.role === "admin") { res.status(200).json({ me, rate: 0, stats: null }); return; }
    // taux de commission depuis le compte
    let rate = 0;
    try {
      const flat = (await cmd(["HGETALL", "app:users"])) || [];
      for (let i = 0; i < flat.length; i += 2) {
        try { const u = JSON.parse(flat[i + 1]); if (String(u.name || flat[i]).toLowerCase() === String(me.name).toLowerCase()) { rate = u.rate || 0; break; } } catch {}
      }
    } catch {}
    const leads = await buildLeads(cmd);
    const stats = personStats(leads, me.name, me.role, rate);
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ me, rate, stats });
  } catch (e) {
    res.status(200).json({ me, error: String(e.message || e) });
  }
};
