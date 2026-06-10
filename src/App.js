import React, { useState, useEffect, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import {
  AlertTriangle, Check, Plus, X, Calendar, TrendingUp, Trash2, Landmark,
  RotateCcw, Users, UserCheck, Phone, Mail, Leaf, Megaphone, Grid3x3,
} from "lucide-react";

/* ------------------------------ helpers ------------------------------ */

const euro = (n) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 })
    .format(Math.round(n || 0));
const euro2 = (n) =>
  new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(n || 0);

const round2 = (x) => Math.round(x * 100) / 100;
const pad = (n) => String(n).padStart(2, "0");
const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseLocal = (iso) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const addMonths = (date, n) => new Date(date.getFullYear(), date.getMonth() + n, date.getDate());

const today = new Date();
today.setHours(0, 0, 0, 0);

const monthKey = (iso) => iso.slice(0, 7);
const monthLabel = (key) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }).replace(".", "");
};
const dateLabel = (iso) => parseLocal(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
const statusOf = (inst) => inst.paid ? "paid" : (parseLocal(inst.dueDate) < today ? "overdue" : "upcoming");

/* ------------------------------ seed (iClosed + Systeme.io demo) ------------------------------ */


const normalize = (list) =>
  list.map((s, i) => ({
    id: s.id || `s${i}-${Math.random().toString(36).slice(2, 7)}`,
    source: "—", channel: "organic", ...s,
    schedule: s.schedule.map((inst, j) => ({
      id: inst.id || `i${i}-${j}-${Math.random().toString(36).slice(2, 7)}`, method: null, ...inst,
    })),
  }));

const STORAGE_KEY = "melo_sales_v5";

/* ------------------------------ styles ------------------------------ */

const css = `
@import url('https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700;800&family=Inter:wght@400;500;600;700&display=swap');
.melo{
  --bg:#0A1220; --panel:#101D33; --panel2:#16243d; --line:rgba(255,255,255,.08);
  --cyan:#00D4FF; --green:#2BD9A0; --amber:#FFB020; --red:#FF4D5E; --text:#EAF2FF; --muted:rgba(234,242,255,.52);
  font-family:'Inter',system-ui,sans-serif; color:var(--text);
  background:radial-gradient(1200px 600px at 80% -10%, rgba(0,212,255,.07), transparent 60%), var(--bg);
  min-height:100vh; padding:28px clamp(16px,4vw,40px); box-sizing:border-box;
}
.melo *{box-sizing:border-box;}
.melo-head{display:flex; flex-wrap:wrap; gap:16px; align-items:flex-end; justify-content:space-between; margin-bottom:24px;}
.melo-title{font-family:'Montserrat'; font-weight:800; font-size:clamp(20px,3.2vw,30px); line-height:1.05; margin:0;}
.melo-title .accent{color:var(--cyan);}
.melo-sub{color:var(--muted); font-size:13px; margin-top:6px;}
.chip{display:inline-flex; align-items:center; gap:7px; padding:7px 12px; border-radius:999px; border:1px solid var(--line); background:var(--panel); font-size:12px;}
.dot{width:7px; height:7px; border-radius:50%; background:var(--amber);}
.chip button{background:var(--cyan); color:#04121f; border:none; font-weight:700; font-size:11px; padding:4px 9px; border-radius:999px; cursor:pointer; font-family:'Inter';}
.btn-primary{display:inline-flex; align-items:center; gap:8px; background:var(--cyan); color:#04121f; border:none; padding:11px 16px; border-radius:11px; font-weight:700; font-size:14px; cursor:pointer; font-family:'Inter'; transition:transform .12s, box-shadow .2s; box-shadow:0 6px 22px rgba(0,212,255,.25);}
.btn-primary:hover{transform:translateY(-1px); box-shadow:0 10px 28px rgba(0,212,255,.4);}
.btn-ghost{background:transparent; border:1px solid var(--line); color:var(--text); padding:11px 16px; border-radius:11px; font-weight:600; cursor:pointer; font-family:'Inter'; font-size:14px;}

.kpis{display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:14px; margin-bottom:14px;}
.card{background:var(--panel); border:1px solid var(--line); border-radius:16px; padding:18px;}
.kpi-label{font-size:11px; text-transform:uppercase; letter-spacing:.09em; color:var(--muted); font-weight:600;}
.kpi-val{font-family:'Montserrat'; font-weight:800; font-size:26px; margin-top:10px; letter-spacing:-.02em;}
.kpi-foot{font-size:12px; color:var(--muted); margin-top:6px;}
.kpi-alert{border-color:rgba(255,77,94,.4); background:linear-gradient(180deg, rgba(255,77,94,.1), var(--panel));}
.kpi-alert .kpi-val{color:var(--red);}

.split{display:flex; height:10px; border-radius:99px; overflow:hidden; margin:13px 0; background:rgba(255,255,255,.06);}
.split .o{background:var(--green);} .split .p{background:var(--cyan);}
.attr-cols{display:grid; grid-template-columns:1fr 1fr; gap:14px;}
.attr-box{border:1px solid var(--line); border-radius:12px; padding:14px;}
.attr-box h4{margin:0 0 8px; font-family:'Montserrat'; font-size:13px; display:flex; align-items:center; gap:7px;}
.attr-box .big{font-family:'Montserrat'; font-weight:800; font-size:22px;}
.attr-box .small{font-size:12px; color:var(--muted); margin-top:5px;}

.banner{display:flex; align-items:center; gap:14px; padding:16px 18px; border-radius:14px; margin-bottom:6px; background:linear-gradient(90deg, rgba(255,77,94,.16), rgba(255,77,94,.04)); border:1px solid rgba(255,77,94,.35);}
.banner-ic{flex:none; width:38px; height:38px; border-radius:11px; display:grid; place-items:center; background:rgba(255,77,94,.18); color:var(--red);}
.banner b{font-family:'Montserrat'; font-weight:700;}

.tabs{display:inline-flex; gap:4px; background:var(--panel); border:1px solid var(--line); border-radius:12px; padding:4px; margin:22px 0 16px; flex-wrap:wrap;}
.tab{display:inline-flex; align-items:center; gap:7px; padding:9px 15px; border-radius:9px; font-size:13px; font-weight:600; color:var(--muted); cursor:pointer; border:none; background:transparent; font-family:'Inter';}
.tab.active{background:var(--cyan); color:#04121f;}
.section-h{display:flex; align-items:center; gap:9px; font-size:12px; text-transform:uppercase; letter-spacing:.1em; color:var(--muted); font-weight:700; margin:24px 2px 14px;}
.section-h svg{color:var(--cyan);}

.ledger{display:flex; flex-direction:column; gap:12px;}
.row{background:var(--panel); border:1px solid var(--line); border-radius:16px; padding:16px 18px; display:grid; grid-template-columns:1.6fr 1fr 2.1fr auto; gap:18px; align-items:center;}
.row.flag{border-color:rgba(255,77,94,.45); background:linear-gradient(90deg, rgba(255,77,94,.07), var(--panel) 40%);}
.client-name{font-family:'Montserrat'; font-weight:700; font-size:16px;}
.client-meta{display:flex; flex-wrap:wrap; gap:6px 10px; font-size:11.5px; color:var(--muted); margin-top:6px; align-items:center;}
.client-meta span{display:inline-flex; align-items:center; gap:4px;}
.tag{display:inline-flex; align-items:center; gap:5px; font-size:11px; padding:3px 8px; border-radius:7px; background:var(--panel2); border:1px solid var(--line); color:var(--text);}
.tag svg{color:var(--cyan);}
.src{display:inline-flex; align-items:center; gap:5px; font-size:11px; padding:3px 8px; border-radius:7px; border:1px solid var(--line); white-space:nowrap;}
.src-organic{color:var(--green); background:rgba(43,217,160,.1); border-color:rgba(43,217,160,.3);}
.src-paid{color:var(--cyan); background:rgba(0,212,255,.08); border-color:rgba(0,212,255,.3);}
.amt-total{font-family:'Montserrat'; font-weight:700; font-size:17px;}
.amt-sub{font-size:11.5px; color:var(--muted); margin-top:3px; line-height:1.5;}
.amt-sub .ok{color:var(--green);} .amt-sub .late{color:var(--red); font-weight:600;}

.pills{display:flex; flex-wrap:wrap; gap:7px;}
.pill-wrap{position:relative;}
.pill{position:relative; display:flex; flex-direction:column; align-items:center; gap:3px; cursor:pointer; user-select:none; min-width:50px; padding:7px 8px 6px; border-radius:10px; border:1px solid var(--line); background:var(--panel2); transition:transform .1s, border-color .2s;}
.pill:hover{transform:translateY(-2px);}
.pill .m{font-size:10px; text-transform:uppercase; color:var(--muted);}
.pill .a{font-family:'Montserrat'; font-weight:700; font-size:12px;}
.pill .ic{width:15px; height:15px; margin-bottom:1px;}
.pill-paid{border-color:rgba(43,217,160,.5); background:rgba(43,217,160,.12);}
.pill-paid .ic,.pill-paid .a{color:var(--green);}
.pill-manual{border-color:rgba(43,217,160,.45); background:rgba(43,217,160,.1);}
.pill-manual .ic,.pill-manual .a{color:var(--green);}
.pill-manual::after{content:'VIR'; position:absolute; top:-7px; right:-6px; font-size:8px; font-weight:700; background:var(--amber); color:#1a1206; padding:1px 4px; border-radius:5px; font-family:'Montserrat';}
.pill-upcoming .a{color:var(--text);}
.pill-overdue{border-color:rgba(255,77,94,.6); background:rgba(255,77,94,.13); animation:pulse 2.1s ease-in-out infinite;}
.pill-overdue .ic,.pill-overdue .a,.pill-overdue .m{color:var(--red);}
.pill-next{box-shadow:0 0 0 2px rgba(0,212,255,.55);}
@keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(255,77,94,0);}50%{box-shadow:0 0 0 4px rgba(255,77,94,.18);}}
.pill-menu{position:absolute; top:calc(100% + 6px); left:50%; transform:translateX(-50%); z-index:30; background:var(--panel2); border:1px solid var(--line); border-radius:11px; padding:6px; width:215px; box-shadow:0 14px 40px rgba(0,0,0,.55);}
.menu-item{display:flex; align-items:center; gap:9px; padding:9px 10px; border-radius:8px; cursor:pointer; font-size:13px; white-space:nowrap;}
.menu-item:hover{background:rgba(255,255,255,.06);}
.menu-scrim{position:fixed; inset:0; z-index:20;}
.del{background:transparent; border:1px solid var(--line); color:var(--muted); width:34px; height:34px; border-radius:9px; display:grid; place-items:center; cursor:pointer;}
.del:hover{color:var(--red); border-color:rgba(255,77,94,.5);}

.matrix-wrap{overflow-x:auto;}
.tbl{width:100%; border-collapse:collapse; font-size:13.5px;}
.mtx{min-width:760px;}
.tbl th{text-align:left; font-size:11px; text-transform:uppercase; letter-spacing:.06em; color:var(--muted); font-weight:600; padding:11px 12px; border-bottom:1px solid var(--line); white-space:nowrap;}
.tbl td{padding:13px 12px; border-bottom:1px solid var(--line); vertical-align:middle; white-space:nowrap;}
.tbl .num{font-family:'Montserrat'; font-weight:600; text-align:right; font-variant-numeric:tabular-nums;}
.tbl th.num{text-align:right;}
.tbl .lab{font-family:'Montserrat'; font-weight:700;}
.green{color:var(--green);} .red{color:var(--red);} .mut{color:var(--muted);}
.grp-row td{background:var(--panel2); font-family:'Montserrat'; font-weight:700; font-size:12.5px; padding:11px 12px;}
.grp-row .gmeta{color:var(--muted); font-weight:500; font-size:11.5px; margin-left:8px;}
.tot-row td{border-top:2px solid var(--cyan); background:rgba(0,212,255,.05); font-family:'Montserrat'; font-weight:700;}
.tot-row .num{color:var(--cyan);}
.rate{display:flex; align-items:center; gap:9px; justify-content:flex-end;}
.bar{height:6px; width:74px; border-radius:99px; background:rgba(255,255,255,.08); overflow:hidden;}
.bar>span{display:block; height:100%; background:var(--green);}

.overlay{position:fixed; inset:0; background:rgba(4,8,16,.7); backdrop-filter:blur(4px); display:grid; place-items:center; z-index:50; padding:16px;}
.modal{background:var(--panel); border:1px solid var(--line); border-radius:20px; padding:26px; width:min(440px,100%); max-height:90vh; overflow:auto;}
.modal h3{font-family:'Montserrat'; font-weight:800; margin:0 0 4px; font-size:20px;}
.modal p{color:var(--muted); font-size:13px; margin:0 0 18px;}
.modal-close{float:right; background:transparent; border:none; color:var(--muted); cursor:pointer;}
.field{margin-bottom:14px;} .field label{display:block; font-size:12px; color:var(--muted); margin-bottom:6px; font-weight:600;}
.field input{width:100%; background:var(--bg); border:1px solid var(--line); border-radius:10px; padding:11px 12px; color:var(--text); font-size:14px; font-family:'Inter'; outline:none;}
.field input:focus{border-color:var(--cyan);}
.field-row{display:grid; grid-template-columns:1fr 1fr; gap:12px;}
.seg{display:flex; gap:8px;}
.seg button{flex:1; padding:10px; border-radius:10px; border:1px solid var(--line); background:var(--bg); color:var(--muted); cursor:pointer; font-family:'Inter'; font-size:13px; font-weight:600; display:flex; align-items:center; justify-content:center; gap:6px;}
.seg button.on-o{border-color:var(--green); color:var(--green); background:rgba(43,217,160,.1);}
.seg button.on-p{border-color:var(--cyan); color:var(--cyan); background:rgba(0,212,255,.08);}
.preview{background:var(--bg); border:1px dashed var(--line); border-radius:11px; padding:12px 14px; font-size:13px; color:var(--muted); margin:4px 0 18px;}
.preview b{color:var(--cyan); font-family:'Montserrat';}
.modal-actions{display:flex; gap:10px; justify-content:flex-end;}
.toast{position:fixed; bottom:24px; left:50%; transform:translateX(-50%); background:var(--panel2); border:1px solid var(--cyan); color:var(--text); padding:13px 20px; border-radius:12px; font-size:13px; z-index:60; box-shadow:0 12px 40px rgba(0,0,0,.5); max-width:90vw; text-align:center;}
@media(max-width:760px){ .row{grid-template-columns:1fr; gap:12px;} .field-row,.attr-cols{grid-template-columns:1fr;} }
`;

/* ------------------------------ component ------------------------------ */

export default function App() {
  const [sales, setSales] = useState([]);
  const [tab, setTab] = useState("clients");
  const [showAdd, setShowAdd] = useState(false);
  const [menu, setMenu] = useState(null);
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState({
    client: "", email: "", phone: "", closer: "", source: "", channel: "organic",
    offer: "Ecom Ascension", total: "", acompte: "", n: "", start: toISO(today),
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setSales(normalize(JSON.parse(raw)));
    } catch (e) { /* ignore corrupted storage */ }
  }, []);

  const persist = (next) => {
    setSales(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (e) { /* quota / private mode */ }
  };
  const flash = (m) => { setToast(m); setTimeout(() => setToast(null), 3800); };

  const [syncing, setSyncing] = useState(false);
  // Applique les ventes venues de la base (webhooks systeme.io) en conservant
  // l'attribution manuelle (canal/source/closer) et les ventes saisies à la main.
  const applyDbSales = (incoming) => {
    setSales((prev) => {
      const prevById = new Map(
        prev.filter((s) => String(s.id).startsWith("sio-")).map((s) => [s.id, s])
      );
      const merged = incoming.map((s) => {
        const p = prevById.get(s.id);
        return p ? { ...s, channel: p.channel, source: p.source, closer: p.closer } : s;
      });
      const manual = prev.filter((s) => !String(s.id).startsWith("sio-"));
      const next = [...manual, ...merged];
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch (e) { /* quota */ }
      return next;
    });
  };

  // Synchro depuis notre base (alimentée en continu par les webhooks systeme.io).
  const syncSio = async ({ silent = false } = {}) => {
    if (!silent) setSyncing(true);
    try {
      const r = await fetch("/api/sales");
      const data = await r.json();
      if (!r.ok) throw new Error(data && data.error ? data.error : `Erreur ${r.status}`);
      const incoming = normalize(data.sales || []);
      applyDbSales(incoming);
      if (!silent) flash(incoming.length
        ? `${incoming.length} client(s) synchronisé(s) depuis systeme.io.`
        : "Synchro OK — aucune vente en base pour l'instant (les webhooks alimentent au fil de l'eau).");
    } catch (e) {
      if (!silent) flash(`Synchro impossible : ${e.message}`);
    } finally {
      if (!silent) setSyncing(false);
    }
  };

  // Chargement automatique au démarrage.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { syncSio({ silent: true }); }, []);

  const allInst = useMemo(
    () => sales.flatMap((s) => s.schedule.map((i) => ({ ...i, saleId: s.id, st: statusOf(i) }))),
    [sales]
  );

  const k = useMemo(() => {
    const signed = sales.reduce((a, s) => a + s.total, 0);
    const paid = allInst.filter((i) => i.st === "paid");
    const collected = paid.reduce((a, i) => a + i.amount, 0);
    const manual = paid.filter((i) => i.method === "manual").reduce((a, i) => a + i.amount, 0);
    const overdue = allInst.filter((i) => i.st === "overdue");
    const cm = toISO(today).slice(0, 7);
    return {
      signed, collected, manual,
      overdueAmt: overdue.reduce((a, i) => a + i.amount, 0), overdueCount: overdue.length,
      outstanding: allInst.filter((i) => i.st !== "paid").reduce((a, i) => a + i.amount, 0),
      dueThisMonth: allInst.filter((i) => i.st !== "paid" && i.dueDate.slice(0, 7) === cm).reduce((a, i) => a + i.amount, 0),
    };
  }, [sales, allInst]);

  const attr = useMemo(() => {
    const g = { organic: { signed: 0, collected: 0, clients: 0 }, paid: { signed: 0, collected: 0, clients: 0 } };
    sales.forEach((s) => {
      const c = s.channel === "paid" ? "paid" : "organic";
      g[c].signed += s.total; g[c].clients += 1;
      g[c].collected += s.schedule.filter((i) => i.paid).reduce((a, i) => a + i.amount, 0);
    });
    const tot = g.organic.signed + g.paid.signed || 1;
    return { ...g, oShare: g.organic.signed / tot, pShare: g.paid.signed / tot };
  }, [sales]);

  const forecast = useMemo(() => {
    const m = {};
    allInst.forEach((i) => { const key = monthKey(i.dueDate); if (!m[key]) m[key] = { key, paid: 0, due: 0 }; if (i.paid) m[key].paid += i.amount; else m[key].due += i.amount; });
    return Object.values(m).sort((a, b) => a.key.localeCompare(b.key)).map((x) => ({ ...x, label: monthLabel(x.key) }));
  }, [allInst]);

  const monthCols = useMemo(() => [...new Set(allInst.map((i) => monthKey(i.dueDate)))].sort(), [allInst]);

  const cohortGroups = useMemo(() => {
    const m = {};
    sales.forEach((s) => {
      const key = monthKey(s.closeDate);
      if (!m[key]) m[key] = { key, label: monthLabel(key), sales: [], clients: 0, signed: 0, collected: 0, overdue: 0 };
      const g = m[key]; g.sales.push(s); g.clients += 1; g.signed += s.total;
      s.schedule.forEach((i) => { const st = statusOf(i); if (st === "paid") g.collected += i.amount; else if (st === "overdue") g.overdue += i.amount; });
    });
    return Object.values(m).sort((a, b) => a.key.localeCompare(b.key)).map((g) => ({ ...g, rate: g.signed ? g.collected / g.signed : 0 }));
  }, [sales]);

  const months = useMemo(() => {
    const m = {};
    allInst.forEach((i) => {
      const key = monthKey(i.dueDate); if (!m[key]) m[key] = { key, encaisse: 0, aVenir: 0, impaye: 0, total: 0 };
      const g = m[key]; g.total += i.amount;
      if (i.st === "paid") g.encaisse += i.amount; else if (i.st === "overdue") g.impaye += i.amount; else g.aVenir += i.amount;
    });
    return Object.values(m).sort((a, b) => a.key.localeCompare(b.key)).map((x) => ({ ...x, label: monthLabel(x.key) }));
  }, [allInst]);

  const [selMonth, setSelMonth] = useState(toISO(today).slice(0, 7));
  const daysLate = (iso) => Math.max(0, Math.floor((today - parseLocal(iso)) / 86400000));

  // Toutes les échéances en retard (impayés), tri du plus ancien au plus récent.
  const overdues = useMemo(() => {
    const list = [];
    sales.forEach((s) => s.schedule.forEach((i) => {
      if (statusOf(i) === "overdue") list.push({ ...i, sale: s });
    }));
    return list.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [sales]);

  // Mois disponibles pour le filtre "À collecter".
  const monthOptions = useMemo(() => {
    const set = new Set(allInst.map((i) => monthKey(i.dueDate)));
    set.add(toISO(today).slice(0, 7));
    return [...set].sort();
  }, [allInst]);

  // Échéances du mois sélectionné (toutes, payées et à venir).
  const monthList = useMemo(() => {
    const list = [];
    sales.forEach((s) => s.schedule.forEach((i) => {
      if (monthKey(i.dueDate) === selMonth) list.push({ ...i, sale: s, st: statusOf(i) });
    }));
    return list.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [sales, selMonth]);

  const monthTot = useMemo(() => ({
    toCollect: monthList.filter((i) => !i.paid).reduce((a, i) => a + i.amount, 0),
    collected: monthList.filter((i) => i.paid).reduce((a, i) => a + i.amount, 0),
    overdue: monthList.filter((i) => i.st === "overdue").reduce((a, i) => a + i.amount, 0),
    count: monthList.filter((i) => !i.paid).length,
  }), [monthList]);

  const nextDue = (s) => s.schedule.filter((i) => !i.paid).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] || null;
  const hasOverdue = (s) => s.schedule.some((i) => statusOf(i) === "overdue");

  const setPayment = (saleId, instId, paid, method) => {
    persist(sales.map((s) => s.id !== saleId ? s : { ...s, schedule: s.schedule.map((i) => i.id === instId ? { ...i, paid, method: paid ? method : null, paidDate: paid ? toISO(today) : null } : i) }));
    setMenu(null);
  };
  const removeSale = (id) => persist(sales.filter((s) => s.id !== id));
  // Attribution manuelle organique ⇄ paid (systeme.io ne fournit pas la donnée).
  const toggleChannel = (id) =>
    persist(sales.map((s) => s.id !== id ? s : { ...s, channel: s.channel === "paid" ? "organic" : "paid" }));

  const pv = (() => {
    const total = parseFloat(String(form.total).replace(",", ".")) || 0;
    const ac = parseFloat(String(form.acompte).replace(",", ".")) || 0;
    const n = parseInt(form.n) || 0;
    return (!n || total <= 0) ? null : { each: round2((total - ac) / n), n, ac };
  })();

  const addSale = () => {
    const total = parseFloat(String(form.total).replace(",", ".")) || 0;
    const ac = parseFloat(String(form.acompte).replace(",", ".")) || 0;
    const n = parseInt(form.n) || 0;
    if (!form.client.trim() || total <= 0 || n <= 0) { flash("Renseigne au moins le nom, le montant total et le nombre de mensualités."); return; }
    const start = parseLocal(form.start); const each = round2((total - ac) / n); const schedule = [];
    if (ac > 0) schedule.push({ id: `i-${Date.now()}-ac`, dueDate: toISO(today), amount: ac, paid: true, method: "manual" });
    for (let i = 0; i < n; i++) {
      const amt = i === n - 1 ? round2(total - ac - each * (n - 1)) : each;
      schedule.push({ id: `i-${Date.now()}-${i}`, dueDate: toISO(addMonths(start, i)), amount: amt, paid: false, method: null });
    }
    persist([...sales, {
      id: `s-${Date.now()}`, client: form.client.trim(), email: form.email.trim(), phone: form.phone.trim(),
      closer: form.closer.trim() || "—", source: form.source.trim() || "—", channel: form.channel,
      offer: form.offer || "Ecom Ascension", closeDate: toISO(today), total, schedule,
    }]);
    setShowAdd(false);
    setForm({ client: "", email: "", phone: "", closer: "", source: "", channel: "organic", offer: "Ecom Ascension", total: "", acompte: "", n: "", start: toISO(today) });
    flash(`Plan créé pour ${form.client.trim()}.`);
  };

  const cell = (insts) => {
    if (!insts.length) return <td className="num" style={{ opacity: .22 }}>·</td>;
    const amt = insts.reduce((a, i) => a + i.amount, 0);
    const over = insts.some((i) => statusOf(i) === "overdue");
    const allPaid = insts.every((i) => i.paid);
    return <td className={`num ${over ? "red" : allPaid ? "green" : ""}`}>{euro(amt)}</td>;
  };

  return (
    <div className="melo">
      <style>{css}</style>
      <style>{`
        .month-sel{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:7px 12px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;}
        .row-actions{display:inline-flex;gap:6px;justify-content:flex-end;}
        .mini{display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:7px;border:1px solid var(--line);background:var(--panel2);color:var(--text);cursor:pointer;transition:.15s;}
        .mini:hover{border-color:rgba(255,255,255,.28);}
        .mini.ok:hover{color:#2BD9A0;border-color:#2BD9A0;}
        .mini.warn:hover{color:#FFB020;border-color:#FFB020;}
        .badge{display:inline-block;font-size:11px;font-weight:600;padding:3px 9px;border-radius:20px;border:1px solid var(--line);}
        .badge.green{color:#2BD9A0;border-color:rgba(43,217,160,.4);background:rgba(43,217,160,.08);}
        .badge.red{color:#FF4D5E;border-color:rgba(255,77,94,.4);background:rgba(255,77,94,.08);}
        .badge.mut{color:rgba(234,242,255,.55);}
        .empty{padding:46px 20px;text-align:center;color:rgba(234,242,255,.55);font-size:14px;}
      `}</style>

      <header className="melo-head">
        <div>
          <h1 className="melo-title">Suivi des paiements <span className="accent">·</span> Melo</h1>
          <div className="melo-sub">Clients iClosed + plans Systeme.io · cohortes, impayés, acquisition</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <span className="chip"><span className="dot" /> Source : systeme.io
            <button onClick={() => syncSio()} disabled={syncing}>{syncing ? "Synchro…" : "Synchroniser"}</button>
          </span>
          <button className="btn-primary" onClick={() => setShowAdd(true)}><Plus size={17} /> Ajouter une vente</button>
        </div>
      </header>

      <div className="kpis">
        <div className="card"><div className="kpi-label">CA signé</div><div className="kpi-val">{euro(k.signed)}</div><div className="kpi-foot">{sales.length} clients</div></div>
        <div className="card"><div className="kpi-label">Encaissé</div><div className="kpi-val" style={{ color: "var(--green)" }}>{euro(k.collected)}</div><div className="kpi-foot">{k.signed ? Math.round((k.collected / k.signed) * 100) : 0}% du signé · {euro(k.manual)} en direct</div></div>
        <div className="card"><div className="kpi-label">Reste à encaisser</div><div className="kpi-val">{euro(k.outstanding)}</div><div className="kpi-foot">dont {euro(k.dueThisMonth)} ce mois-ci</div></div>
        <div className={`card ${k.overdueCount ? "kpi-alert" : ""}`}><div className="kpi-label">Impayés</div><div className="kpi-val">{euro(k.overdueAmt)}</div><div className="kpi-foot">{k.overdueCount} échéance{k.overdueCount > 1 ? "s" : ""} en retard</div></div>
        <div className="card"><div className="kpi-label" style={{ display: "flex", alignItems: "center", gap: 6 }}><Leaf size={13} color="#2BD9A0" /> Revenu organique</div><div className="kpi-val green">{euro(attr.organic.signed)}</div><div className="kpi-foot">{Math.round(attr.oShare * 100)}% · {euro(attr.organic.collected)} encaissé · {attr.organic.clients} clients</div></div>
        <div className="card"><div className="kpi-label" style={{ display: "flex", alignItems: "center", gap: 6 }}><Megaphone size={13} color="#00D4FF" /> Revenu paid</div><div className="kpi-val" style={{ color: "var(--cyan)" }}>{euro(attr.paid.signed)}</div><div className="kpi-foot">{Math.round(attr.pShare * 100)}% · {euro(attr.paid.collected)} encaissé · {attr.paid.clients} clients</div></div>
      </div>

      {k.overdueCount > 0 && (
        <div className="banner"><div className="banner-ic"><AlertTriangle size={20} /></div>
          <div><b>{k.overdueCount} impayé{k.overdueCount > 1 ? "s" : ""} à relancer</b> · {euro(k.overdueAmt)} dépassé. <span className="mut">Si tu as reçu un virement, marque l'échéance "encaissé en direct".</span></div>
        </div>
      )}

      <div className="tabs">
        <button className={`tab ${tab === "clients" ? "active" : ""}`} onClick={() => setTab("clients")}><Users size={15} /> Clients</button>
        <button className={`tab ${tab === "cohortes" ? "active" : ""}`} onClick={() => setTab("cohortes")}><Grid3x3 size={15} /> Cohortes</button>
        <button className={`tab ${tab === "impayes" ? "active" : ""}`} onClick={() => setTab("impayes")}><AlertTriangle size={15} /> Impayés{k.overdueCount ? ` (${k.overdueCount})` : ""}</button>
        <button className={`tab ${tab === "collecte" ? "active" : ""}`} onClick={() => setTab("collecte")}><Landmark size={15} /> À collecter</button>
        <button className={`tab ${tab === "mois" ? "active" : ""}`} onClick={() => setTab("mois")}><Calendar size={15} /> Par mois</button>
      </div>

      {/* CLIENTS */}
      {tab === "clients" && (
        <div className="ledger">
          {sales.map((s) => {
            const nd = nextDue(s); const ndSt = nd ? statusOf(nd) : null;
            const paidSum = s.schedule.filter((i) => i.paid).reduce((a, i) => a + i.amount, 0);
            return (
              <div key={s.id} className={`row ${hasOverdue(s) ? "flag" : ""}`}>
                <div>
                  <div className="client-name">{s.client}</div>
                  <div className="client-meta">
                    <span className={`src src-${s.channel === "paid" ? "paid" : "organic"}`} role="button" style={{ cursor: "pointer" }} title="Cliquer pour basculer organique / paid" onClick={(e) => { e.stopPropagation(); toggleChannel(s.id); }}>{s.channel === "paid" ? <Megaphone size={11} /> : <Leaf size={11} />}{s.source}</span>
                    <span className="tag"><UserCheck size={12} /> {s.closer}</span>
                    {s.email && <span><Mail size={12} /> {s.email}</span>}
                    {s.phone && <span><Phone size={12} /> {s.phone}</span>}
                  </div>
                </div>
                <div>
                  <div className="amt-total">{euro(s.total)}</div>
                  <div className="amt-sub"><span className="ok">{euro(paidSum)} encaissé</span><br />
                    {nd ? <>prochaine : {dateLabel(nd.dueDate)} {ndSt === "overdue" ? <span className="late">(en retard)</span> : <>({euro(nd.amount)})</>}</> : <>soldé</>}</div>
                </div>
                <div className="pills">
                  {s.schedule.map((inst) => {
                    const st = statusOf(inst);
                    const cls = st === "paid" ? (inst.method === "manual" ? "pill-manual" : "pill-paid") : `pill-${st}`;
                    const isNext = nd && inst.id === nd.id;
                    return (
                      <div key={inst.id} className="pill-wrap">
                        <div className={`pill ${cls} ${isNext ? "pill-next" : ""}`} onClick={(e) => { e.stopPropagation(); setMenu(menu === inst.id ? null : inst.id); }} title={`${dateLabel(inst.dueDate)} · ${euro2(inst.amount)}`}>
                          <span className="m">{monthLabel(monthKey(inst.dueDate))}</span>
                          {st === "paid" && (inst.method === "manual" ? <Landmark className="ic" size={15} /> : <Check className="ic" size={15} />)}
                          {st === "overdue" && <AlertTriangle className="ic" size={15} />}
                          <span className="a">{euro(inst.amount)}</span>
                        </div>
                        {menu === inst.id && (<>
                          <div className="menu-scrim" onClick={() => setMenu(null)} />
                          <div className="pill-menu" onClick={(e) => e.stopPropagation()}>
                            <div className="menu-item" onClick={() => setPayment(s.id, inst.id, true, "auto")}><Check size={15} color="#2BD9A0" /> Encaissé (Stripe)</div>
                            <div className="menu-item" onClick={() => setPayment(s.id, inst.id, true, "manual")}><Landmark size={15} color="#FFB020" /> Encaissé en direct (virement)</div>
                            <div className="menu-item" onClick={() => setPayment(s.id, inst.id, false, null)}><RotateCcw size={15} color="#FF4D5E" /> Remettre en attente</div>
                          </div>
                        </>)}
                      </div>
                    );
                  })}
                </div>
                <button className="del" onClick={() => removeSale(s.id)} title="Supprimer"><Trash2 size={15} /></button>
              </div>
            );
          })}
        </div>
      )}

      {/* COHORTES — matrice façon tableur */}
      {tab === "cohortes" && (
        <div className="card" style={{ padding: 6 }}>
          <div className="matrix-wrap">
            <table className="tbl mtx">
              <thead><tr>
                <th>Client</th><th>Source</th><th className="num">Total</th>
                {monthCols.map((mk) => <th key={mk} className="num">{monthLabel(mk)}</th>)}
              </tr></thead>
              <tbody>
                {cohortGroups.map((g) => (
                  <React.Fragment key={g.key}>
                    <tr className="grp-row"><td colSpan={3 + monthCols.length}>
                      Cohorte {g.label}<span className="gmeta">{g.clients} clients · {euro(g.signed)} signés · {Math.round(g.rate * 100)}% recouvré{g.overdue ? ` · ${euro(g.overdue)} impayés` : ""}</span>
                    </td></tr>
                    {g.sales.map((s) => (
                      <tr key={s.id}>
                        <td className="lab">{s.client}</td>
                        <td><span className={`src src-${s.channel === "paid" ? "paid" : "organic"}`}>{s.source}</span></td>
                        <td className="num">{euro(s.total)}</td>
                        {monthCols.map((mk) => <React.Fragment key={mk}>{cell(s.schedule.filter((i) => monthKey(i.dueDate) === mk))}</React.Fragment>)}
                      </tr>
                    ))}
                  </React.Fragment>
                ))}
                <tr className="tot-row">
                  <td className="lab">Total</td><td /><td className="num">{euro(k.signed)}</td>
                  {monthCols.map((mk) => <td key={mk} className="num">{euro(allInst.filter((i) => monthKey(i.dueDate) === mk).reduce((a, i) => a + i.amount, 0))}</td>)}
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* PAR MOIS */}
      {tab === "mois" && (<>
        <div className="section-h"><TrendingUp size={15} /> Prévisionnel d'encaissement (par échéance)</div>
        <div className="card" style={{ paddingLeft: 6 }}>
          <ResponsiveContainer width="100%" height={210}>
            <BarChart data={forecast} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "rgba(234,242,255,.55)", fontSize: 12 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "rgba(234,242,255,.4)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
              <Tooltip cursor={{ fill: "rgba(255,255,255,.04)" }} contentStyle={{ background: "#16243d", border: "1px solid rgba(255,255,255,.12)", borderRadius: 10, color: "#EAF2FF" }} formatter={(v, n) => [euro(v), n === "paid" ? "Encaissé" : "À encaisser"]} />
              <Bar dataKey="paid" stackId="a" fill="#2BD9A0" />
              <Bar dataKey="due" stackId="a" fill="#00D4FF" radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="card" style={{ padding: 6, marginTop: 14 }}>
          <table className="tbl">
            <thead><tr><th>Mois</th><th className="num">Encaissé</th><th className="num">À encaisser</th><th className="num">Impayés</th><th className="num">Total attendu</th></tr></thead>
            <tbody>{months.map((m) => (
              <tr key={m.key}><td className="lab">{m.label}</td><td className="num green">{euro(m.encaisse)}</td><td className="num">{euro(m.aVenir)}</td><td className={`num ${m.impaye ? "red" : "mut"}`}>{euro(m.impaye)}</td><td className="num">{euro(m.total)}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </>)}

      {/* IMPAYÉS */}
      {tab === "impayes" && (
        <div className="card" style={{ padding: 6 }}>
          {overdues.length === 0 ? (
            <div className="empty">Aucun impayé 🎉 Toutes les échéances dépassées sont réglées.</div>
          ) : (
            <table className="tbl">
              <thead><tr>
                <th>Client</th><th>Source</th><th>Offre</th><th className="num">Échéance</th><th className="num">Retard</th><th className="num">Montant</th><th className="num">Relance</th>
              </tr></thead>
              <tbody>
                {overdues.map((i) => (
                  <tr key={i.id}>
                    <td className="lab">{i.sale.client}{i.sale.phone && <span className="mut" style={{ fontWeight: 400 }}> · {i.sale.phone}</span>}</td>
                    <td><span className={`src src-${i.sale.channel === "paid" ? "paid" : "organic"}`}>{i.sale.channel === "paid" ? <Megaphone size={11} /> : <Leaf size={11} />}{i.sale.source}</span></td>
                    <td className="mut">{i.sale.offer}</td>
                    <td className="num">{dateLabel(i.dueDate)}</td>
                    <td className="num red">{daysLate(i.dueDate)} j</td>
                    <td className="num">{euro(i.amount)}</td>
                    <td className="num">
                      <div className="row-actions">
                        <button className="mini ok" title="Encaissé (Stripe)" onClick={() => setPayment(i.sale.id, i.id, true, "auto")}><Check size={14} /></button>
                        <button className="mini warn" title="Encaissé en direct (virement)" onClick={() => setPayment(i.sale.id, i.id, true, "manual")}><Landmark size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                <tr className="tot-row"><td className="lab">Total impayés</td><td /><td /><td /><td className="num mut">{overdues.length} éch.</td><td className="num red">{euro(k.overdueAmt)}</td><td /></tr>
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* À COLLECTER — filtre par mois */}
      {tab === "collecte" && (<>
        <div className="section-h" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Landmark size={15} /> Paiements à collecter
          <select className="month-sel" value={selMonth} onChange={(e) => setSelMonth(e.target.value)}>
            {monthOptions.map((mk) => <option key={mk} value={mk}>{monthLabel(mk)}</option>)}
          </select>
        </div>
        <div className="kpis" style={{ marginTop: 4 }}>
          <div className="card"><div className="kpi-label">À collecter · {monthLabel(selMonth)}</div><div className="kpi-val">{euro(monthTot.toCollect)}</div><div className="kpi-foot">{monthTot.count} échéance{monthTot.count > 1 ? "s" : ""}</div></div>
          <div className="card"><div className="kpi-label">Déjà encaissé ce mois</div><div className="kpi-val green">{euro(monthTot.collected)}</div></div>
          <div className={`card ${monthTot.overdue ? "kpi-alert" : ""}`}><div className="kpi-label">Dont en retard</div><div className="kpi-val">{euro(monthTot.overdue)}</div></div>
        </div>
        <div className="card" style={{ padding: 6, marginTop: 14 }}>
          {monthList.length === 0 ? (
            <div className="empty">Aucune échéance sur {monthLabel(selMonth)}.</div>
          ) : (
            <table className="tbl">
              <thead><tr><th>Client</th><th>Source</th><th className="num">Échéance</th><th>Statut</th><th className="num">Montant</th><th className="num">Action</th></tr></thead>
              <tbody>
                {monthList.map((i) => (
                  <tr key={i.id}>
                    <td className="lab">{i.sale.client}</td>
                    <td><span className={`src src-${i.sale.channel === "paid" ? "paid" : "organic"}`}>{i.sale.channel === "paid" ? <Megaphone size={11} /> : <Leaf size={11} />}{i.sale.source}</span></td>
                    <td className="num">{dateLabel(i.dueDate)}</td>
                    <td>{i.st === "paid" ? <span className="badge green">Encaissé</span> : i.st === "overdue" ? <span className="badge red">En retard</span> : <span className="badge mut">À venir</span>}</td>
                    <td className="num">{euro(i.amount)}</td>
                    <td className="num">
                      <div className="row-actions">
                        {!i.paid ? (<>
                          <button className="mini ok" title="Encaissé (Stripe)" onClick={() => setPayment(i.sale.id, i.id, true, "auto")}><Check size={14} /></button>
                          <button className="mini warn" title="Encaissé en direct (virement)" onClick={() => setPayment(i.sale.id, i.id, true, "manual")}><Landmark size={14} /></button>
                        </>) : (
                          <button className="mini" title="Remettre en attente" onClick={() => setPayment(i.sale.id, i.id, false, null)}><RotateCcw size={14} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                <tr className="tot-row"><td className="lab">À collecter</td><td /><td /><td /><td className="num">{euro(monthTot.toCollect)}</td><td /></tr>
              </tbody>
            </table>
          )}
        </div>
      </>)}

      {/* ADD MODAL */}
      {showAdd && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setShowAdd(false)}>
          <div className="modal">
            <button className="modal-close" onClick={() => setShowAdd(false)}><X size={20} /></button>
            <h3>Nouvelle vente</h3>
            <p>Infos client, source du lead et plan de paiement.</p>
            <div className="field"><label>Nom du client</label><input value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} placeholder="Ex : Sofiane K." /></div>
            <div className="field-row">
              <div className="field"><label>Email</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="email@…" /></div>
              <div className="field"><label>Téléphone</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} placeholder="+33…" /></div>
            </div>
            <div className="field-row">
              <div className="field"><label>Closer (iClosed)</label><input value={form.closer} onChange={(e) => setForm({ ...form, closer: e.target.value })} placeholder="Yanis" /></div>
              <div className="field"><label>Source du lead</label><input value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="YouTube, Meta Ads…" /></div>
            </div>
            <div className="field">
              <label>Canal d'acquisition</label>
              <div className="seg">
                <button className={form.channel === "organic" ? "on-o" : ""} onClick={() => setForm({ ...form, channel: "organic" })}><Leaf size={14} /> Organique</button>
                <button className={form.channel === "paid" ? "on-p" : ""} onClick={() => setForm({ ...form, channel: "paid" })}><Megaphone size={14} /> Paid</button>
              </div>
            </div>
            <div className="field-row">
              <div className="field"><label>Montant total (€)</label><input value={form.total} onChange={(e) => setForm({ ...form, total: e.target.value })} placeholder="2390" inputMode="decimal" /></div>
              <div className="field"><label>Acompte (€)</label><input value={form.acompte} onChange={(e) => setForm({ ...form, acompte: e.target.value })} placeholder="0" inputMode="decimal" /></div>
            </div>
            <div className="field-row">
              <div className="field"><label>Nb de mensualités</label><input value={form.n} onChange={(e) => setForm({ ...form, n: e.target.value })} placeholder="4" inputMode="numeric" /></div>
              <div className="field"><label>1ère échéance</label><input type="date" value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value })} /></div>
            </div>
            {pv && <div className="preview">{pv.ac > 0 && <>Acompte <b>{euro2(pv.ac)}</b>, puis </>}{pv.n} mensualité{pv.n > 1 ? "s" : ""} de <b>{euro2(pv.each)}</b> dès le {dateLabel(form.start)}.</div>}
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setShowAdd(false)}>Annuler</button>
              <button className="btn-primary" onClick={addSale}><Check size={16} /> Créer le plan</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
