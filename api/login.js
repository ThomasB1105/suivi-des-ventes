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

  // ---- Compte équipe (identifiant OU prénom + mot de passe personnel) ----
  if (username) {
    if (!isConfigured()) { res.status(500).json({ ok: false, error: "Base KV non configurée." }); return; }
    try {
      // Tolérance de saisie : accents et majuscules ignorés, et on accepte
      // aussi bien l'identifiant du compte que son nom affiché (prénom).
      const norm = (x) => String(x || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
      let key = username.toLowerCase();
      let s = await cmd(["HGET", "app:users", key]);
      if (!s) {
        const flat = (await cmd(["HGETALL", "app:users"])) || [];
        for (let i = 0; i < flat.length; i += 2) {
          try {
            const u2 = JSON.parse(flat[i + 1]);
            if (norm(flat[i]) === norm(username) || norm(u2.name) === norm(username)) { key = flat[i]; s = flat[i + 1]; break; }
          } catch {}
        }
      }
      if (!s) { res.status(401).json({ ok: false, error: "Compte inconnu — vérifie l'identifiant créé dans Équipe." }); return; }
      const u = JSON.parse(s);
      // Le hash est salé avec l'IDENTIFIANT du compte (sa clé), pas la saisie.
      if (u.hash !== userHash(key, password)) { res.status(401).json({ ok: false, error: "Mot de passe invalide." }); return; }
      const t = userToken(key, u.hash);
      await cmd(["HSET", "app:sessions", t, JSON.stringify({ name: u.name || key, role: u.role || "closer" })]);
      res.status(200).json({ ok: true, token: t, role: u.role || "closer", name: u.name || key });
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
