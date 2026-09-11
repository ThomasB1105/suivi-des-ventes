/* eslint-disable */
// Connexion.
//   POST /api/login  body:{ password }            -> admin (APP_PASSWORD)
//   POST /api/login  body:{ username, password }  -> compte équipe (closer/setter)
// Réponse : { ok, token, role, name }

const { token, userHash, userToken } = require("../lib/auth");
const { cmd, isConfigured } = require("../lib/kv");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ ok: false }); return; }

  // Pas de mot de passe configuré → accès ouvert (admin).
  if (!process.env.APP_PASSWORD) { res.status(200).json({ ok: true, token: "", role: "admin", name: "Admin", open: true }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};
  const username = String(body.username || "").trim();
  const password = String(body.password || "");

  // ---- Compte équipe (nom + mot de passe personnel) ----
  if (username) {
    if (!isConfigured()) { res.status(500).json({ ok: false, error: "Base KV non configurée." }); return; }
    try {
      const s = await cmd(["HGET", "app:users", username.toLowerCase()]);
      if (!s) { res.status(401).json({ ok: false, error: "Compte inconnu." }); return; }
      const u = JSON.parse(s);
      if (u.hash !== userHash(username, password)) { res.status(401).json({ ok: false, error: "Mot de passe invalide." }); return; }
      const t = userToken(username, u.hash);
      await cmd(["HSET", "app:sessions", t, JSON.stringify({ name: u.name || username, role: u.role || "closer" })]);
      res.status(200).json({ ok: true, token: t, role: u.role || "closer", name: u.name || username });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e.message || e) });
    }
    return;
  }

  // ---- Admin (mot de passe partagé, comme avant) ----
  if (password === String(process.env.APP_PASSWORD)) {
    res.status(200).json({ ok: true, token: token(), role: "admin", name: "Admin" });
  } else {
    res.status(401).json({ ok: false });
  }
};
