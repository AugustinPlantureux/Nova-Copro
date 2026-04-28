-- ══════════════════════════════════════════════════════════════
-- Nova Copro — Schéma v2 (base neuve)
-- Toutes les données personnelles sont chiffrées dès le départ.
-- À exécuter via : node src/db/setup.js
-- ══════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Copropriétés ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS coproprietes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nom         VARCHAR(255) NOT NULL,
  adresse     TEXT,
  code_postal VARCHAR(10),
  ville       VARCHAR(100),
  drive_url_base TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Utilisateurs (PII chiffrées) ──────────────────────────────
-- email_hash       : HMAC-SHA256 de l'email normalisé (pour les lookups)
-- email_encrypted  : email chiffré AES-256-GCM (pour l'affichage)
-- nom_encrypted    : nom chiffré AES-256-GCM
-- prenom_encrypted : prénom chiffré AES-256-GCM
-- Les colonnes "email", "nom", "prenom" en clair n'existent PAS.
CREATE TABLE IF NOT EXISTS users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash       VARCHAR(64) UNIQUE NOT NULL,
  email_encrypted  TEXT NOT NULL,
  nom_encrypted    TEXT,
  prenom_encrypted TEXT,
  is_admin         BOOLEAN DEFAULT FALSE,
  is_active        BOOLEAN DEFAULT TRUE,
  last_login       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

-- ── Accès copropriété ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_acces (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               UUID NOT NULL REFERENCES users(id)        ON DELETE CASCADE,
  copropriete_id        UUID NOT NULL REFERENCES coproprietes(id) ON DELETE CASCADE,
  drive_url_copropriete TEXT,
  drive_url_personnel   TEXT,
  drive_url_conseil     TEXT,
  is_conseil_syndical   BOOLEAN DEFAULT FALSE,
  notes                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, copropriete_id)
);

-- ── Codes OTP ─────────────────────────────────────────────────
-- email_hash : HMAC de l'email (même clé HMAC_KEY que users)
-- code_hash  : SHA-256 du code OTP à 6 chiffres
--              Le code en clair n'est JAMAIS stocké en base.
CREATE TABLE IF NOT EXISTS otp_codes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_hash  VARCHAR(64) NOT NULL,
  code_hash   VARCHAR(64) NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  used        BOOLEAN DEFAULT FALSE,
  ip_address  VARCHAR(50),
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- ── Journal d'audit admin ─────────────────────────────────────
-- Trace toutes les opérations sensibles effectuées par les admins.
CREATE TABLE IF NOT EXISTS audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id     UUID REFERENCES users(id) ON DELETE SET NULL,
  action       VARCHAR(50)  NOT NULL,
  resource     VARCHAR(50),
  resource_id  UUID,
  detail       JSONB,
  ip_address   VARCHAR(50),
  created_at   TIMESTAMPTZ DEFAULT NOW()
);


-- ── Dossiers Drive utilisés (historique pour sync) ──────────
-- Mémorise tous les folder IDs jamais assignés à un accès.
-- Permet au script de sync de nettoyer les permissions Drive
-- même si l'accès a été supprimé et que l'URL n'est plus en base.
CREATE TABLE IF NOT EXISTS drive_folders_used (
  folder_id  VARCHAR(200) PRIMARY KEY,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Index ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_users_email_hash     ON users(email_hash);
CREATE INDEX IF NOT EXISTS idx_otp_email_hash       ON otp_codes(email_hash);
CREATE INDEX IF NOT EXISTS idx_otp_expires          ON otp_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_user_acces_user      ON user_acces(user_id);
CREATE INDEX IF NOT EXISTS idx_user_acces_copro     ON user_acces(copropriete_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_admin      ON audit_log(admin_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_resource   ON audit_log(resource, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created_at ON audit_log(created_at DESC);

-- ── updated_at automatique ────────────────────────────────────
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_coproprietes_updated_at') THEN
    CREATE TRIGGER update_coproprietes_updated_at
      BEFORE UPDATE ON coproprietes FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_users_updated_at') THEN
    CREATE TRIGGER update_users_updated_at
      BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'update_user_acces_updated_at') THEN
    CREATE TRIGGER update_user_acces_updated_at
      BEFORE UPDATE ON user_acces FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
  END IF;
END $$;

-- ── Nettoyage OTP expirés (à planifier via pg_cron ou cron externe) ───
-- DELETE FROM otp_codes WHERE expires_at < NOW() - INTERVAL '1 day';
