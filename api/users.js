/* eslint-disable */
// Gestion des comptes équipe (ADMIN uniquement).
//   GET    /api/users                -> liste + stats/commissions calculées
//   POST   /api/users                -> { username, name?, role, password?, rate? } crée/modifie
//   DELETE /api/users?username=xxx   -> supprime le compte (et sa session)
//
// rate = % de commission sur le revenu encaissé de ses deals.

const { cmd, isConfigured } = require("../lib/kv");
const { checkAuth, userHash, userToken } = require("../lib/auth");
const { buildLeads, personStats } = require("../lib/crmData");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-token");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (!checkAuth(req)) { res.status(401).json({ error: "Non autorisé (admin uniquement)." }); return; }
  if (!isConfigured()) { res.status(500).json({ error: "Base KV non configurée." }); return; }

  try {
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
      body = body || {};
      const username = String(body.username || "").trim().toLowerCase();
      if (!username) { res.status(400).json({ error: "username manquant." }); return; }
      let u = null;
      try { const s = await cmd(["HGET", "app:users", username]); u = s ? JSON.parse(s) : null; } catch {}
      if (!u) u = { createdAt: new Date().toISOString() };
      if (body.name !== undefined) u.name = String(body.name || username);
      if (!u.name) u.name = String(body.username).trim();
      if (body.role !== undefined) u.role = body.role === "setter" ? "setter" : "closer";
      if (!u.role) u.role = "closer";
      if (body.rate !== undefined) u.rate = Math.max(0, Math.min(100, Number(body.rate) || 0));
      if (body.autoAssign !== undefined) u.autoAssign = !!body.autoAssign;
      if (body.password) {
        // nouveau mot de passe -> nouvelle empreinte + invalidation de l'ancienne session
        if (u.hash) { try { await cmd(["HDEL", "app:sessions", userToken(username, u.hash)]); } catch {} }
        u.hash = userHash(username, String(body.password));
      }
      if (!u.hash) { res.status(400).json({ error: "Mot de passe requis pour un nouveau compte." }); return; }
      await cmd(["HSET", "app:users", username, JSON.stringify(u)]);
      res.status(200).json({ ok: true, username, user: { name: u.name, role: u.role, rate: u.rate || 0 } });
      return;
    }

    if (req.method === "DELETE") {
      const username = String((req.query && req.query.username) || "").trim().toLowerCase();
      if (!username) { res.status(400).json({ error: "username manquant." }); return; }
      try { const s = await cmd(["HGET", "app:users", username]); const u = s ? JSON.parse(s) : null; if (u && u.hash) await cmd(["HDEL", "app:sessions", userToken(username, u.hash)]); } catch {}
      await cmd(["HDEL", "app:users", username]);
      res.status(200).json({ ok: true, deleted: username });
      return;
    }

    // GET : liste + stats
    const flat = (await cmd(["HGETALL", "app:users"])) || [];
    const users = [];
    for (let i = 0; i < flat.length; i += 2) { try { users.push({ username: flat[i], ...JSON.parse(flat[i + 1]) }); } catch {} }
    const leads = await buildLeads(cmd);
    const out = users.map((u) => ({
      username: u.username,
      name: u.name || u.username,
      role: u.role || "closer",
      rate: u.rate || 0,
      autoAssign: u.autoAssign !== false,
      createdAt: u.createdAt,
      stats: personStats(leads, u.name || u.username, u.role || "closer", u.rate || 0),
    }));
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ users: out });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
};
