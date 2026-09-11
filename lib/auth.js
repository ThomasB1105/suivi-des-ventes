/* eslint-disable */
// Authentification.
//  - Admin : mot de passe partagé APP_PASSWORD (comme avant) -> accès complet.
//  - Équipe (closer/setter) : comptes stockés dans app:users, session par
//    token individuel dans app:sessions. Ces tokens ne passent PAS checkAuth :
//    ils n'ouvrent que les endpoints qui appellent identify() (crm, me).
// Tant qu'APP_PASSWORD n'est pas défini, l'accès reste ouvert (rétro-compatible).

const crypto = require("crypto");

const sha = (s) => crypto.createHash("sha256").update(s).digest("hex");

function token() {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return null;
  return sha("ang:" + pw).slice(0, 40);
}

const provided = (req) => (req.headers && req.headers["x-app-token"]) || (req.query && req.query.token);

// true si ADMIN (ou si aucun mot de passe n'est configuré). Les endpoints
// financiers/imports restent sur ce contrôle -> cloisonnés de l'équipe.
function checkAuth(req) {
  const t = token();
  if (!t) return true;
  return provided(req) === t;
}

// Hash du mot de passe d'un compte équipe (salé avec APP_PASSWORD).
const userHash = (name, password) => sha(`u:${String(name).toLowerCase()}:${password}:${process.env.APP_PASSWORD || ""}`);
// Token de session d'un compte équipe (déterministe tant que le mdp ne change pas).
const userToken = (name, passHash) => sha(`s:${String(name).toLowerCase()}:${passHash}`).slice(0, 40);

// Identité de la requête : {role:"admin"} | {role:"closer"|"setter", name} | null.
// `cmd` = client KV (passé par l'endpoint pour éviter une dépendance circulaire).
async function identify(req, cmd) {
  const t = token();
  if (!t) return { role: "admin", name: "Admin" };
  const p = provided(req);
  if (!p) return null;
  if (p === t) return { role: "admin", name: "Admin" };
  try {
    const s = await cmd(["HGET", "app:sessions", p]);
    if (!s) return null;
    const sess = JSON.parse(s);
    if (!sess || !sess.name || !sess.role) return null;
    return { role: sess.role, name: sess.name };
  } catch (e) { return null; }
}

module.exports = { token, checkAuth, identify, userHash, userToken };
