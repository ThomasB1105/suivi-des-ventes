/* eslint-disable */
// « Qui est qui » (ADMIN) : correspondance entre les noms bruts venant de
// Calendly (hôtes) / iClosed (closers) et les comptes de l'équipe.
//   GET  /api/aliases  -> { aliases:{raw->nom}, detected:[{name, sources, count}] }
//   POST /api/aliases  -> { raw, to }   (to vide = supprimer la correspondance)
// Les alias sont appliqués partout (board, stats, commissions) via buildLeads.

const { cmd, isConfigured } = require("../lib/kv");
const { checkAuth } = require("../lib/auth");
const { DEFAULT_ALIASES, loadAliases, buildRoleMap } = require("../lib/crmData");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-token");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (!checkAuth(req)) { res.status(401).json({ error: "Non autorisé (admin uniquement)." }); return; }
  if (!isConfigured()) { res.status(500).json({ error: "Base KV non configurée." }); return; }

  try {
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
      const raw = String((body && body.raw) || "").trim();
      if (!raw) { res.status(400).json({ error: "raw manquant." }); return; }
      const to = String((body && body.to) || "").trim();
      const role = ["setter", "closer"].includes(body && body.role) ? body.role : "";
      if (to || role) await cmd(["HSET", "crm:aliases", raw.toLowerCase(), JSON.stringify({ to, role })]);
      else await cmd(["HDEL", "crm:aliases", raw.toLowerCase()]);
      res.status(200).json({ ok: true, raw: raw.toLowerCase(), to: to || null, role: role || null });
      return;
    }

    // GET : alias existants ({to, role}) + noms bruts détectés (AVANT résolution)
    const aliases = await loadAliases(cmd);
    const roleMap = await buildRoleMap(cmd);

    const detected = {}; // rawLower -> { name, sources:Set, count }
    const add = (name, source) => {
      const k = String(name || "").trim();
      if (!k) return;
      const kl = k.toLowerCase();
      if (!detected[kl]) detected[kl] = { name: k, sources: new Set(), count: 0 };
      detected[kl].sources.add(source);
      detected[kl].count += 1;
    };

    const scanHash = async (key, fields, source) => {
      const flat = (await cmd(["HGETALL", key])) || [];
      for (let i = 1; i < flat.length; i += 2) {
        try { const o = JSON.parse(flat[i]); fields.forEach((f) => add(o[f], source)); } catch {}
      }
    };
    await scanHash("crm:leads", ["setter", "closer"], "calendly");
    await scanHash("iclosed:calls_h", ["closer"], "iclosed");
    await scanHash("iclosed:contacts", ["closer"], "iclosed");

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      aliases,
      detected: Object.entries(detected)
        .map(([kl, d]) => ({
          raw: kl, name: d.name, sources: [...d.sources], count: d.count,
          to: (aliases[kl] && aliases[kl].to) || "",
          role: (aliases[kl] && aliases[kl].role) || roleMap[kl] || "",
        }))
        .sort((a, b) => b.count - a.count),
    });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
