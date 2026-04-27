#!/usr/bin/env node
/**
 * Re-chiffre toutes les données PII avec la clé de version courante (KEY_VERSION).
 *
 * Utile lors d'une rotation de clé :
 *  1. Ajouter ENCRYPTION_KEY_vN (nouvelle clé) et KEY_VERSION=N dans l'env.
 *  2. Conserver l'ancienne clé sous ENCRYPTION_KEY ou ENCRYPTION_KEY_v(N-1).
 *  3. Lancer ce script → il déchiffre avec l'ancienne version, rechiffre avec la nouvelle.
 *  4. Valider, puis supprimer l'ancienne clé.
 *
 * Usage : node scripts/reencrypt.js [--dry-run]
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const dryRun = process.argv.includes('--dry-run');
const db     = require('../src/db');
const { decrypt, encrypt, hashEmail } = require('../src/services/crypto');

(async () => {
  console.log(`🔑 Re-chiffrement vers KEY_VERSION=${process.env.KEY_VERSION || '1'}`);
  if (dryRun) console.log('   ⚠️  Mode dry-run : aucune écriture');

  const { rows } = await db.query(
    'SELECT id, email_encrypted, nom_encrypted, prenom_encrypted FROM users'
  );

  let ok = 0, skipped = 0, errors = 0;

  for (const row of rows) {
    try {
      const email  = decrypt(row.email_encrypted);
      const nom    = decrypt(row.nom_encrypted);
      const prenom = decrypt(row.prenom_encrypted);

      if (email === '[déchiffrement impossible]') {
        console.warn(`  ⚠️  id=${row.id} : déchiffrement impossible, ignoré`);
        skipped++;
        continue;
      }

      const newEmailEnc  = email  ? encrypt(email)  : null;
      const newNomEnc    = nom    ? encrypt(nom)    : null;
      const newPrenomEnc = prenom ? encrypt(prenom) : null;
      const newEmailHash = email  ? hashEmail(email) : null;

      if (!dryRun) {
        await db.query(
          `UPDATE users SET email_hash=$1, email_encrypted=$2, nom_encrypted=$3, prenom_encrypted=$4
           WHERE id=$5`,
          [newEmailHash, newEmailEnc, newNomEnc, newPrenomEnc, row.id]
        );
      }
      ok++;
    } catch (err) {
      console.error(`  ❌ id=${row.id} : ${err.message}`);
      errors++;
    }
  }

  console.log(`\nTerminé : ${ok} re-chiffrés, ${skipped} ignorés, ${errors} erreurs`);
  process.exit(errors > 0 ? 1 : 0);
})();
