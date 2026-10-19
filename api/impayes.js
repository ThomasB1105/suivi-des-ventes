/* eslint-disable */
// Impayés pour les setters (relances) + notes de suivi partagées.
//   GET  /api/impayes -> { items:[{ id, saleId, client, email, phone, amount, dueDate,
//                          closer, setter, offer, leadEmail }], leads:{email->fiche},
//                          notes:{saleId->[{at, by, text}]} }
//   POST /api/impayes { saleId, text } -> ajoute une note de suivi
//
// Source : l'état des ventes tel que corrigé par l'admin (app:state : overlay,
// échéances marquées payées, ventes supprimées) -> mêmes impayés que l'onglet
// admin. Ne renvoie QUE les échéances en retard, sans le reste des finances.
// Notes : hash crm:impnotes (saleId -> liste JSON), partagées admin / setters.
// Accès : admin, setter, setter DM.

const { cmd, isConfigured } = require("../lib/kv");
const { identify } = require("../lib/auth");
const { buildLeads } = require("../lib/crmData");

const parisToday = () => new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const normPhone = (p) => { const d = String(p || "").replace(/\D/g, ""); return d.length >= 8 ? d.slice(-9) : ""; };
// Champs de la fiche CRM utiles à la relance (lecture seule pour les setters).
const LEAD_KEYS = ["email", "name", "phone", "closer", "setter", "dmSetter", "stage", "source", "campaign", "bookedAt", "bookedEvent", "callAt", "lastCall", "answers", "notes", "fathom", "links", "history", "showUp", "callResult", "followUp", "followUpAt", "setStatus", "hasCall"];

async function readNotes() {
  const out = {};
  try {
    const flat = (await cmd(["HGETALL", "crm:impnotes"])) || [];
    for (let i = 0; i < flat.length; i += 2) { try { out[flat[i]] = JSON.parse(flat[i + 1]) || []; } catch (e) { /* ignore */ } }
  } catch (e) { /* vide */ }
  return out;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-token");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (!isConfigured()) { res.status(200).json({ items: [], leads: {}, notes: {} }); return; }
  const me = await identify(req, cmd);
  if (!me || !["admin", "setter", "setter_dm"].includes(me.role)) { res.status(401).json({ error: "Non autorisé." }); return; }

  try {
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
      body = body || {};
      const saleId = String(body.saleId || "").trim();
      const text = String(body.text || "").trim().slice(0, 1000);
      if (!saleId || !text) { res.status(400).json({ error: "Vente ou note manquante." }); return; }
      let list = [];
      try { const s = await cmd(["HGET", "crm:impnotes", saleId]); list = s ? JSON.parse(s) || [] : []; } catch (e) { list = []; }
      const note = { at: new Date().toISOString(), by: me.role === "admin" ? "Admin" : me.name, text };
      list = [...list, note].slice(-50);
      await cmd(["HSET", "crm:impnotes", saleId, JSON.stringify(list)]);
      res.status(200).json({ ok: true, saleId, notes: list });
      return;
    }

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
    const leadOut = {};
    sales.forEach((s) => {
      const lead = byEmail[String(s.email || "").toLowerCase()] || byPhone[normPhone(s.phone)] || null;
      (Array.isArray(s.schedule) ? s.schedule : []).forEach((i) => {
        if (!i || i.paid || i.cancelled || i.refunded) return;
        const due = String(i.dueDate || "").slice(0, 10);
        if (!due || due >= today) return;
        if (!(Number(i.amount) > 0)) return;
        if (lead && !leadOut[lead.email]) {
          leadOut[lead.email] = { ...Object.fromEntries(LEAD_KEYS.filter((k) => lead[k] !== undefined).map((k) => [k, lead[k]])), shared: true };
        }
        items.push({
          id: `${s.id}|${i.id}`,
          saleId: s.id,
          client: s.client || (lead && lead.name) || s.email || "—",
          email: s.email || (lead && lead.email) || "",
          phone: s.phone || (lead && lead.phone) || "",
          amount: Number(i.amount) || 0,
          dueDate: due,
          closer: (lead && lead.closer) || (s.closer && s.closer !== "—" ? s.closer : ""),
          setter: (lead && lead.setter) || (s.setter && s.setter !== "—" ? s.setter : ""),
          offer: s.offer || "",
          leadEmail: lead ? lead.email : "",
        });
      });
    });
    items.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    const allNotes = await readNotes();
    const saleIds = new Set(items.map((i) => i.saleId));
    // Setters : notes des impayés en cours uniquement. Admin : toutes.
    const notes = me.role === "admin" ? allNotes : Object.fromEntries(Object.entries(allNotes).filter(([k]) => saleIds.has(k)));
    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ items, leads: leadOut, notes, today });
  } catch (e) {
    res.status(200).json({ items: [], leads: {}, notes: {}, error: String(e.message || e) });
  }
};
