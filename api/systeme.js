/* eslint-disable */
// ---------------------------------------------------------------------------
// Vercel serverless function — pont entre l'app et l'API publique systeme.io.
//
// La clé API reste 100% côté serveur (jamais exposée au navigateur).
//
// Appels depuis le front :
//   GET /api/systeme           -> ventes normalisées { sales: [...] } pour l'app
//   GET /api/systeme?debug=1   -> échantillons BRUTS (1re page de orders + contacts)
//                                 pour caler le mapping sur tes vraies données
//
// Variables d'environnement (Vercel → Project → Settings → Environment Variables) :
//   SYSTEME_API_KEY        (obligatoire) clé API systeme.io
//                          → Profil → "Public API keys" → créer une clé
//   SYSTEME_PAID_TAGS      (option) tags = "paid",   ex: "meta,google,ads,tiktok"
//   SYSTEME_ORGANIC_TAGS   (option) tags = "organic",ex: "youtube,insta,seo,direct"
// ---------------------------------------------------------------------------

const API_BASE = "https://api.systeme.io/api";

// --- petit client HTTP vers systeme.io -------------------------------------
async function sioGet(path, key, params = {}) {
  const url = new URL(API_BASE + path);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, v);
  });
  const r = await fetch(url, {
    headers: { "X-API-Key": key, Accept: "application/json" },
  });
  const text = await r.text();
  let body;
  try { body = JSON.parse(text); } catch { body = text; }
  if (!r.ok) {
    const err = new Error(`systeme.io ${r.status}`);
    err.status = r.status;
    err.body = body;
    throw err;
  }
  return body;
}

// systeme.io pagine en curseur : `limit` + `startingAfter` (= id du dernier item),
// et renvoie en général { items: [...], hasMore: bool }. On gère aussi le cas
// où la réponse est directement un tableau, par sécurité.
async function sioList(path, key, { limit = 100, max = 2000 } = {}) {
  const out = [];
  let startingAfter;
  while (out.length < max) {
    const page = await sioGet(path, key, { limit, startingAfter });
    const items = Array.isArray(page) ? page : (page.items || page.data || []);
    if (!items.length) break;
    out.push(...items);
    const hasMore = Array.isArray(page) ? items.length === limit : !!page.hasMore;
    if (!hasMore) break;
    const last = items[items.length - 1];
    if (!last || last.id == null) break;
    startingAfter = last.id;
  }
  return out;
}

// --- helpers de mapping (défensifs : on essaie plusieurs noms de champs) ----
const pick = (obj, ...keys) => {
  for (const k of keys) {
    if (obj && obj[k] !== undefined && obj[k] !== null) return obj[k];
  }
  return undefined;
};

const csvEnv = (name) =>
  (process.env[name] || "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

function channelFromTags(tagNames) {
  const lower = (tagNames || []).map((t) => String(t).toLowerCase());
  const paid = csvEnv("SYSTEME_PAID_TAGS");
  const organic = csvEnv("SYSTEME_ORGANIC_TAGS");
  if (paid.length && lower.some((t) => paid.some((p) => t.includes(p)))) return "paid";
  if (organic.length && lower.some((t) => organic.some((o) => t.includes(o)))) return "organic";
  // heuristique de repli si aucun tag configuré
  const paidWords = ["ads", "meta", "facebook", "google", "paid", "tiktok", "sea"];
  if (lower.some((t) => paidWords.some((w) => t.includes(w)))) return "paid";
  return "organic";
}

const toISODate = (v) => {
  if (!v) return undefined;
  const d = new Date(v);
  if (isNaN(d)) return undefined;
  return d.toISOString().slice(0, 10);
};

const num = (v) => {
  if (v == null) return 0;
  const n = parseFloat(String(v).replace(",", "."));
  return isNaN(n) ? 0 : n;
};

// Normalise une commande systeme.io vers le modèle attendu par l'app.
// NB : les noms de champs côté systeme.io peuvent varier selon le compte —
// le mode ?debug=1 affiche le format brut pour finaliser ce mapping.
function normalizeOrder(order, tagsById) {
  const contact = pick(order, "contact") || {};
  const contactTags = (pick(contact, "tags") || pick(order, "tags") || [])
    .map((t) => (typeof t === "string" ? t : pick(t, "name", "tag", "id")))
    .map((t) => (tagsById && tagsById[t] ? tagsById[t] : t))
    .filter(Boolean);

  const first = pick(contact, "firstName", "first_name") || "";
  const last = pick(contact, "surname", "lastName", "last_name") || "";
  const fullName =
    [first, last].filter(Boolean).join(" ").trim() ||
    pick(contact, "email") ||
    pick(order, "customerName") ||
    "Client";

  const total = num(pick(order, "total", "amount", "totalAmount", "price"));

  // Plan de paiement : on tente de lire les échéances/paiements de la commande.
  const rawItems =
    pick(order, "installments", "payments", "paymentPlan", "schedule") || [];
  let schedule = (Array.isArray(rawItems) ? rawItems : []).map((p, j) => ({
    id: `inst-${pick(order, "id") || "x"}-${j}`,
    dueDate:
      toISODate(pick(p, "dueDate", "date", "scheduledAt", "due_at")) ||
      toISODate(pick(order, "createdAt", "date")) ||
      toISODate(Date.now()),
    amount: num(pick(p, "amount", "total", "price")),
    paid: ["paid", "succeeded", "completed", "captured"].includes(
      String(pick(p, "status", "state") || (pick(p, "paid") ? "paid" : "")).toLowerCase()
    ),
    method: "auto",
  }));

  // Pas de plan détaillé renvoyé par l'API → une seule échéance = la commande.
  if (!schedule.length) {
    const paidWhole = ["paid", "completed", "succeeded"].includes(
      String(pick(order, "status", "state") || "").toLowerCase()
    );
    schedule = [
      {
        id: `inst-${pick(order, "id") || "x"}-0`,
        dueDate: toISODate(pick(order, "createdAt", "date")) || toISODate(Date.now()),
        amount: total,
        paid: paidWhole,
        method: "auto",
      },
    ];
  }

  return {
    id: `sio-${pick(order, "id") || Math.random().toString(36).slice(2)}`,
    client: fullName,
    email: pick(contact, "email") || "",
    phone: pick(contact, "phoneNumber", "phone") || "",
    closer: "—",
    // Attribution organique/paid faite à la main dans l'app (pas dispo dans systeme.io).
    // La synchro préserve ces champs une fois que tu les as réglés.
    source: "À attribuer",
    channel: "organic",
    offer: pick(order, "productName") || pick(order, "name") || "—",
    closeDate: toISODate(pick(order, "createdAt", "date")) || toISODate(Date.now()),
    total,
    schedule,
  };
}

// --- handler ----------------------------------------------------------------
module.exports = async (req, res) => {
  const key = process.env.SYSTEME_API_KEY;
  if (!key) {
    res.status(500).json({
      error:
        "SYSTEME_API_KEY manquante. Ajoute-la dans Vercel → Settings → Environment Variables, puis redéploie.",
    });
    return;
  }

  try {
    // Mode calibration : on renvoie le format brut pour caler le mapping.
    if (req.query && (req.query.debug === "1" || req.query.debug === "true")) {
      const [orders, contacts, tags] = await Promise.all([
        sioGet("/orders", key, { limit: 3 }).catch((e) => ({ _error: e.status, _body: e.body })),
        sioGet("/contacts", key, { limit: 3 }).catch((e) => ({ _error: e.status, _body: e.body })),
        sioGet("/tags", key, { limit: 50 }).catch((e) => ({ _error: e.status, _body: e.body })),
      ]);
      res.status(200).json({ debug: true, orders, contacts, tags });
      return;
    }

    // Dictionnaire id->nom de tag (si l'API renvoie des ids de tags).
    let tagsById = {};
    try {
      const tags = await sioList("/tags", key, { max: 500 });
      tags.forEach((t) => {
        const id = pick(t, "id");
        const name = pick(t, "name", "tag");
        if (id != null && name) tagsById[id] = name;
      });
    } catch { /* tags optionnels */ }

    const orders = await sioList("/orders", key, { limit: 100, max: 2000 });
    const sales = orders.map((o) => normalizeOrder(o, tagsById));

    res.setHeader("Cache-Control", "s-maxage=60, stale-while-revalidate=300");
    res.status(200).json({ sales, count: sales.length, syncedAt: new Date().toISOString() });
  } catch (e) {
    res.status(e.status || 502).json({
      error: `Appel systeme.io échoué (${e.status || "réseau"}).`,
      detail: e.body || String(e.message || e),
    });
  }
};
