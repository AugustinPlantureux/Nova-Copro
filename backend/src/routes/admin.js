const express = require('express');
const router  = express.Router();
const db      = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { encryptUser, decryptUser } = require('../services/crypto');
const { isValidEmail } = require('../utils/validation');
const { extractFolderId, checkFolderAccessible } = require('../services/drive');


// ── Enregistrement des folder IDs Drive utilisés ──────────────
// Permet au script sync de retrouver les anciens dossiers même après suppression d'un accès.
const logDriveFolderIds = async (urls) => {
  const ids = Object.values(urls)
    .filter(Boolean)
    .map(url => extractFolderId(url))
    .filter(Boolean);
  if (!ids.length) return;
  const placeholders = ids.map((_, i) => `($${i + 1})`).join(', ');
  await db.query(
    `INSERT INTO drive_folders_used (folder_id) VALUES ${placeholders} ON CONFLICT DO NOTHING`,
    ids
  );
};

router.use(authMiddleware, adminMiddleware);

// ── Journal d'audit ───────────────────────────────────────────

const audit = async (req, action, resource, resourceId, detail) => {
  try {
    await db.query(
      `INSERT INTO audit_log (admin_id, action, resource, resource_id, detail, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [req.user.id, action, resource, resourceId || null,
       detail ? JSON.stringify(detail) : null, req.ip]
    );
  } catch (e) {
    console.error('audit log error:', e.message);
  }
};

// ── Validation URL Drive ───────────────────────────────────────
// https uniquement — http refusé.
// Vérification syntaxique + accessibilité réelle du dossier via API Drive.

const validateDriveUrl = async (url, fieldName) => {
  if (url === undefined) return undefined; // champ absent → ne pas toucher
  if (!url || !url.trim()) return null;    // champ présent et vide → effacer

  const trimmed = url.trim();

  if (!trimmed.startsWith('https://drive.google.com/')) {
    throw { status: 400, message: `${fieldName} : doit être une URL Google Drive en https` };
  }

  const folderId = extractFolderId(trimmed);
  if (!folderId) {
    throw { status: 400, message: `${fieldName} : impossible d'extraire l'ID du dossier Drive` };
  }

  // Vérification d'accessibilité réelle (le service account peut-il lire ce dossier ?)
  await checkFolderAccessible(folderId);

  return trimmed;
};

// Valide un ensemble de champs Drive présents dans le body.
// Modifie `body` en place et retourne les valeurs validées.
const validateDriveFields = async (body, fields) => {
  const validated = {};
  for (const [key, label] of fields) {
    if (key in body) {
      validated[key] = await validateDriveUrl(body[key], label);
    }
  }
  return validated;
};

const DRIVE_URL_FIELDS = [
  ['drive_url_copropriete', 'drive_url_copropriete'],
  ['drive_url_personnel',   'drive_url_personnel'],
  ['drive_url_conseil',     'drive_url_conseil'],
];

// ══════════════════════════════════════════════════════════════
// COPROPRIÉTÉS
// ══════════════════════════════════════════════════════════════

router.get('/coproprietes', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.*, COUNT(DISTINCT ua.user_id) AS nb_utilisateurs
       FROM coproprietes c
       LEFT JOIN user_acces ua ON ua.copropriete_id = c.id
       GROUP BY c.id ORDER BY c.nom ASC`
    );
    return res.json({ success: true, coproprietes: result.rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/coproprietes/:id', async (req, res) => {
  try {
    const copro = await db.query('SELECT * FROM coproprietes WHERE id = $1', [req.params.id]);
    if (!copro.rows.length) return res.status(404).json({ error: 'Copropriété non trouvée' });

    const users = await db.query(
      `SELECT u.id, u.email_encrypted, u.nom_encrypted, u.prenom_encrypted,
              ua.id AS acces_id,
              ua.drive_url_copropriete, ua.drive_url_personnel,
              ua.drive_url_conseil, ua.is_conseil_syndical, ua.notes
       FROM user_acces ua
       JOIN users u ON u.id = ua.user_id
       WHERE ua.copropriete_id = $1 ORDER BY u.created_at ASC`,
      [req.params.id]
    );

    const decryptedUsers = users.rows.map(decryptUser).sort((a, b) =>
      (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity: 'base' })
    );

    return res.json({ success: true, copropriete: copro.rows[0], users: decryptedUsers });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/coproprietes', async (req, res) => {
  const { nom, adresse, code_postal, ville } = req.body;
  if (!nom) return res.status(400).json({ error: 'Le nom est requis' });
  try {
    const urls = await validateDriveFields(req.body, [['drive_url_base', 'drive_url_base']]);
    const result = await db.query(
      'INSERT INTO coproprietes (nom, adresse, code_postal, ville, drive_url_base) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [nom, adresse || null, code_postal || null, ville || null, urls.drive_url_base ?? null]
    );
    await audit(req, 'copropriete.create', 'copropriete', result.rows[0].id, { nom });
    return res.status(201).json({ success: true, copropriete: result.rows[0] });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/coproprietes/:id', async (req, res) => {
  // Patch strict : seuls les champs présents dans le body sont mis à jour.
  // Envoyer null pour un champ = l'effacer explicitement.
  // Ne pas envoyer un champ = le laisser intact.
  try {
    const updates = [];
    const values  = [];
    let i = 1;

    const simpleFields = ['nom', 'adresse', 'code_postal', 'ville'];
    for (const field of simpleFields) {
      if (field in req.body) {
        updates.push(`${field} = $${i++}`);
        values.push(req.body[field] || null);
      }
    }

    if ('drive_url_base' in req.body) {
      const validated = await validateDriveUrl(req.body.drive_url_base, 'drive_url_base');
      updates.push(`drive_url_base = $${i++}`);
      values.push(validated);
    }

    if (!updates.length) return res.status(400).json({ error: 'Aucun champ à mettre à jour' });

    values.push(req.params.id);
    const result = await db.query(
      `UPDATE coproprietes SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Copropriété non trouvée' });
    await audit(req, 'copropriete.update', 'copropriete', req.params.id, { fields: Object.keys(req.body) });
    return res.json({ success: true, copropriete: result.rows[0] });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/coproprietes/:id', async (req, res) => {
  try {
    const existing = await db.query('SELECT nom FROM coproprietes WHERE id = $1', [req.params.id]);
    await db.query('DELETE FROM coproprietes WHERE id = $1', [req.params.id]);
    await audit(req, 'copropriete.delete', 'copropriete', req.params.id,
      existing.rows[0] ? { nom: existing.rows[0].nom } : null);
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// UTILISATEURS
// ══════════════════════════════════════════════════════════════

router.get('/users', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.id, u.email_encrypted, u.nom_encrypted, u.prenom_encrypted,
              u.is_admin, u.is_active, u.last_login, u.created_at,
              COUNT(DISTINCT ua.copropriete_id) AS nb_coproprietes
       FROM users u
       LEFT JOIN user_acces ua ON ua.user_id = u.id
       GROUP BY u.id ORDER BY u.created_at ASC`
    );
    const users = result.rows.map(decryptUser).sort((a, b) =>
      (a.nom || '').localeCompare(b.nom || '', 'fr', { sensitivity: 'base' })
    );
    return res.json({ success: true, users });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.get('/users/:id', async (req, res) => {
  try {
    const user = await db.query(
      `SELECT id, email_encrypted, nom_encrypted, prenom_encrypted, is_admin, is_active, last_login
       FROM users WHERE id = $1`,
      [req.params.id]
    );
    if (!user.rows.length) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    const acces = await db.query(
      `SELECT ua.*, c.nom AS copropriete_nom, c.adresse, c.code_postal, c.ville
       FROM user_acces ua
       JOIN coproprietes c ON c.id = ua.copropriete_id
       WHERE ua.user_id = $1 ORDER BY c.nom`,
      [req.params.id]
    );
    return res.json({ success: true, user: decryptUser(user.rows[0]), acces: acces.rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.post('/users', async (req, res) => {
  const { email, nom, prenom, is_admin } = req.body;
  if (!isValidEmail(email)) return res.status(400).json({ error: 'Email invalide' });
  try {
    const enc = encryptUser({ email, nom, prenom });
    const result = await db.query(
      `INSERT INTO users (email_hash, email_encrypted, nom_encrypted, prenom_encrypted, is_admin)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [enc.email_hash, enc.email_encrypted, enc.nom_encrypted, enc.prenom_encrypted, is_admin || false]
    );
    const newUser = decryptUser(result.rows[0]);
    await audit(req, 'user.create', 'user', newUser.id, null);
    return res.status(201).json({ success: true, user: newUser });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Cet email existe déjà' });
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/users/:id', async (req, res) => {
  const { email, nom, prenom, is_admin, is_active } = req.body;
  try {
    const updates = [];
    const values  = [];
    let i = 1;

    // Chaque champ est mis à jour indépendamment — pas d'effet de bord entre eux.
    if (email !== undefined) {
      if (!isValidEmail(email)) return res.status(400).json({ error: 'Email invalide' });
      const enc = encryptUser({ email });
      updates.push(`email_hash = $${i++}`, `email_encrypted = $${i++}`);
      values.push(enc.email_hash, enc.email_encrypted);
    }
    if (nom !== undefined) {
      const enc = encryptUser({ nom });
      updates.push(`nom_encrypted = $${i++}`);
      values.push(enc.nom_encrypted);
    }
    if (prenom !== undefined) {
      const enc = encryptUser({ prenom });
      updates.push(`prenom_encrypted = $${i++}`);
      values.push(enc.prenom_encrypted);
    }
    if (is_admin  !== undefined) { updates.push(`is_admin = $${i++}`);  values.push(is_admin); }
    if (is_active !== undefined) { updates.push(`is_active = $${i++}`); values.push(is_active); }

    if (!updates.length) return res.status(400).json({ error: 'Aucun champ à mettre à jour' });

    values.push(req.params.id);
    const result = await db.query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    await audit(req, 'user.update', 'user', req.params.id,
      { fields: Object.keys(req.body).filter(k => k !== 'email') });
    return res.json({ success: true, user: decryptUser(result.rows[0]) });
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'Cet email existe déjà' });
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/users/:id', async (req, res) => {
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
  }
  try {
    await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    await audit(req, 'user.delete', 'user', req.params.id, null);
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// ACCÈS
// ══════════════════════════════════════════════════════════════

router.post('/acces', async (req, res) => {
  const { user_id, copropriete_id, is_conseil_syndical, notes } = req.body;
  if (!user_id || !copropriete_id) {
    return res.status(400).json({ error: 'user_id et copropriete_id requis' });
  }
  try {
    const urls = await validateDriveFields(req.body, DRIVE_URL_FIELDS);
    const result = await db.query(
      `INSERT INTO user_acces
         (user_id, copropriete_id, drive_url_copropriete, drive_url_personnel,
          drive_url_conseil, is_conseil_syndical, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (user_id, copropriete_id) DO UPDATE SET
         drive_url_copropriete = EXCLUDED.drive_url_copropriete,
         drive_url_personnel   = EXCLUDED.drive_url_personnel,
         drive_url_conseil     = EXCLUDED.drive_url_conseil,
         is_conseil_syndical   = EXCLUDED.is_conseil_syndical,
         notes                 = EXCLUDED.notes
       RETURNING *`,
      [user_id, copropriete_id,
       urls.drive_url_copropriete ?? null,
       urls.drive_url_personnel   ?? null,
       urls.drive_url_conseil     ?? null,
       is_conseil_syndical || false,
       notes || null]
    );
    await logDriveFolderIds(urls);
    await audit(req, 'acces.upsert', 'acces', result.rows[0].id, { user_id, copropriete_id });
    return res.status(201).json({ success: true, acces: result.rows[0] });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    if (err.code === '23503') return res.status(400).json({ error: 'Utilisateur ou copropriété introuvable' });
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.put('/acces/:id', async (req, res) => {
  try {
    const urls = await validateDriveFields(req.body, DRIVE_URL_FIELDS);
    const updates = [];
    const values  = [];
    let i = 1;

    // Patch strict : seuls les champs présents dans le body sont touchés.
    for (const [key] of DRIVE_URL_FIELDS) {
      if (key in urls) { updates.push(`${key} = $${i++}`); values.push(urls[key]); }
    }
    if ('is_conseil_syndical' in req.body) {
      updates.push(`is_conseil_syndical = $${i++}`);
      values.push(req.body.is_conseil_syndical);
    }
    if ('notes' in req.body) {
      updates.push(`notes = $${i++}`);
      values.push(req.body.notes || null);
    }

    if (!updates.length) return res.status(400).json({ error: 'Aucun champ à mettre à jour' });

    values.push(req.params.id);
    const result = await db.query(
      `UPDATE user_acces SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Accès non trouvé' });
    await logDriveFolderIds(urls);
    await audit(req, 'acces.update', 'acces', req.params.id, { fields: Object.keys(req.body) });
    return res.json({ success: true, acces: result.rows[0] });
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

router.delete('/acces/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM user_acces WHERE id = $1', [req.params.id]);
    await audit(req, 'acces.delete', 'acces', req.params.id, null);
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// STATS
// ══════════════════════════════════════════════════════════════

router.get('/stats', async (req, res) => {
  try {
    const [nbUsers, nbCopros, nbAcces, recentLogins] = await Promise.all([
      db.query('SELECT COUNT(*) FROM users WHERE is_active = TRUE'),
      db.query('SELECT COUNT(*) FROM coproprietes'),
      db.query('SELECT COUNT(*) FROM user_acces'),
      db.query(
        `SELECT id, email_encrypted, nom_encrypted, prenom_encrypted, last_login
         FROM users WHERE last_login IS NOT NULL ORDER BY last_login DESC LIMIT 10`
      ),
    ]);
    return res.json({
      success: true,
      stats: {
        nb_utilisateurs: parseInt(nbUsers.rows[0].count),
        nb_coproprietes: parseInt(nbCopros.rows[0].count),
        nb_acces:        parseInt(nbAcces.rows[0].count),
        recent_logins:   recentLogins.rows.map(decryptUser),
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ══════════════════════════════════════════════════════════════
// JOURNAL D'AUDIT
// GET /api/admin/audit?limit=50&offset=0&action=user.create&since=2025-01-01&admin_id=UUID
// ══════════════════════════════════════════════════════════════

router.get('/audit', async (req, res) => {
  try {
    const limit  = Math.min(parseInt(req.query.limit  || '50'), 200);
    const offset = parseInt(req.query.offset || '0');

    // Filtres optionnels
    const conditions = [];
    const params     = [limit, offset];
    let p = 3;

    if (req.query.action) {
      conditions.push(`al.action = $${p++}`);
      params.push(req.query.action);
    }
    if (req.query.resource) {
      conditions.push(`al.resource = $${p++}`);
      params.push(req.query.resource);
    }
    if (req.query.admin_id) {
      conditions.push(`al.admin_id = $${p++}`);
      params.push(req.query.admin_id);
    }
    if (req.query.since) {
      conditions.push(`al.created_at >= $${p++}`);
      params.push(new Date(req.query.since));
    }
    if (req.query.until) {
      conditions.push(`al.created_at <= $${p++}`);
      params.push(new Date(req.query.until));
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [result, total] = await Promise.all([
      db.query(
        `SELECT al.id, al.action, al.resource, al.resource_id, al.detail,
                al.ip_address, al.created_at,
                u.email_encrypted, u.nom_encrypted, u.prenom_encrypted
         FROM audit_log al
         LEFT JOIN users u ON u.id = al.admin_id
         ${where}
         ORDER BY al.created_at DESC
         LIMIT $1 OFFSET $2`,
        params
      ),
      db.query(`SELECT COUNT(*) FROM audit_log al ${where}`, params.slice(2)),
    ]);

    const logs = result.rows.map(row => ({
      id:          row.id,
      action:      row.action,
      resource:    row.resource,
      resource_id: row.resource_id,
      detail:      row.detail,
      ip_address:  row.ip_address,
      created_at:  row.created_at,
      admin:       decryptUser({
        email_encrypted:  row.email_encrypted,
        nom_encrypted:    row.nom_encrypted,
        prenom_encrypted: row.prenom_encrypted,
      }),
    }));

    return res.json({ success: true, logs, total: parseInt(total.rows[0].count) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ── Sync Drive ────────────────────────────────────────────────

router.post('/drive/sync/dry', async (req, res) => {
  try {
    const { runSync } = require('../services/driveSync');

    const report = await runSync({ dryRun: true });

    return res.json({
      success: true,
      report,
    });
  } catch (err) {
    console.error('drive sync dry error:', err);
    return res.status(500).json({ error: err.message || 'Erreur sync Drive' });
  }
});

router.post('/drive/sync/apply', async (req, res) => {
  try {
    const { runSync } = require('../services/driveSync');

    const report = await runSync({ dryRun: false });

    await audit(req, 'drive.sync', 'drive', null, {
      granted: report.counts.granted,
      revoked: report.counts.revoked,
      unchanged: report.counts.unchanged,
      errors: report.counts.errors,
    });

    return res.json({
      success: true,
      report,
    });
  } catch (err) {
    console.error('drive sync apply error:', err);
    return res.status(500).json({ error: err.message || 'Erreur sync Drive' });
  }
});

module.exports = router;
