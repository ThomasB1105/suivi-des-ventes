/* eslint-disable */
// CRM : agrège les calls (Calendly + iClosed) et les ventes.
//   GET  /api/crm  -> { leads:[...], me:{role,name} }
//   POST /api/crm  -> mise à jour d'un lead { email, stage?, setter?, closer?, notes? }
//
// Cloisonnement : l'admin voit tout ; un closer/setter ne voit et ne modifie
// QUE les lignes qui lui sont assignées (closer===son nom / setter===son nom).

const { cmd, isConfigured } = require("../lib/kv");
const { identify } = require("../lib/auth");
const { buildLeads, STAGES, isPerson } = require("../lib/crmData");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-token");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (!isConfigured()) { res.status(200).json({ leads: [], configured: false }); return; }

  const me = await identify(req, cmd);
  if (!me) { res.status(401).json({ error: "Non autorisé." }); return; }
  const isAdmin = me.role === "admin";
  const myField = me.role === "setter" ? "setter" : "closer";

  try {
    // ---- Mise à jour d'un lead ----
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
      const email = String((body && body.email) || "").toLowerCase();
      if (!email) { res.status(400).json({ error: "Email manquant." }); return; }

      // Un membre d'équipe ne peut toucher qu'à SES lignes.
      if (!isAdmin) {
        const rows = await buildLeads(cmd);
        const row = rows.find((l) => l.email === email);
        if (!row || !isPerson(row[myField], me.name)) { res.status(403).json({ error: "Lead non assigné à ton compte." }); return; }
        // et ne peut pas se réassigner les leads des autres
        delete body.closer; delete body.setter;
      }

      let lead = null;
      try { const s = await cmd(["HGET", "crm:leads", email]); lead = s ? JSON.parse(s) : null; } catch {}
      if (!lead) lead = { email, createdAt: new Date().toISOString(), history: [] };
      if (body.stage !== undefined && STAGES.includes(body.stage)) { lead.stage = body.stage; lead.manualStage = true; }
      if (body.setter !== undefined) lead.setter = String(body.setter || "") || undefined;
      if (body.closer !== undefined) lead.closer = String(body.closer || "") || undefined;
      if (body.notes !== undefined) lead.notes = String(body.notes || "") || undefined;
      if (body.autoStage === true) lead.manualStage = false;
      lead.updatedAt = new Date().toISOString();
      lead.history = [...(lead.history || []), { at: lead.updatedAt, type: "edit", label: `Mise à jour (${me.name})` }].slice(-12);
      await cmd(["HSET", "crm:leads", email, JSON.stringify(lead)]);
      res.status(200).json({ ok: true, lead });
      return;
    }

    // ---- Lecture du board ----
    let leads = await buildLeads(cmd);
    if (!isAdmin) leads = leads.filter((l) => isPerson(l[myField], me.name));

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ leads, me: { role: me.role, name: me.name } });
  } catch (e) {
    res.status(200).json({ leads: [], error: String(e.message || e) });
  }
};
