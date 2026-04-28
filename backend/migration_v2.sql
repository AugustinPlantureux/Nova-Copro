-- ══════════════════════════════════════════════════════════════
-- Migration v2 — pour bases EXISTANTES (v1 → v2)
-- À exécuter UNE SEULE FOIS sur une base déjà peuplée.
-- Sur une base neuve, utiliser schema.sql directement.
-- ══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "pgcrypto";


-- ── 1. Colonnes chiffrées utilisateurs ───────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_hash       VARCHAR(64),
  ADD COLUMN IF NOT EXISTS email_encrypted  TEXT,
  ADD COLUMN IF NOT EXISTS nom_encrypted    TEXT,
  ADD COLUMN IF NOT EXISTS prenom_encrypted TEXT;

-- ── 2. Index sur email_hash ───────────────────────────────────
DROP INDEX IF EXISTS idx_users_email;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_hash ON users(email_hash);

-- ── 3. Migration des données existantes (via script Node.js) ──
-- Ne pas faire le chiffrement en SQL — la clé vit en dehors de la base.
-- Lancer : node src/db/migrate_encrypt.js

-- ── 4. OTP v2 : hash du code ─────────────────────────────────
ALTER TABLE otp_codes
  ADD COLUMN IF NOT EXISTS email_hash VARCHAR(64),
  ADD COLUMN IF NOT EXISTS code_hash  VARCHAR(64);

-- Invalider tous les OTP existants (ils utilisent l'ancien schéma)
UPDATE otp_codes SET used = TRUE WHERE used = FALSE;

DROP INDEX IF EXISTS idx_otp_email;
CREATE INDEX IF NOT EXISTS idx_otp_email_hash ON otp_codes(email_hash);

-- ── 5. Journal d'audit ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  action      VARCHAR(50) NOT NULL,
  resource    VARCHAR(50),
  resource_id UUID,
  detail      JSONB,
  ip_address  VARCHAR(50),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_log_admin      ON audit_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource   ON audit_log(resource, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);

-- ── 6. Après validation de la migration Node.js : ────────────
-- Supprimer les colonnes en clair (à exécuter manuellement) :
--
-- ALTER TABLE users DROP COLUMN IF EXISTS email;
-- ALTER TABLE users DROP COLUMN IF EXISTS nom;
-- ALTER TABLE users DROP COLUMN IF EXISTS prenom;
-- ALTER TABLE otp_codes DROP COLUMN IF EXISTS email;
-- ALTER TABLE otp_codes DROP COLUMN IF EXISTS code;
--
-- Rendre email_hash NOT NULL une fois toutes les lignes migrées :
-- ALTER TABLE users ALTER COLUMN email_hash SET NOT NULL;
-- ALTER TABLE users ALTER COLUMN email_encrypted SET NOT NULL;

-- ── 7. Historique des dossiers Drive ─────────────────────────
CREATE TABLE IF NOT EXISTS drive_folders_used (
  folder_id  VARCHAR(200) PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── 8. Backfill drive_folders_used (anciens dossiers déjà en base) ──────
-- Injecte dans l'historique tous les folder IDs Drive déjà présents
-- dans user_acces et coproprietes, pour que le script de sync puisse
-- nettoyer les permissions orphelines sur ces dossiers anciens.
INSERT INTO drive_folders_used (folder_id)
SELECT DISTINCT folder_id FROM (
  -- Extraire l'ID depuis les URLs de la forme .../folders/FOLDER_ID...
  SELECT regexp_replace(drive_url_copropriete, '.*/folders/([^/?]+).*', '\1') AS folder_id
    FROM user_acces WHERE drive_url_copropriete IS NOT NULL
    AND drive_url_copropriete ~ '/folders/'
  UNION
  SELECT regexp_replace(drive_url_personnel, '.*/folders/([^/?]+).*', '\1')
    FROM user_acces WHERE drive_url_personnel IS NOT NULL
    AND drive_url_personnel ~ '/folders/'
  UNION
  SELECT regexp_replace(drive_url_conseil, '.*/folders/([^/?]+).*', '\1')
    FROM user_acces WHERE drive_url_conseil IS NOT NULL
    AND drive_url_conseil ~ '/folders/'

) sub
WHERE folder_id IS NOT NULL AND folder_id != ''
ON CONFLICT DO NOTHING;
