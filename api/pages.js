/* eslint-disable */
// YouClose Pages : pages hébergées (admin uniquement).
//   GET    /api/pages              -> {pages:[{slug,title,updatedAt,stats}]}
//   GET    /api/pages?slug=x       -> {page:{slug,title,state,updatedAt}}
//   POST   /api/pages {slug,title,html,state}  -> publie / met à jour
//   DELETE /api/pages?slug=x       -> retire la page

const { cmd, isConfigured } = require("../lib/kv");
const { checkAuth } = require("../lib/auth");

const cleanSlug = (s) => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (!checkAuth(req)) { res.status(401).json({ error: "Connecte-toi en admin sur l'app pour publier." }); return; }
  if (!isConfigured()) { res.status(500).json({ error: "Base KV non configurée." }); return; }
  try {
    if (req.method === "GET") {
      const one = cleanSlug(req.query && req.query.slug);
      if (one) {
        const raw = await cmd(["HGET", "yc:pages", one]);
        if (!raw) { res.status(404).json({ error: "Page introuvable." }); return; }
        const p = JSON.parse(raw);
        res.status(200).json({ page: { slug: p.slug, title: p.title, state: p.state || null, updatedAt: p.updatedAt } });
        return;
      }
      const flat = (await cmd(["HGETALL", "yc:pages"])) || [];
      const pages = [];
      for (let i = 0; i < flat.length; i += 2) {
        let p; try { p = JSON.parse(flat[i + 1]); } catch (e) { continue; }
        const sf = (await cmd(["HGETALL", "trk:s:" + p.slug])) || [];
        const stats = {}; for (let j = 0; j < sf.length; j += 2) stats[sf[j]] = Number(sf[j + 1]) || 0;
        pages.push({ slug: p.slug, title: p.title, updatedAt: p.updatedAt, stats });
      }
      pages.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
      res.status(200).json({ pages });
      return;
    }
    if (req.method === "POST") {
      let b = req.body; if (typeof b === "string") { try { b = JSON.parse(b); } catch (e) { b = {}; } }
      b = b || {};
      const slug = cleanSlug(b.slug);
      const html = String(b.html || "");
      if (slug.length < 2) { res.status(400).json({ error: "Choisis une adresse de page (au moins 2 caractères)." }); return; }
      if (!html.trim()) { res.status(400).json({ error: "La page est vide." }); return; }
      if (html.length > 900000) { res.status(400).json({ error: "Page trop lourde (900 Ko max)." }); return; }
      const page = { slug, title: String(b.title || slug).slice(0, 140), html, state: b.state && typeof b.state === "object" ? b.state : null, updatedAt: new Date().toISOString() };
      await cmd(["HSET", "yc:pages", slug, JSON.stringify(page)]);
      res.status(200).json({ ok: true, slug, url: `/p/${slug}` });
      return;
    }
    if (req.method === "DELETE") {
      const slug = cleanSlug(req.query && req.query.slug);
      if (!slug) { res.status(400).json({ error: "Page manquante." }); return; }
      await cmd(["HDEL", "yc:pages", slug]);
      res.status(200).json({ ok: true });
      return;
    }
    res.status(405).json({ error: "Méthode non gérée." });
  } catch (e) {
    res.status(500).json({ error: "Erreur serveur : " + String(e.message || e) });
  }
};
