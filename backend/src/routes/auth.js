const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { sendOTP } = require('../services/email');

// Rate limiting : max 5 demandes de code par email par 15 minutes
const sendCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.body?.email?.toLowerCase() || req.ip,
  message: { error: 'Trop de tentatives. Veuillez réessayer dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiting : max 10 tentatives de vérification par 15 minutes
const verifyCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.body?.email?.toLowerCase() || req.ip,
  message: { error: 'Trop de tentatives. Veuillez réessayer dans 15 minutes.' },
});

// Génère un code OTP à 6 chiffres
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

/**
 * POST /api/auth/send-code
 * Demande d'envoi du code OTP
 */
router.post('/send-code', sendCodeLimiter, async (req, res) => {
  const { email } = req.body;

  if (!email || !email.includes('@')) {
    return res.status(400).json({ error: 'Email invalide' });
  }

  const normalizedEmail = email.toLowerCase().trim();

  try {
    // Vérifier que l'email est autorisé
    const userResult = await db.query(
      'SELECT id, email, nom, prenom, is_active FROM users WHERE email = $1',
      [normalizedEmail]
    );

    if (!userResult.rows.length || !userResult.rows[0].is_active) {
      // Réponse intentionnellement vague pour la sécurité
      // On attend quand même un peu pour éviter l'énumération d'emails
      await new Promise(r => setTimeout(r, 500));
      return res.json({
        success: true,
        message: 'Si cet email est autorisé, vous allez recevoir un code.'
      });
    }

    const user = userResult.rows[0];

    // Invalider les anciens codes non utilisés pour cet email
    await db.query(
      'UPDATE otp_codes SET used = TRUE WHERE email = $1 AND used = FALSE AND expires_at > NOW()',
      [normalizedEmail]
    );

    // Générer un nouveau code
    const code = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Sauvegarder le code
    await db.query(
      'INSERT INTO otp_codes (email, code, expires_at, ip_address) VALUES ($1, $2, $3, $4)',
      [normalizedEmail, code, expiresAt, req.ip]
    );

    // Envoyer l'email
    await sendOTP(normalizedEmail, code, user.prenom);

    return res.json({
      success: true,
      message: 'Code envoyé ! Vérifiez votre boîte email (et vos spams).'
    });

  } catch (err) {
    console.error('Erreur send-code:', err);
    return res.status(500).json({ error: 'Erreur serveur. Veuillez réessayer.' });
  }
});

/**
 * POST /api/auth/verify-code
 * Vérification du code OTP et délivrance du JWT
 */
router.post('/verify-code', verifyCodeLimiter, async (req, res) => {
  const { email, code, rememberMe } = req.body;

  if (!email || !code) {
    return res.status(400).json({ error: 'Email et code requis' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const normalizedCode = code.trim();

  try {
    // Vérifier le code OTP
    const otpResult = await db.query(
      `SELECT id FROM otp_codes 
       WHERE email = $1 AND code = $2 AND used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [normalizedEmail, normalizedCode]
    );

    if (!otpResult.rows.length) {
      return res.status(401).json({ error: 'Code invalide ou expiré' });
    }

    // Marquer le code comme utilisé
    await db.query('UPDATE otp_codes SET used = TRUE WHERE id = $1', [otpResult.rows[0].id]);

    // Récupérer l'utilisateur
    const userResult = await db.query(
      'SELECT id, email, nom, prenom, is_admin FROM users WHERE email = $1 AND is_active = TRUE',
      [normalizedEmail]
    );

    if (!userResult.rows.length) {
      return res.status(401).json({ error: 'Utilisateur non autorisé' });
    }

    const user = userResult.rows[0];

    // Mettre à jour last_login
    await db.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    // Générer le JWT
    const expiresIn = rememberMe ? '30d' : '24h';
    const token = jwt.sign(
      { userId: user.id, email: user.email, isAdmin: user.is_admin },
      process.env.JWT_SECRET,
      { expiresIn }
    );

    return res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        nom: user.nom,
        prenom: user.prenom,
        isAdmin: user.is_admin,
      },
      expiresIn,
    });

  } catch (err) {
    console.error('Erreur verify-code:', err);
    return res.status(500).json({ error: 'Erreur serveur. Veuillez réessayer.' });
  }
});

/**
 * POST /api/auth/logout
 * Déconnexion (côté client principalement, mais on le log)
 */
router.post('/logout', async (req, res) => {
  return res.json({ success: true, message: 'Déconnecté avec succès' });
});

/**
 * GET /api/auth/me
 * Vérification du token (utilisé au chargement de l'app)
 */
router.get('/me', require('../middleware/auth').authMiddleware, async (req, res) => {
  return res.json({ user: req.user });
});

module.exports = router;
