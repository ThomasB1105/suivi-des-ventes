// Petit client Redis REST (compatible Vercel KV et Upstash) pour les fonctions
// serverless. On utilise l'API REST (pas de connexion persistante) — idéal en
// environnement serverless. Lit les identifiants depuis les variables d'env
// injectées par l'intégration Vercel KV / Upstash.

function creds() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return { url, token };
}

function isConfigured() {
  const { url, token } = creds();
  return !!(url && token);
}

// Exécute une commande Redis ( ex: ["HSET","sales:events", id, json] ).
async function cmd(command) {
  const { url, token } = creds();
  if (!url || !token) {
    throw new Error("Base KV non configurée (KV_REST_API_URL / KV_REST_API_TOKEN manquants).");
  }
  const r = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok || data.error) throw new Error(data.error || `KV ${r.status}`);
  return data.result;
}

// Exécute plusieurs commandes en une requête (Upstash /pipeline).
async function pipeline(commands) {
  const { url, token } = creds();
  if (!url || !token) throw new Error("Base KV non configurée.");
  if (!commands.length) return [];
  const r = await fetch(url + "/pipeline", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  const data = await r.json().catch(() => []);
  if (!r.ok) throw new Error(`KV ${r.status}`);
  return data;
}

module.exports = { isConfigured, cmd, pipeline };
