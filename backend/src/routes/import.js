/**
 * Route d'import Excel (import ponctuel)
 *
 * POST /api/admin/import             → import réel
 * POST /api/admin/import?dry_run=true → simulation sans écriture
 * GET  /api/admin/import/template    → modèle vide
 */

const express = require('express');
const router  = express.Router();
const ExcelJS = require('exceljs');
const multer  = require('multer');
const db      = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');
const { encryptUser, hashEmail } = require('../services/crypto');
const { isValidEmail } = require('../utils/validation');
const { extractFolderId } = require('../services/drive');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.xlsx$/i.test(file.originalname) || file.mimetype.includes('spreadsheetml')) {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers Excel .xlsx sont acceptés'));
    }
  },
});

router.use(authMiddleware, adminMiddleware);

// ── Log Drive folder IDs (historique pour sync) ────────────────
const logDriveFolderIds = async (urls, client) => {
  const ids = Object.values(urls).filter(Boolean).map(extractFolderId).filter(Boolean);
  if (!ids.length) return;
  const ph = ids.map((_, i) => `($${i + 1})`).join(', ');
  // Utilise le client transactionnel si fourni, sinon le pool global.
  const runner = client || db;
  await runner.query(
    `INSERT INTO drive_folders_used (folder_id) VALUES ${ph} ON CONFLICT DO NOTHING`,
    ids
  );
};

// ── Validation URL Drive ───────────────────────────────────────
const validateImportUrl = (url, fieldName) => {
  if (!url) return null;
  const trimmed = String(url).trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith('https://drive.google.com/')) {
    throw new Error(`${fieldName} : doit commencer par https://drive.google.com/`);
  }
  if (!extractFolderId(trimmed)) {
    throw new Error(`${fieldName} : impossible d'extraire l'ID du dossier`);
  }
  return trimmed;
};

// ── COLONNES ATTENDUES ────────────────────────────────────────
const COLUMNS = [
  { header: 'email',                  key: 'email',                  width: 30 },
  { header: 'nom',                    key: 'nom',                    width: 15 },
  { header: 'prenom',                 key: 'prenom',                 width: 15 },
  { header: 'copropriete_nom',        key: 'copropriete_nom',        width: 25 },
  { header: 'adresse_copropriete',    key: 'adresse_copropriete',    width: 25 },
  { header: 'code_postal',            key: 'code_postal',            width: 12 },
  { header: 'ville',                  key: 'ville',                  width: 15 },
  { header: 'drive_url_copropriete',  key: 'drive_url_copropriete',  width: 55 },
  { header: 'drive_url_personnel',    key: 'drive_url_personnel',    width: 55 },
  { header: 'drive_url_conseil',      key: 'drive_url_conseil',      width: 55 },
  { header: 'is_conseil_syndical',    key: 'is_conseil_syndical',    width: 20 },
];

// ── GET /template ─────────────────────────────────────────────
router.get('/template', async (req, res) => {
  try {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Utilisateurs');
    ws.columns = COLUMNS;

    // Style en-tête
    ws.getRow(1).eachCell(cell => {
      cell.font      = { bold: true };
      cell.fill      = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE3F0FF' } };
      cell.border    = { bottom: { style: 'thin' } };
      cell.alignment = { vertical: 'middle' };
    });

    // Ligne d'exemple
    ws.addRow({
      email:                 'jean.dupont@gmail.com',
      nom:                   'Dupont',
      prenom:                'Jean',
      copropriete_nom:       'Résidence Les Jardins',
      adresse_copropriete:   '12 rue de la Paix',
      code_postal:           '75001',
      ville:                 'Paris',
      drive_url_copropriete: 'https://drive.google.com/drive/folders/AAA',
      drive_url_personnel:   'https://drive.google.com/drive/folders/BBB',
      drive_url_conseil:     '',
      is_conseil_syndical:   'non',
    });

    const buffer = await wb.xlsx.writeBuffer();
    res.setHeader('Content-Disposition', 'attachment; filename="nova-copro-modele-import.xlsx"');
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buffer);
  } catch (err) {
    console.error('Erreur template:', err);
    res.status(500).json({ error: 'Erreur génération du modèle' });
  }
});

// ── POST / ────────────────────────────────────────────────────
router.post('/', (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Aucun fichier fourni' });

  const dryRun = req.query.dry_run === 'true' || req.body?.dry_run === 'true';

  const report = {
    dry_run: dryRun, total: 0,
    created_users: 0, updated_users: 0,
    created_coproprietes: 0, created_acces: 0, updated_acces: 0,
    overwritten_urls: [], errors: [], details: [],
  };

  // Parser le fichier avec exceljs
  let rows = [];
  try {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(req.file.buffer);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('Aucune feuille trouvée dans le fichier');

    // Lire les en-têtes (ligne 1)
    const headers = {};
    ws.getRow(1).eachCell((cell, col) => { headers[col] = String(cell.value || '').trim(); });

    // Convertit une valeur de cellule ExcelJS en string.
  // Gère les objets hyperlink { text, hyperlink } et richText — fréquents sur les URLs Drive.
  const cellToString = (value) => {
    if (value === null || value === undefined) return '';
    if (typeof value === 'object') {
      if (value.hyperlink) return String(value.hyperlink).trim();
      if (value.text)      return String(value.text).trim();
      if (value.richText)  return value.richText.map(x => x.text || '').join('').trim();
    }
    return String(value).trim();
  };

  // Lire les données (lignes 2+)
    ws.eachRow({ includeEmpty: false }, (row, rowNum) => {
      if (rowNum === 1) return;
      const obj = {};
      row.eachCell((cell, col) => {
        const key = headers[col];
        if (key) obj[key] = cellToString(cell.value);
      });
      if (Object.keys(obj).length) rows.push(obj);
    });
  } catch (parseErr) {
    return res.status(400).json({ error: 'Fichier Excel illisible : ' + parseErr.message });
  }

  report.total = rows.length;

  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    for (let i = 0; i < rows.length; i++) {
      const lineNum = i + 2;
      const row = rows[i];
      const get = (key) => (row[key] || '').trim();

      const email          = get('email').toLowerCase();
      const nom            = get('nom');
      const prenom         = get('prenom');
      const coproprieteNom = get('copropriete_nom');
      const adresse        = get('adresse_copropriete');
      const codePostal     = get('code_postal');
      const ville          = get('ville');
      const isConseil      = ['oui','yes','true','1'].includes(get('is_conseil_syndical').toLowerCase());

      const lineDetail = { line: lineNum, email, copropriete: coproprieteNom, status: 'ok', actions: [], overwritten_urls: [] };

      if (!isValidEmail(email)) {
        lineDetail.status = 'error'; lineDetail.error = 'Email invalide ou manquant';
        report.errors.push({ line: lineNum, error: lineDetail.error }); report.details.push(lineDetail); continue;
      }
      if (!coproprieteNom) {
        lineDetail.status = 'error'; lineDetail.error = 'copropriete_nom manquant';
        report.errors.push({ line: lineNum, error: lineDetail.error }); report.details.push(lineDetail); continue;
      }

      let driveUrlCopro, driveUrlPerso, driveUrlConseil;
      try {
        driveUrlCopro   = validateImportUrl(get('drive_url_copropriete'), 'drive_url_copropriete');
        driveUrlPerso   = validateImportUrl(get('drive_url_personnel'),   'drive_url_personnel');
        driveUrlConseil = validateImportUrl(get('drive_url_conseil'),      'drive_url_conseil');
      } catch (urlErr) {
        lineDetail.status = 'error'; lineDetail.error = urlErr.message;
        report.errors.push({ line: lineNum, error: urlErr.message }); report.details.push(lineDetail); continue;
      }

      const sp = `sp_line_${i}`;
      try {
        await client.query(`SAVEPOINT ${sp}`);

        // 1. Upsert utilisateur
        const eHash = hashEmail(email);
        let userRow = await client.query('SELECT id, nom_encrypted, prenom_encrypted FROM users WHERE email_hash = $1', [eHash]);

        if (!userRow.rows.length) {
          const enc = encryptUser({ email, nom: nom || null, prenom: prenom || null });
          userRow = await client.query(
            'INSERT INTO users (email_hash, email_encrypted, nom_encrypted, prenom_encrypted, is_active) VALUES ($1,$2,$3,$4,TRUE) RETURNING id',
            [enc.email_hash, enc.email_encrypted, enc.nom_encrypted, enc.prenom_encrypted]
          );
          report.created_users++; lineDetail.actions.push('utilisateur créé');
        } else {
          const nomUpdates = []; const nomValues = []; let ni = 1;
          if (nom)    { const enc = encryptUser({ nom });    nomUpdates.push(`nom_encrypted = $${ni++}`);    nomValues.push(enc.nom_encrypted); }
          if (prenom) { const enc = encryptUser({ prenom }); nomUpdates.push(`prenom_encrypted = $${ni++}`); nomValues.push(enc.prenom_encrypted); }
          if (nomUpdates.length) {
            nomValues.push(userRow.rows[0].id);
            await client.query(`UPDATE users SET ${nomUpdates.join(', ')} WHERE id = $${ni}`, nomValues);
            report.updated_users++; lineDetail.actions.push('utilisateur mis à jour');
          }
        }
        const userId = userRow.rows[0].id;

        // 2. Upsert copropriété
        let coproRow = await client.query('SELECT id FROM coproprietes WHERE nom = $1', [coproprieteNom]);
        if (!coproRow.rows.length) {
          coproRow = await client.query(
            'INSERT INTO coproprietes (nom, adresse, code_postal, ville) VALUES ($1,$2,$3,$4) RETURNING id',
            [coproprieteNom, adresse || null, codePostal || null, ville || null]
          );
          report.created_coproprietes++; lineDetail.actions.push('copropriété créée');
        }
        const coproId = coproRow.rows[0].id;

        // 3. Accès
        const existing = await client.query(
          'SELECT id, drive_url_copropriete, drive_url_personnel, drive_url_conseil FROM user_acces WHERE user_id = $1 AND copropriete_id = $2',
          [userId, coproId]
        );

        if (existing.rows.length) {
          const ex = existing.rows[0];
          const checkOw = (field, newVal) => {
            if (ex[field] && newVal && ex[field] !== newVal) {
              const ow = { line: lineNum, field, old: ex[field], new: newVal };
              lineDetail.overwritten_urls.push(ow); report.overwritten_urls.push(ow);
            }
          };
          checkOw('drive_url_copropriete', driveUrlCopro);
          checkOw('drive_url_personnel',   driveUrlPerso);
          checkOw('drive_url_conseil',      driveUrlConseil);

          await client.query(
            `UPDATE user_acces SET
               drive_url_copropriete = COALESCE($1, drive_url_copropriete),
               drive_url_personnel   = COALESCE($2, drive_url_personnel),
               drive_url_conseil     = COALESCE($3, drive_url_conseil),
               is_conseil_syndical   = $4
             WHERE id = $5`,
            [driveUrlCopro, driveUrlPerso, driveUrlConseil, isConseil, ex.id]
          );
          report.updated_acces++; lineDetail.actions.push('accès mis à jour');
        } else {
          await client.query(
            'INSERT INTO user_acces (user_id, copropriete_id, drive_url_copropriete, drive_url_personnel, drive_url_conseil, is_conseil_syndical) VALUES ($1,$2,$3,$4,$5,$6)',
            [userId, coproId, driveUrlCopro, driveUrlPerso, driveUrlConseil, isConseil]
          );
          report.created_acces++; lineDetail.actions.push('accès créé');
        }

        // Log des folder IDs dans la même transaction (cohérence garantie)
        if (!dryRun) {
          await logDriveFolderIds({ a: driveUrlCopro, b: driveUrlPerso, c: driveUrlConseil }, client);
        }

        await client.query(`RELEASE SAVEPOINT ${sp}`);
      } catch (rowErr) {
        await client.query(`ROLLBACK TO SAVEPOINT ${sp}`);
        lineDetail.status = 'error'; lineDetail.error = rowErr.message;
        report.errors.push({ line: lineNum, error: rowErr.message });
      }

      report.details.push(lineDetail);
    }

    if (dryRun) {
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
      await db.query(
        `INSERT INTO audit_log (admin_id, action, resource, detail, ip_address) VALUES ($1, 'import', 'import', $2, $3)`,
        [req.user.id, JSON.stringify({
          total: report.total, created_users: report.created_users,
          created_coproprietes: report.created_coproprietes,
          created_acces: report.created_acces, updated_acces: report.updated_acces,
          errors: report.errors.length,
        }), req.ip]
      );
    }

    return res.json({ success: true, report });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Erreur import:', err);
    return res.status(500).json({ error: 'Erreur : ' + err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
