# Suivi des ventes & impayés

Application React de **suivi des ventes, de l'attribution (organique / paid) et des paiements échelonnés**.
Pensée pour relier les ventes **systeme.io** + les fiches **iClosed** afin de savoir **d'où viennent les ventes** et de **gérer les impayés**.

## Ce que fait l'app (v1)

- **KPI** : CA signé, encaissé, reste à encaisser, impayés, revenu organique vs paid.
- **Clients** : pour chaque vente, le plan de paiement échéance par échéance. Un clic sur une échéance permet de la marquer *encaissée (Stripe)*, *encaissée en direct (virement)* ou de la remettre en attente. Les échéances dépassées non payées passent automatiquement en **impayé**.
- **Cohortes** : matrice façon tableur par mois de signature (taux de recouvrement, impayés).
- **Par mois** : prévisionnel d'encaissement (graphe) + tableau encaissé / à encaisser / impayés.
- **Ajout de vente** : formulaire avec source du lead, canal (organique/paid), montant, acompte et nombre de mensualités → génère le plan de paiement.

Les données sont persistées en **localStorage** (clé `melo_sales_v4`). Des données de démonstration sont chargées au premier lancement.

## Lancer en local

```bash
npm install
npm start        # http://localhost:3000
npm run build    # build de production dans ./build
```

## Déploiement Vercel

Le projet est un Create React App standard : Vercel le détecte automatiquement.
- **Framework Preset** : Create React App
- **Build Command** : `npm run build`
- **Output Directory** : `build`

Si le code est poussé dans un sous-dossier du dépôt, définis le **Root Directory** correspondant dans les réglages du projet Vercel.

## Prochaine étape — synchro systeme.io

La v1 fonctionne en saisie manuelle + données démo. Pour brancher les ventes réelles, plusieurs pistes :

1. **API systeme.io** (clé API) : une fonction serverless interroge l'API officielle pour récupérer commandes/contacts.
2. **Webhooks via Make/Zapier** : systeme.io / Stripe pousse chaque vente (et chaque prélèvement échoué → bascule en impayé) vers un endpoint, qui alimente un stockage.
3. **Import CSV** des ventes systeme.io.

L'attribution « d'où viennent les ventes » peut venir des **tags / UTM** de la commande systeme.io ou rester en **saisie manuelle** (champ source + canal, déjà en place).

## Synchro systeme.io (webhooks + base KV) — automatique

L'**API publique systeme.io n'expose que les contacts/tags** (pas les ventes). La synchro
passe donc par les **webhooks** : systeme.io pousse chaque événement (vente, paiement
d'abonnement, **paiement échoué = impayé**) vers notre endpoint, qui le stocke dans une
**base KV**. L'app lit la base et se met à jour **automatiquement** au chargement.

```
systeme.io (webhook) ──> /api/ingest ──> base KV ──> /api/sales ──> app
```

- `api/ingest.js` : reçoit les webhooks (protégé par `INGEST_SECRET`), stocke les événements.
- `api/sales.js` : regroupe les transactions par client (email) → ventes + échéances.
- `lib/kv.js` : petit client Redis REST (compatible Vercel KV / Upstash).

### Mise en route

1. **Base KV** : Vercel → **Storage → Create Database → KV (Upstash Redis)** → connecte-la
   au projet. Ça injecte automatiquement `KV_REST_API_URL` et `KV_REST_API_TOKEN`.
2. **Secret** : Vercel → Settings → Environment Variables → ajoute `INGEST_SECRET`
   (une longue chaîne aléatoire). **Redéploie**.
3. **Webhook systeme.io** : Profil → **Réglages → Webhooks → Create** (ou Automatisations →
   Règles). Événements : *nouvelle vente*, *paiement d'abonnement*, *paiement d'abonnement
   échoué*, *vente annulée*. URL :
   ```
   https://<ton-app>.vercel.app/api/ingest?secret=<INGEST_SECRET>
   ```
4. Fais une vente test (ou attends la prochaine) → elle apparaît dans l'app.

> ⚠️ Les webhooks ne captent que les **nouveaux** événements à partir de l'activation :
> l'historique antérieur n'est pas récupérable (l'API systeme.io ne l'expose pas).

### Calibration du mapping (une fois, sur du réel)

Le format exact du payload systeme.io n'est pas documenté. Après le 1er webhook reçu, ouvre :

```
https://<ton-app>.vercel.app/api/sales?debug=1
```

Ça affiche les derniers payloads bruts. Si un champ ne tombe pas au bon endroit (montant,
date, contact, offre, statut), on ajuste l'extraction dans `api/ingest.js`.
