#!/usr/bin/env node
/**
 * Crée le premier administrateur sur une base v2 (chiffrée).
 *
 * Usage :
 *   node scripts/create-admin.js --email admin@exemple.com --nom Dupont --prenom Marie
 *
 * Requiert les variables d'env : DATABASE_URL, ENCRYPTION_KEY, HMAC_KEY, KEY_VERSION, OTP_SECRET
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const db = require('../src/db');
const { encryptUser } = require('../src/services/crypto');
const { isValidEmail } = require('../src/utils/validation');

const args = process.argv.slice(2);
const get  = (flag) => { const idx = args.indexOf(flag); return idx !== -1 ? args[idx + 1] : null; };

const email  = get('--email');
const nom    = get('--nom');
const prenom = get('--prenom');

if (!isValidEmail(email)) {
  console.error('Usage : node scripts/create-admin.js --email EMAIL --nom NOM --prenom PRENOM');
  process.exit(1);
}

(async () => {
  try {
    const enc = encryptUser({ email, nom, prenom });
    const result = await db.query(
      `INSERT INTO users
         (email_hash, email_encrypted, nom_encrypted, prenom_encrypted, is_admin, is_active)
       VALUES ($1, $2, $3, $4, TRUE, TRUE)
       ON CONFLICT (email_hash) DO UPDATE SET is_admin = TRUE
       RETURNING id`,
      [enc.email_hash, enc.email_encrypted, enc.nom_encrypted, enc.prenom_encrypted]
    );
    console.log(`✅ Admin créé / mis à jour : ${email} (id: ${result.rows[0].id})`);
    process.exit(0);
  } catch (err) {
    console.error('❌ Erreur :', err.message);
    process.exit(1);
  }
})();
