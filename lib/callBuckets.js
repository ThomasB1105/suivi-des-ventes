/* eslint-disable */
// Classement d'un call (lead CRM agrégé par buildLeads) — règle UNIQUE partagée
// par le reporting closers et le reporting hebdo (copie côté front : callBucket
// dans src/App.js, à garder identique).
//
//   won       : vente (paiement encaissé ou résultat « closé »)
//   lost/show : présent, non closé / présent sans résultat de vente
//   pending   : call PASSÉ sans résultat renseigné -> compté comme honoré
//   noshow    : no-show
//   cancelled : annulé (plateforme, closer ou setting « cancel »)
//   upcoming  : call d'aujourd'hui ou à venir, pas encore renseigné
//   excluded  : écarté par le setting (non qualifié, dead, NRP…)
const HELD = ["won", "lost", "show", "pending"];

const parisDay = (s) => {
  const str = String(s || "");
  if (!str) return "";
  if (!/([zZ]|[+-]\d{2}:?\d{2})$/.test(str)) return str.slice(0, 10);
  const d = new Date(str.replace(/\.(\d{3})\d+/, ".$1"));
  if (isNaN(d)) return str.slice(0, 10);
  return new Intl.DateTimeFormat("fr-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
};
const parisToday = () => parisDay(new Date().toISOString());
const callDay = (l) => parisDay(l.callAt || (l.lastCall && l.lastCall.date) || l.bookedAt || "");

function callBucket(l, today) {
  if (l.stage === "won") return "won";
  if (l.stage === "noshow" || l.showUp === "noshow") return "noshow";
  if (l.stage === "lost") return "lost";
  if (l.stage === "show" || l.showUp === "present") return "show";
  if (l.showUp === "cancelled" || l.setStatus === "cancel" || (l.stage === "setting" && l.bookedAt)) return "cancelled";
  if (l.stage === "booked") return callDay(l) < today ? "pending" : "upcoming";
  return "excluded";
}

module.exports = { HELD, callBucket, callDay, parisDay, parisToday };

// ---- Plusieurs calls par lead ----
// Un lead re-booké (après un no-show, un « non closé »…) garde le résultat de
// son call précédent dans lead.pastCalls, pour que le reporting le compte à SA
// date. Appelé quand un nouveau RDV remplace le RDV de référence.
const OUTCOME_STAGES = ["noshow", "show", "lost"];
function archiveOnRebook(lead, newStart) {
  if (!lead || !lead.bookedAt || !newStart) return false;
  if (String(newStart).slice(0, 16) === String(lead.bookedAt).slice(0, 16)) return false; // même RDV
  if (String(newStart) < String(lead.bookedAt)) return false;                             // RDV plus ancien
  const manualOutcome = lead.manualStage && OUTCOME_STAGES.concat("won").includes(lead.stage);
  const hasOutcome = !!(lead.callResult || (lead.showUp && lead.showUp !== "cancelled") || manualOutcome);
  if (hasOutcome) {
    const prev = { at: lead.bookedAt, event: lead.bookedEvent, closer: lead.closer, showUp: lead.showUp, callResult: lead.callResult, stage: manualOutcome ? lead.stage : undefined };
    lead.pastCalls = [...(lead.pastCalls || []).filter((p) => String(p.at).slice(0, 16) !== String(prev.at).slice(0, 16)), prev].slice(-10);
  }
  if (lead.stage === "won") return hasOutcome; // client : son statut ne bouge pas
  // Nouveau RDV : le résultat repart de zéro.
  delete lead.showUp; delete lead.showUpAuto; delete lead.callResult;
  if (lead.manualStage && OUTCOME_STAGES.concat("setting").includes(lead.stage)) { lead.manualStage = false; lead.stage = "booked"; }
  return hasOutcome;
}

// Statut d'un call archivé (pastCalls) au format d'un lead, pour callBucket.
function pastCallStage(p) {
  if (p.callResult === "won" || p.stage === "won") return "won";
  if (p.showUp === "noshow" || p.stage === "noshow") return "noshow";
  if (p.callResult === "lost" || p.stage === "lost") return "lost";
  if (p.showUp === "present" || p.stage === "show") return "show";
  return "booked";
}
// Liste des calls : le call courant de chaque lead + ses calls archivés.
function expandCalls(leads) {
  const out = [];
  (leads || []).forEach((l) => {
    out.push(l);
    (l.pastCalls || []).forEach((p) => {
      out.push({ ...l, callAt: p.at, bookedAt: p.at, bookedEvent: p.event || l.bookedEvent, lastCall: undefined,
        closer: p.closer || l.closer, stage: pastCallStage(p), showUp: p.showUp, callResult: p.callResult,
        setStatus: undefined, amount: 0, pastCalls: undefined, isPastCall: true });
    });
  });
  return out;
}

module.exports.archiveOnRebook = archiveOnRebook;
module.exports.pastCallStage = pastCallStage;
module.exports.expandCalls = expandCalls;
