/* eslint-disable */
// YouClose Pages : sert une page publiée.  GET /p/<slug>  (réécrit vers /api/p?slug=)
// Ajoute le script de suivi : identifiant visiteur, UTM du premier contact,
// temps de visionnage de la VSL (<video data-yc-vsl>), clics, RDV Calendly.

const { cmd, isConfigured } = require("../lib/kv");

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Script injecté en fin de page (le DOM est déjà là).
const TRACKER = String.raw`(function () {
  var slug = window.__YC && window.__YC.slug; if (!slug) return;
  var API = '/api/t';
  var vid;
  try { vid = localStorage.getItem('yc_vid'); } catch (e) {}
  if (!vid) { vid = 'v' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36); try { localStorage.setItem('yc_vid', vid); } catch (e) {} }
  function send(type, data) {
    var body = JSON.stringify({ vid: vid, slug: slug, type: type, data: data || {} });
    try { if (navigator.sendBeacon && navigator.sendBeacon(API, body)) return; } catch (e) {}
    try { fetch(API, { method: 'POST', body: body, keepalive: true, headers: { 'Content-Type': 'text/plain' } }); } catch (e) {}
  }
  var q = new URLSearchParams(location.search), utm = {};
  ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','ad_id','adset_id','campaign_id','placement','fbclid','gclid'].forEach(function (k) { var v = q.get(k); if (v) utm[k] = v; });
  var device = /Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'mobile' : (/iPad|Tablet/i.test(navigator.userAgent) ? 'tablette' : 'ordinateur');
  send('visit', { utm: utm, ref: document.referrer, url: location.href, device: device });

  /* Clics sur les boutons et liens */
  document.addEventListener('click', function (e) {
    var a = e.target && e.target.closest ? e.target.closest('a,button.ea-btn') : null;
    if (a) send('cta', { href: a.getAttribute('href') || '', text: (a.textContent || '').trim().slice(0, 60) });
  }, true);

  /* VSL : meilleur temps atteint, seulement quand la vidéo joue avec le son */
  var video = document.querySelector('video[data-yc-vsl]');
  if (video) {
    var best = 0, sentPct = -1, sentSec = 0;
    var report = function () {
      var dur = video.duration; if (!isFinite(dur) || !dur) return;
      var pct = Math.min(100, Math.floor(best / dur * 100));
      if (pct === sentPct && best - sentSec < 30) return;
      sentPct = pct; sentSec = best;
      send('vsl', { sec: Math.round(best), dur: Math.round(dur) });
    };
    setInterval(function () {
      if (!video.paused && !video.ended && !video.muted && video.currentTime > best) best = video.currentTime;
      report();
    }, 1000);
    video.addEventListener('ended', function () { best = video.duration || best; report(); });
    window.addEventListener('pagehide', report);
  }

  /* Calendly : on transmet l'identifiant visiteur (utm_content=yc_<vid>) pour relier le RDV au lead */
  var cal = document.querySelector('.calendly-inline-widget');
  if (cal) {
    try {
      var u = new URL(cal.getAttribute('data-url'));
      u.searchParams.set('utm_content', 'yc_' + vid);
      ['utm_source','utm_medium','utm_campaign','utm_term'].forEach(function (k) { if (utm[k] && !u.searchParams.get(k)) u.searchParams.set(k, utm[k]); });
      cal.setAttribute('data-url', u.toString());
    } catch (e) {}
    var s = document.createElement('script'); s.src = 'https://assets.calendly.com/assets/external/widget.js'; s.async = true; document.body.appendChild(s);
    window.addEventListener('message', function (e) {
      if (!e.origin || e.origin.indexOf('calendly.com') === -1) return;
      if (e.data && e.data.event === 'calendly.event_scheduled') send('booked', {});
    });
  }
})();`;

const notFound = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Page introuvable</title></head><body style="margin:0;font:16px system-ui,sans-serif;background:#0e0e10;color:#fff;display:grid;place-items:center;min-height:100vh"><div style="text-align:center;padding:24px"><h1 style="font-size:22px">Cette page n'existe pas ou n'est plus en ligne.</h1></div></body></html>`;

module.exports = async (req, res) => {
  const slug = String((req.query && req.query.slug) || "").toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60);
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  if (!slug || !isConfigured()) { res.status(404).send(notFound); return; }
  let pg = null;
  try { const raw = await cmd(["HGET", "yc:pages", slug]); pg = raw ? JSON.parse(raw) : null; } catch (e) { pg = null; }
  if (!pg || !pg.html) { res.status(404).send(notFound); return; }
  // Le script Calendly est rechargé par le suivi APRÈS avoir ajouté l'identifiant visiteur.
  const html = String(pg.html).replace(/<script[^>]*src=["']https:\/\/assets\.calendly\.com\/assets\/external\/widget\.js["'][^>]*>\s*<\/script>/gi, "");
  const doc = `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(pg.title || "")}</title>
<script>window.__YC = { slug: ${JSON.stringify(slug)} };</script>
</head>
<body>
${html}
<script>${TRACKER}</script>
</body>
</html>`;
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=300");
  res.status(200).send(doc);
};
