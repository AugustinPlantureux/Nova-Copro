const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware } = require('../middleware/auth');

// Toutes les routes nécessitent une authentification
router.use(authMiddleware);

/**
 * GET /api/user/folders
 * Retourne tous les dossiers Drive accessibles par l'utilisateur
 */
router.get('/folders', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT 
        ua.id,
        ua.copropriete_id,
        c.nom AS copropriete_nom,
        c.adresse,
        c.code_postal,
        c.ville,
        ua.drive_url_copropriete,
        ua.drive_url_personnel,
        ua.drive_url_conseil,
        ua.is_conseil_syndical
      FROM user_acces ua
      JOIN coproprietes c ON c.id = ua.copropriete_id
      WHERE ua.user_id = $1
      ORDER BY c.nom ASC`,
      [req.user.id]
    );

    // Structurer les données pour le frontend
    const coproprietes = result.rows.map(row => {
      const folders = [];

      if (row.drive_url_copropriete) {
        folders.push({
          type: 'copropriete',
          label: 'Documents de la copropriété',
          description: 'PV d\'assemblées générales, règlement de copropriété, contrats...',
          icon: '🏢',
          url: row.drive_url_copropriete,
        });
      }

      if (row.drive_url_personnel) {
        folders.push({
          type: 'personnel',
          label: 'Mes documents personnels',
          description: 'Appels de fonds, décomptes de charges, avis de mutation...',
          icon: '📄',
          url: row.drive_url_personnel,
        });
      }

      if (row.is_conseil_syndical && row.drive_url_conseil) {
        folders.push({
          type: 'conseil',
          label: 'Conseil syndical',
          description: 'Documents réservés aux membres du conseil syndical',
          icon: '🔒',
          url: row.drive_url_conseil,
        });
      }

      return {
        id: row.copropriete_id,
        nom: row.copropriete_nom,
        adresse: [row.adresse, row.code_postal, row.ville].filter(Boolean).join(' '),
        isConseilSyndical: row.is_conseil_syndical,
        folders,
      };
    });

    return res.json({
      success: true,
      coproprietes,
    });

  } catch (err) {
    console.error('Erreur /user/folders:', err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

/**
 * GET /api/user/profile
 * Infos du profil utilisateur
 */
router.get('/profile', async (req, res) => {
  return res.json({
    success: true,
    user: {
      id: req.user.id,
      email: req.user.email,
      nom: req.user.nom,
      prenom: req.user.prenom,
      isAdmin: req.user.is_admin,
    },
  });
});

module.exports = router;
