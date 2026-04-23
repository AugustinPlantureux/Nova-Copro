-- Nova Copro - Schéma base de données
-- À exécuter via : node src/db/setup.js

-- Extension UUID
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Table des copropriétés
CREATE TABLE IF NOT EXISTS coproprietes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nom VARCHAR(255) NOT NULL,
  adresse TEXT,
  code_postal VARCHAR(10),
  ville VARCHAR(100),
  drive_url_base TEXT, -- Lien Drive racine de la copropriété (optionnel, pour info)
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table des utilisateurs autorisés
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  nom VARCHAR(255),
  prenom VARCHAR(255),
  is_admin BOOLEAN DEFAULT FALSE,
  is_active BOOLEAN DEFAULT TRUE,
  last_login TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table des accès (permissions par copropriété)
-- Un utilisateur peut être copropriétaire dans plusieurs copropriétés
CREATE TABLE IF NOT EXISTS user_acces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  copropriete_id UUID NOT NULL REFERENCES coproprietes(id) ON DELETE CASCADE,
  
  -- Lien vers le dossier général de la copropriété (PV AG, règlement, etc.)
  drive_url_copropriete TEXT,
  
  -- Lien vers le dossier personnel du copropriétaire (appels de fonds, etc.)
  drive_url_personnel TEXT,
  
  -- Lien vers le dossier conseil syndical (null si pas membre)
  drive_url_conseil TEXT,
  
  -- Est-il membre du conseil syndical ?
  is_conseil_syndical BOOLEAN DEFAULT FALSE,
  
  -- Notes admin
  notes TEXT,
  
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  
  UNIQUE(user_id, copropriete_id)
);

-- Table des codes OTP
CREATE TABLE IF NOT EXISTS otp_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL,
  code VARCHAR(6) NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  ip_address VARCHAR(50),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index pour les recherches fréquentes
CREATE INDEX IF NOT EXISTS idx_otp_email ON otp_codes(email);
CREATE INDEX IF NOT EXISTS idx_otp_expires ON otp_codes(expires_at);
CREATE INDEX IF NOT EXISTS idx_user_acces_user ON user_acces(user_id);
CREATE INDEX IF NOT EXISTS idx_user_acces_copro ON user_acces(copropriete_id);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Fonction de mise à jour automatique updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers updated_at
CREATE TRIGGER update_coproprietes_updated_at BEFORE UPDATE ON coproprietes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_user_acces_updated_at BEFORE UPDATE ON user_acces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Nettoyage automatique des OTP expirés (à lancer via un cron job ou pg_cron)
-- DELETE FROM otp_codes WHERE expires_at < NOW() - INTERVAL '1 day';
