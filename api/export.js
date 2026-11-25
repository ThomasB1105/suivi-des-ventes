/* eslint-disable */
// Export brut des données (migration de CRM). Lecture seule, ADMIN uniquement.
//   GET /api/export            -> liste des jeux de données disponibles
//   GET /api/export?key=<nom>  -> contenu brut du jeu de données
// Les comptes équipe (app:users, mots de passe) ne sont jamais exportés.

const { cmd, isConfigured } = require("../lib/kv");
const { checkAuth } = require("../lib/auth");

const HASHES = {
  leads: "crm:leads",                 // fiches CRM brutes (email -> fiche)
  iclosed_calls: "iclosed:calls_h",   // calls iClosed complets (id -> call)
  iclosed_contacts: "iclosed:contacts",
  sale_links: "crm:salelinks",        // rattachements manuels paiement -> fiche
  unpaid_notes: "crm:impnotes",       // notes de relance des impayés
  payments: "sales:events",           // paiements bruts (Stripe, Whop, Systeme.io)
};

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-token");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (!checkAuth(req)) { res.status(401).json({ error: "Non autorisé." }); return; }
  if (!isConfigured()) { res.status(200).json({ configured: false }); return; }
  const key = String((req.query && req.query.key) || "");
  if (!key) { res.status(200).json({ keys: Object.keys(HASHES) }); return; }
  if (!HASHES[key]) { res.status(400).json({ error: "Jeu de données inconnu." }); return; }
  try {
    const flat = (await cmd(["HGETALL", HASHES[key]])) || [];
    const data = {};
    for (let i = 0; i < flat.length; i += 2) { try { data[flat[i]] = JSON.parse(flat[i + 1]); } catch (e) { data[flat[i]] = flat[i + 1]; } }
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ key, count: Object.keys(data).length, data });
  } catch (e) {
    res.status(500).json({ error: "Lecture impossible." });
  }
};
