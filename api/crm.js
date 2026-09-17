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
  // Un membre voit SES leads, qu'il soit dans la colonne closer OU setter
  // (un rôle mal configuré dans le matching ne doit pas vider son espace).
  // Un SETTER voit aussi les leads entrants pas encore attribués : les
  // entrants à traiter ne doivent jamais rester invisibles.
  const isMine = (l) => isPerson(l.closer, me.name) || isPerson(l.setter, me.name)
    || (me.role === "setter" && !l.setter && l.hasCall === false);
  // Le compte « Saphia » (récup) voit tous les calls pris non closés.
  const normName = String(me.name || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  const isRecup = normName === "saphia";
  const canSee = (l) => isMine(l) || (isRecup && l.hasCall !== false && l.stage !== "won");

  try {
    // ---- Mise à jour d'un lead ----
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }

      // ---- Attribution EN MASSE (admin) : tous les calls d'aujourd'hui et à
      // venir -> un setter/closer donné. { bulkAssign: { role, name } } ----
      if (isAdmin && body && body.bulkAssign) {
        const role = body.bulkAssign.role === "closer" ? "closer" : "setter";
        const nm = String(body.bulkAssign.name || "").trim();
        if (!nm) { res.status(400).json({ error: "Nom manquant." }); return; }
        // « aujourd'hui » au sens heure de Paris (les dates plateformes sont en UTC)
        const parisDay = (v) => {
          const str = String(v || "");
          if (!str) return "";
          if (!/([zZ]|[+-]\d{2}:?\d{2})$/.test(str)) return str.slice(0, 10);
          const d = new Date(str.replace(/\.(\d{3})\d+/, ".$1"));
          if (isNaN(d)) return str.slice(0, 10);
          return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
        };
        const today = new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
        const rows = await buildLeads(cmd);
        // scope "optins" : les leads VSL/formulaire SANS call et sans setter.
        // scope par défaut : les calls d'aujourd'hui et à venir.
        const scope = body.bulkAssign.scope === "optins" ? "optins" : "upcoming";
        const targets = rows.filter((l) => {
          if (scope === "optins") return l.hasCall === false && !["unqualified", "dead"].includes(l.stage) && !l.setter;
          if (l.hasCall === false || ["won", "lost"].includes(l.stage)) return false;
          const d = parisDay((l.lastCall && l.lastCall.date) || l.bookedAt);
          return d && d >= today;
        }).slice(0, 300);
        let updated = 0;
        for (const t of targets) {
          let lead = null;
          try { const s = await cmd(["HGET", "crm:leads", t.email]); lead = s ? JSON.parse(s) : null; } catch {}
          if (!lead) lead = { email: t.email, createdAt: new Date().toISOString(), history: [] };
          if (String(lead[role] || "") === nm) continue;
          lead[role] = nm;
          lead[role + "Auto"] = false; // choix admin : la synchro ne l'écrase pas
          lead.updatedAt = new Date().toISOString();
          lead.history = [...(lead.history || []), { at: lead.updatedAt, type: "assign", label: `Attribué à ${nm} (attribution en masse)` }].slice(-12);
          await cmd(["HSET", "crm:leads", t.email, JSON.stringify(lead)]);
          updated += 1;
        }
        res.status(200).json({ ok: true, updated, matched: targets.length, name: nm, role });
        return;
      }

      const email = String((body && body.email) || "").toLowerCase();
      if (!email) { res.status(400).json({ error: "Email manquant." }); return; }

      // Un membre d'équipe ne peut toucher qu'à SES lignes.
      if (!isAdmin) {
        const rows = await buildLeads(cmd);
        const row = rows.find((l) => l.email === email);
        if (!row || !canSee(row)) { res.status(403).json({ error: "Lead non assigné à ton compte." }); return; }
        // et ne peut pas se réassigner les leads des autres
        delete body.closer; delete body.setter;
      }

      let lead = null;
      try { const s = await cmd(["HGET", "crm:leads", email]); lead = s ? JSON.parse(s) : null; } catch {}
      if (!lead) lead = { email, createdAt: new Date().toISOString(), history: [] };
      if (body.stage !== undefined && STAGES.includes(body.stage)) { lead.stage = body.stage; lead.manualStage = true; }
      if (body.setter !== undefined) { lead.setter = String(body.setter || "") || undefined; lead.setterAuto = false; }
      if (body.closer !== undefined) { lead.closer = String(body.closer || "") || undefined; lead.closerAuto = false; }
      if (body.notes !== undefined) lead.notes = String(body.notes || "") || undefined;
      // Process setting : lead appelé + groupe WhatsApp créé.
      if (body.setCalled !== undefined) lead.setCalled = body.setCalled ? true : undefined;
      if (body.waGroup !== undefined) lead.waGroup = body.waGroup ? true : undefined;
      // Statut setting : NRP / cancel / groupe WA créé / non qualifié.
      if (body.setStatus !== undefined) {
        const v = ["nrp", "cancel", "wa", "unqualified", ""].includes(body.setStatus) ? body.setStatus : "";
        lead.setStatus = v || undefined;
        if (v === "wa") lead.waGroup = true;
        else if (lead.waGroup) lead.waGroup = undefined;
        if (v === "unqualified") { lead.stage = "unqualified"; lead.manualStage = true; }
      }
      // Lien Fathom (enregistrement du call) : saisi par le closer sur SA ligne.
      if (body.fathom !== undefined) {
        let v = String(body.fathom || "").trim();
        if (v && !/^https?:\/\//i.test(v)) v = "https://" + v;
        lead.fathom = v || undefined;
      }
      // Dimensions du résultat de call (synchronisent le statut quand pertinent)
      if (body.callResult !== undefined) {
        const v = ["won", "lost", ""].includes(body.callResult) ? body.callResult : "";
        lead.callResult = v || undefined;
        if (v === "won" || v === "lost") { lead.stage = v; lead.manualStage = true; }
      }
      if (body.showUp !== undefined) {
        const v = ["present", "noshow", "cancelled", ""].includes(body.showUp) ? body.showUp : "";
        lead.showUp = v || undefined;
        lead.showUpAuto = false; // saisie manuelle : la synchro plateformes ne l'écrase plus
        if (v === "noshow") { lead.stage = "noshow"; lead.manualStage = true; }
        if (v === "present" && !["won", "lost"].includes(lead.stage)) { lead.stage = "show"; lead.manualStage = true; }
      }
      // Suivi de récupération (onglet Saphia)
      if (body.outreach !== undefined) {
        const v = ["contact", "fup", "rebooked", "nrp", "stop", ""].includes(body.outreach) ? body.outreach : "";
        lead.outreach = v || undefined;
        lead.outreachAt = v ? new Date().toISOString() : undefined;
      }
      if (body.followUp !== undefined) {
        const v = ["yes", "no", ""].includes(body.followUp) ? body.followUp : "";
        lead.followUp = v || undefined;
        if (v !== "yes") lead.followUpAt = undefined; // plus de follow-up -> plus de date
      }
      // Date de relance du follow-up (apparaît dans la todo du closer le jour J)
      if (body.followUpAt !== undefined) {
        const v = String(body.followUpAt || "");
        lead.followUpAt = /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined;
      }
      if (body.autoStage === true) lead.manualStage = false;
      lead.updatedAt = new Date().toISOString();
      lead.history = [...(lead.history || []), { at: lead.updatedAt, type: "edit", label: `Mise à jour (${me.name})` }].slice(-12);
      await cmd(["HSET", "crm:leads", email, JSON.stringify(lead)]);
      res.status(200).json({ ok: true, lead });
      return;
    }

    // ---- Lecture du board ----
    let leads = await buildLeads(cmd);
    if (!isAdmin) leads = leads.filter(canSee);

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({ leads, me: { role: me.role, name: me.name } });
  } catch (e) {
    res.status(200).json({ leads: [], error: String(e.message || e) });
  }
};
