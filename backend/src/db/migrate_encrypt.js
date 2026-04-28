/**
 * Script de migration : chiffre les données existantes en clair
 * Usage : node src/db/migrate_encrypt.js
 *
 * À lancer UNE SEULE FOIS après avoir appliqué migration_encryption.sql
 */
require('dotenv').config();
const db = require('./index');
const { encryptUser } = require('../services/crypto');

(async () => {
  console.log('🔐 Début de la migration de chiffrement...');

  try {
    // Récupérer tous les users avec données en clair (ancienne structure)
    const result = await db.query(
      `SELECT id, email, nom, prenom FROM users 
       WHERE email_hash IS NULL AND email IS NOT NULL`
    );

    console.log(`📋 ${result.rows.length} utilisateur(s) à migrer`);

    let ok = 0, errors = 0;

    for (const user of result.rows) {
      try {
        const encrypted = encryptUser({
          email: user.email,
          nom: user.nom,
          prenom: user.prenom,
        });

        await db.query(
          `UPDATE users SET
             email_hash       = $1,
             email_encrypted  = $2,
             nom_encrypted    = $3,
             prenom_encrypted = $4
           WHERE id = $5`,
          [
            encrypted.email_hash,
            encrypted.email_encrypted,
            encrypted.nom_encrypted,
            encrypted.prenom_encrypted,
            user.id,
          ]
        );
        ok++;
        console.log(`  ✅ Migré : ${user.email}`);
      } catch (err) {
        errors++;
        console.error(`  ❌ Erreur sur ${user.email}:`, err.message);
      }
    }

    console.log(`\n✅ Migration terminée : ${ok} migrés, ${errors} erreurs`);

    if (errors === 0) {
      console.log('\n📌 Prochaine étape (après validation) :');
      console.log('   ALTER TABLE users DROP COLUMN email, DROP COLUMN nom, DROP COLUMN prenom;');
    }

    process.exit(errors > 0 ? 1 : 0);
  } catch (err) {
    console.error('❌ Erreur critique:', err);
    process.exit(1);
  }
})();
