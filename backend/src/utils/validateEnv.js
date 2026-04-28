/**
 * Valide les variables d'environnement critiques au démarrage.
 * Stoppe le process si une variable manquante rendrait l'app inutilisable.
 * /health peut dire "ok" même si la DB ou le chiffrement sont cassés —
 * cette fonction garantit l'absence de démarrage silencieusement cassé.
 */

const validateEnv = () => {
  const errors = [];

  const required = [
    { key: 'DATABASE_URL',   desc: 'URL de connexion PostgreSQL' },
    { key: 'JWT_SECRET',     desc: 'Secret JWT (min 32 chars)', minLen: 32 },
    { key: 'ENCRYPTION_KEY', desc: 'Clé AES-256 (64 hex chars)', len: 64 },
    { key: 'HMAC_KEY',       desc: 'Clé HMAC email (64 hex chars)', len: 64 },
    { key: 'OTP_SECRET',     desc: 'Secret OTP HMAC (min 32 chars)', minLen: 32 },
    { key: 'FRONTEND_URL',   desc: 'URL du frontend (CORS)' },
    { key: 'RESEND_API_KEY', desc: 'Clé API Resend pour les emails' },
    { key: 'EMAIL_FROM',     desc: 'Adresse email d\'expéditeur' },
    { key: 'ADMIN_EMAIL',    desc: 'Email admin pour les demandes d\'accès' },
  ];

  for (const { key, desc, len, minLen } of required) {
    const val = process.env[key];
    if (!val) {
      errors.push(`  ✗ ${key} manquant — ${desc}`);
      continue;
    }
    if (len && val.length !== len) {
      errors.push(`  ✗ ${key} invalide — doit faire ${len} caractères (actuel: ${val.length})`);
    }
    if (minLen && val.length < minLen) {
      errors.push(`  ✗ ${key} trop court — minimum ${minLen} caractères (actuel: ${val.length})`);
    }
  }

  // GOOGLE_SERVICE_ACCOUNT_JSON : doit être un JSON valide
  const gsaj = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!gsaj) {
    errors.push('  ✗ GOOGLE_SERVICE_ACCOUNT_JSON manquant');
  } else {
    try { JSON.parse(gsaj); } catch {
      errors.push('  ✗ GOOGLE_SERVICE_ACCOUNT_JSON invalide (JSON malformé)');
    }
  }

  if (errors.length) {
    console.error('\n🚨 Variables d\'environnement manquantes ou invalides :\n');
    errors.forEach(e => console.error(e));
    console.error('\nConsulter backend/.env.example pour la liste complète.\n');
    process.exit(1);
  }

  console.log('✅ Variables d\'environnement validées');
};

module.exports = { validateEnv };
