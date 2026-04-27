const jwt = require('jsonwebtoken');
const db  = require('../db');
const { decryptUser } = require('../services/crypto');

/**
 * Middleware d'authentification JWT.
 *
 * Lit le token depuis (par priorité) :
 *   1. Cookie HttpOnly `nova_token` (défini par le backend à la connexion)
 *   2. Header `Authorization: Bearer <token>` (compatibilité API)
 *
 * Charge les colonnes chiffrées depuis la base, déchiffre les PII,
 * et expose req.user = { id, email, nom, prenom, is_admin }.
 */
const authMiddleware = async (req, res, next) => {
  try {
    // 1. Cookie HttpOnly (chemin préféré, résistant au XSS)
    let token = req.cookies?.nova_token;

    // 2. Fallback header Authorization: Bearer (compatibilité API externe)
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader?.startsWith('Bearer ')) {
        token = authHeader.split(' ')[1];
      }
    }

    if (!token) {
      return res.status(401).json({ error: 'Token manquant', code: 'TOKEN_MISSING' });
    }

    let decoded;
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      if (err.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Session expirée', code: 'TOKEN_EXPIRED' });
      }
      return res.status(401).json({ error: 'Token invalide', code: 'TOKEN_INVALID' });
    }

    const result = await db.query(
      `SELECT id, email_encrypted, nom_encrypted, prenom_encrypted, is_admin, is_active
       FROM users WHERE id = $1`,
      [decoded.userId]
    );

    if (!result.rows.length || !result.rows[0].is_active) {
      return res.status(401).json({ error: 'Session invalide', code: 'SESSION_INVALID' });
    }

    req.user = decryptUser(result.rows[0]);
    next();
  } catch (err) {
    console.error('authMiddleware error:', err);
    return res.status(500).json({ error: 'Erreur serveur lors de l\'authentification' });
  }
};

const adminMiddleware = (req, res, next) => {
  if (!req.user?.is_admin) {
    return res.status(403).json({ error: 'Accès refusé. Droits administrateur requis.' });
  }
  next();
};

module.exports = { authMiddleware, adminMiddleware };
