const express = require('express');
const router = express.Router();
const db = require('../db');
const { authMiddleware, adminMiddleware } = require('../middleware/auth');

// Toutes les routes admin nécessitent auth + droits admin
router.use(authMiddleware, adminMiddleware);

// ═══════════════════════════════════════
// COPROPRIÉTÉS
// ═══════════════════════════════════════

/** GET /api/admin/coproprietes - Liste toutes les copropriétés */
router.get('/coproprietes', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.*, 
        COUNT(DISTINCT ua.user_id) AS nb_utilisateurs
       FROM coproprietes c
       LEFT JOIN user_acces ua ON ua.copropriete_id = c.id
       GROUP BY c.id
       ORDER BY c.nom ASC`
    );
    return res.json({ success: true, coproprietes: result.rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

/** GET /api/admin/coproprietes/:id - Détail d'une copropriété */
router.get('/coproprietes/:id', async (req, res) => {
  try {
    const copro = await db.query('SELECT * FROM coproprietes WHERE id = $1', [req.params.id]);
    if (!copro.rows.length) return res.status(404).json({ error: 'Copropriété non trouvée' });

    const users = await db.query(
      `SELECT u.id, u.email, u.nom, u.prenom, ua.drive_url_copropriete, 
              ua.drive_url_personnel, ua.drive_url_conseil, ua.is_conseil_syndical, ua.notes
       FROM user_acces ua
       JOIN users u ON u.id = ua.user_id
       WHERE ua.copropriete_id = $1
       ORDER BY u.nom, u.prenom`,
      [req.params.id]
    );

    return res.json({ success: true, copropriete: copro.rows[0], users: users.rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

/** POST /api/admin/coproprietes - Créer une copropriété */
router.post('/coproprietes', async (req, res) => {
  const { nom, adresse, code_postal, ville, drive_url_base } = req.body;
  if (!nom) return res.status(400).json({ error: 'Le nom est requis' });

  try {
    const result = await db.query(
      `INSERT INTO coproprietes (nom, adresse, code_postal, ville, drive_url_base)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [nom, adresse, code_postal, ville, drive_url_base]
    );
    return res.status(201).json({ success: true, copropriete: result.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

/** PUT /api/admin/coproprietes/:id - Modifier une copropriété */
router.put('/coproprietes/:id', async (req, res) => {
  const { nom, adresse, code_postal, ville, drive_url_base } = req.body;

  try {
    const result = await db.query(
      `UPDATE coproprietes 
       SET nom = COALESCE($1, nom), adresse = $2, code_postal = $3, ville = $4, drive_url_base = $5
       WHERE id = $6 RETURNING *`,
      [nom, adresse, code_postal, ville, drive_url_base, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Copropriété non trouvée' });
    return res.json({ success: true, copropriete: result.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

/** DELETE /api/admin/coproprietes/:id - Supprimer une copropriété */
router.delete('/coproprietes/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM coproprietes WHERE id = $1', [req.params.id]);
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════
// UTILISATEURS
// ═══════════════════════════════════════

/** GET /api/admin/users - Liste tous les utilisateurs */
router.get('/users', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT u.*, 
        COUNT(DISTINCT ua.copropriete_id) AS nb_coproprietes,
        array_agg(c.nom ORDER BY c.nom) FILTER (WHERE c.nom IS NOT NULL) AS coproprietes_noms
       FROM users u
       LEFT JOIN user_acces ua ON ua.user_id = u.id
       LEFT JOIN coproprietes c ON c.id = ua.copropriete_id
       GROUP BY u.id
       ORDER BY u.nom, u.prenom`
    );
    return res.json({ success: true, users: result.rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

/** GET /api/admin/users/:id - Détail d'un utilisateur */
router.get('/users/:id', async (req, res) => {
  try {
    const user = await db.query('SELECT * FROM users WHERE id = $1', [req.params.id]);
    if (!user.rows.length) return res.status(404).json({ error: 'Utilisateur non trouvé' });

    const acces = await db.query(
      `SELECT ua.*, c.nom AS copropriete_nom, c.adresse, c.code_postal, c.ville
       FROM user_acces ua
       JOIN coproprietes c ON c.id = ua.copropriete_id
       WHERE ua.user_id = $1
       ORDER BY c.nom`,
      [req.params.id]
    );

    return res.json({ success: true, user: user.rows[0], acces: acces.rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

/** POST /api/admin/users - Créer un utilisateur autorisé */
router.post('/users', async (req, res) => {
  const { email, nom, prenom, is_admin } = req.body;
  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Email invalide' });
  }

  try {
    const result = await db.query(
      `INSERT INTO users (email, nom, prenom, is_admin)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [email.toLowerCase().trim(), nom, prenom, is_admin || false]
    );
    return res.status(201).json({ success: true, user: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Cet email existe déjà' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

/** PUT /api/admin/users/:id - Modifier un utilisateur */
router.put('/users/:id', async (req, res) => {
  const { email, nom, prenom, is_admin, is_active } = req.body;

  try {
    const result = await db.query(
      `UPDATE users
       SET email = COALESCE($1, email), nom = $2, prenom = $3,
           is_admin = COALESCE($4, is_admin), is_active = COALESCE($5, is_active)
       WHERE id = $6 RETURNING *`,
      [email?.toLowerCase().trim(), nom, prenom, is_admin, is_active, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Utilisateur non trouvé' });
    return res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

/** DELETE /api/admin/users/:id - Supprimer un utilisateur */
router.delete('/users/:id', async (req, res) => {
  // Empêcher l'admin de se supprimer lui-même
  if (req.params.id === req.user.id) {
    return res.status(400).json({ error: 'Vous ne pouvez pas supprimer votre propre compte' });
  }
  try {
    await db.query('DELETE FROM users WHERE id = $1', [req.params.id]);
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

// ═══════════════════════════════════════
// ACCÈS (Permissions par copropriété)
// ═══════════════════════════════════════

/** POST /api/admin/acces - Attribuer un accès à un utilisateur */
router.post('/acces', async (req, res) => {
  const {
    user_id, copropriete_id,
    drive_url_copropriete, drive_url_personnel, drive_url_conseil,
    is_conseil_syndical, notes
  } = req.body;

  if (!user_id || !copropriete_id) {
    return res.status(400).json({ error: 'user_id et copropriete_id sont requis' });
  }

  try {
    const result = await db.query(
      `INSERT INTO user_acces 
        (user_id, copropriete_id, drive_url_copropriete, drive_url_personnel, 
         drive_url_conseil, is_conseil_syndical, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id, copropriete_id) DO UPDATE SET
         drive_url_copropriete = EXCLUDED.drive_url_copropriete,
         drive_url_personnel = EXCLUDED.drive_url_personnel,
         drive_url_conseil = EXCLUDED.drive_url_conseil,
         is_conseil_syndical = EXCLUDED.is_conseil_syndical,
         notes = EXCLUDED.notes
       RETURNING *`,
      [user_id, copropriete_id, drive_url_copropriete, drive_url_personnel,
       drive_url_conseil, is_conseil_syndical || false, notes]
    );
    return res.status(201).json({ success: true, acces: result.rows[0] });
  } catch (err) {
    if (err.code === '23503') {
      return res.status(400).json({ error: 'Utilisateur ou copropriété introuvable' });
    }
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

/** PUT /api/admin/acces/:id - Modifier un accès */
router.put('/acces/:id', async (req, res) => {
  const {
    drive_url_copropriete, drive_url_personnel, drive_url_conseil,
    is_conseil_syndical, notes
  } = req.body;

  try {
    const result = await db.query(
      `UPDATE user_acces SET
         drive_url_copropriete = $1, drive_url_personnel = $2,
         drive_url_conseil = $3, is_conseil_syndical = $4, notes = $5
       WHERE id = $6 RETURNING *`,
      [drive_url_copropriete, drive_url_personnel, drive_url_conseil,
       is_conseil_syndical, notes, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Accès non trouvé' });
    return res.json({ success: true, acces: result.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

/** DELETE /api/admin/acces/:id - Supprimer un accès */
router.delete('/acces/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM user_acces WHERE id = $1', [req.params.id]);
    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

/** GET /api/admin/stats - Dashboard stats */
router.get('/stats', async (req, res) => {
  try {
    const [nbUsers, nbCopros, nbAcces, recentLogins] = await Promise.all([
      db.query('SELECT COUNT(*) FROM users WHERE is_active = TRUE'),
      db.query('SELECT COUNT(*) FROM coproprietes'),
      db.query('SELECT COUNT(*) FROM user_acces'),
      db.query(
        `SELECT u.email, u.nom, u.prenom, u.last_login
         FROM users u WHERE u.last_login IS NOT NULL
         ORDER BY u.last_login DESC LIMIT 10`
      ),
    ]);

    return res.json({
      success: true,
      stats: {
        nb_utilisateurs: parseInt(nbUsers.rows[0].count),
        nb_coproprietes: parseInt(nbCopros.rows[0].count),
        nb_acces: parseInt(nbAcces.rows[0].count),
        recent_logins: recentLogins.rows,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: 'Erreur serveur' });
  }
});

module.exports = router;
