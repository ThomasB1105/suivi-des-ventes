// Setting DM (Instagram) — règle d'attribution.
//
// Les RDV pris sur l'event Calendly « Appel de candidature - Ecom Ascension »
// (lien partagé calendly.com/d/d2bt-hs4-67s/…) par un lead SANS opt-in VSL
// préalable viennent du setting DM : ils sont attribués au setter DM, et le
// cash encaissé sur ces leads remonte dans le reporting « Setting DM ».
// Un lead passé par la VSL (opt-in Make / systeme.io) qui book le même event
// reste un lead VSL (setter round-robin), même event ou pas.
const DM = {
  setter: "Aurélie",
  eventRe: /appel\s+de\s+candidature/i,
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
  if (hasVslOptin(lead)) return false;
  if (lead.lastCall && !lead.bookedAt) return false; // iClosed pur
  return String(lead.bookedAt).slice(0, 10) >= DM.since;
}

// Mutations sur un lead stocké (webhook / import) : tag + setter auto.
function applyDm(lead) {
  if (!isDmLead(lead)) return false;
  lead.dm = true;
  if (!lead.setter || lead.setterAuto) { lead.setter = DM.setter; lead.setterAuto = true; }
  return true;
}

module.exports = { DM, isDmLead, applyDm, hasVslOptin };
