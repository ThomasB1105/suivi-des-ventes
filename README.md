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

## Synchro systeme.io (API + serverless) — en place

Une fonction serverless `api/systeme.js` (déployée automatiquement par Vercel) interroge
l'**API publique systeme.io** côté serveur et renvoie les ventes à l'app. La clé API n'est
**jamais** exposée au navigateur. Dans l'app, le bouton **« Synchroniser »** (en-tête)
appelle cet endpoint et remplace les ventes issues de systeme.io (les ventes saisies à la
main sont conservées). systeme.io reste la **source de vérité** des paiements/impayés.

### Mise en route

1. Dans systeme.io : **Profil → « Public API keys » → créer une clé** (copie-la tout de suite,
   elle n'est plus affichée ensuite).
2. Dans Vercel : **Project → Settings → Environment Variables**, ajoute `SYSTEME_API_KEY`
   (et, en option, `SYSTEME_PAID_TAGS` / `SYSTEME_ORGANIC_TAGS` pour l'attribution — voir
   `.env.example`). **Redéploie** pour que la variable soit prise en compte.
3. Ouvre l'app → clique **« Synchroniser »**.

### Calibration du mapping (une fois)

Les noms de champs de l'API systeme.io peuvent varier d'un compte à l'autre. Pour vérifier le
format réel de tes commandes, ouvre dans le navigateur :

```
https://<ton-app>.vercel.app/api/systeme?debug=1
```

Cela renvoie un échantillon brut (`orders`, `contacts`, `tags`). Si un champ ne tombe pas au
bon endroit (montant, plan de paiement, statut payé), on ajuste le mapping dans
`api/systeme.js` (fonction `normalizeOrder`) à partir de ce qu'on y voit.
