/* eslint-disable */
// CRM : agrège les leads (VSL/Calendly), les appels iClosed et les ventes.
//   GET  /api/crm            -> { leads:[...], stats:{...} }
//   POST /api/crm            -> mise à jour manuelle d'un lead
//        body: { email, stage?, setter?, closer?, notes? }
//
// Stage automatique (sauf override manuel) :
//   vente encaissée -> won ; sinon dernier appel iClosed (won/lost/noshow/
//   show/booked) ; sinon RDV Calendly -> booked ; sinon new/setting.

const { cmd, isConfigured } = require("../lib/kv");
const { checkAuth } = require("../lib/auth");

const STAGES = ["new", "setting", "booked", "show", "noshow", "won", "lost", "unqualified"];

const dayN = (d) => { const [y, m, dd] = String(d || "").split("-").map(Number); return y ? Math.round(Date.UTC(y, m - 1, dd || 1) / 864e5) : NaN; };

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-token");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (!checkAuth(req)) { res.status(401).json({ error: "Non autorisé." }); return; }
  if (!isConfigured()) { res.status(200).json({ leads: [], configured: false }); return; }

  try {
    // ---- Mise à jour manuelle d'un lead ----
    if (req.method === "POST") {
      let body = req.body;
      if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
      const email = String((body && body.email) || "").toLowerCase();
      if (!email) { res.status(400).json({ error: "Email manquant." }); return; }
      let lead = null;
      try { const s = await cmd(["HGET", "crm:leads", email]); lead = s ? JSON.parse(s) : null; } catch {}
      if (!lead) lead = { email, createdAt: new Date().toISOString(), history: [] };
      if (body.stage !== undefined && STAGES.includes(body.stage)) { lead.stage = body.stage; lead.manualStage = true; }
      if (body.setter !== undefined) lead.setter = String(body.setter || "") || undefined;
      if (body.closer !== undefined) lead.closer = String(body.closer || "") || undefined;
      if (body.notes !== undefined) lead.notes = String(body.notes || "") || undefined;
      if (body.autoStage === true) lead.manualStage = false; // revenir au stage auto
      lead.updatedAt = new Date().toISOString();
      lead.history = [...(lead.history || []), { at: lead.updatedAt, type: "edit", label: "Mise à jour manuelle" }].slice(-12);
      await cmd(["HSET", "crm:leads", email, JSON.stringify(lead)]);
      res.status(200).json({ ok: true, lead });
      return;
    }

    // ---- Agrégation ----
    const readHash = async (key) => {
      const flat = (await cmd(["HGETALL", key])) || [];
      const out = {};
      for (let i = 0; i < flat.length; i += 2) { try { out[flat[i]] = JSON.parse(flat[i + 1]); } catch {} }
      return out;
    };

    const crmLeads = await readHash("crm:leads");           // email -> lead
    const icContacts = await readHash("iclosed:contacts");  // email -> {closer, source, channel}
    const icCallsById = await readHash("iclosed:calls_h");  // id -> call

    // Ventes encaissées par email (dédup cross-source ±1 jour, même logique que /api/sales)
    const saleByEmail = {};
    {
      const ev = await readHash("sales:events");
      const paid = {};
      Object.values(ev).forEach((e) => {
        const amount = Number(e.amount || 0);
        if (!(amount > 0) || e.status === "cancelled") return;
        const em = String(e.email || "").toLowerCase();
        if (!em) return;
        const ct = Math.round(amount * 100), dn = dayN(e.date);
        if (!paid[em]) paid[em] = [];
        if (paid[em].some((p) => p.cents === ct && Math.abs(p.day - dn) <= 1)) return;
        paid[em].push({ cents: ct, day: dn });
        saleByEmail[em] = (saleByEmail[em] || 0) + amount;
      });
    }

    // Dernier appel iClosed par email (+ closer)
    const callByEmail = {};
    Object.values(icCallsById).forEach((c) => {
      const em = String(c.email || "").toLowerCase();
      if (!em) return;
      const prev = callByEmail[em];
      if (!prev || String(c.date || "") > String(prev.date || "")) callByEmail[em] = c;
      if (c.status === "won") callByEmail[em] = { ...callByEmail[em], hadWon: true };
    });

    // Union de tous les emails connus
    const emails = new Set([
      ...Object.keys(crmLeads),
      ...Object.keys(icContacts),
      ...Object.keys(callByEmail),
      ...Object.keys(saleByEmail),
    ].map((e) => String(e).toLowerCase()).filter(Boolean));

    const CALL_TO_STAGE = { won: "won", lost: "lost", noshow: "noshow", show: "show", pending: "show", rescheduled: "booked", booked: "booked", cancelled: "setting" };

    const leads = [...emails].map((email) => {
      const l = crmLeads[email] || {};
      const ic = icContacts[email] || {};
      const call = callByEmail[email];
      const paid = saleByEmail[email] || 0;

      // stage auto : vente > appel iClosed > RDV Calendly > opt-in
      let auto = "new";
      if (l.stage === "setting") auto = "setting";
      if (l.bookedAt) auto = "booked";
      if (call) auto = CALL_TO_STAGE[call.status] || auto;
      if (call && call.hadWon) auto = "won";
      if (paid > 0) auto = "won";
      const stage = l.manualStage && l.stage ? l.stage : auto;

      const lastActivity = [l.updatedAt, call && call.date, l.bookedAt, l.createdAt].filter(Boolean).sort().pop();
      return {
        email,
        name: l.name || (call && call.email === email ? undefined : undefined) || l.name || email,
        phone: l.phone || undefined,
        source: l.source || ic.source || (call ? "iClosed" : "—"),
        campaign: l.campaign || undefined,
        setter: l.setter || undefined,
        closer: l.closer || (call && call.closer) || ic.closer || undefined,
        stage,
        manualStage: !!l.manualStage,
        notes: l.notes || undefined,
        amount: paid || undefined,
        bookedAt: l.bookedAt || undefined,
        bookedEvent: l.bookedEvent || undefined,
        lastCall: call ? { date: call.date, status: call.status, event: call.event } : undefined,
        createdAt: l.createdAt || (call && call.date) || undefined,
        lastActivity,
        history: l.history || undefined,
      };
    })
      // Périmètre du board : UNIQUEMENT les calls pris (iClosed ou RDV Calendly),
      // + les payeurs (un paiement implique un call). Les opt-ins VSL bruts sont exclus.
      .filter((l) => l.lastCall || l.bookedAt || (l.amount || 0) > 0)
      .sort((a, b) => String(b.lastActivity || "").localeCompare(String(a.lastActivity || "")));

    // ---- Stats pipeline ----
    const stages = {};
    STAGES.forEach((s) => { stages[s] = 0; });
    leads.forEach((l) => { stages[l.stage] = (stages[l.stage] || 0) + 1; });

    const nLeads = leads.length;
    const booked = leads.filter((l) => ["booked", "show", "noshow", "won", "lost"].includes(l.stage)).length;
    const showed = leads.filter((l) => ["show", "won", "lost"].includes(l.stage)).length;
    const won = stages.won || 0;
    const funnel = {
      leads: nLeads, booked, showed, won,
      settingRate: nLeads ? booked / nLeads : 0,      // lead -> call booké
      showRate: booked ? showed / booked : 0,          // booké -> présent
      closingRate: showed ? won / showed : 0,          // présent -> closé
      revenue: leads.reduce((a, l) => a + (l.amount || 0), 0),
    };

    // Perfs par personne (setting = setter, closing = closer)
    const byPerson = (field, num, den) => {
      const m = {};
      leads.forEach((l) => {
        const p = l[field];
        if (!p) return;
        if (!m[p]) m[p] = { name: p, leads: 0, booked: 0, showed: 0, won: 0, revenue: 0 };
        m[p].leads += 1;
        if (["booked", "show", "noshow", "won", "lost"].includes(l.stage)) m[p].booked += 1;
        if (["show", "won", "lost"].includes(l.stage)) m[p].showed += 1;
        if (l.stage === "won") { m[p].won += 1; m[p].revenue += l.amount || 0; }
      });
      return Object.values(m).map((p) => ({ ...p, rate: p[den] ? p[num] / p[den] : 0 }))
        .sort((a, b) => b.won - a.won || b.booked - a.booked);
    };

    res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate=60");
    res.status(200).json({
      leads,
      stats: {
        stages,
        funnel,
        bySetter: byPerson("setter", "booked", "leads"),   // taux de setting
        byCloser: byPerson("closer", "won", "showed"),     // taux de closing
      },
    });
  } catch (e) {
    res.status(200).json({ leads: [], error: String(e.message || e) });
  }
};
