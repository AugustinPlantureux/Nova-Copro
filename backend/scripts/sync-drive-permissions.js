#!/usr/bin/env node
/**
 * Synchronisation des permissions Google Drive — approche "Drive-first"
 *
 * Pour chaque dossier Drive connu (accès actifs + historique drive_folders_used) :
 *   1. Lister les permissions réelles via l'API Drive
 *   2. Comparer avec qui devrait avoir accès selon Nova Copro
 *   3. Accorder les accès manquants
 *   4. Révoquer tout ce qui est obsolète, sauf les emails protégés
 *
 * IMPORTANT — drive_url_base (dossier racine copropriété) :
 *   Ce dossier n'est PAS géré par ce script. Il peut contenir des accès
 *   manuels (gestionnaire, comptable, prestataire…) qui ne sont pas
 *   dans user_acces. Le logguer dans drive_folders_used déclencherait
 *   des révocations dangereuses. Il est donc volontairement exclu.
 *
 * Allowlist :
 *   Les emails dans SYNC_PROTECTED_EMAILS (séparés par des virgules dans l'env)
 *   ne sont jamais révoqués, quoi qu'il arrive.
 *
 * Usage :
 *   node scripts/sync-drive-permissions.js              → sync complète
 *   node scripts/sync-drive-permissions.js --dry-run    → simulation
 *   node scripts/sync-drive-permissions.js --revoke-only → révoque tout, n'accorde rien
 *   node scripts/sync-drive-permissions.js --user EMAIL → un seul utilisateur
 *   node scripts/sync-drive-permissions.js --folder ID  → un seul dossier
 *
 * Prérequis :
 *   Le service account doit avoir le rôle Gestionnaire sur les Shared Drives,
 *   ou être propriétaire des dossiers My Drive partagés.
 *   Scope requis : https://www.googleapis.com/auth/drive
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const { google }      = require('googleapis');
const db              = require('../src/db');
const { decryptUser } = require('../src/services/crypto');
const { extractFolderId } = require('../src/services/drive');

const args          = process.argv.slice(2);
const DRY_RUN       = args.includes('--dry-run');
const REVOKE_ONLY   = args.includes('--revoke-only');
const getArg        = (f) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : null; };
const USER_FILTER   = getArg('--user')?.toLowerCase();
const FOLDER_FILTER = getArg('--folder');

// ── Allowlist : emails jamais révoqués ───────────────────────
// Configurer dans l'env : SYNC_PROTECTED_EMAILS=toi@domain.fr,gestionnaire@domain.fr
const PROTECTED_EMAILS = new Set(
  (process.env.SYNC_PROTECTED_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean)
);

// ── Client Drive ──────────────────────────────────────────────
const getDrive = () => {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });
  return google.drive({ version: 'v3', auth });
};

const SHARED = { supportsAllDrives: true };

// ── Service account email (jamais révoqué) ────────────────────
let _saEmail = null;
const getSaEmail = () => {
  if (!_saEmail) {
    try { _saEmail = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON).client_email?.toLowerCase() || ''; }
    catch { _saEmail = ''; }
  }
  return _saEmail;
};

// ── API helpers ───────────────────────────────────────────────

const listPermissions = async (drive, folderId) => {
  try {
    const all = [];
    let pageToken = undefined;
    do {
      const res = await drive.permissions.list({
        fileId: folderId,
        fields: 'nextPageToken, permissions(id,emailAddress,role,type)',
        pageSize: 100,
        pageToken,
        ...SHARED,
      });
      all.push(...(res.data.permissions || []).filter(p => p.type === 'user' && p.emailAddress));
      pageToken = res.data.nextPageToken;
    } while (pageToken);
    return all;
  } catch (err) {
    if (err.response?.status === 404 || err.response?.status === 403) return null;
    throw err;
  }
};

const grantAccess = async (drive, folderId, email) =>
  drive.permissions.create({
    fileId: folderId, sendNotificationEmail: false,
    requestBody: { type: 'user', role: 'reader', emailAddress: email },
    ...SHARED,
  });

const revokeAccess = async (drive, folderId, permissionId) =>
  drive.permissions.delete({ fileId: folderId, permissionId, ...SHARED });

// ── Source de vérité Nova Copro ───────────────────────────────
// Map<folderId, Set<email>> — seuls les dossiers de user_acces sont gérés.
// drive_url_base (dossier racine) est volontairement exclu.

const buildExpectedAccesses = (rows) => {
  const expected = new Map();

  const add = (url, email) => {
    const fid = extractFolderId(url);
    if (!fid) return;
    if (!expected.has(fid)) expected.set(fid, new Set());
    expected.get(fid).add(email);
  };

  const touch = (url) => { // Connaître le dossier sans y donner accès
    const fid = extractFolderId(url);
    if (fid && !expected.has(fid)) expected.set(fid, new Set());
  };

  for (const row of rows) {
    const user = decryptUser(row);
    if (!user?.email) continue;
    const email = user.email.toLowerCase();

    // En mode revoke-only : personne n'est autorisé, mais les dossiers sont connus
    if (REVOKE_ONLY || !row.is_active) {
      [row.drive_url_copropriete, row.drive_url_personnel, row.drive_url_conseil]
        .filter(Boolean).forEach(touch);
      continue;
    }

    if (row.drive_url_copropriete) add(row.drive_url_copropriete, email);
    if (row.drive_url_personnel)   add(row.drive_url_personnel,   email);

    if (row.drive_url_conseil) {
      if (row.is_conseil_syndical) add(row.drive_url_conseil, email);
      else touch(row.drive_url_conseil); // Connu mais pas autorisé pour cet user
    }
  }

  return expected;
};

// ── Sync d'un dossier ─────────────────────────────────────────

const syncFolder = async (drive, folderId, authorizedEmails, report) => {
  if (FOLDER_FILTER && folderId !== FOLDER_FILTER) return;

  const permissions = await listPermissions(drive, folderId);
  if (permissions === null) {
    report.errors.push(`Dossier ${folderId} inaccessible (introuvable ou droits insuffisants)`);
    return;
  }

  const existing = new Map(permissions.map(p => [p.emailAddress.toLowerCase(), p.id]));

  // Accorder les accès manquants
  if (!REVOKE_ONLY) {
    for (const email of authorizedEmails) {
      if (USER_FILTER && email !== USER_FILTER) continue;
      if (!existing.has(email)) {
        report.granted.push({ email, folderId });
        if (!DRY_RUN) await grantAccess(drive, folderId, email);
      }
    }
  }

  // Révoquer les accès obsolètes
  for (const [email, permId] of existing) {
    if (email === getSaEmail())         continue; // ne jamais révoquer le service account
    if (PROTECTED_EMAILS.has(email))   continue; // allowlist
    if (USER_FILTER && email !== USER_FILTER) continue;

    if (!authorizedEmails.has(email)) {
      report.revoked.push({ email, folderId });
      if (!DRY_RUN) await revokeAccess(drive, folderId, permId);
    } else if (!REVOKE_ONLY) {
      report.unchanged.push({ email, folderId });
    }
  }
};

// ── Main ──────────────────────────────────────────────────────

(async () => {
  const mode = DRY_RUN ? ' (DRY-RUN)' : REVOKE_ONLY ? ' (REVOKE-ONLY)' : '';
  console.log(`\n🔄 Nova Copro — Sync Drive${mode}`);
  if (USER_FILTER)      console.log(`   Filtre    : ${USER_FILTER}`);
  if (FOLDER_FILTER)    console.log(`   Dossier   : ${FOLDER_FILTER}`);
  if (PROTECTED_EMAILS.size) console.log(`   Protégés  : ${[...PROTECTED_EMAILS].join(', ')}`);
  console.log('');

  const drive = getDrive();

  const { rows } = await db.query(`
    SELECT u.email_encrypted, u.nom_encrypted, u.prenom_encrypted, u.is_active,
           ua.drive_url_copropriete, ua.drive_url_personnel,
           ua.drive_url_conseil, ua.is_conseil_syndical
    FROM user_acces ua JOIN users u ON u.id = ua.user_id
  `);

  const expected = buildExpectedAccesses(rows);

  // Ajouter les dossiers historiques (anciens accès supprimés, URLs remplacées)
  const historical = await db.query('SELECT folder_id FROM drive_folders_used');
  for (const { folder_id } of historical.rows) {
    if (!expected.has(folder_id)) expected.set(folder_id, new Set());
  }

  const report = { granted: [], revoked: [], unchanged: [], errors: [] };
  console.log(`📋 ${expected.size} dossier(s) à vérifier\n`);

  let n = 0;
  for (const [folderId, authorizedEmails] of expected) {
    n++;
    process.stdout.write(`  [${n}/${expected.size}] ${folderId.substring(0, 25)}…\r`);
    await syncFolder(drive, folderId, authorizedEmails, report);
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log(`📊 Rapport${DRY_RUN ? ' (simulation)' : ''}`);
  console.log(`${'─'.repeat(50)}`);
  console.log(`  ✅ Accordés  : ${report.granted.length}`);
  console.log(`  🗑️  Révoqués  : ${report.revoked.length}`);
  console.log(`  ✓  Inchangés : ${report.unchanged.length}`);
  console.log(`  ❌ Erreurs   : ${report.errors.length}`);

  if (report.granted.length) { console.log('\n  Accordés :'); report.granted.forEach(g => console.log(`    + ${g.email}  →  ${g.folderId}`)); }
  if (report.revoked.length) { console.log('\n  Révoqués :'); report.revoked.forEach(r => console.log(`    - ${r.email}  →  ${r.folderId}`)); }
  if (report.errors.length)  { console.log('\n  Erreurs :');  report.errors.forEach(e  => console.log(`    ⚠️  ${e}`)); }

  console.log('');
  await db.pool.end();
  process.exit(report.errors.length > 0 ? 1 : 0);
})().catch(err => { console.error('\n❌', err.message); process.exit(1); });
