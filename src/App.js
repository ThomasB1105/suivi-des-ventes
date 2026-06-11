import React, { useState, useEffect, useMemo } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";
import {
  AlertTriangle, Check, Plus, X, Calendar, TrendingUp, Trash2, Landmark,
  RotateCcw, Users, UserCheck, Phone, Mail, Leaf, Megaphone, Grid3x3, Search, Pencil, Wallet,
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

const addDays = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n);
const fmtFr = (iso) => parseLocal(iso).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
const presetRange = (key) => {
  const t = today, Y = t.getFullYear(), M = t.getMonth(), I = toISO;
  switch (key) {
    case "today": return { from: I(t), to: I(t) };
    case "yesterday": { const y = addDays(t, -1); return { from: I(y), to: I(y) }; }
    case "7d": return { from: I(addDays(t, -6)), to: I(t) };
    case "30d": return { from: I(addDays(t, -29)), to: I(t) };
    case "mtd": return { from: I(new Date(Y, M, 1)), to: I(new Date(Y, M + 1, 0)) };
    case "lastmonth": return { from: I(new Date(Y, M - 1, 1)), to: I(new Date(Y, M, 0)) };
    case "ytd": return { from: I(new Date(Y, 0, 1)), to: I(t) };
    case "year": return { from: I(new Date(Y, 0, 1)), to: I(new Date(Y, 11, 31)) };
    case "lastyear": return { from: I(new Date(Y - 1, 0, 1)), to: I(new Date(Y - 1, 11, 31)) };
    case "all": return { from: "2000-01-01", to: I(new Date(Y + 2, 11, 31)) };
    default: return { from: I(new Date(Y, M, 1)), to: I(new Date(Y, M + 1, 0)) };
  }
};
const PRESETS = [
  ["today", "Aujourd'hui"], ["yesterday", "Hier"], ["7d", "7 derniers jours"], ["30d", "30 derniers jours"],
  ["mtd", "Mois en cours"], ["lastmonth", "Mois dernier"], ["ytd", "Depuis janvier"],
  ["year", "Cette année"], ["lastyear", "Année dernière"], ["all", "Tout"],
];

const monthKey = (iso) => iso.slice(0, 7);
const monthLabel = (key) => {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }).replace(".", "");
};
const dateLabel = (iso) => parseLocal(iso).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
const statusOf = (inst) => inst.cancelled ? "cancelled" : inst.refunded ? "refunded" : inst.paid ? "paid" : (parseLocal(inst.dueDate) < today ? "overdue" : "upcoming");
const isActive = (inst) => !inst.cancelled && !inst.refunded; // compte dans les montants attendus

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
  const [q, setQ] = useState("");
  const [payFor, setPayFor] = useState(null);
  const [payForm, setPayForm] = useState({ amount: "", date: toISO(today), method: "manual" });
  const [editFor, setEditFor] = useState(null);
  const [editDraft, setEditDraft] = useState(null);
  const [range, setRange] = useState(() => presetRange("mtd"));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [calMonth, setCalMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [selStart, setSelStart] = useState(null);
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
  const [deletedSales, setDeletedSales] = useState(() => { try { return JSON.parse(localStorage.getItem("melo_deleted_v1") || "[]"); } catch (e) { return []; } });
  // Coûts récurrents (logiciels…) + dépenses pub Meta.
  const [costs, setCosts] = useState(() => { try { return JSON.parse(localStorage.getItem("melo_costs_v1") || "[]"); } catch (e) { return []; } });
  const [costForm, setCostForm] = useState({ name: "", amount: "", type: "logiciel" });
  const [metaSpend, setMetaSpend] = useState({ configured: false, spend: 0 });
  const persistCosts = (next) => { setCosts(next); try { localStorage.setItem("melo_costs_v1", JSON.stringify(next)); } catch (e) { /* quota */ } };
  const addCost = () => {
    const amt = parseFloat(String(costForm.amount).replace(",", ".")) || 0;
    if (!costForm.name.trim() || amt <= 0) { flash("Indique un nom et un montant."); return; }
    persistCosts([...costs, { id: `c-${Date.now()}`, name: costForm.name.trim(), amount: amt, type: costForm.type }]);
    setCostForm({ name: "", amount: "", type: "logiciel" });
  };
  const removeCost = (id) => persistCosts(costs.filter((c) => c.id !== id));
  // Applique les ventes venues de la base (webhooks systeme.io) en conservant
  // l'attribution manuelle (canal/source/closer) et les ventes saisies à la main.
  // Synchro : ajoute les nouveaux clients ET rafraîchit les clients existants
  // (nouveaux paiements) en PRÉSERVANT les corrections manuelles :
  //  - attribution (canal), nom/téléphone/email édités
  //  - échéances annulées / remboursées
  //  - encaissements marqués à la main (virement) ou ajoutés (id "m-…")
  const applyDbSales = (incomingRaw) => {
    const incoming = incomingRaw.filter((s) => !deletedSales.includes(s.id)); // clients supprimés à la main
    setSales((prev) => {
      const prevById = new Map(prev.map((s) => [s.id, s]));
      const incIds = new Set(incoming.map((s) => s.id));
      const merged = incoming.map((inc) => {
        const loc = prevById.get(inc.id);
        if (!loc) return inc; // nouveau client
        const del = new Set(loc.deletedInsts || []);
        const ov = loc.ov || {};
        // base = échéances serveur (vérité financière), moins les suppressions, + overlay
        const schedule = inc.schedule
          .filter((i) => !del.has(i.id))
          .map((i) => (ov[i.id] ? { ...i, ...ov[i.id] } : i));
        // + encaissements ajoutés à la main (id "m-…", absents du serveur)
        loc.schedule.forEach((i) => { if (String(i.id).startsWith("m-")) schedule.push(i); });
        schedule.sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
        const total = schedule.reduce((a, i) => a + (i.cancelled || i.refunded ? 0 : i.amount), 0);
        return { ...inc, client: loc.client, phone: loc.phone || inc.phone, email: loc.email || inc.email, closer: loc.closer, source: loc.source, channel: loc.channel, ov, deletedInsts: loc.deletedInsts || [], schedule, total };
      });
      // conserver les ventes purement manuelles (ajoutées via "Ajouter une vente")
      prev.forEach((s) => { if (!incIds.has(s.id)) merged.push(s); });
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(merged)); } catch (e) { /* quota */ }
      return merged;
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
      if (i.st === "cancelled" || i.st === "refunded") return;
      const key = monthKey(i.dueDate); if (!m[key]) m[key] = { key, encaisse: 0, aVenir: 0, impaye: 0, total: 0 };
      const g = m[key]; g.total += i.amount;
      if (i.st === "paid") g.encaisse += i.amount; else if (i.st === "overdue") g.impaye += i.amount; else g.aVenir += i.amount;
    });
    return Object.values(m).sort((a, b) => a.key.localeCompare(b.key)).map((x) => ({ ...x, label: monthLabel(x.key) }));
  }, [allInst]);

  const daysLate = (iso) => Math.max(0, Math.floor((today - parseLocal(iso)) / 86400000));

  const nextDue = (s) => s.schedule.filter((i) => !i.paid && isActive(i)).sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0] || null;
  const hasOverdue = (s) => s.schedule.some((i) => statusOf(i) === "overdue");

  // Applique un correctif à une échéance ET le mémorise (overlay s.ov) pour qu'il
  // survive aux synchros suivantes.
  const patchInst = (saleId, instId, patch) => {
    persist(sales.map((s) => {
      if (s.id !== saleId) return s;
      const ov = { ...(s.ov || {}), [instId]: { ...((s.ov || {})[instId] || {}), ...patch } };
      const schedule = s.schedule.map((i) => i.id === instId ? { ...i, ...patch } : i);
      return { ...s, ov, schedule };
    }));
  };
  const setPayment = (saleId, instId, paid, method) => {
    patchInst(saleId, instId, { paid, method: paid ? method : null, cancelled: false, refunded: false, paidDate: paid ? toISO(today) : null });
    setMenu(null);
  };
  // Annuler une échéance (sort des impayés) ou la marquer remboursée.
  const setInstState = (saleId, instId, patch) => {
    patchInst(saleId, instId, { paid: false, method: null, cancelled: false, refunded: false, ...patch });
    setMenu(null);
  };
  const removeSale = (id) => {
    if (String(id).startsWith("sio-")) {
      const next = [...new Set([...deletedSales, id])];
      setDeletedSales(next);
      try { localStorage.setItem("melo_deleted_v1", JSON.stringify(next)); } catch (e) { /* quota */ }
    }
    persist(sales.filter((s) => s.id !== id));
  };
  // Supprimer une seule échéance — et mémoriser la suppression (persiste à la synchro).
  const removeInst = (saleId, instId) => {
    persist(sales.map((s) => s.id !== saleId ? s : {
      ...s,
      schedule: s.schedule.filter((i) => i.id !== instId),
      deletedInsts: [...(s.deletedInsts || []), instId],
    }));
    setMenu(null);
  };
  // Ajouter un encaissement manuel à un client (ex : acompte reçu sur Stripe).
  const addPayment = () => {
    const amt = parseFloat(String(payForm.amount).replace(",", ".")) || 0;
    if (!payFor || amt <= 0) { flash("Indique un montant valide."); return; }
    const inst = { id: `m-${Date.now()}`, dueDate: payForm.date || toISO(today), amount: amt, paid: true, method: payForm.method || "manual" };
    persist(sales.map((s) => s.id !== payFor ? s : { ...s, schedule: [...s.schedule, inst].sort((a, b) => a.dueDate.localeCompare(b.dueDate)) }));
    setPayFor(null);
    setPayForm({ amount: "", date: toISO(today), method: "manual" });
    flash("Encaissement ajouté.");
  };
  const matchQ = (s) => !q.trim() || `${s.client} ${s.source} ${s.email}`.toLowerCase().includes(q.trim().toLowerCase());

  // Édition complète d'une fiche client (échéances personnalisables).
  const openEdit = (s) => { setEditFor(s.id); setEditDraft({ client: s.client, phone: s.phone || "", email: s.email || "", schedule: s.schedule.map((i) => ({ ...i })).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate))) }); };
  const closeEdit = () => { setEditFor(null); setEditDraft(null); };
  const editInst = (idx, patch) => setEditDraft((d) => ({ ...d, schedule: d.schedule.map((i, j) => j === idx ? { ...i, ...patch } : i) }));
  const addEditInst = () => setEditDraft((d) => ({ ...d, schedule: [...d.schedule, { id: `m-${Date.now()}-${d.schedule.length}`, dueDate: toISO(today), amount: "", paid: false, method: null }] }));
  const delEditInst = (idx) => setEditDraft((d) => ({ ...d, schedule: d.schedule.filter((_, j) => j !== idx) }));
  const saveEdit = () => {
    const orig = sales.find((s) => s.id === editFor) || { schedule: [], ov: {}, deletedInsts: [] };
    const sched = editDraft.schedule.map((i) => ({ ...i, amount: parseFloat(String(i.amount).replace(",", ".")) || 0, method: i.paid ? (i.method || "manual") : null })).sort((a, b) => String(a.dueDate).localeCompare(String(b.dueDate)));
    // Mémoriser les modifications (overlay) pour qu'elles tiennent à la synchro.
    const ov = { ...(orig.ov || {}) };
    sched.forEach((i) => { if (!String(i.id).startsWith("m-")) ov[i.id] = { amount: i.amount, dueDate: i.dueDate, paid: i.paid, method: i.method, cancelled: !!i.cancelled, refunded: !!i.refunded }; });
    const kept = new Set(sched.map((i) => i.id));
    const deletedInsts = [...(orig.deletedInsts || [])];
    orig.schedule.forEach((i) => { if (!kept.has(i.id) && !String(i.id).startsWith("m-") && !deletedInsts.includes(i.id)) deletedInsts.push(i.id); });
    const total = sched.reduce((a, i) => a + (i.cancelled || i.refunded ? 0 : i.amount), 0);
    persist(sales.map((s) => s.id !== editFor ? s : { ...s, client: editDraft.client.trim() || s.client, phone: editDraft.phone.trim(), email: editDraft.email.trim(), schedule: sched, ov, deletedInsts, total }));
    closeEdit();
    flash("Fiche mise à jour.");
  };
  // Attribution manuelle du lead (Organique / Ads).
  const setChannel = (id, channel) =>
    persist(sales.map((s) => s.id !== id ? s : { ...s, channel }));

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

  // ---- Plage de dates (filtre global) + comparaisons MoM / YoY ----
  const periodRange = useMemo(() => {
    const fromD = parseLocal(range.from), toD = parseLocal(range.to);
    const lenDays = Math.max(1, Math.round((toD - fromD) / 86400000) + 1);
    const prevTo = addDays(fromD, -1), prevFrom = addDays(fromD, -lenDays);
    const yoyFrom = new Date(fromD.getFullYear() - 1, fromD.getMonth(), fromD.getDate());
    const yoyTo = new Date(toD.getFullYear() - 1, toD.getMonth(), toD.getDate());
    const label = range.from === range.to ? fmtFr(range.from) : `${fmtFr(range.from)} → ${fmtFr(range.to)}`;
    return { from: range.from, to: range.to, label, prevFrom: toISO(prevFrom), prevTo: toISO(prevTo), yoyFrom: toISO(yoyFrom), yoyTo: toISO(yoyTo) };
  }, [range]);

  // métriques sur [from,to] inclusif (dueDate = cash encaissé/dû, closeDate = contracté)
  const metricsFor = (from, to) => {
    let collected = 0, outstanding = 0, overdueAmt = 0, overdueCount = 0, org = 0, paid = 0, expected = 0;
    sales.forEach((s) => s.schedule.forEach((i) => {
      if (i.dueDate >= from && i.dueDate <= to && isActive(i)) {
        expected += i.amount;
        if (i.paid) { collected += i.amount; if (s.channel === "paid") paid += i.amount; else org += i.amount; }
        else { outstanding += i.amount; if (statusOf(i) === "overdue") { overdueAmt += i.amount; overdueCount++; } }
      }
    }));
    let signed = 0, clients = 0;
    sales.forEach((s) => { if (s.closeDate >= from && s.closeDate <= to) { signed += s.total; clients++; } });
    return { collected, outstanding, overdueAmt, overdueCount, org, paid, expected, signed, clients };
  };
  const kp = useMemo(() => metricsFor(periodRange.from, periodRange.to), [sales, periodRange]); // eslint-disable-line
  const kpPrev = useMemo(() => metricsFor(periodRange.prevFrom, periodRange.prevTo), [sales, periodRange]); // eslint-disable-line
  const kpYoy = useMemo(() => metricsFor(periodRange.yoyFrom, periodRange.yoyTo), [sales, periodRange]); // eslint-disable-line

  const Delta = (cur, prev, label) => {
    if (!prev && !cur) return null;
    const up = cur >= prev;
    const pct = prev > 0 ? Math.round(((cur - prev) / prev) * 100) : (cur > 0 ? 100 : 0);
    return <span className={`delta ${up ? "up" : "down"}`}>{up ? "▲" : "▼"} {Math.abs(pct)}% {label}</span>;
  };

  const inPeriod = (iso) => iso >= periodRange.from && iso <= periodRange.to;

  // Échéances de la période (onglet "À collecter").
  const periodList = useMemo(() => {
    const list = [];
    sales.forEach((s) => s.schedule.forEach((i) => { if (inPeriod(i.dueDate)) list.push({ ...i, sale: s, st: statusOf(i) }); }));
    return list.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [sales, periodRange]); // eslint-disable-line
  const periodTot = {
    toCollect: periodList.filter((i) => !i.paid && isActive(i)).reduce((a, i) => a + i.amount, 0),
    collected: periodList.filter((i) => i.paid).reduce((a, i) => a + i.amount, 0),
    overdue: periodList.filter((i) => i.st === "overdue").reduce((a, i) => a + i.amount, 0),
    count: periodList.filter((i) => !i.paid && isActive(i)).length,
  };

  // Impayés DE LA PÉRIODE (onglet Impayés + bandeau).
  const overdues = useMemo(() => {
    const list = [];
    sales.forEach((s) => s.schedule.forEach((i) => { if (statusOf(i) === "overdue" && inPeriod(i.dueDate)) list.push({ ...i, sale: s }); }));
    return list.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  }, [sales, periodRange]); // eslint-disable-line

  // Clients ayant au moins une échéance dans la période, + tri.
  const [sortBy, setSortBy] = useState("recent");
  const lastDateOf = (s) => s.schedule.reduce((mx, i) => i.dueDate > mx ? i.dueDate : mx, "");
  const sortClients = (list) => {
    const arr = [...list];
    if (sortBy === "recent") arr.sort((a, b) => lastDateOf(b).localeCompare(lastDateOf(a)));
    else if (sortBy === "old") arr.sort((a, b) => lastDateOf(a).localeCompare(lastDateOf(b)));
    else if (sortBy === "amount") arr.sort((a, b) => b.total - a.total);
    else if (sortBy === "overdue") arr.sort((a, b) => (hasOverdue(b) ? 1 : 0) - (hasOverdue(a) ? 1 : 0) || lastDateOf(b).localeCompare(lastDateOf(a)));
    return arr;
  };
  // Graph "Prévisionnel d'encaissement" sur l'accueil — période indépendante.
  const [chartPreset, setChartPreset] = useState("year");
  const chartRange = useMemo(() => {
    const t = today, Y = t.getFullYear();
    switch (chartPreset) {
      case "year": return { from: toISO(new Date(Y, 0, 1)), to: toISO(new Date(Y, 11, 31)) };
      case "lastyear": return { from: toISO(new Date(Y - 1, 0, 1)), to: toISO(new Date(Y - 1, 11, 31)) };
      case "12m": return { from: toISO(new Date(Y, t.getMonth() - 11, 1)), to: toISO(new Date(Y, t.getMonth() + 1, 0)) };
      case "global": return { from: range.from, to: range.to };
      default: return { from: "2000-01-01", to: toISO(new Date(Y + 2, 11, 31)) };
    }
  }, [chartPreset, range]);
  const chartForecast = useMemo(() => {
    const m = {};
    sales.forEach((s) => s.schedule.forEach((i) => {
      if (i.dueDate >= chartRange.from && i.dueDate <= chartRange.to && isActive(i)) {
        const key = monthKey(i.dueDate);
        if (!m[key]) m[key] = { key, paid: 0, due: 0 };
        if (i.paid) m[key].paid += i.amount; else m[key].due += i.amount;
      }
    }));
    return Object.values(m).sort((a, b) => a.key.localeCompare(b.key)).map((x) => ({ ...x, label: monthLabel(x.key) }));
  }, [sales, chartRange]);

  // Impayés : filtre dédié "Tous / Période" + tri (indépendant de la période globale).
  const allOverdue = useMemo(() => {
    const list = [];
    sales.forEach((s) => s.schedule.forEach((i) => { if (statusOf(i) === "overdue") list.push({ ...i, sale: s }); }));
    return list;
  }, [sales]);
  const [impAll, setImpAll] = useState(true);
  const [impSort, setImpSort] = useState("late");
  const sortOverdue = (list) => {
    const arr = [...list];
    if (impSort === "amount") arr.sort((a, b) => b.amount - a.amount);
    else if (impSort === "recent") arr.sort((a, b) => b.dueDate.localeCompare(a.dueDate));
    else arr.sort((a, b) => a.dueDate.localeCompare(b.dueDate)); // plus en retard d'abord
    return arr;
  };

  // Coûts de la période (logiciels mensuels × nb de mois + dépenses Meta) et bénéfice net.
  const monthsInPeriod = Math.max(1, (parseLocal(periodRange.to).getFullYear() - parseLocal(periodRange.from).getFullYear()) * 12 + (parseLocal(periodRange.to).getMonth() - parseLocal(periodRange.from).getMonth()) + 1);
  const monthlyCosts = costs.reduce((a, c) => a + c.amount, 0);
  const periodSoftwareCosts = monthlyCosts * monthsInPeriod;
  const metaCost = metaSpend && metaSpend.spend ? Number(metaSpend.spend) : 0;
  const periodCosts = periodSoftwareCosts + metaCost;
  const netProfit = kp.collected - periodCosts;
  const roas = metaCost > 0 ? kp.paid / metaCost : 0;

  useEffect(() => {
    let on = true;
    fetch(`/api/meta?since=${periodRange.from}&until=${periodRange.to}`)
      .then((r) => r.json()).then((d) => { if (on) setMetaSpend(d || { configured: false, spend: 0 }); })
      .catch(() => {});
    return () => { on = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodRange.from, periodRange.to]);

  const salesInPeriod = sales.filter((s) => s.schedule.some((i) => inPeriod(i.dueDate)));
  const salesF = sortClients(salesInPeriod.filter(matchQ));
  const overduesF = sortOverdue((impAll ? allOverdue : overdues).filter((i) => matchQ(i.sale)));
  const periodListF = periodList.filter((i) => matchQ(i.sale));

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
        .filterbar{display:flex;align-items:center;gap:9px;margin:0 0 12px;padding:9px 13px;background:var(--panel2);border:1px solid var(--line);border-radius:10px;color:rgba(234,242,255,.55);}
        .filterbar input{flex:1;background:transparent;border:none;outline:none;color:var(--text);font:inherit;font-size:14px;}
        .filterbar input::placeholder{color:rgba(234,242,255,.4);}
        .filterbar .clr{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;border-radius:6px;border:1px solid var(--line);background:transparent;color:var(--text);cursor:pointer;}
        .row-end{display:flex;gap:7px;align-items:center;justify-content:flex-end;}
        .modal-wide{max-width:660px;width:94%;}
        .edit-lbl{display:block;font-size:12px;font-weight:600;color:rgba(234,242,255,.6);margin:14px 0 8px;}
        .edit-head{display:grid;grid-template-columns:1.25fr 1fr 1.05fr .95fr 34px;gap:8px;padding:0 2px 6px;font-size:11px;color:rgba(234,242,255,.4);}
        .edit-list{display:flex;flex-direction:column;gap:8px;max-height:44vh;overflow:auto;margin-bottom:12px;}
        .edit-row{display:grid;grid-template-columns:1.25fr 1fr 1.05fr .95fr 34px;gap:8px;align-items:center;}
        .edit-row input,.edit-row select{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:8px 10px;font:inherit;font-size:13px;width:100%;}
        .edit-row input.amt{text-align:right;}
        .edit-row select:disabled{opacity:.4;}
        .pay-toggle{display:inline-flex;align-items:center;gap:5px;justify-content:center;background:var(--panel2);border:1px solid var(--line);color:rgba(234,242,255,.55);border-radius:8px;padding:8px;font:inherit;font-size:12px;font-weight:600;cursor:pointer;}
        .pay-toggle.on{color:#2BD9A0;border-color:rgba(43,217,160,.4);background:rgba(43,217,160,.08);}
        .period{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-bottom:14px;color:rgba(234,242,255,.5);}
        .daterange{position:relative;}
        .dr-trigger{display:inline-flex;align-items:center;gap:8px;background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:9px;padding:8px 14px;font:inherit;font-size:13.5px;cursor:pointer;}
        .dr-trigger:hover{border-color:var(--cyan);}
        .dr-trigger b{font-weight:700;}
        .dr-scrim{position:fixed;inset:0;z-index:40;}
        .dr-pop{position:absolute;top:calc(100% + 8px);left:0;z-index:41;display:flex;background:#16243d;border:1px solid rgba(255,255,255,.14);border-radius:12px;box-shadow:0 18px 50px rgba(0,0,0,.5);overflow:hidden;}
        .dr-presets{display:flex;flex-direction:column;padding:8px;gap:2px;border-right:1px solid rgba(255,255,255,.1);min-width:160px;}
        .dr-presets button{text-align:left;background:transparent;border:none;color:rgba(234,242,255,.8);border-radius:7px;padding:8px 12px;font:inherit;font-size:13px;cursor:pointer;}
        .dr-presets button:hover{background:rgba(255,255,255,.06);color:#fff;}
        .dr-cal{padding:12px;width:248px;}
        .dr-cal-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;font-weight:700;font-size:13px;text-transform:capitalize;}
        .dr-cal-head button{background:var(--panel2);border:1px solid var(--line);color:var(--text);width:26px;height:26px;border-radius:7px;cursor:pointer;}
        .dr-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:3px;}
        .dr-dow span{text-align:center;font-size:10px;color:rgba(234,242,255,.4);padding:2px 0;}
        .dr-day{aspect-ratio:1;border:none;background:transparent;color:rgba(234,242,255,.8);border-radius:7px;font:inherit;font-size:12px;cursor:pointer;}
        .dr-day:hover{background:rgba(255,255,255,.08);}
        .dr-day.in{background:rgba(0,212,255,.14);color:#fff;border-radius:0;}
        .dr-day.edge{background:var(--cyan);color:#04121f;font-weight:700;border-radius:7px;}
        .dr-day.today{outline:1px solid rgba(255,255,255,.3);}
        .dr-hint{margin-top:8px;font-size:11px;color:rgba(234,242,255,.45);text-align:center;}
        .period-lbl{font-size:12px;font-weight:600;color:rgba(234,242,255,.4);margin-left:auto;}
        .sort-sel{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:8px;padding:7px 10px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;color-scheme:dark;}
        .chart-head{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:2px 0 8px;font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:rgba(234,242,255,.65);}
        .chart-head>span{display:inline-flex;align-items:center;gap:8px;}
        .chart-head .mut{text-transform:none;letter-spacing:0;font-weight:500;}
        .chan-sel{background:var(--panel2);border:1px solid var(--line);border-radius:7px;padding:3px 8px;font:inherit;font-size:11px;font-weight:600;cursor:pointer;color-scheme:dark;}
        .chan-sel.src-organic{color:#2BD9A0;border-color:rgba(43,217,160,.4);background:rgba(43,217,160,.08);}
        .chan-sel.src-paid{color:#00D4FF;border-color:rgba(0,212,255,.4);background:rgba(0,212,255,.08);}
        .client-link{display:inline-flex;align-items:center;gap:6px;cursor:pointer;background:none;border:none;color:inherit;font:inherit;font-weight:inherit;padding:0;}
        .client-link svg{opacity:.4;transition:.15s;}
        .client-link:hover{color:var(--cyan);text-decoration:underline;}
        .client-link:hover svg{opacity:1;}
        .pill.pill-cancelled{opacity:.5;border-style:dashed;}
        .pill.pill-cancelled .a{text-decoration:line-through;}
        .pill.pill-refunded{color:#FFB020;border-color:rgba(255,176,32,.4);background:rgba(255,176,32,.08);}
        .badge.warn{color:#FFB020;border-color:rgba(255,176,32,.4);background:rgba(255,176,32,.08);}
        .seg2{display:inline-flex;border:1px solid var(--line);border-radius:8px;overflow:hidden;}
        .seg2 button{background:var(--panel2);border:none;color:rgba(234,242,255,.6);padding:6px 12px;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;}
        .seg2 button.on{background:rgba(0,212,255,.14);color:var(--cyan);}
        .chip-btn{cursor:pointer;}
        .chip-btn:hover{border-color:var(--cyan);}
        .chip-btn:disabled{opacity:.6;cursor:default;}
        .spin{animation:spin 1s linear infinite;}
        @keyframes spin{to{transform:rotate(360deg);}}

        /* ============ POLISH SaaS ============ */
        .melo{background:
          radial-gradient(1100px 520px at 85% -8%, rgba(0,212,255,.10), transparent 60%),
          radial-gradient(820px 460px at -5% 2%, rgba(43,217,160,.06), transparent 55%),
          #070D18; padding-bottom:60px;}
        .melo-title{font-family:'Montserrat';letter-spacing:-.025em;}
        .melo-sub{color:var(--muted);}
        .card{border-radius:18px;box-shadow:0 1px 0 rgba(255,255,255,.04) inset, 0 14px 34px -22px rgba(0,0,0,.75);transition:border-color .2s,transform .2s,box-shadow .2s;}
        .kpis .card{position:relative;overflow:hidden;}
        .kpis .card::after{content:"";position:absolute;top:0;left:0;right:0;height:2px;background:linear-gradient(90deg,var(--cyan),transparent 70%);opacity:.45;}
        .kpis .card:hover{transform:translateY(-3px);border-color:rgba(0,212,255,.28);box-shadow:0 18px 40px -24px rgba(0,212,255,.5);}
        .kpi-val{font-size:27px;}
        .delta{padding:2px 7px;border-radius:6px;}
        .delta.up{background:rgba(43,217,160,.12);}
        .delta.down{background:rgba(255,77,94,.12);}
        .tabs{background:rgba(255,255,255,.035);border-radius:14px;backdrop-filter:blur(6px);}
        .tab{transition:background .18s,color .18s;}
        .tab:hover:not(.active){color:var(--text);background:rgba(255,255,255,.05);}
        .tab.active{box-shadow:0 8px 20px -8px rgba(0,212,255,.65);}
        .row{border-radius:15px;transition:border-color .18s,transform .18s,box-shadow .18s;}
        .row:hover{border-color:rgba(255,255,255,.17);transform:translateY(-1px);box-shadow:0 14px 30px -24px rgba(0,0,0,.8);}
        .pill{transition:transform .12s,border-color .2s,box-shadow .2s;}
        .pill:hover{transform:translateY(-2px);box-shadow:0 8px 18px -10px rgba(0,0,0,.7);}
        .tbl tbody tr{transition:background .14s;}
        .tbl tbody tr:hover td{background:rgba(255,255,255,.028);}
        .btn-primary{border-radius:12px;transition:transform .12s,box-shadow .2s,filter .2s;}
        .btn-primary:hover{transform:translateY(-1px);filter:brightness(1.05);box-shadow:0 12px 30px rgba(0,212,255,.4);}
        .btn-primary:active{transform:translateY(0);}
        .btn-ghost{border-radius:11px;transition:.15s;}
        .btn-ghost:hover{border-color:rgba(255,255,255,.25);background:rgba(255,255,255,.04);}
        .mini{transition:transform .14s,background .14s,border-color .14s,color .14s;}
        .mini:hover{transform:translateY(-1px);background:rgba(255,255,255,.06);}
        .del{transition:.15s;}
        .del:hover{color:var(--red);border-color:rgba(255,77,94,.5);background:rgba(255,77,94,.08);}
        .filterbar{border-radius:12px;background:rgba(255,255,255,.028);}
        .banner{border-radius:15px;}
        .chip{background:rgba(255,255,255,.04);}
        .modal{border-radius:22px;box-shadow:0 40px 90px -30px rgba(0,0,0,.85);}
        .overlay{backdrop-filter:blur(4px);background:rgba(4,8,16,.6);}
        .menu-item{border-radius:8px;transition:background .14s;}
        .menu-item:hover{background:rgba(255,255,255,.06);}
        .chan-sel:hover,.sort-sel:hover,.dr-trigger:hover{border-color:var(--cyan);}
        ::selection{background:rgba(0,212,255,.3);}
        *::-webkit-scrollbar{width:10px;height:10px;}
        *::-webkit-scrollbar-thumb{background:rgba(255,255,255,.13);border-radius:10px;border:2px solid transparent;background-clip:content-box;}
        *::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.22);background-clip:content-box;}
        .cost-form{display:grid;grid-template-columns:2fr 1fr 1.2fr auto;gap:10px;margin-bottom:6px;}
        .cost-form input,.cost-form select{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:10px;padding:11px 12px;font:inherit;font-size:14px;outline:none;color-scheme:dark;}
        .cost-form input:focus{border-color:var(--cyan);}
        .cost-form .btn-primary{padding:11px 16px;}
        code{background:rgba(255,255,255,.08);padding:1px 6px;border-radius:5px;font-size:12px;}
        @media (max-width:760px){ .kpi-val{font-size:23px;} .row{grid-template-columns:1fr;gap:12px;} .cost-form{grid-template-columns:1fr;} }
        .delta{display:inline-block;font-size:11px;font-weight:700;margin-right:8px;}
        .delta.up{color:#2BD9A0;}
        .delta.down{color:#FF4D5E;}
      `}</style>

      <header className="melo-head">
        <div>
          <h1 className="melo-title">Suivi des paiements <span className="accent">·</span> Melo</h1>
          <div className="melo-sub">Clients iClosed + plans Systeme.io · cohortes, impayés, acquisition</div>
        </div>
        <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
          <button className="chip chip-btn" onClick={() => syncSio()} disabled={syncing} title="Forcer la récupération des nouvelles ventes">
            <RotateCcw size={13} className={syncing ? "spin" : ""} /> {syncing ? "Actualisation…" : "Actualiser"}
          </button>
          <button className="btn-primary" onClick={() => setShowAdd(true)}><Plus size={17} /> Ajouter une vente</button>
        </div>
      </header>

      <div className="period">
        <div className="daterange">
          <button className="dr-trigger" onClick={() => { setPickerOpen((o) => !o); setSelStart(null); setCalMonth(parseLocal(range.from)); }}>
            <Calendar size={15} /> <b>{periodRange.label}</b>
          </button>
          {pickerOpen && (<>
            <div className="dr-scrim" onClick={() => setPickerOpen(false)} />
            <div className="dr-pop">
              <div className="dr-presets">
                {PRESETS.map(([key, lab]) => (
                  <button key={key} onClick={() => { const r = presetRange(key); setRange(r); setCalMonth(parseLocal(r.from)); setSelStart(null); setPickerOpen(false); }}>{lab}</button>
                ))}
              </div>
              <div className="dr-cal">
                <div className="dr-cal-head">
                  <button onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() - 1, 1))}>‹</button>
                  <span>{monthLabel(toISO(calMonth))}</span>
                  <button onClick={() => setCalMonth(new Date(calMonth.getFullYear(), calMonth.getMonth() + 1, 1))}>›</button>
                </div>
                <div className="dr-grid dr-dow">{["L", "M", "M", "J", "V", "S", "D"].map((d, idx) => <span key={idx}>{d}</span>)}</div>
                <div className="dr-grid">
                  {(() => {
                    const y = calMonth.getFullYear(), mo = calMonth.getMonth();
                    const start = (new Date(y, mo, 1).getDay() + 6) % 7;
                    const nb = new Date(y, mo + 1, 0).getDate();
                    const cells = [];
                    for (let i = 0; i < start; i++) cells.push(<span key={`e${i}`} />);
                    for (let d = 1; d <= nb; d++) {
                      const iso = toISO(new Date(y, mo, d));
                      const inR = iso >= range.from && iso <= range.to;
                      const edge = iso === range.from || iso === range.to;
                      const isToday = iso === toISO(today);
                      cells.push(
                        <button key={d} className={`dr-day ${inR ? "in" : ""} ${edge ? "edge" : ""} ${selStart === iso ? "edge" : ""} ${isToday ? "today" : ""}`}
                          onClick={() => {
                            if (!selStart) { setSelStart(iso); }
                            else {
                              const from = selStart <= iso ? selStart : iso;
                              const to = selStart <= iso ? iso : selStart;
                              setRange({ from, to }); setSelStart(null); setPickerOpen(false);
                            }
                          }}>{d}</button>
                      );
                    }
                    return cells;
                  })()}
                </div>
                <div className="dr-hint">{selStart ? "Choisis la date de fin…" : "Clique une date de début puis de fin"}</div>
              </div>
            </div>
          </>)}
        </div>
        <span className="period-lbl">Comparé à la période précédente (MoM) et N-1 (YoY)</span>
      </div>

      <div className="kpis">
        <div className="card"><div className="kpi-label">CA contracté</div><div className="kpi-val">{euro(kp.signed)}</div><div className="kpi-foot">{kp.clients} vente{kp.clients > 1 ? "s" : ""} signée{kp.clients > 1 ? "s" : ""}<br />{Delta(kp.signed, kpPrev.signed, "MoM")}{Delta(kp.signed, kpYoy.signed, "YoY")}</div></div>
        <div className="card"><div className="kpi-label">CA collecté</div><div className="kpi-val" style={{ color: "var(--green)" }}>{euro(kp.collected)}</div><div className="kpi-foot">{kp.expected ? Math.round((kp.collected / kp.expected) * 100) : 0}% de l'attendu<br />{Delta(kp.collected, kpPrev.collected, "MoM")}{Delta(kp.collected, kpYoy.collected, "YoY")}</div></div>
        <div className="card"><div className="kpi-label">Reste à encaisser</div><div className="kpi-val">{euro(kp.outstanding)}</div><div className="kpi-foot">sur la période</div></div>
        <div className={`card ${kp.overdueCount ? "kpi-alert" : ""}`}><div className="kpi-label">Impayés</div><div className="kpi-val">{euro(kp.overdueAmt)}</div><div className="kpi-foot">{kp.overdueCount} échéance{kp.overdueCount > 1 ? "s" : ""} en retard<br />{Delta(kp.overdueAmt, kpYoy.overdueAmt, "YoY")}</div></div>
        <div className="card"><div className="kpi-label" style={{ display: "flex", alignItems: "center", gap: 6 }}><Leaf size={13} color="#2BD9A0" /> Encaissé organique</div><div className="kpi-val green">{euro(kp.org)}</div><div className="kpi-foot">{kp.collected ? Math.round((kp.org / kp.collected) * 100) : 0}% de l'encaissé<br />{Delta(kp.org, kpPrev.org, "MoM")}{Delta(kp.org, kpYoy.org, "YoY")}</div></div>
        <div className="card"><div className="kpi-label" style={{ display: "flex", alignItems: "center", gap: 6 }}><Megaphone size={13} color="#00D4FF" /> Encaissé paid</div><div className="kpi-val" style={{ color: "var(--cyan)" }}>{euro(kp.paid)}</div><div className="kpi-foot">{kp.collected ? Math.round((kp.paid / kp.collected) * 100) : 0}% de l'encaissé<br />{Delta(kp.paid, kpPrev.paid, "MoM")}{Delta(kp.paid, kpYoy.paid, "YoY")}</div></div>
      </div>

      {/* GRAPH PRÉVISIONNEL — toujours visible sous les KPIs */}
      <div className="chart-head">
        <span><TrendingUp size={15} /> Prévisionnel d'encaissement (MRR) <span className="mut">· par échéance</span></span>
        <select className="sort-sel" value={chartPreset} onChange={(e) => setChartPreset(e.target.value)} title="Période du graphique">
          <option value="year">Année en cours</option>
          <option value="lastyear">Année dernière</option>
          <option value="12m">12 derniers mois</option>
          <option value="all">Tout</option>
          <option value="global">Période du filtre</option>
        </select>
      </div>
      <div className="card" style={{ paddingLeft: 6, marginBottom: 16 }}>
        <ResponsiveContainer width="100%" height={230}>
          <BarChart data={chartForecast} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,.06)" vertical={false} />
            <XAxis dataKey="label" tick={{ fill: "rgba(234,242,255,.55)", fontSize: 12 }} axisLine={false} tickLine={false} />
            <YAxis tick={{ fill: "rgba(234,242,255,.4)", fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={(v) => (v >= 1000 ? `${v / 1000}k` : v)} />
            <Tooltip cursor={{ fill: "rgba(255,255,255,.04)" }} contentStyle={{ background: "#16243d", border: "1px solid rgba(255,255,255,.12)", borderRadius: 10, color: "#EAF2FF" }} formatter={(v, n) => [euro(v), n === "paid" ? "Encaissé" : "À encaisser"]} />
            <Bar dataKey="paid" stackId="a" fill="#2BD9A0" />
            <Bar dataKey="due" stackId="a" fill="#00D4FF" radius={[5, 5, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>

      {overdues.length > 0 && (
        <div className="banner"><div className="banner-ic"><AlertTriangle size={20} /></div>
          <div><b>{overdues.length} impayé{overdues.length > 1 ? "s" : ""} à relancer</b> · {euro(overdues.reduce((a, i) => a + i.amount, 0))} dépassé sur la période. <span className="mut">Si tu as reçu un virement, marque l'échéance "encaissé en direct".</span></div>
        </div>
      )}

      <div className="tabs">
        <button className={`tab ${tab === "clients" ? "active" : ""}`} onClick={() => setTab("clients")}><Users size={15} /> Clients</button>
        <button className={`tab ${tab === "cohortes" ? "active" : ""}`} onClick={() => setTab("cohortes")}><Grid3x3 size={15} /> Cohortes</button>
        <button className={`tab ${tab === "impayes" ? "active" : ""}`} onClick={() => setTab("impayes")}><AlertTriangle size={15} /> Impayés{allOverdue.length ? ` (${allOverdue.length})` : ""}</button>
        <button className={`tab ${tab === "collecte" ? "active" : ""}`} onClick={() => setTab("collecte")}><Landmark size={15} /> À collecter</button>
        <button className={`tab ${tab === "mois" ? "active" : ""}`} onClick={() => setTab("mois")}><Calendar size={15} /> Par mois</button>
        <button className={`tab ${tab === "couts" ? "active" : ""}`} onClick={() => setTab("couts")}><Wallet size={15} /> Coûts</button>
      </div>

      {(tab === "clients" || tab === "impayes" || tab === "collecte") && (
        <div className="filterbar">
          <Search size={15} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Rechercher un client, un email, une source…" />
          {q && <button className="clr" onClick={() => setQ("")} title="Effacer"><X size={14} /></button>}
          {tab === "clients" && (
            <select className="sort-sel" value={sortBy} onChange={(e) => setSortBy(e.target.value)} title="Trier">
              <option value="recent">Plus récents</option>
              <option value="old">Plus anciens</option>
              <option value="amount">Montant ↓</option>
              <option value="overdue">Impayés d'abord</option>
            </select>
          )}
          {tab === "impayes" && (<>
            <div className="seg2">
              <button className={impAll ? "on" : ""} onClick={() => setImpAll(true)}>Tous ({allOverdue.length})</button>
              <button className={!impAll ? "on" : ""} onClick={() => setImpAll(false)}>Période</button>
            </div>
            <select className="sort-sel" value={impSort} onChange={(e) => setImpSort(e.target.value)} title="Trier">
              <option value="late">Plus en retard</option>
              <option value="amount">Montant ↓</option>
              <option value="recent">Plus récents</option>
            </select>
          </>)}
        </div>
      )}

      {/* CLIENTS */}
      {tab === "clients" && (
        <div className="ledger">
          {salesF.map((s) => {
            const nd = nextDue(s); const ndSt = nd ? statusOf(nd) : null;
            const paidSum = s.schedule.filter((i) => i.paid).reduce((a, i) => a + i.amount, 0);
            return (
              <div key={s.id} className={`row ${hasOverdue(s) ? "flag" : ""}`}>
                <div>
                  <div className="client-name client-link" title="Voir / éditer la fiche" onClick={() => openEdit(s)}>{s.client} <Pencil size={12} /></div>
                  <div className="client-meta">
                    <select className={`chan-sel src-${s.channel === "paid" ? "paid" : "organic"}`} value={s.channel} onClick={(e) => e.stopPropagation()} onChange={(e) => { e.stopPropagation(); setChannel(s.id, e.target.value); }} title="Attribuer le lead">
                      <option value="organic">🌱 Organique</option>
                      <option value="paid">📣 Ads</option>
                    </select>
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
                  {[...s.schedule].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((inst) => {
                    const st = statusOf(inst);
                    const cls = st === "paid" ? (inst.method === "manual" ? "pill-manual" : "pill-paid") : `pill-${st}`;
                    const isNext = nd && inst.id === nd.id;
                    return (
                      <div key={inst.id} className="pill-wrap">
                        <div className={`pill ${cls} ${isNext ? "pill-next" : ""}`} onClick={(e) => { e.stopPropagation(); setMenu(menu === inst.id ? null : inst.id); }} title={`${dateLabel(inst.dueDate)} · ${euro2(inst.amount)}`}>
                          <span className="m">{monthLabel(monthKey(inst.dueDate))}</span>
                          {st === "paid" && (inst.method === "manual" ? <Landmark className="ic" size={15} /> : <Check className="ic" size={15} />)}
                          {st === "overdue" && <AlertTriangle className="ic" size={15} />}
                          {st === "cancelled" && <X className="ic" size={15} />}
                          {st === "refunded" && <RotateCcw className="ic" size={15} />}
                          <span className="a">{euro(inst.amount)}</span>
                        </div>
                        {menu === inst.id && (<>
                          <div className="menu-scrim" onClick={() => setMenu(null)} />
                          <div className="pill-menu" onClick={(e) => e.stopPropagation()}>
                            <div className="menu-item" onClick={() => setPayment(s.id, inst.id, true, "auto")}><Check size={15} color="#2BD9A0" /> Encaissé (Stripe)</div>
                            <div className="menu-item" onClick={() => setPayment(s.id, inst.id, true, "manual")}><Landmark size={15} color="#FFB020" /> Encaissé en direct (virement)</div>
                            <div className="menu-item" onClick={() => setPayment(s.id, inst.id, false, null)}><RotateCcw size={15} color="#00D4FF" /> Remettre en attente</div>
                            <div className="menu-item" onClick={() => setInstState(s.id, inst.id, { cancelled: true })}><X size={15} color="#8a93a5" /> Annuler l'échéance</div>
                            <div className="menu-item" onClick={() => setInstState(s.id, inst.id, { refunded: true })}><RotateCcw size={15} color="#FFB020" /> Marquer remboursé</div>
                            <div className="menu-item" onClick={() => removeInst(s.id, inst.id)}><Trash2 size={15} color="#FF4D5E" /> Supprimer cette échéance</div>
                          </div>
                        </>)}
                      </div>
                    );
                  })}
                </div>
                <div className="row-end">
                  <button className="mini" onClick={() => openEdit(s)} title="Éditer la fiche"><Pencil size={15} /></button>
                  <button className="mini ok" onClick={() => { setPayFor(s.id); setPayForm({ amount: "", date: toISO(today), method: "manual" }); }} title="Ajouter un encaissement"><Plus size={15} /></button>
                  <button className="del" onClick={() => removeSale(s.id)} title="Supprimer le client"><Trash2 size={15} /></button>
                </div>
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
        <div className="section-h"><Calendar size={15} /> Détail par mois</div>
        <div className="card" style={{ padding: 6, marginTop: 4 }}>
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
          {overduesF.length === 0 ? (
            <div className="empty">{allOverdue.length ? "Aucun impayé pour ce filtre." : "Aucun impayé 🎉 Toutes les échéances dépassées sont réglées."}</div>
          ) : (
            <table className="tbl">
              <thead><tr>
                <th>Client</th><th>Source</th><th>Offre</th><th className="num">Échéance</th><th className="num">Retard</th><th className="num">Montant</th><th className="num">Relance</th>
              </tr></thead>
              <tbody>
                {overduesF.map((i) => (
                  <tr key={i.id}>
                    <td className="lab">
                      <button className="client-link" title="Voir la fiche" onClick={() => openEdit(i.sale)}>{i.sale.client} <Pencil size={11} /></button>
                      {(i.sale.email || i.sale.phone) && <div className="mut" style={{ fontWeight: 400, fontSize: 11, marginTop: 2 }}>{[i.sale.email, i.sale.phone].filter(Boolean).join(" · ")}</div>}
                    </td>
                    <td><span className={`src src-${i.sale.channel === "paid" ? "paid" : "organic"}`}>{i.sale.channel === "paid" ? <Megaphone size={11} /> : <Leaf size={11} />}{i.sale.channel === "paid" ? "Ads" : "Organique"}</span></td>
                    <td className="mut">{i.sale.offer}</td>
                    <td className="num">{dateLabel(i.dueDate)}</td>
                    <td className="num red">{daysLate(i.dueDate)} j</td>
                    <td className="num">{euro(i.amount)}</td>
                    <td className="num">
                      <div className="row-actions">
                        <button className="mini ok" title="Encaissé (Stripe)" onClick={() => setPayment(i.sale.id, i.id, true, "auto")}><Check size={14} /></button>
                        <button className="mini warn" title="Encaissé en direct (virement)" onClick={() => setPayment(i.sale.id, i.id, true, "manual")}><Landmark size={14} /></button>
                        <button className="mini" title="Annuler l'échéance (sort des impayés)" onClick={() => setInstState(i.sale.id, i.id, { cancelled: true })}><X size={14} /></button>
                        <button className="mini" title="Marquer remboursé" onClick={() => setInstState(i.sale.id, i.id, { refunded: true })}><RotateCcw size={14} /></button>
                        <button className="mini" title="Supprimer cette échéance" onClick={() => removeInst(i.sale.id, i.id)}><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                <tr className="tot-row"><td className="lab">Total impayés</td><td /><td /><td /><td className="num mut">{overduesF.length} éch.</td><td className="num red">{euro(overduesF.reduce((a, i) => a + i.amount, 0))}</td><td /></tr>
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* À COLLECTER — piloté par la plage de dates globale */}
      {tab === "collecte" && (<>
        <div className="section-h" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Landmark size={15} /> Paiements à collecter · <b style={{ color: "var(--text)" }}>{periodRange.label}</b>
        </div>
        <div className="kpis" style={{ marginTop: 4 }}>
          <div className="card"><div className="kpi-label">À collecter</div><div className="kpi-val">{euro(periodTot.toCollect)}</div><div className="kpi-foot">{periodTot.count} échéance{periodTot.count > 1 ? "s" : ""}</div></div>
          <div className="card"><div className="kpi-label">Déjà encaissé</div><div className="kpi-val green">{euro(periodTot.collected)}</div></div>
          <div className={`card ${periodTot.overdue ? "kpi-alert" : ""}`}><div className="kpi-label">Dont en retard</div><div className="kpi-val">{euro(periodTot.overdue)}</div></div>
        </div>
        <div className="card" style={{ padding: 6, marginTop: 14 }}>
          {periodListF.length === 0 ? (
            <div className="empty">Aucune échéance sur cette période{q ? " pour cette recherche" : ""}.</div>
          ) : (
            <table className="tbl">
              <thead><tr><th>Client</th><th>Source</th><th className="num">Échéance</th><th>Statut</th><th className="num">Montant</th><th className="num">Action</th></tr></thead>
              <tbody>
                {periodListF.map((i) => (
                  <tr key={i.id}>
                    <td className="lab"><button className="client-link" title="Voir la fiche" onClick={() => openEdit(i.sale)}>{i.sale.client} <Pencil size={11} /></button></td>
                    <td><span className={`src src-${i.sale.channel === "paid" ? "paid" : "organic"}`}>{i.sale.channel === "paid" ? <Megaphone size={11} /> : <Leaf size={11} />}{i.sale.channel === "paid" ? "Ads" : "Organique"}</span></td>
                    <td className="num">{dateLabel(i.dueDate)}</td>
                    <td>{i.st === "paid" ? <span className="badge green">Encaissé</span> : i.st === "overdue" ? <span className="badge red">En retard</span> : i.st === "cancelled" ? <span className="badge mut">Annulé</span> : i.st === "refunded" ? <span className="badge warn">Remboursé</span> : <span className="badge mut">À venir</span>}</td>
                    <td className="num">{euro(i.amount)}</td>
                    <td className="num">
                      <div className="row-actions">
                        {!i.paid && isActive(i) ? (<>
                          <button className="mini ok" title="Encaissé (Stripe)" onClick={() => setPayment(i.sale.id, i.id, true, "auto")}><Check size={14} /></button>
                          <button className="mini warn" title="Encaissé en direct (virement)" onClick={() => setPayment(i.sale.id, i.id, true, "manual")}><Landmark size={14} /></button>
                          <button className="mini" title="Annuler l'échéance" onClick={() => setInstState(i.sale.id, i.id, { cancelled: true })}><X size={14} /></button>
                        </>) : (
                          <button className="mini" title="Remettre en attente" onClick={() => setPayment(i.sale.id, i.id, false, null)}><RotateCcw size={14} /></button>
                        )}
                        <button className="mini" title="Supprimer cette échéance" onClick={() => removeInst(i.sale.id, i.id)}><Trash2 size={14} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                <tr className="tot-row"><td className="lab">À collecter{q ? " (filtré)" : ""}</td><td /><td /><td /><td className="num">{euro(periodListF.filter((i) => !i.paid && isActive(i)).reduce((a, i) => a + i.amount, 0))}</td><td /></tr>
              </tbody>
            </table>
          )}
        </div>
      </>)}

      {/* COÛTS */}
      {tab === "couts" && (<>
        <div className="kpis" style={{ marginTop: 4 }}>
          <div className="card"><div className="kpi-label">Coûts logiciels / mois</div><div className="kpi-val">{euro(monthlyCosts)}</div><div className="kpi-foot">{costs.length} poste{costs.length > 1 ? "s" : ""} · {euro(periodSoftwareCosts)} sur la période</div></div>
          <div className="card"><div className="kpi-label" style={{ display: "flex", alignItems: "center", gap: 6 }}><Megaphone size={13} color="#00D4FF" /> Invest. Meta Ads</div><div className="kpi-val" style={{ color: "var(--cyan)" }}>{metaSpend.configured ? euro(metaCost) : "—"}</div><div className="kpi-foot">{metaSpend.configured ? (roas ? `ROAS ${roas.toFixed(1)}x (CA paid / dépense)` : periodRange.label) : "Meta non connecté"}</div></div>
          <div className="card"><div className="kpi-label">Coûts totaux · {periodRange.label}</div><div className="kpi-val">{euro(periodCosts)}</div><div className="kpi-foot">logiciels + pub</div></div>
          <div className={`card ${netProfit < 0 ? "kpi-alert" : ""}`}><div className="kpi-label">Bénéfice net (période)</div><div className="kpi-val" style={{ color: netProfit >= 0 ? "var(--green)" : "var(--red)" }}>{euro(netProfit)}</div><div className="kpi-foot">CA collecté {euro(kp.collected)} − coûts</div></div>
        </div>

        <div className="section-h"><Wallet size={15} /> Coûts mensuels récurrents (logiciels, abonnements…)</div>
        <div className="card" style={{ padding: 18 }}>
          <div className="cost-form">
            <input placeholder="Nom (ex : Shopify, Notion…)" value={costForm.name} onChange={(e) => setCostForm({ ...costForm, name: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addCost()} />
            <input placeholder="€ / mois" inputMode="decimal" value={costForm.amount} onChange={(e) => setCostForm({ ...costForm, amount: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addCost()} />
            <select value={costForm.type} onChange={(e) => setCostForm({ ...costForm, type: e.target.value })}>
              <option value="logiciel">Logiciel</option>
              <option value="salaire">Salaire / freelance</option>
              <option value="pub">Publicité</option>
              <option value="autre">Autre</option>
            </select>
            <button className="btn-primary" onClick={addCost}><Plus size={16} /> Ajouter</button>
          </div>
          {costs.length === 0 ? (
            <div className="empty">Aucun coût pour l'instant. Ajoute tes abonnements logiciels ci-dessus.</div>
          ) : (
            <table className="tbl" style={{ marginTop: 8 }}>
              <thead><tr><th>Poste</th><th>Type</th><th className="num">€ / mois</th><th className="num">Sur la période</th><th className="num" /></tr></thead>
              <tbody>
                {costs.map((c) => (
                  <tr key={c.id}>
                    <td className="lab">{c.name}</td>
                    <td><span className="badge mut" style={{ textTransform: "capitalize" }}>{c.type}</span></td>
                    <td className="num">{euro(c.amount)}</td>
                    <td className="num mut">{euro(c.amount * monthsInPeriod)}</td>
                    <td className="num"><button className="mini" title="Supprimer" onClick={() => removeCost(c.id)}><Trash2 size={14} /></button></td>
                  </tr>
                ))}
                {metaSpend.configured && metaCost > 0 && (
                  <tr><td className="lab">Meta Ads <span className="mut" style={{ fontWeight: 400 }}>(auto)</span></td><td><span className="badge" style={{ color: "var(--cyan)", borderColor: "rgba(0,212,255,.4)" }}>pub</span></td><td className="num mut">—</td><td className="num">{euro(metaCost)}</td><td /></tr>
                )}
                <tr className="tot-row"><td className="lab">Total période</td><td /><td className="num">{euro(monthlyCosts)}</td><td className="num">{euro(periodCosts)}</td><td /></tr>
              </tbody>
            </table>
          )}
          {!metaSpend.configured && (
            <div className="empty" style={{ padding: "18px 20px", fontSize: 13 }}>💡 Connecte <b style={{ color: "var(--cyan)" }}>Meta Ads</b> pour ajouter automatiquement tes dépenses pub (variables d'env <code>META_ACCESS_TOKEN</code> + <code>META_AD_ACCOUNT_ID</code> sur Vercel).</div>
          )}
        </div>
      </>)}

      {/* ÉDITER LA FICHE */}
      {editFor && editDraft && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && closeEdit()}>
          <div className="modal modal-wide">
            <button className="modal-close" onClick={closeEdit}><X size={20} /></button>
            <h3>Éditer la fiche</h3>
            <div className="field"><label>Nom du client</label><input value={editDraft.client} onChange={(e) => setEditDraft({ ...editDraft, client: e.target.value })} /></div>
            <div className="field-row">
              <div className="field"><label>Téléphone</label><input value={editDraft.phone} onChange={(e) => setEditDraft({ ...editDraft, phone: e.target.value })} placeholder="+33 6 12 34 56 78" /></div>
              <div className="field"><label>Email</label><input value={editDraft.email} onChange={(e) => setEditDraft({ ...editDraft, email: e.target.value })} placeholder="email@…" /></div>
            </div>
            <label className="edit-lbl">Échéances</label>
            <div className="edit-head"><span>Date</span><span>Montant (€)</span><span>Statut</span><span>Moyen</span><span /></div>
            <div className="edit-list">
              {editDraft.schedule.map((i, idx) => (
                <div className="edit-row" key={i.id || idx}>
                  <input type="date" value={i.dueDate || ""} onChange={(e) => editInst(idx, { dueDate: e.target.value })} />
                  <input className="amt" value={i.amount} inputMode="decimal" placeholder="0" onChange={(e) => editInst(idx, { amount: e.target.value })} />
                  <button className={`pay-toggle ${i.paid ? "on" : ""}`} onClick={() => editInst(idx, { paid: !i.paid, method: !i.paid ? (i.method || "manual") : i.method })}>{i.paid ? <><Check size={13} /> Encaissé</> : "À venir"}</button>
                  <select value={i.method || "manual"} disabled={!i.paid} onChange={(e) => editInst(idx, { method: e.target.value })}>
                    <option value="auto">Stripe</option>
                    <option value="manual">Virement</option>
                  </select>
                  <button className="mini" title="Supprimer l'échéance" onClick={() => delEditInst(idx)}><Trash2 size={14} /></button>
                </div>
              ))}
              {editDraft.schedule.length === 0 && <div className="empty" style={{ padding: 20 }}>Aucune échéance. Ajoute-en une ci-dessous.</div>}
            </div>
            <button className="btn-ghost" onClick={addEditInst}><Plus size={15} /> Ajouter une échéance</button>
            <div className="preview">Total : <b>{euro(editDraft.schedule.reduce((a, i) => a + (parseFloat(String(i.amount).replace(",", ".")) || 0), 0))}</b> · {editDraft.schedule.filter((i) => i.paid).length} encaissée(s) · {euro(editDraft.schedule.filter((i) => i.paid).reduce((a, i) => a + (parseFloat(String(i.amount).replace(",", ".")) || 0), 0))} reçu</div>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={closeEdit}>Annuler</button>
              <button className="btn-primary" onClick={saveEdit}><Check size={16} /> Enregistrer</button>
            </div>
          </div>
        </div>
      )}

      {/* AJOUTER UN ENCAISSEMENT */}
      {payFor && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setPayFor(null)}>
          <div className="modal">
            <button className="modal-close" onClick={() => setPayFor(null)}><X size={20} /></button>
            <h3>Ajouter un encaissement</h3>
            <p>{(sales.find((s) => s.id === payFor) || {}).client} · paiement reçu (acompte Stripe, virement…).</p>
            <div className="field-row">
              <div className="field"><label>Montant (€)</label><input value={payForm.amount} onChange={(e) => setPayForm({ ...payForm, amount: e.target.value })} placeholder="200" inputMode="decimal" autoFocus /></div>
              <div className="field"><label>Date du paiement</label><input type="date" value={payForm.date} onChange={(e) => setPayForm({ ...payForm, date: e.target.value })} /></div>
            </div>
            <div className="field">
              <label>Moyen d'encaissement</label>
              <div className="seg">
                <button className={payForm.method === "manual" ? "on-o" : ""} onClick={() => setPayForm({ ...payForm, method: "manual" })}><Landmark size={14} /> Virement / direct</button>
                <button className={payForm.method === "auto" ? "on-p" : ""} onClick={() => setPayForm({ ...payForm, method: "auto" })}><Check size={14} /> Stripe</button>
              </div>
            </div>
            <div className="modal-actions">
              <button className="btn-ghost" onClick={() => setPayFor(null)}>Annuler</button>
              <button className="btn-primary" onClick={addPayment}><Plus size={16} /> Ajouter l'encaissement</button>
            </div>
          </div>
        </div>
      )}

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
