/* eslint-disable */
// Rattrapage automatique quotidien.
//
// Déclenché par le cron Vercel (vercel.json, 05:00 UTC) — Vercel envoie
// « Authorization: Bearer <CRON_SECRET> » quand la variable d'env
// CRON_SECRET est définie. Un planificateur externe (Make, cron-job.org)
// peut appeler la même URL avec le même en-tête.
//
// Les webhooks (Calendly, iClosed) peuvent être refusés — base indisponible,
// secret changé, abonnement Calendly expiré… Ce cron ré-importe chaque jour
// les RDV Calendly des 14 derniers jours + à venir et les appels iClosed,
// pour qu'aucun lead ne manque dans les agendas des closers.
//
// Sécurité : Vercel envoie « Authorization: Bearer <CRON_SECRET> » quand la
// variable d'env CRON_SECRET est définie. Sans CRON_SECRET, la route refuse
// tout (elle n'est utile qu'avec le cron). L'admin peut aussi l'appeler avec
// son token (x-app-token) pour un rattrapage manuel.

const { checkAuth } = require("../lib/auth");
const calendlyImport = require("./calendly-import");
const iclosedImport = require("./iclosed-import");

// Exécute un handler (req,res) interne et récupère sa réponse JSON.
async function runInternal(handler, query) {
  let status = 0, body = null;
  const res = {
    setHeader() {},
    status(c) { status = c; return res; },
    json(b) { body = b; return res; },
    end() { return res; },
  };
  const req = { method: "GET", query: { ...query, secret: process.env.INGEST_SECRET || "" }, headers: { "x-app-token": "" }, body: null };
  try { await handler(req, res); } catch (e) { status = 500; body = { error: String(e.message || e) }; }
  return { status, body };
}

module.exports = async (req, res) => {
  const cronOk = !!(process.env.CRON_SECRET && (req.headers.authorization || "") === `Bearer ${process.env.CRON_SECRET}`);
  const adminOk = !!process.env.APP_PASSWORD && checkAuth(req);
  if (!cronOk && !adminOk) { res.status(401).json({ error: "Non autorisé." }); return; }

  const startedAt = new Date().toISOString();
  const days = Math.max(1, Math.min(90, Number(req.query && req.query.days) || 14));
  const out = { ok: true, startedAt, days };

  const cal = await runInternal(calendlyImport, { days: String(days) });
  out.calendly = { status: cal.status, ...(cal.body && typeof cal.body === "object" ? { imported: cal.body.imported, stored: cal.body.stored, cancelled: cal.body.cancelled, error: cal.body.error } : {}) };

  const ic = await runInternal(iclosedImport, {});
  out.iclosed = { status: ic.status, ...(ic.body && typeof ic.body === "object" ? { imported: ic.body.imported, stored: ic.body.stored, total: ic.body.total, error: ic.body.error } : {}) };

  out.finishedAt = new Date().toISOString();
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json(out);
};
