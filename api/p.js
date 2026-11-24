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
  /* Calendrier YouClose : questionnaire, créneaux, coordonnées, confirmation */
  var book = document.getElementById('yc-book');
  if (book) {
    var E = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
    var st = { q: 0, answers: {}, data: null, day: 0, time: null, done: null, dq: false, err: '', sending: false };
    var load = function () {
      book.innerHTML = '<div class="ycb-msg">Chargement des créneaux…</div>';
      fetch('/api/book?page=' + encodeURIComponent(slug)).then(function (r) { return r.json(); }).then(function (d) {
        if (!d || !d.days) throw 0; st.data = d; if (st.day >= d.days.length) st.day = 0; render();
      }).catch(function () { book.innerHTML = '<div class="ycb-msg">Le calendrier ne s\'est pas chargé. <button type="button" class="ycb-link" id="ycb-retry">Réessayer</button></div>'; var r = document.getElementById('ycb-retry'); if (r) r.onclick = load; });
    };
    var render = function () {
      var d = st.data, h = '';
      if (st.done) {
        h = '<div class="ycb-done"><div class="ycb-check">✓</div><h3>C\'est réservé</h3><p><b>' + E(st.done.label) + '</b> (heure de Paris), avec ' + E(st.done.closer) + '.</p><p>On te contacte au numéro indiqué à l\'heure du rendez-vous. Garde ce créneau libre.</p></div>';
      } else if (st.dq) {
        h = '<div class="ycb-done"><h3>Merci pour tes réponses</h3><p>' + E(d.dqText) + '</p></div>';
      } else if (st.q < d.questions.length) {
        var Q = d.questions[st.q];
        h = '<div class="ycb-step">Question ' + (st.q + 1) + ' sur ' + d.questions.length + '</div><div class="ycb-bar"><i style="width:' + Math.round(st.q / d.questions.length * 100) + '%"></i></div><h3>' + E(Q.q) + '</h3><div class="ycb-opts">' +
          Q.options.map(function (o, i) { return '<button type="button" class="ycb-opt" data-i="' + i + '"><span>' + 'ABCDEFGH'.charAt(i) + '</span>' + E(o.label) + '</button>'; }).join('') + '</div>' +
          (st.q ? '<button type="button" class="ycb-link" id="ycb-back">‹ Question précédente</button>' : '');
      } else if (!st.time) {
        if (!d.days.length) { h = '<div class="ycb-msg">Aucun créneau libre pour le moment. Reviens un peu plus tard.</div>'; }
        else {
          var day = d.days[st.day];
          h = '<h3>Choisis ton créneau</h3><p class="ycb-sub">Appel de ' + d.duration + ' min · heure de Paris</p><div class="ycb-days">' +
            d.days.map(function (x, i) { return '<button type="button" class="ycb-day' + (i === st.day ? ' on' : '') + '" data-d="' + i + '"><b>' + E(x.label.split(' ')[0].slice(0, 3)) + '.</b><span>' + E(x.label.split(' ').slice(1).join(' ')) + '</span></button>'; }).join('') +
            '</div><div class="ycb-times">' + day.slots.map(function (t) { return '<button type="button" class="ycb-time" data-t="' + E(t) + '">' + E(t.replace(':', 'h')) + '</button>'; }).join('') + '</div>';
        }
      } else {
        var dd = d.days[st.day];
        h = '<h3>Tes coordonnées</h3><p class="ycb-sub">' + E(dd.label) + ' à ' + E(st.time.replace(':', 'h')) + ' · <button type="button" class="ycb-link" id="ycb-change">changer</button></p>' +
          '<form id="ycb-form" novalidate><div class="ycb-grid"><label>Prénom<input name="firstName" autocomplete="given-name" required></label><label>Nom<input name="lastName" autocomplete="family-name"></label></div>' +
          '<label>Email<input name="email" type="email" autocomplete="email" required></label><label>Téléphone (WhatsApp)<input name="phone" type="tel" autocomplete="tel" required placeholder="+33 6 12 34 56 78"></label>' +
          (st.err ? '<div class="ycb-err">' + E(st.err) + '</div>' : '') +
          '<button type="submit" class="ycb-submit"' + (st.sending ? ' disabled' : '') + '>' + (st.sending ? 'Réservation…' : 'Confirmer mon appel') + '</button></form>';
      }
      book.innerHTML = '<div class="ycb">' + h + '</div>';
      Array.prototype.forEach.call(book.querySelectorAll('.ycb-opt'), function (b) { b.onclick = function () { var Q = d.questions[st.q], o = Q.options[+b.getAttribute('data-i')]; st.answers[Q.q] = o.label; if (o.dq) { st.dq = true; send('cta', { text: 'Écarté par le questionnaire' }); } else st.q++; render(); }; });
      var bk = document.getElementById('ycb-back'); if (bk) bk.onclick = function () { st.q = Math.max(0, st.q - 1); render(); };
      Array.prototype.forEach.call(book.querySelectorAll('.ycb-day'), function (b) { b.onclick = function () { st.day = +b.getAttribute('data-d'); render(); }; });
      Array.prototype.forEach.call(book.querySelectorAll('.ycb-time'), function (b) { b.onclick = function () { st.time = b.getAttribute('data-t'); st.err = ''; render(); var f = book.querySelector('input'); if (f) f.focus(); }; });
      var ch = document.getElementById('ycb-change'); if (ch) ch.onclick = function () { st.time = null; render(); };
      var form = document.getElementById('ycb-form');
      if (form) form.onsubmit = function (e) {
        e.preventDefault(); if (st.sending) return;
        var fd = new FormData(form), body = { page: slug, date: d.days[st.day].date, time: st.time, answers: st.answers, vid: vid };
        fd.forEach(function (v, k) { body[k] = String(v).trim(); });
        st.sending = true; st.err = ''; var keep = body; render(); var f2 = document.getElementById('ycb-form'); if (f2) Object.keys(keep).forEach(function (k) { if (f2.elements[k]) f2.elements[k].value = keep[k]; });
        fetch('/api/book', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json().then(function (j) { return { s: r.status, j: j }; }); }).then(function (x) {
          st.sending = false;
          if (x.s === 200 && x.j.ok) { st.done = x.j; send('booked', {}); render(); return; }
          if (x.j && x.j.disqualified) { st.dq = true; render(); return; }
          if (x.s === 409) { st.time = null; st.err = ''; load(); alertMsg(x.j.error); return; }
          st.err = (x.j && x.j.error) || 'La réservation a échoué. Réessaie.'; render(); var f3 = document.getElementById('ycb-form'); if (f3) Object.keys(keep).forEach(function (k) { if (f3.elements[k]) f3.elements[k].value = keep[k]; });
        }).catch(function () { st.sending = false; st.err = 'Connexion impossible. Vérifie ta connexion et réessaie.'; render(); });
      };
    };
    var alertMsg = function (m) { var n = document.createElement('div'); n.className = 'ycb-toast'; n.textContent = m; document.body.appendChild(n); setTimeout(function () { n.remove(); }, 3500); };
    load();
  }
})();`;


const BOOK_CSS = `.ycb{background:#fff;color:#111827;text-align:left;padding:28px clamp(18px,4vw,40px) 32px;font-family:Inter,system-ui,sans-serif;min-height:340px;display:flex;flex-direction:column;gap:12px}
.ycb h3{margin:4px 0 0;font:800 clamp(18px,2.2vw,22px)/1.25 Montserrat,Inter,sans-serif;color:#0b0b0c}
.ycb-sub{margin:0;color:#6b7280;font-size:14px}
.ycb-step{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ea-accent)}
.ycb-bar{height:4px;border-radius:99px;background:#eef0f4;overflow:hidden}.ycb-bar i{display:block;height:100%;background:var(--ea-accent)}
.ycb-opts{display:flex;flex-direction:column;gap:8px;margin-top:6px}
.ycb-opt{display:flex;align-items:center;gap:12px;text-align:left;border:1px solid #e5e7eb;background:#fff;border-radius:12px;padding:13px 14px;font:500 15px Inter,sans-serif;color:#111827;cursor:pointer;min-height:48px}
.ycb-opt:hover,.ycb-opt:focus-visible{border-color:var(--ea-accent);background:rgba(var(--ea-accent-rgb),.05);outline:none}
.ycb-opt span{width:26px;height:26px;border-radius:7px;border:1px solid #d1d5db;display:grid;place-items:center;font-size:12px;font-weight:700;color:var(--ea-accent);flex:none}
.ycb-days{display:flex;gap:8px;overflow-x:auto;padding-bottom:4px}
.ycb-day{flex:none;border:1px solid #e5e7eb;background:#fff;border-radius:12px;padding:9px 12px;display:flex;flex-direction:column;align-items:center;gap:1px;cursor:pointer;font:500 13px Inter,sans-serif;color:#374151;min-width:76px}
.ycb-day b{font-weight:700;text-transform:capitalize;color:#111827}
.ycb-day.on{border-color:var(--ea-accent);background:var(--ea-accent);color:#fff}.ycb-day.on b{color:#fff}
.ycb-times{display:grid;grid-template-columns:repeat(auto-fill,minmax(92px,1fr));gap:8px;margin-top:4px}
.ycb-time{border:1px solid rgba(var(--ea-accent-rgb),.45);background:#fff;color:var(--ea-accent);border-radius:10px;padding:12px 0;font:700 15px Inter,sans-serif;cursor:pointer}
.ycb-time:hover,.ycb-time:focus-visible{background:var(--ea-accent);color:#fff;outline:none}
.ycb form{display:flex;flex-direction:column;gap:12px;margin-top:4px}
.ycb label{display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:600;color:#374151}
.ycb input{border:1px solid #d1d5db;border-radius:10px;padding:12px;font:16px Inter,sans-serif;color:#111827;background:#fff}
.ycb input:focus{border-color:var(--ea-accent);outline:2px solid rgba(var(--ea-accent-rgb),.2)}
.ycb-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.ycb-submit{background:var(--ea-accent);color:#fff;border:0;border-radius:12px;padding:16px;font:800 16px Montserrat,Inter,sans-serif;text-transform:uppercase;letter-spacing:.03em;cursor:pointer}
.ycb-submit:disabled{opacity:.6;cursor:wait}
.ycb-link{background:none;border:0;padding:0;color:var(--ea-accent);font:600 14px Inter,sans-serif;cursor:pointer;text-decoration:underline;align-self:flex-start}
.ycb-err{background:#fef2f2;color:#b91c1c;border-radius:10px;padding:10px 12px;font-size:14px}
.ycb-msg{padding:40px 20px;text-align:center;color:#6b7280;background:#fff;font:15px Inter,sans-serif}
.ycb-done{text-align:center;padding:30px 10px;display:flex;flex-direction:column;align-items:center;gap:8px}
.ycb-done p{margin:0;color:#4b5563;font-size:15px;max-width:440px;line-height:1.5}
.ycb-check{width:56px;height:56px;border-radius:50%;background:var(--ea-accent);color:#fff;display:grid;place-items:center;font-size:26px;font-weight:800}
.ycb-toast{position:fixed;left:50%;bottom:20px;transform:translateX(-50%);background:#111827;color:#fff;padding:12px 16px;border-radius:12px;font:600 14px Inter,sans-serif;z-index:99}
@media (max-width:520px){.ycb-grid{grid-template-columns:1fr}}`;

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
${/yc-book/.test(html) ? `<style>${BOOK_CSS}</style>` : ''}
</head>
<body>
${html}
<script>${TRACKER}</script>
</body>
</html>`;
  res.setHeader("Cache-Control", "public, s-maxage=30, stale-while-revalidate=300");
  res.status(200).send(doc);
};
