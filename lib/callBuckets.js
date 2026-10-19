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
