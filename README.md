## Première installation

Après avoir cloné le dépôt, installer les dépendances et committer les lockfiles :

```bash
cd backend && npm install
git add package-lock.json

cd ../frontend && npm install
git add package-lock.json

git commit -m "chore: add package-lock.json"
```

Les `package-lock.json` ne sont pas inclus dans le dépôt — ils doivent être générés
lors de la première installation. Sans eux, `npm ci` échoue et les builds ne sont pas
déterministes. **Ne pas sauter cette étape avant le premier déploiement.**


## Architecture

```
nova-copro/
├── backend/   Node.js + Express + PostgreSQL
└── frontend/  Next.js + Tailwind CSS
```

**Ce que l'app stocke :** emails (hashés + chiffrés), noms/prénoms (chiffrés), URLs de dossiers Drive, accès par copropriété.  
**Ce qu'elle chiffre :** tous les champs personnels (PII) via AES-256-GCM côté applicatif. Un dump PostgreSQL sans `ENCRYPTION_KEY` est illisible.  
**Ce qu'elle délègue à Google Drive :** le stockage et l'affichage des documents. L'app ne stocke que des URLs de dossiers.  
**Ce que fait l'import Excel :** un import ponctuel (upsert utilisateurs + accès). Ce n'est pas une synchronisation automatique.

---

## Prérequis

- Node.js 18+
- PostgreSQL 14+
- Un projet Google Cloud avec un Service Account et l'API Drive activée
- Un serveur email (Resend)

---



## Installation backend

### 1. Variables d'environnement

```bash
cp backend/.env.example backend/.env
```

Remplir toutes les valeurs :

```env
DATABASE_URL=postgresql://user:pass@host:5432/nova_copro

# JWT
JWT_SECRET=<openssl rand -hex 32>

# Chiffrement PII
ENCRYPTION_KEY=<openssl rand -hex 32>
HMAC_KEY=<openssl rand -hex 32>
KEY_VERSION=1

# OTP (protège contre brute-force hors-ligne en cas de fuite de base)
OTP_SECRET=<openssl rand -base64 32>

# Google Drive
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}  # JSON sur une ligne

# Email
RESEND_API_KEY=re_...
EMAIL_FROM=noreply@votre-domaine.com
ADMIN_EMAIL=votre@email.com          # reçoit les demandes d'accès

FRONTEND_URL=https://votre-app.vercel.app
NODE_ENV=production
```

> **Secrets critiques :** `ENCRYPTION_KEY`, `HMAC_KEY` et `OTP_SECRET` ne doivent jamais être dans le dépôt Git.

### 2. Initialiser la base

**Base neuve :**
```bash
cd backend && npm install
node src/db/setup.js
```

**Base existante (migration v1 → v2) :**
```bash
psql $DATABASE_URL -f migration_v2.sql
node src/db/migrate_encrypt.js
```

### 3. Créer le premier administrateur

```bash
npm run admin:create -- --email admin@exemple.com --nom Dupont --prenom Marie
```

### 4. Démarrer

```bash
npm run dev    # développement
npm start      # production
```

---

## Installation frontend

```bash
cd frontend && npm install
cp .env.example .env.local
# NEXT_PUBLIC_API_URL=https://api.votre-domaine.com
npm run dev
```

---

## Authentification

L'authentification repose sur des **codes OTP envoyés par email** — aucun mot de passe.

### Flux de connexion
1. L'utilisateur saisit son email.
2. Si l'email est **connu** → code OTP envoyé, valide 10 minutes.
3. Si l'email est **inconnu** → page de demande d'accès avec formulaire libre.
   - L'admin reçoit un email de notification.
   - L'utilisateur reçoit une confirmation.
4. Après validation du code → session créée (cookie HttpOnly, 6 mois si "rester connecté").

### Session

> **Note déploiement cross-domain (Vercel + Render) :** En production, le cookie JWT
> utilise `SameSite=None; Secure`, ce qui est requis quand le frontend et le backend
> sont sur des domaines distincts. Certains navigateurs (Safari en navigation privée,
> Brave, Firefox avec protections renforcées) peuvent bloquer les cookies tiers.
> Pour éviter ce problème à terme, il est recommandé de passer front et back sur un
> sous-domaine commun (ex : `app.nova-copro.fr` + `api.nova-copro.fr`), ce qui permettra
> de repasser en `SameSite=Strict`.

- **"Rester connecté"** : session de **6 mois** (cookie HttpOnly posé par le backend).
- **Sans cette option** : session de 24h.
- Le token JWT est dans un cookie `HttpOnly; Secure` → inaccessible depuis JavaScript (résistant au XSS).
En production cross-domain (Vercel + Render), le cookie utilise `SameSite=None; Secure`.
Sur un domaine commun (`app.nova-copro.fr` / `api.nova-copro.fr`), `SameSite=Lax` ou `Strict` est préférable.

---

## Synchronisation automatique des droits Drive

Le script `sync-drive-permissions.js` lit tous les accès configurés dans Nova Copro et
synchronise les permissions directement sur les dossiers Google Drive.

**Avantage concret :** les copropriétaires peuvent accéder aux dossiers depuis leur
Google Drive personnel, sans passer par Nova Copro. L'app sert de surcouche,
mais les accès Drive sont réels et directs.

### Usage

```bash
# Simulation — voir ce qui serait modifié sans rien toucher
npm run drive:sync:dry

# Sync complète — accorde et révoque les accès selon la base Nova Copro
npm run drive:sync

# Sync pour un seul utilisateur
node scripts/sync-drive-permissions.js --user email@exemple.com

# Révoquer tous les accès Drive (sans en accorder de nouveaux)
npm run drive:revoke-all
```

### Fonctionnement par accès

Pour chaque ligne `user_acces` en base :

| Dossier | Accordé si |
|---------|-----------|
| `drive_url_copropriete` | utilisateur actif |
| `drive_url_personnel`   | utilisateur actif |
| `drive_url_conseil`     | utilisateur actif **et** `is_conseil_syndical = true` |

Un utilisateur **désactivé** dans Nova Copro → ses permissions Drive sont **révoquées** automatiquement.

### Quand lancer la sync ?

Après chaque modification significative en base :
- Import Excel
- Ajout / suppression d'un utilisateur
- Modification des URLs Drive d'une copropriété
- Passage d'un utilisateur en `is_active = false`

La sync est idempotente : la relancer plusieurs fois ne crée pas de doublons.

### Procédure recommandée après chaque modification

La sync ne se lance pas automatiquement. Après un import, une création/désactivation d'utilisateur
ou un changement d'URL Drive, lancer dans l'ordre :

```bash
npm run drive:sync:dry   # 1. Vérifier ce qui sera modifié
npm run drive:sync       # 2. Appliquer seulement si le dry-run est correct
```

Le dry-run est obligatoire avant toute sync en production.

### Emails protégés (allowlist)

Configurer `SYNC_PROTECTED_EMAILS` pour ne jamais révoquer certains emails :

```env
SYNC_PROTECTED_EMAILS=toi@domain.fr,gestionnaire@domain.fr,comptable@domain.fr
```

Ces emails ne sont jamais touchés par le script, même s'ils ne sont pas dans Nova Copro.
Utile pour les accès manuels permanents (gestionnaire, comptable, prestataire…).

> **Note :** `drive_url_base` (dossier racine copropriété) n'est pas géré par la sync — il peut contenir des accès manuels qui ne passent pas par Nova Copro. La sync ne touche que les dossiers de `user_acces`.

### Prérequis Drive pour la sync

Le service account doit avoir le rôle **Gestionnaire** (Manager) sur les Shared Drives concernés,
ou être **propriétaire** des dossiers My Drive à partager.
Le scope utilisé est `https://www.googleapis.com/auth/drive` (lecture + gestion permissions).

---

## Import Excel

- Format : une ligne = un accès (un utilisateur dans une copropriété).
- Télécharger le modèle : bouton dans l'interface admin ou `GET /api/admin/import/template`.
- **Simuler d'abord** : prévisualise créations, mises à jour, écrasements et erreurs sans rien écrire.
- Cellule Drive vide → l'URL existante en base est conservée (pas d'écrasement silencieux).
- Chaque ligne s'exécute sous un `SAVEPOINT` : une erreur sur une ligne n'annule pas les autres.
- Après un import, lancer `npm run drive:sync` pour répercuter les changements sur Drive.

---

## Google Drive

1. Créer un projet Google Cloud → activer l'**API Google Drive v3**.
2. Créer un Service Account → télécharger le JSON de credentials.
3. Pour la **lecture seule** (explorateur Nova Copro) : partager les dossiers avec l'email du service account.
4. Pour la **sync des permissions** : donner au service account le rôle Gestionnaire sur les Shared Drives.
5. Compatible **Shared Drives** — `supportsAllDrives` et `includeItemsFromAllDrives` sont positionnés sur toutes les requêtes.
6. Lors de l'enregistrement d'une URL Drive en admin, l'accessibilité du dossier est vérifiée en temps réel.

---

## Sécurité

### Token JWT — cookie HttpOnly
Le token JWT est stocké dans un cookie `HttpOnly` posé par le backend — jamais exposé en JavaScript.
`withCredentials: true` sur axios assure l'envoi automatique. `SameSite=None; Secure` en production cross-domain, `SameSite=Lax` en développement.
Fallback `Authorization: Bearer` supporté pour les clients API non-navigateur.

### OTP
- Généré via `crypto.randomInt()` (CSPRNG).
- Stocké sous forme de **HMAC-SHA256(code, OTP_SECRET)** — jamais le code en clair.
- Expire après 10 minutes. Les codes précédents sont invalidés à chaque nouvelle demande.
- Rate limiting : 5 tentatives / 15 min par email.

### Chiffrement PII
- AES-256-GCM, IV aléatoire par champ, format versionné `vN:iv:tag:cipher`.
- Lookup email via HMAC-SHA256 (clé `HMAC_KEY` séparée de la clé de chiffrement).
- Rotation de clé supportée sans downtime (voir section ci-dessous).

### Journal d'audit
Toutes les opérations admin sont tracées dans `audit_log`. Consultable via `/admin/audit`
avec filtres par action, date, et administrateur.

---

## Rotation de clé de chiffrement

1. `openssl rand -hex 32` → nouvelle clé.
2. Ajouter `ENCRYPTION_KEY_v2=<nouvelle>` + `KEY_VERSION=2` dans l'env.
3. Conserver `ENCRYPTION_KEY_v1=<ancienne>` (ou `ENCRYPTION_KEY`) le temps de la migration.
4. `npm run keys:reencrypt` (ou `--dry-run` pour simuler).
5. Valider, puis supprimer l'ancienne variable.

### Ordre de déploiement (migration v1 → v2)

1. Appliquer `migration_v2.sql` (ajoute les colonnes chiffrées, ne supprime rien).
2. Déployer le nouveau code (lit les deux formats).
3. `node src/db/migrate_encrypt.js` (remplit les nouvelles colonnes).
4. Valider en prod.
5. Supprimer manuellement les colonnes en clair (listées en bas de `migration_v2.sql`).

### En cas de perte de clé

Les données PII sont **irrécupérables** sans la clé. Recommandations :
- Stocker `ENCRYPTION_KEY`, `HMAC_KEY`, `OTP_SECRET` dans un gestionnaire de secrets (Vault, AWS Secrets Manager, Doppler…).
- Inclure les variables d'env dans la procédure de sauvegarde et tester la restauration régulièrement.
