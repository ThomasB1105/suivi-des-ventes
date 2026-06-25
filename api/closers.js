/* eslint-disable */
// Reporting closers complet à partir des appels iClosed (iclosed:calls + iclosed:calls_h).
//   GET /api/closers -> funnel / séries hebdo / outcomes / no-sale / objections /
//                       closers / events / questions (cohorte) / breakdown ventes
//
// Reproduit l'Analytics iClosed (Scheduling funnel, Calls created, Strategy Call
// Outcomes, No sale reasons, Closing/Engagement/Show-up, Sales breakdown,
// Scheduling cohort, Objections, Top members, Top events) — en FR.

const { cmd, isConfigured } = require("../lib/kv");
const { checkAuth } = require("../lib/auth");

// Lundi de la semaine d'une date ISO -> "YYYY-MM-DD"
function weekKey(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return null;
  const day = (d.getUTCDay() + 6) % 7; // 0 = lundi
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-token");
  if (!checkAuth(req)) { res.status(401).json({ error: "Non autorisé." }); return; }
  if (!isConfigured()) { res.status(200).json({ totalCalls: 0, configured: false }); return; }

  try {
    const raw = (await cmd(["LRANGE", "iclosed:calls", "0", "4999"])) || [];
    const hashRaw = (await cmd(["HGETALL", "iclosed:calls_h"])) || [];
    // Dédoublonnage par clé NATURELLE (email + horaire) et non par id : le webhook
    // et l'import API attribuent des id différents au même appel, ce qui le comptait
    // deux fois. On conserve à chaque fois l'enregistrement le plus informatif.
    const natKey = (c) => {
      const em = String(c.email || "").toLowerCase();
      const dt = String(c.date || "").slice(0, 16); // YYYY-MM-DDTHH:MM
      if (em && dt) return `${em}|${dt}`;
      return c.id || `${em}|${c.date}|${c.status}`;
    };
    const rank = (s) => ({ won: 5, lost: 4, noshow: 4, cancelled: 3, show: 2, rescheduled: 2, pending: 1, booked: 1, other: 0 }[s] || 0);
    const better = (a, b) => {
      if (!a) return b;
      const ra = rank(a.status) + (a.amount ? 1 : 0) + (a.reason || a.objection ? 1 : 0);
      const rb = rank(b.status) + (b.amount ? 1 : 0) + (b.reason || b.objection ? 1 : 0);
      return rb > ra ? b : a;
    };
    const byId = new Map();
    const add = (c) => { const k = natKey(c); byId.set(k, better(byId.get(k), c)); };
    raw.forEach((s) => { try { add(JSON.parse(s)); } catch {} });
    for (let i = 1; i < hashRaw.length; i += 2) { try { add(JSON.parse(hashRaw[i])); } catch {} }
    let calls = [...byId.values()];

    // Résolution des noms de closers SUR LES DONNÉES DÉJÀ STOCKÉES (sans réimport).
    // L'API iClosed n'expose pas les noms : on traduit "Closer <id>" via la carte
    // configurable Vercel → ICLOSED_USER_MAP = {"22743":"Melo", ...}.
    let NAMEMAP = {}; try { NAMEMAP = JSON.parse(process.env.ICLOSED_USER_MAP || "{}"); } catch {}
    if (!NAMEMAP["22743"]) NAMEMAP["22743"] = "Melo";          // compte principal (ex-"Ecom ascension")
    if (!NAMEMAP["Ecom ascension"]) NAMEMAP["Ecom ascension"] = "Melo";
    const renameCloser = (name) => {
      if (!name) return "Non attribué";
      const m = /^Closer\s+(.+)$/i.exec(String(name));
      const id = m ? m[1].trim() : null;
      if (id && NAMEMAP[id]) return NAMEMAP[id];
      if (NAMEMAP[name]) return NAMEMAP[name];
      return String(name);
    };
    calls.forEach((c) => { c.closer = renameCloser(c.closer); });
    // Exclut les données de test injectées manuellement lors du branchement webhook.
    calls = calls.filter((c) => !/test\s*closer/i.test(String(c.closer || "")) && !/(^|@)test\b/i.test(String(c.email || "")));

    // Attribution automatique des closers restants, calculée sur TOUT l'historique
    // (et non sur la période affichée) pour que l'identité d'un userId reste stable.
    // Signal d'identification (indication utilisateur) : Diego n'est actif que
    // récemment -> c'est le seul closer (hors Melo) à avoir des appels CETTE SEMAINE.
    // Diego = "Closer <id>" non mappé le plus actif sur les 7 derniers jours ;
    // Saphia = le suivant (par volume tout-historique). Surclassé par ICLOSED_USER_MAP.
    const weekAgoISO = new Date(Date.now() - 7 * 864e5).toISOString().slice(0, 10);
    const allTimeCnt = {}, weekCnt = {};
    calls.forEach((c) => {
      const lbl = String(c.closer || "");
      if (!/^Closer\s+\d+/i.test(lbl)) return;
      allTimeCnt[lbl] = (allTimeCnt[lbl] || 0) + 1;
      if (String(c.date || "").slice(0, 10) >= weekAgoISO) weekCnt[lbl] = (weekCnt[lbl] || 0) + 1;
    });
    const autoMap = {};
    // 1) Diego = le non-mappé le plus actif cette semaine (s'il y en a un)
    const diego = Object.entries(weekCnt).sort((a, b) => b[1] - a[1])[0];
    if (diego) autoMap[diego[0]] = "Diego";
    // 2) Saphia = le non-mappé restant le plus actif tout-historique
    const saphia = Object.entries(allTimeCnt).filter(([lbl]) => !autoMap[lbl]).sort((a, b) => b[1] - a[1])[0];
    if (saphia) autoMap[saphia[0]] = "Saphia";
    if (Object.keys(autoMap).length) calls.forEach((c) => { if (autoMap[c.closer]) c.closer = autoMap[c.closer]; });

    // Filtre par période (aligné sur le sélecteur de l'app) : ?from=YYYY-MM-DD&to=YYYY-MM-DD
    const from = req.query && req.query.from ? String(req.query.from).slice(0, 10) : null;
    const to = req.query && req.query.to ? String(req.query.to).slice(0, 10) : null;
    if (from || to) {
      calls = calls.filter((c) => {
        const d = String(c.date || "").slice(0, 10);
        if (!d) return false;
        if (from && d < from) return false;
        if (to && d > to) return false;
        return true;
      });
    }

    // Nb de contacts iClosed (haut du funnel)
    let contactsCount = 0;
    try { contactsCount = Number(await cmd(["HLEN", "iclosed:contacts"])) || 0; } catch {}

    // Ventes systeme.io par email : sert de repli quand iClosed n'a pas le montant
    // ni le résultat de l'appel. On matche l'email de l'appel avec celui de la vente.
    const saleByEmail = {};
    try {
      const sFlat = (await cmd(["HGETALL", "sales:events"])) || [];
      const seenPay = {}; // email -> Set(date|amount) pour dédupliquer
      for (let i = 1; i < sFlat.length; i += 2) {
        let e; try { e = JSON.parse(sFlat[i]); } catch { continue; }
        const amount = Number(e.amount || 0);
        if (!(amount > 0) || e.status === "cancelled") continue;
        const em = String(e.email || "").toLowerCase();
        if (!em) continue;
        const k = `${e.date}|${Math.round(amount * 100)}`;
        if (!seenPay[em]) seenPay[em] = new Set();
        if (seenPay[em].has(k)) continue;
        seenPay[em].add(k);
        saleByEmail[em] = (saleByEmail[em] || 0) + amount;
      }
    } catch {}
    // Pour chaque email ayant une vente, on désigne UN appel gagnant (pour ne pas
    // gonfler le nombre de ventes si le lead a plusieurs appels) :
    //   - si un appel est déjà "gagné" côté iClosed -> c'est lui ;
    //   - sinon l'appel le plus récent. Cet appel est forcé en "gagné" même si
    //     iClosed l'a marqué "perdu", car une vente (revenu) y est rattachée.
    const callsByEmail = {};
    calls.forEach((c) => { const em = String(c.email || "").toLowerCase(); if (em) (callsByEmail[em] = callsByEmail[em] || []).push(c); });
    const winnerIds = new Set();
    Object.keys(saleByEmail).forEach((em) => {
      const list = callsByEmail[em];
      if (!list || !list.length) return;
      const alreadyWon = list.find((c) => c.status === "won");
      const winner = alreadyWon || list.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0];
      if (winner) winnerIds.add(winner.id);
    });
    // Montant d'un appel gagnant : iClosed en priorité, sinon la vente liée par email.
    const usedEmail = new Set(); // n'attribue le total d'une vente qu'une fois
    const callAmount = (c) => {
      let a = Number(c.amount || 0);
      const em = String(c.email || "").toLowerCase();
      if (!a && em && saleByEmail[em] && !usedEmail.has(em)) { a = saleByEmail[em]; usedEmail.add(em); }
      return a;
    };

    const bump = (obj, key, n = 1) => { const k = key || "—"; obj[k] = (obj[k] || 0) + n; };

    const out = { won: 0, lost: 0, pending: 0, noshow: 0, cancelled: 0, rescheduled: 0, booked: 0, show: 0, other: 0 };
    const byCloser = {};
    const byEvent = {};
    const reasons = {};
    const objections = {};
    const qmap = {};
    const weeks = {};   // weekKey -> { created, won, lost, pending, noshow, cancelled }
    let revenue = 0, deposits = 0, recurring = 0;

    calls.forEach((c) => {
      let st = c.status || "other";
      // L'appel gagnant d'un email ayant une vente est forcé "gagné" (même si
      // iClosed l'a marqué perdu/en attente) : le revenu doit aller au closer.
      if (winnerIds.has(c.id)) st = "won";
      if (out[st] !== undefined) out[st] += 1; else out.other += 1;
      const amt = st === "won" ? callAmount(c) : Number(c.amount || 0);
      if (st === "won") {
        revenue += amt;
        // Acompte vs paiement intégral : heuristique sur le libellé d'outcome/réponses
        const blob = JSON.stringify(c.answers || {}).toLowerCase() + " " + String(c.reason || "").toLowerCase();
        if (/acompte|deposit|partiel/.test(blob)) deposits += amt; else recurring += amt;
      }

      // série hebdo (calls created + outcomes)
      const wk = weekKey(c.date);
      if (wk) {
        if (!weeks[wk]) weeks[wk] = { week: wk, created: 0, won: 0, lost: 0, pending: 0, noshow: 0, cancelled: 0 };
        weeks[wk].created += 1;
        if (weeks[wk][st] !== undefined) weeks[wk][st] += 1;
      }

      // par closer
      const ck = c.closer || "Non attribué";
      if (!byCloser[ck]) byCloser[ck] = { closer: ck, calls: 0, won: 0, lost: 0, noshow: 0, show: 0, pending: 0, cancelled: 0, revenue: 0 };
      const g = byCloser[ck];
      g.calls += 1;
      if (g[st] !== undefined) g[st] += 1;
      if (st === "won") g.revenue += amt;

      // par événement
      if (c.event) {
        if (!byEvent[c.event]) byEvent[c.event] = { event: c.event, booked: 0, rescheduled: 0, cancelled: 0, won: 0 };
        const e = byEvent[c.event];
        e.booked += 1;
        if (st === "rescheduled") e.rescheduled += 1;
        if (st === "cancelled") e.cancelled += 1;
        if (st === "won") e.won += 1;
      }

      if (st === "lost" && c.reason) bump(reasons, c.reason);
      if (c.objection) bump(objections, c.objection);

      // cohorte : conversion par réponse aux questions
      if (c.answers && typeof c.answers === "object") {
        Object.entries(c.answers).forEach(([q, a]) => {
          const ans = String(a == null ? "—" : a);
          if (!qmap[q]) qmap[q] = {};
          if (!qmap[q][ans]) qmap[q][ans] = { answer: ans, n: 0, won: 0 };
          qmap[q][ans].n += 1;
          if (st === "won") qmap[q][ans].won += 1;
        });
      }
    });

    const held = out.won + out.lost + out.show;        // appels honorés
    const heldOrNo = held + out.noshow;
    const closers = Object.values(byCloser).map((g) => ({
      ...g,
      showRate: (g.won + g.lost + g.show + g.noshow) ? (g.won + g.lost + g.show) / (g.won + g.lost + g.show + g.noshow) : 0,
      closingRate: (g.won + g.lost) ? g.won / (g.won + g.lost) : 0,
    })).sort((a, b) => b.revenue - a.revenue || b.won - a.won);

    const toArr = (obj) => Object.entries(obj).map(([k, v]) => ({ label: k, n: v })).sort((a, b) => b.n - a.n);
    // On ne garde que les questions "qualifiantes" (réponses catégorielles).
    // On exclut les champs d'identité (nom, email, téléphone…) et le texte libre
    // où chaque réponse est unique : ça ne dit rien sur la conversion.
    const IDENTITY_Q = /(full ?name|name|nom|prénom|prenom|e-?mail|courriel|phone|t[ée]l[ée]phone|num[ée]ro|whatsapp|instagram|@|adresse|address|website|site)/i;
    const questions = Object.entries(qmap).filter(([q, ans]) => {
      if (IDENTITY_Q.test(q)) return false;
      const vals = Object.values(ans);
      const total = vals.reduce((a, v) => a + v.n, 0);
      if (total < 3) return false;                       // pas assez de volume
      if (vals.length > 8) return false;                 // trop d'options = liste de leads, pas une cohorte
      if (vals.length / total > 0.6) return false;       // surtout du texte libre / réponses uniques
      return true;
    }).map(([q, ans]) => ({
      question: q,
      total: Object.values(ans).reduce((a, v) => a + v.n, 0),
      answers: Object.values(ans).map((a) => ({ ...a, rate: a.n ? a.won / a.n : 0 })).sort((x, y) => y.n - x.n).slice(0, 8),
    }));

    const series = Object.values(weeks).sort((a, b) => a.week.localeCompare(b.week));

    // Funnel monotone (toujours décroissant) : Appels créés -> Honorés -> Ventes.
    // (Les "contacts" du webhook sont partiels, on ne les met plus dans le funnel
    //  pour éviter un taux >100%.)
    const scheduled = calls.length;
    const funnel = {
      created: scheduled,
      held,
      won: out.won,
      createdToHeld: scheduled ? held / scheduled : 0,
      heldToWon: held ? out.won / held : 0,
      contacts: contactsCount, // info, non affiché dans le funnel
    };

    res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=120");
    res.status(200).json({
      totalCalls: calls.length,
      outcomes: out,
      totals: {
        scheduled,
        sales: out.won, noSale: out.lost, pending: out.pending,
        showRate: heldOrNo ? held / heldOrNo : 0,
        noShowRate: heldOrNo ? out.noshow / heldOrNo : 0,
        closingRate: (out.won + out.lost) ? out.won / (out.won + out.lost) : 0,
        // engagement = honorés + replanifiés (a interagi) / planifiés
        engagementRate: scheduled ? (held + out.rescheduled) / scheduled : 0,
        revenue,
      },
      funnel,
      series,
      breakdown: { revenue, won: out.won, deposits, recurring },
      closers,
      events: Object.values(byEvent).sort((a, b) => b.booked - a.booked),
      reasons: toArr(reasons),
      objections: toArr(objections),
      questions,
    });
  } catch (e) {
    res.status(200).json({ totalCalls: 0, error: String(e.message || e) });
  }
};
