/* eslint-disable */
// Connexion Calendly : import de l'historique des RDV + activation du webhook.
//   POST/GET /api/calendly-import            -> importe les RDV (90 derniers jours + à venir)
//   POST/GET /api/calendly-import?setup=1    -> idem + crée l'abonnement webhook
//                                               (invitee.created / invitee.canceled -> /api/lead)
//   GET      /api/calendly-import?debug=1    -> infos compte + échantillon brut
//
// Variables d'env : CALENDLY_TOKEN (Personal Access Token, Calendly →
// Integrations → API & Webhooks), INGEST_SECRET. Auth : admin (token app) ou secret.
// NB : les webhooks Calendly nécessitent un plan payant ; l'import marche partout.

const { cmd, isConfigured } = require("../lib/kv");
const { checkAuth } = require("../lib/auth");

const BASE = "https://api.calendly.com";

async function cGet(path, tok, params = {}) {
  const url = path.startsWith("http") ? new URL(path) : new URL(BASE + path);
  Object.entries(params).forEach(([k, v]) => { if (v != null && v !== "") url.searchParams.set(k, v); });
  const r = await fetch(url, { headers: { Authorization: `Bearer ${tok}`, Accept: "application/json" } });
  const t = await r.text(); let b; try { b = JSON.parse(t); } catch { b = t; }
  if (!r.ok) { const e = new Error("Calendly " + r.status); e.status = r.status; e.body = b; throw e; }
  return b;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, x-app-token, x-ingest-secret");
  const secret = process.env.INGEST_SECRET;
  const provided = (req.query && req.query.secret) || req.headers["x-ingest-secret"];
  if (!(secret && provided === secret) && !checkAuth(req)) { res.status(401).json({ error: "Non autorisé." }); return; }
  const tok = process.env.CALENDLY_TOKEN;
  if (!tok) { res.status(500).json({ error: "CALENDLY_TOKEN manquant (Calendly → Integrations → API & Webhooks → Personal Access Token, puis Vercel → Environment Variables)." }); return; }
  if (!isConfigured()) { res.status(500).json({ error: "Base KV non configurée." }); return; }

  try {
    // Compte + organisation (nécessaires pour lister les événements / créer le webhook)
    const meResp = await cGet("/users/me", tok);
    const user = (meResp && meResp.resource) || {};
    const organization = user.current_organization;

    if (req.query && (req.query.debug === "1" || req.query.debug === "true")) {
      let sample = null;
      try { sample = await cGet("/scheduled_events", tok, { organization, count: 3 }); } catch (e) { sample = { _error: e.status, _body: e.body }; }
      res.status(200).json({ debug: true, user: { name: user.name, email: user.email, organization }, sample });
      return;
    }

    // ---- 1) Webhook temps réel (optionnel, ?setup=1) ----
    let webhook = null;
    if (req.query && (req.query.setup === "1" || req.query.setup === "true")) {
      const hookUrl = `https://${req.headers.host}/api/lead${secret ? `?secret=${secret}` : ""}`;
      try {
        const w = await cGet("/webhook_subscriptions", tok, { organization, scope: "organization", count: 100 });
        const exists = ((w && w.collection) || []).some((h) => String(h.callback_url || "").startsWith(`https://${req.headers.host}/api/lead`) && h.state === "active");
        if (exists) webhook = "déjà actif";
        else {
          const r = await fetch(BASE + "/webhook_subscriptions", {
            method: "POST",
            headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
            body: JSON.stringify({ url: hookUrl, events: ["invitee.created", "invitee.canceled"], organization, scope: "organization" }),
          });
          const d = await r.json().catch(() => ({}));
          if (r.ok) webhook = "activé";
          else if (r.status === 403) webhook = "refusé (les webhooks Calendly demandent un plan payant — l'import reste dispo)";
          else webhook = `erreur ${r.status}${d && d.message ? ` « ${d.message} »` : ""}`;
        }
      } catch (e) { webhook = `erreur ${e.status || e.message}`; }
    }

    // ---- 2) Import des RDV : 90 derniers jours (paramétrable ?days=) + à venir ----
    const days = Math.max(1, Math.min(365, Number(req.query && req.query.days) || 90));
    const minStart = new Date(Date.now() - days * 864e5).toISOString();
    const events = [];
    let pageUrl = null, guard = 0;
    while (guard++ < 20) {
      const page = pageUrl
        ? await cGet(pageUrl, tok)
        : await cGet("/scheduled_events", tok, { organization, count: 100, min_start_time: minStart, sort: "start_time:asc" });
      const col = (page && page.collection) || [];
      events.push(...col);
      pageUrl = page && page.pagination && page.pagination.next_page;
      if (!pageUrl || !col.length) break;
    }

    // Invités de chaque RDV actif -> upsert crm:leads (borne : 150 RDV / run)
    let stored = 0, skipped = 0;
    const active = events.filter((ev) => ev.status === "active").slice(0, 150);
    for (const ev of active) {
      const uuid = String(ev.uri || "").split("/").pop();
      if (!uuid) continue;
      let inv;
      try { inv = await cGet(`/scheduled_events/${uuid}/invitees`, tok, { count: 100 }); } catch (e) { continue; }
      for (const p of (inv && inv.collection) || []) {
        if (p.status !== "active") { skipped += 1; continue; }
        const email = String(p.email || "").toLowerCase();
        if (!email) { skipped += 1; continue; }
        let lead = null;
        try { const s = await cmd(["HGET", "crm:leads", email]); lead = s ? JSON.parse(s) : null; } catch {}
        if (!lead) lead = { email, createdAt: new Date().toISOString(), stage: "new", history: [] };
        lead.name = lead.name || p.name || email;
        // On garde le RDV le plus récent comme référence
        if (!lead.bookedAt || String(ev.start_time) > String(lead.bookedAt)) {
          lead.bookedAt = ev.start_time;
          lead.bookedEvent = ev.name || "Calendly";
        }
        lead.source = lead.source || "Calendly";
        if (!lead.manualStage && !["won", "lost", "noshow", "show"].includes(lead.stage)) lead.stage = "booked";
        lead.updatedAt = new Date().toISOString();
        await cmd(["HSET", "crm:leads", email, JSON.stringify(lead)]);
        stored += 1;
      }
    }

    res.status(200).json({
      ok: true,
      account: user.email,
      events: events.length,
      imported: stored,
      skipped,
      webhook: webhook || "non demandé (ajoute ?setup=1)",
    });
  } catch (e) {
    res.status(e.status || 500).json({ error: String(e.message || e), detail: e.body });
  }
};
