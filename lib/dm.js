// Setting DM (Instagram) — règle d'attribution.
//
// L'event Calendly « Appel Stratégique - Ecom Ascension » (lien partagé
// calendly.com/d/d2bt-hs4-67s/…) est DÉDIÉ au setting DM : tout RDV pris
// dessus est attribué au setter DM, et le cash encaissé sur ces leads remonte
// dans le reporting « Setting DM ». (La VSL book un autre event : « Appel de
// candidature ».)
const DM = {
  setter: "Aurélie",
  eventRe: /appel\s+strat[ée]gique/i,
  eventSlug: "d2bt-hs4-67s",
  since: "2026-10-01", // RDV pris à partir de cette date (bookedAt)
};

const hasVslOptin = (lead) =>
  /vsl/i.test(String(lead.source || "")) ||
  (Array.isArray(lead.history) && lead.history.some((h) => h && h.type === "optin"));

// lead = objet stocké dans crm:leads (ou agrégé par buildLeads : mêmes champs).
function isDmLead(lead) {
  if (!lead || !lead.bookedAt) return false;
  const ev = String(lead.bookedEvent || "");
  const evUrl = String(lead.bookedEventUrl || "");
  if (!(DM.eventRe.test(ev) || evUrl.includes(DM.eventSlug))) return false;
  return String(lead.bookedAt).slice(0, 10) >= DM.since;
}

// Mutations sur un lead stocké (webhook / import) : tag + SETTER DM auto.
// Trois attributions distinctes sur un lead : setter DM (origine du lead),
// setter call (préqualification, round-robin) et closer. Le setter call est
// attribué ensuite par le round-robin habituel.
function applyDm(lead) {
  if (!isDmLead(lead)) return false;
  lead.dm = true;
  if (!lead.dmSetter || lead.dmSetterAuto !== false) { lead.dmSetter = DM.setter; lead.dmSetterAuto = true; }
  return true;
}

module.exports = { DM, isDmLead, applyDm, hasVslOptin };
