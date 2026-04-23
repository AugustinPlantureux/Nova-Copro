# Nova Copro — Portail Documentaire Copropriétaires

Portail d'authentification OTP brandé Nova Copro, donnant accès aux dossiers Google Drive des copropriétés.

## Architecture

```
frontend/    → Next.js   → déploiement Vercel
backend/     → Express   → déploiement Render
             → PostgreSQL → Render Managed DB
             → Resend     → envoi des emails OTP
```

## Flux utilisateur

1. L'utilisateur saisit son email sur la page de connexion
2. Si son email est autorisé en base, il reçoit un code OTP à 6 chiffres valable 10 minutes
3. Il saisit le code → reçoit un JWT → accède à son dashboard
4. Son dashboard affiche ses dossiers Google Drive selon ses permissions :
   - 🏢 Documents de la copropriété (PV AG, règlement...)
   - 📄 Ses documents personnels (appels de fonds...)
   - 🔒 Dossier conseil syndical (si membre)
5. Un clic ouvre directement le dossier dans Google Drive

---

## Déploiement

### 1. Prérequis

- Compte [Render](https://render.com) (gratuit pour démarrer)
- Compte [Vercel](https://vercel.com) (gratuit)
- Compte [Resend](https://resend.com) + domaine vérifié (gratuit jusqu'à 3000 emails/mois)

### 2. Backend sur Render

```bash
cd backend
# Pousser sur GitHub, puis dans Render :
# New → Web Service → connecter le repo → root: backend/
```

Variables d'environnement à configurer dans Render :

| Variable          | Valeur                                      |
|-------------------|---------------------------------------------|
| `DATABASE_URL`    | Auto-injectée si DB Render liée             |
| `JWT_SECRET`      | Générer avec `openssl rand -hex 32`          |
| `RESEND_API_KEY`  | Depuis resend.com → API Keys                |
| `EMAIL_FROM`      | `Nova Copro <noreply@votredomaine.fr>`       |
| `FRONTEND_URL`    | `https://nova-copro.vercel.app`              |
| `NODE_ENV`        | `production`                                |

**Créer la base de données :**

Dans Render : New → PostgreSQL → Lier au service web.  
Puis lancer la commande de setup (depuis l'onglet Shell de Render) :
```bash
npm run db:setup
```

### 3. Frontend sur Vercel

```bash
cd frontend
# Pousser sur GitHub, puis dans Vercel :
# New Project → connecter le repo → root: frontend/
```

Variable d'environnement dans Vercel :

| Variable                | Valeur                                   |
|-------------------------|------------------------------------------|
| `NEXT_PUBLIC_API_URL`   | URL de votre service Render              |

### 4. Créer le premier admin

Via le Shell Render ou psql, exécuter :

```sql
INSERT INTO users (email, nom, prenom, is_admin, is_active)
VALUES ('votre@email.fr', 'Votre Nom', 'Prénom', TRUE, TRUE);
```

Ensuite, connectez-vous normalement via la page de login — vous aurez accès au back-office.

### 5. Configurer Google Drive

Pour chaque copropriété et chaque copropriétaire :

1. Dans Google Drive, créer la structure de dossiers :
   ```
   Copropriété Les Jardins/
   ├── Documents Copropriété/     ← URL à mettre dans drive_url_copropriete
   ├── Copropriétaires/
   │   └── Jean Dupont/           ← URL à mettre dans drive_url_personnel
   └── Conseil Syndical/          ← URL à mettre dans drive_url_conseil
   ```

2. Partager chaque dossier avec l'email du copropriétaire via Drive (Partager → Ajouter des personnes)

3. Dans le back-office Nova Copro : Admin → Utilisateurs → Gérer les accès → Coller les URLs Drive

---

## Back-office

Accessible sur `/admin` pour les utilisateurs avec `is_admin = true`.

- **Dashboard** : statistiques, dernières connexions
- **Copropriétés** : CRUD des immeubles, vue des occupants par immeuble
- **Utilisateurs** : CRUD des comptes, gestion fine des accès par copropriété

---

## Structure des permissions

```
users
  └── user_acces (1 par copropriété)
        ├── drive_url_copropriete   → dossier commun
        ├── drive_url_personnel     → dossier individuel  
        ├── drive_url_conseil       → dossier conseil syndical
        └── is_conseil_syndical     → booléen
```

Un même email peut être copropriétaire dans plusieurs copropriétés.

---

## Sécurité

- Pas de mot de passe stocké : authentification par OTP uniquement
- Rate limiting sur les routes sensibles (5 demandes de code / 15 min)
- JWT avec expiration (24h ou 30j si "Rester connecté")
- CORS restreint au domaine frontend
- Les emails non autorisés ne reçoivent pas de réponse différenciée (anti-énumération)

---

## Développement local

```bash
# Backend
cd backend
cp .env.example .env
# Remplir les variables
npm install
npm run db:setup
npm run dev    # port 3001

# Frontend
cd frontend
cp .env.example .env
# NEXT_PUBLIC_API_URL=http://localhost:3001
npm install
npm run dev    # port 3000
```

## Coût estimé en production

| Service  | Plan         | Coût         |
|----------|--------------|--------------|
| Render   | Starter Web  | ~7$/mois     |
| Render   | Starter DB   | ~7$/mois     |
| Vercel   | Hobby        | Gratuit      |
| Resend   | Free         | Gratuit      |
| **Total**| —            | **~14$/mois**|

Aucune licence par utilisateur. Illimité en nombre de copropriétaires.
