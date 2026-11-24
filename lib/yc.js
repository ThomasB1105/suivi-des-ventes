/* eslint-disable */
// YouClose Pages : suivi des visiteurs des pages hébergées (/p/<slug>).
//
//   trk:v:<vid>   JSON du visiteur (premier contact, visites, VSL, clics, RDV), 180 j
//   trk:s:<slug>  compteurs de la page (visits, uniq, cta, vsl25/50/75/100, booked)
//   yc:pages      hash slug -> {slug, title, html, state, updatedAt}
//
// Le lien visiteur -> lead se fait à la réservation : la page ajoute
// utm_content=yc_<vid> au calendrier Calendly, le webhook (api/lead.js)
// le lit et recopie le parcours sur la fiche.

const VISITOR_TTL = 180 * 24 * 3600;

async function readVisitor(cmd, vid) {
  const id = String(vid || "").replace(/[^a-z0-9]/gi, "").slice(0, 40);
  if (!id) return null;
  try { const raw = await cmd(["GET", "trk:v:" + id]); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
}

// Recopie le parcours d'un visiteur sur la fiche lead (sans écraser une source déjà connue).
async function attachVisitor(cmd, lead, vid, pushHistory) {
  const v = await readVisitor(cmd, vid);
  if (!v) return false;
  const first = v.first || {};
  const utm = first.utm || {};
  lead.yc = {
    vid: v.vid,
    page: first.slug || (v.vsl && v.vsl.slug) || null,
    visits: v.visits || 0,
    cta: v.cta || 0,
    vslPct: v.vsl ? v.vsl.pct : 0,
    vslSec: v.vsl ? v.vsl.sec : 0,
    vslDur: v.vsl ? v.vsl.dur : 0,
    firstAt: first.at || null,
    utm,
    ref: first.ref || "",
  };
  if (utm.utm_campaign && !lead.campaign) lead.campaign = String(utm.utm_campaign);
  if (typeof pushHistory === "function") {
    if (v.vsl && v.vsl.pct) pushHistory(lead, "vsl", `VSL regardée à ${v.vsl.pct} % (page ${lead.yc.page || "?"})`);
    if (first.at) pushHistory(lead, "optin", `Première visite · ${utm.utm_source || (first.ref ? "référent" : "direct")}${utm.utm_campaign ? " · " + utm.utm_campaign : ""}`);
  }
  // Le visiteur est désormais rattaché à ce lead (les vues suivantes le mettront à jour).
  try { v.lead = lead.email; await cmd(["SET", "trk:v:" + v.vid, JSON.stringify(v), "EX", String(VISITOR_TTL)]); } catch (e) {}
  return true;
}

module.exports = { readVisitor, attachVisitor, VISITOR_TTL };
