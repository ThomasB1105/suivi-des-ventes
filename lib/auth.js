/* eslint-disable */
// Authentification simple par mot de passe partagé.
// Le mot de passe est dans la variable d'env APP_PASSWORD (jamais dans le code).
// Tant qu'APP_PASSWORD n'est pas défini, l'accès reste ouvert (rétro-compatible).

const crypto = require("crypto");

function token() {
  const pw = process.env.APP_PASSWORD;
  if (!pw) return null;
  return crypto.createHash("sha256").update("ang:" + pw).digest("hex").slice(0, 40);
}

// true si la requête est autorisée (ou si aucun mot de passe n'est configuré).
function checkAuth(req) {
  const t = token();
  if (!t) return true;
  const provided = (req.headers && req.headers["x-app-token"]) || (req.query && req.query.token);
  return provided === t;
}

module.exports = { token, checkAuth };
