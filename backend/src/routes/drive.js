/**
 * Routes Drive API
 *
 * GET  /api/user/drive/list      ?copropriete_id=X&type=Y[&folder_id=Z]
 *      → liste le contenu d'un dossier (racine ou sous-dossier)
 *
 * GET  /api/user/drive/download  ?file_id=F&copropriete_id=X&type=Y
 *      → télécharge un fichier (stream via le backend)
 *
 * GET  /api/user/drive/preview   ?file_id=F&copropriete_id=X&type=Y
 *      → affiche un fichier inline (PDF, image) dans un iframe
 *
 * Sécurité :
 *  - JWT vérifié sur chaque requête
 *  - root folder ID récupéré depuis la BDD (jamais du frontend)
 *  - Pour les sous-dossiers : vérification que l'ID est bien
 *    un descendant du root autorisé (via Drive API + cache)
 */

const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');
const driveService = require('../services/drive');

router.use(authMiddleware);

// ── Helpers ───────────────────────────────────────────────────

const VALID_TYPES = ['copropriete', 'personnel', 'conseil'];

/**
 * Récupère et valide l'accès utilisateur pour (copropriete_id, type).
 * Retourne le root folder ID Drive.
 */
const getRootFolderId = async (userId, coproprieteId, type) => {
  if (!VALID_TYPES.includes(type)) throw { status: 400, message: 'type invalide' };

  const result = await db.query(
    `SELECT drive_url_copropriete, drive_url_personnel, drive_url_conseil, is_conseil_syndical
     FROM user_acces
     WHERE user_id = $1 AND copropriete_id = $2`,
    [userId, coproprieteId]
  );

  if (!result.rows.length) throw { status: 403, message: 'Accès non autorisé' };

  const row = result.rows[0];

  let url;
  if (type === 'copropriete') url = row.drive_url_copropriete;
  if (type === 'personnel')   url = row.drive_url_personnel;
  if (type === 'conseil') {
    if (!row.is_conseil_syndical) throw { status: 403, message: 'Accès conseil non autorisé' };
    url = row.drive_url_conseil;
  }

  if (!url) throw { status: 404, message: 'Dossier non configuré' };

  const folderId = driveService.extractFolderId(url);
  if (!folderId) throw { status: 500, message: 'URL Drive invalide en base de données' };

  return folderId;
};

const handleError = (err, res) => {
  if (err.status) return res.status(err.status).json({ error: err.message });
  console.error('Erreur Drive API:', err.message);
  if (err.code === 403) return res.status(403).json({ error: 'Accès refusé par Google Drive' });
  if (err.code === 404) return res.status(404).json({ error: 'Fichier introuvable dans Drive' });
  return res.status(500).json({ error: 'Erreur Drive : ' + err.message });
};

// ── GET /api/user/drive/list ──────────────────────────────────

router.get('/list', async (req, res) => {
  const { copropriete_id, type, folder_id } = req.query;

  if (!copropriete_id || !type) {
    return res.status(400).json({ error: 'copropriete_id et type sont requis' });
  }

  try {
    const rootFolderId = await getRootFolderId(req.user.id, copropriete_id, type);
    const targetFolderId = folder_id || rootFolderId;

    // Vérification d'ascendance pour les sous-dossiers
    if (targetFolderId !== rootFolderId) {
      const allowed = await driveService.isDescendantOf(targetFolderId, rootFolderId);
      if (!allowed) {
        return res.status(403).json({ error: 'Ce dossier n\'est pas dans votre espace autorisé' });
      }
    }

    const files = await driveService.listFolder(targetFolderId);

    return res.json({
      success: true,
      rootFolderId,
      currentFolderId: targetFolderId,
      isRoot: targetFolderId === rootFolderId,
      files,
    });

  } catch (err) {
    return handleError(err, res);
  }
});

// ── GET /api/user/drive/download ──────────────────────────────

router.get('/download', async (req, res) => {
  const { file_id, copropriete_id, type } = req.query;

  if (!file_id || !copropriete_id || !type) {
    return res.status(400).json({ error: 'file_id, copropriete_id et type sont requis' });
  }

  try {
    const rootFolderId = await getRootFolderId(req.user.id, copropriete_id, type);

    // Vérifier que le fichier est bien dans l'espace autorisé
    const allowed = await driveService.isDescendantOf(file_id, rootFolderId);
    if (!allowed) {
      return res.status(403).json({ error: 'Ce fichier n\'est pas dans votre espace autorisé' });
    }

    await driveService.streamFile(file_id, res);

  } catch (err) {
    if (!res.headersSent) return handleError(err, res);
  }
});

// ── GET /api/user/drive/preview ───────────────────────────────

router.get('/preview', async (req, res) => {
  const { file_id, copropriete_id, type } = req.query;

  if (!file_id || !copropriete_id || !type) {
    return res.status(400).json({ error: 'Paramètres manquants' });
  }

  try {
    const rootFolderId = await getRootFolderId(req.user.id, copropriete_id, type);

    const allowed = await driveService.isDescendantOf(file_id, rootFolderId);
    if (!allowed) {
      return res.status(403).json({ error: 'Fichier non autorisé' });
    }

    await driveService.streamPreview(file_id, res);

  } catch (err) {
    if (!res.headersSent) return handleError(err, res);
  }
});

module.exports = router;
