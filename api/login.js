/* eslint-disable */
// Vérifie le mot de passe et renvoie un token de session.
//   POST /api/login  body:{ password }

const { token } = require("../lib/auth");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (req.method !== "POST") { res.status(405).json({ ok: false }); return; }

  // Pas de mot de passe configuré → accès ouvert.
  if (!process.env.APP_PASSWORD) { res.status(200).json({ ok: true, token: "", open: true }); return; }

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  body = body || {};

  if (String(body.password || "") === String(process.env.APP_PASSWORD)) {
    res.status(200).json({ ok: true, token: token() });
  } else {
    res.status(401).json({ ok: false });
  }
};
