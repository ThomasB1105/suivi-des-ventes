/* eslint-disable */
// YouClose : calendrier maison des pages hébergées (remplace Calendly / iClosed).
//   GET  /api/book?page=<slug>   -> questions + créneaux libres (heure de Paris)
//   POST /api/book {page, date, time, firstName, lastName, email, phone, answers, vid}
//        -> crée / met à jour le lead (stage booked, bookedAt, closer) dans crm:leads
//
// Disponibilité d'un closer = horaires de la page − RDV déjà posés dans le CRM.
// Attribution : parmi les closers libres sur le créneau, celui qui a le moins
// de RDV ce jour-là (égalité : tour de rôle).

const { cmd, isConfigured } = require("../lib/kv");
const { pickNextAssignee } = require("../lib/crmData");
const { archiveOnRebook } = require("../lib/callBuckets");
const { attachVisitor } = require("../lib/yc");

const TZ = "Europe/Paris";
const DAYS = { dim: 0, lun: 1, mar: 2, mer: 3, jeu: 4, ven: 5, sam: 6 };
const DAY_LABEL = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
const MONTHS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];

function parts(date) {
  return new Intl.DateTimeFormat("en-US", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" })
    .formatToParts(date).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
}
function offsetMin(date) { const p = parts(date); return Math.round((Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - Math.floor(date.getTime() / 60000) * 60000) / 60000); }
function parisToUtc(ds, hm) {
  const [y, m, d] = ds.split("-").map(Number), [h, mi] = hm.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, h, mi);
  let t = guess - offsetMin(new Date(guess)) * 60000;
  const o2 = offsetMin(new Date(t)); t = guess - o2 * 60000;
  return new Date(t);
}
const parisDate = (date) => { const p = parts(date); return `${p.year}-${p.month}-${p.day}`; };
const addDays = (ds, n) => { const [y, m, d] = ds.split("-").map(Number); const t = new Date(Date.UTC(y, m - 1, d + n)); return t.toISOString().slice(0, 10); };
const weekday = (ds) => { const [y, m, d] = ds.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay(); };
const toMin = (hm) => { const [h, m] = String(hm || "").split(":").map(Number); return (h || 0) * 60 + (m || 0); };
const toHm = (n) => `${String(Math.floor(n / 60)).padStart(2, "0")}:${String(n % 60).padStart(2, "0")}`;
const norm = (s) => String(s || "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

// Questions : une par ligne « Question | réponse | réponse* » (* = écarte le lead).
function parseQuestions(txt) {
  return String(txt || "").split(/\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
    const [q, ...opts] = l.split("|").map((x) => x.trim()).filter(Boolean);
    return { q, options: opts.map((o) => ({ label: o.replace(/\*\s*$/, "").trim(), dq: /\*\s*$/.test(o) })) };
  }).filter((x) => x.q && x.options.length);
}

async function loadPage(slug) {
  const raw = await cmd(["HGET", "yc:pages", slug]);
  if (!raw) return null;
  const p = JSON.parse(raw);
  const b = (p.state && p.state.rdv && p.state.rdv.booking) || {};
  const days = String(b.days || "lun mar mer jeu ven").toLowerCase().split(/[\s,;]+/).map((d) => DAYS[d.slice(0, 3)]).filter((d) => d != null);
  return {
    slug, title: p.title || slug,
    cfg: {
      closers: String(b.closers || "").split(/[,;\n]/).map((s) => s.trim()).filter(Boolean),
      days: days.length ? days : [1, 2, 3, 4, 5],
      from: toMin(b.from || "09:00"), to: toMin(b.to || "19:00"),
      duration: Math.max(10, Math.min(180, Number(b.duration) || 45)),
      buffer: Math.max(0, Math.min(120, Number(b.buffer) || 15)),
      minHours: Math.max(0, Math.min(72, Number(b.minHours) || 3)),
      maxDays: Math.max(1, Math.min(30, Number(b.maxDays) || 7)),
      questions: parseQuestions(b.questions),
      dqText: String(b.dqText || "Merci pour tes réponses. Notre accompagnement ne correspond pas à ta situation pour le moment."),
    },
  };
}

async function teamClosers(cfg) {
  const flat = (await cmd(["HGETALL", "app:users"])) || [];
  const all = [];
  for (let i = 0; i < flat.length; i += 2) { try { const u = JSON.parse(flat[i + 1]); if ((u.role || "closer") === "closer" && u.autoAssign !== false) all.push(u.name || flat[i]); } catch (e) {} }
  if (!cfg.closers.length) return all;
  const wanted = cfg.closers.map(norm);
  return all.filter((n) => wanted.includes(norm(n)));
}

// RDV posés dans le CRM : [{closer, start(ms)}]
let busyCache = { at: 0, data: null };
async function busyCalls() {
  if (busyCache.data && Date.now() - busyCache.at < 15000) return busyCache.data;
  const flat = (await cmd(["HGETALL", "crm:leads"])) || [];
  const out = [];
  for (let i = 0; i < flat.length; i += 2) {
    let l; try { l = JSON.parse(flat[i + 1]); } catch (e) { continue; }
    if (!l.bookedAt || !l.closer || l.showUp === "cancelled") continue;
    const t = Date.parse(l.bookedAt); if (!isFinite(t) || t < Date.now() - 86400000) continue;
    out.push({ closer: norm(l.closer), start: t });
  }
  busyCache = { at: Date.now(), data: out };
  return out;
}

function computeSlots(cfg, closers, busy) {
  const now = Date.now(), earliest = now + cfg.minHours * 3600000;
  const step = cfg.duration + cfg.buffer, span = (cfg.duration + cfg.buffer) * 60000;
  const today = parisDate(new Date());
  const days = [];
  for (let i = 0; i <= cfg.maxDays; i++) {
    const ds = addDays(today, i);
    if (!cfg.days.includes(weekday(ds))) continue;
    const slots = [];
    for (let m = cfg.from; m + cfg.duration <= cfg.to; m += step) {
      const start = parisToUtc(ds, toHm(m)).getTime();
      if (start < earliest) continue;
      const free = closers.filter((c) => !busy.some((b) => b.closer === norm(c) && Math.abs(b.start - start) < span));
      if (free.length) slots.push({ time: toHm(m), start, free });
    }
    if (slots.length) days.push({ date: ds, slots });
  }
  return days;
}

const label = (ds, hm) => { const [y, m, d] = ds.split("-").map(Number); return `${DAY_LABEL[weekday(ds)]} ${d} ${MONTHS[m - 1]} à ${hm.replace(":", "h")}`; };
const pushHistory = (lead, type, lbl) => { lead.history = [...(lead.history || []), { at: new Date().toISOString(), type, label: lbl }].slice(-12); };

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  if (!isConfigured()) { res.status(500).json({ error: "Service indisponible." }); return; }
  try {
    let b = req.body; if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } } b = b || {};
    const slug = String((req.query && req.query.page) || b.page || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60);
    const page = slug ? await loadPage(slug) : null;
    if (!page) { res.status(404).json({ error: "Page introuvable." }); return; }
    const { cfg } = page;
    const closers = await teamClosers(cfg);

    if (req.method === "GET") {
      const days = computeSlots(cfg, closers, await busyCalls());
      res.status(200).json({
        tz: TZ, duration: cfg.duration, dqText: cfg.dqText,
        questions: cfg.questions.map((q) => ({ q: q.q, options: q.options.map((o) => ({ label: o.label, dq: o.dq })) })),
        days: days.map((d) => ({ date: d.date, label: label(d.date, "00:00").replace(/ à .*/, ""), slots: d.slots.map((s) => s.time) })),
      });
      return;
    }
    if (req.method !== "POST") { res.status(405).json({ error: "Méthode non gérée." }); return; }

    const email = String(b.email || "").trim().toLowerCase();
    const first = String(b.firstName || "").trim().slice(0, 60), last = String(b.lastName || "").trim().slice(0, 60);
    const phone = String(b.phone || "").trim().slice(0, 30);
    if (!first) { res.status(400).json({ error: "Indique ton prénom." }); return; }
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) { res.status(400).json({ error: "Cet email ne semble pas valide." }); return; }
    if (phone.replace(/\D/g, "").length < 8) { res.status(400).json({ error: "Indique un numéro de téléphone valide." }); return; }
    // Questionnaire : on revérifie côté serveur qu'aucune réponse n'écarte le lead.
    const answers = b.answers && typeof b.answers === "object" ? b.answers : {};
    const qa = {};
    for (const q of cfg.questions) {
      const a = String(answers[q.q] || "");
      const opt = q.options.find((o) => o.label === a);
      if (!opt) { res.status(400).json({ error: "Réponds à toutes les questions." }); return; }
      if (opt.dq) { res.status(403).json({ error: cfg.dqText, disqualified: true }); return; }
      qa[q.q] = a;
    }
    const ds = String(b.date || ""), hm = String(b.time || "");
    busyCache.at = 0; // créneaux frais au moment de réserver
    const busy = await busyCalls();
    const day = computeSlots(cfg, closers, busy).find((d) => d.date === ds);
    const slot = day && day.slots.find((s) => s.time === hm);
    if (!slot) { res.status(409).json({ error: "Ce créneau vient d'être pris. Choisis-en un autre." }); return; }

    // Closer : le moins chargé ce jour-là parmi les libres (égalité : tour de rôle).
    const dayStart = parisToUtc(ds, "00:00").getTime(), dayEnd = dayStart + 86400000;
    const load = (c) => busy.filter((x) => x.closer === norm(c) && x.start >= dayStart && x.start < dayEnd).length;
    const min = Math.min(...slot.free.map(load));
    const cands = slot.free.filter((c) => load(c) === min);
    const n = Number(await cmd(["INCR", "yc:rr:closer"])) || 1;
    const closer = cands[(n - 1) % cands.length];

    const startIso = new Date(slot.start).toISOString();
    const raw = await cmd(["HGET", "crm:leads", email]);
    const lead = raw ? JSON.parse(raw) : { email, createdAt: new Date().toISOString(), stage: "new", history: [] };
    lead.name = [first, last].filter(Boolean).join(" ");
    lead.phone = phone;
    lead.answers = { ...(lead.answers || {}), ...qa };
    if (archiveOnRebook(lead, startIso)) pushHistory(lead, "rebook", "Nouveau RDV : résultat du call précédent archivé");
    if (!lead.manualStage && !["won", "lost"].includes(lead.stage)) lead.stage = "booked";
    if (lead.showUp === "cancelled") { delete lead.showUp; delete lead.showUpAuto; }
    lead.bookedAt = startIso;
    lead.bookedEvent = `YouClose · ${page.title}`;
    lead.closer = closer; lead.closerAuto = true;
    if (!lead.setter) { const s = await pickNextAssignee(cmd, "setter"); if (s) { lead.setter = s; lead.setterAuto = true; } }
    lead.source = lead.source || "Page YouClose";
    pushHistory(lead, "calendly_booked", `RDV réservé sur la page ${slug} avec ${closer} à ${hm} (${ds})`);
    const vid = String(b.vid || "").replace(/[^a-z0-9]/gi, "").slice(0, 40);
    if (vid) { try { await attachVisitor(cmd, lead, vid, pushHistory); } catch (e) {} }
    lead.updatedAt = new Date().toISOString();
    await cmd(["HSET", "crm:leads", email, JSON.stringify(lead)]);
    try { await cmd(["HINCRBY", "trk:s:" + slug, "booked", "1"]); } catch (e) {}
    busyCache.at = 0;
    res.status(200).json({ ok: true, start: startIso, label: label(ds, hm), closer: String(closer).split(" ")[0] });
  } catch (e) {
    res.status(500).json({ error: "La réservation a échoué. Réessaie dans un instant." });
  }
};
