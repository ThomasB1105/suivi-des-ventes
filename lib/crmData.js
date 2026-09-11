/* eslint-disable */
// Agrégation CRM partagée : construit les lignes du board (calls Calendly +
// iClosed + ventes) à partir de la base KV. Utilisée par /api/crm, /api/me
// et /api/users (commissions).

const STAGES = ["new", "setting", "booked", "show", "noshow", "won", "lost", "unqualified"];

const dayN = (d) => { const [y, m, dd] = String(d || "").split("-").map(Number); return y ? Math.round(Date.UTC(y, m - 1, dd || 1) / 864e5) : NaN; };

async function buildLeads(cmd) {
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

  const emails = new Set([
    ...Object.keys(crmLeads),
    ...Object.keys(icContacts),
    ...Object.keys(callByEmail),
    ...Object.keys(saleByEmail),
  ].map((e) => String(e).toLowerCase()).filter(Boolean));

  const CALL_TO_STAGE = { won: "won", lost: "lost", noshow: "noshow", show: "show", pending: "show", rescheduled: "booked", booked: "booked", cancelled: "setting" };

  return [...emails].map((email) => {
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
    const ansMerged = Object.assign({}, (call && call.answers) || {}, l.answers || {});
    return {
      email,
      name: l.name || email,
      phone: l.phone || (call && call.phone) || undefined,
      source: l.source || ic.source || (call ? "iClosed" : "—"),
      campaign: l.campaign || undefined,
      setter: l.setter || undefined,
      closer: l.closer || (call && call.closer) || ic.closer || undefined,
      stage,
      manualStage: !!l.manualStage,
      notes: l.notes || undefined,
      answers: Object.keys(ansMerged).length ? ansMerged : undefined,
      amount: paid || undefined,
      bookedAt: l.bookedAt || undefined,
      bookedEvent: l.bookedEvent || undefined,
      links: l.links || undefined,
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
}

// Le nom d'une personne matche un champ (closer/setter), insensible à la casse.
const isPerson = (field, name) => String(field || "").trim().toLowerCase() === String(name || "").trim().toLowerCase();

// Stats d'un membre d'équipe sur les lignes du board.
function personStats(leads, name, role, rate) {
  const field = role === "setter" ? "setter" : "closer";
  const mine = leads.filter((l) => isPerson(l[field], name));
  const showed = mine.filter((l) => ["show", "won", "lost"].includes(l.stage)).length;
  const noshow = mine.filter((l) => l.stage === "noshow").length;
  const won = mine.filter((l) => l.stage === "won");
  const revenue = won.reduce((a, l) => a + (l.amount || 0), 0);
  const r = Number(rate || 0);
  return {
    calls: mine.length,
    showed,
    noshow,
    won: won.length,
    revenue,
    showRate: (showed + noshow) ? showed / (showed + noshow) : 0,
    closingRate: showed ? won.length / showed : 0,
    commissionRate: r,
    commission: revenue * (r / 100),
  };
}

// Attribution automatique round-robin : renvoie le prochain membre de l'équipe
// pour un rôle donné ("setter" | "closer"), parmi les comptes dont l'attribution
// auto est activée. Compteur persistant crm:rr:<role> -> répartition équitable.
async function pickNextAssignee(cmd, role) {
  try {
    const flat = (await cmd(["HGETALL", "app:users"])) || [];
    const pool = [];
    for (let i = 0; i < flat.length; i += 2) {
      try {
        const u = JSON.parse(flat[i + 1]);
        if ((u.role || "closer") === role && u.autoAssign !== false) pool.push({ username: flat[i], name: u.name || flat[i] });
      } catch {}
    }
    if (!pool.length) return null;
    pool.sort((a, b) => a.username.localeCompare(b.username));
    const n = Number(await cmd(["INCR", `crm:rr:${role}`])) || 1;
    return pool[(n - 1) % pool.length].name;
  } catch (e) { return null; }
}

module.exports = { buildLeads, STAGES, personStats, isPerson, pickNextAssignee };
