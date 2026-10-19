/* eslint-disable */
// Impayés pour les setters (relances).
//   GET /api/impayes -> { items:[{ id, client, email, phone, amount, dueDate, closer, setter, offer }] }
//
// Source : l'état des ventes tel que corrigé par l'admin (app:state : overlay,
// échéances marquées payées, ventes supprimées) -> mêmes impayés que l'onglet
// admin. Ne renvoie QUE les échéances en retard, sans le reste des finances.
// Accès : admin, setter, setter DM.

const { cmd, isConfigured } = require("../lib/kv");
const { identify } = require("../lib/auth");
const { buildLeads } = require("../lib/crmData");

const parisToday = () => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const normPhone = (p) => { const d = String(p || "").replace(/\D/g, ""); return d.length >= 8 ? d.slice(-9) : ""; };

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-token");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (!isConfigured()) { res.status(200).json({ items: [] }); return; }
  const me = await identify(req, cmd);
  if (!me || !["admin", "setter", "setter_dm"].includes(me.role)) { res.status(401).json({ error: "Non autorisé." }); return; }

  try {
    let state = {};
    try { const raw = await cmd(["GET", "app:state"]); if (raw) state = JSON.parse(raw) || {}; } catch (e) { /* vide */ }
    const deleted = new Set(Array.isArray(state.deletedSales) ? state.deletedSales : []);
    const sales = (Array.isArray(state.sales) ? state.sales : []).filter((s) => s && !deleted.has(s.id));

    // Fiche CRM (téléphone, closer, setter) par email de paiement / téléphone.
    let leads = [];
    try { leads = await buildLeads(cmd); } catch (e) { leads = []; }
    const byEmail = {}, byPhone = {};
    leads.forEach((l) => {
      [l.email, ...(l.saleEmails || [])].forEach((em) => { const k = String(em || "").toLowerCase(); if (k && !byEmail[k]) byEmail[k] = l; });
      const ph = normPhone(l.phone); if (ph && !byPhone[ph]) byPhone[ph] = l;
    });

    const today = parisToday();
    const items = [];
    sales.forEach((s) => {
      const lead = byEmail[String(s.email || "").toLowerCase()] || byPhone[normPhone(s.phone)] || null;
      (Array.isArray(s.schedule) ? s.schedule : []).forEach((i) => {
        if (!i || i.paid || i.cancelled || i.refunded) return;
        const due = String(i.dueDate || "").slice(0, 10);
        if (!due || due >= today) return;
        if (!(Number(i.amount) > 0)) return;
        items.push({
          id: `${s.id}|${i.id}`,
          client: s.client || (lead && lead.name) || s.email || "—",
          email: s.email || (lead && lead.email) || "",
          phone: s.phone || (lead && lead.phone) || "",
          amount: Number(i.amount) || 0,
          dueDate: due,
          closer: (lead && lead.closer) || (s.closer && s.closer !== "—" ? s.closer : ""),
          setter: (lead && lead.setter) || (s.setter && s.setter !== "—" ? s.setter : ""),
          offer: s.offer || "",
        });
      });
    });
    items.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ items, today });
  } catch (e) {
    res.status(200).json({ items: [], error: String(e.message || e) });
  }
};
