const express    = require('express');
const router     = express.Router();
const jwt        = require('jsonwebtoken');
const rateLimit  = require('express-rate-limit');
const db         = require('../db');
const { sendOTP, sendAccessRequest } = require('../services/email');
const { hashEmail, decryptUser, generateOTP, hashOTP } = require('../services/crypto');
const { isValidEmail } = require('../utils/validation');
const { authMiddleware } = require('../middleware/auth');

const sendCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.body?.email?.toLowerCase() || req.ip,
  message: { error: 'Trop de tentatives. Veuillez réessayer dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

// Limite supplémentaire par IP — empêche l'énumération d'emails en masse
// (changer d'email à chaque requête ne contourne pas cette limite)
const sendCodeIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  message: { error: 'Trop de tentatives depuis cette adresse. Veuillez réessayer dans 15 minutes.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const verifyCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.body?.email?.toLowerCase() || req.ip,
  message: { error: 'Trop de tentatives. Veuillez réessayer dans 15 minutes.' },
});

const accessRequestLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 3,
  keyGenerator: (req) => req.body?.email?.toLowerCase() || req.ip,
  message: { error: 'Trop de demandes. Veuillez réessayer dans une heure.' },
});

// Limite supplémentaire par IP — empêche les spams en changeant d'email
const accessRequestIpLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  message: { error: 'Trop de demandes depuis cette adresse. Veuillez réessayer dans une heure.' },
});

// ── Cookie HttpOnly ───────────────────────────────────────────
//
// Stratégie SameSite selon l'environnement :
//
//   production  → SameSite=None; Secure
//     Requis pour les déploiements cross-origin (ex : Vercel + Render sur
//     des domaines distincts). SameSite=None est la seule valeur qui
//     autorise l'envoi du cookie dans les requêtes cross-site.
//     Secure est obligatoire avec SameSite=None (HTTPS uniquement).
//
//   development → SameSite=Lax; pas de Secure
//     Permet le fonctionnement en HTTP localhost sans HTTPS.
//
// Si tu passes sur un sous-domaine commun (ex : api.nova-copro.fr +
// app.nova-copro.fr), tu peux repasser à SameSite=Strict pour un
// durcissement maximal.

const TOKEN_COOKIE = 'nova_token';
const IS_PROD      = process.env.NODE_ENV === 'production';

const setTokenCookie = (res, token, rememberMe) => {
  const maxAge = rememberMe
    ? 180 * 24 * 60 * 60 * 1000  // 180 jours
    :       24 * 60 * 60 * 1000; // 24 h

  res.cookie(TOKEN_COOKIE, token, {
    httpOnly: true,
    secure:   IS_PROD,              // HTTPS obligatoire en prod (requis par SameSite=None)
    sameSite: IS_PROD ? 'none' : 'lax',
    maxAge,
    path:     '/',
  });
};

const clearTokenCookie = (res) => {
  res.clearCookie(TOKEN_COOKIE, {
    httpOnly: true,
    secure:   IS_PROD,
    sameSite: IS_PROD ? 'none' : 'lax',
    path:     '/',
  });
};

// ── POST /api/auth/send-code ──────────────────────────────────

router.post('/send-code', sendCodeIpLimiter, sendCodeLimiter, async (req, res) => {
  const { email } = req.body;
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Email invalide' });
  }

  const normalizedEmail = email.toLowerCase().trim();
  const emailHash = hashEmail(normalizedEmail);

  try {
    const userResult = await db.query(
      `SELECT id, email_encrypted, nom_encrypted, prenom_encrypted, is_active
       FROM users WHERE email_hash = $1`,
      [emailHash]
    );

    // Email inconnu ou inactif → 404 explicite pour déclencher la page de demande d'accès.
    // Même délai que le chemin "connu" pour éviter la différenciation par timing.
    if (!userResult.rows.length || !userResult.rows[0].is_active) {
      await new Promise(r => setTimeout(r, 400 + Math.random() * 200));
      return res.status(404).json({
        code:    'EMAIL_NOT_FOUND',
        message: 'Cet email n\'est pas enregistré.',
      });
    }

    const user = decryptUser(userResult.rows[0]);

    await db.query(
      'UPDATE otp_codes SET used = TRUE WHERE email_hash = $1 AND used = FALSE AND expires_at > NOW()',
      [emailHash]
    );

    const { code, codeHash } = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await db.query(
      'INSERT INTO otp_codes (email_hash, code_hash, expires_at, ip_address) VALUES ($1, $2, $3, $4)',
      [emailHash, codeHash, expiresAt, req.ip]
    );

    await sendOTP(normalizedEmail, code, user.prenom);
    return res.json({ success: true, message: 'Code envoyé ! Vérifiez votre boîte email (et vos spams).' });

  } catch (err) {
    console.error('Erreur send-code:', err);
    return res.status(500).json({ error: 'Erreur serveur. Veuillez réessayer.' });
  }
});

// ── POST /api/auth/verify-code ────────────────────────────────

router.post('/verify-code', verifyCodeLimiter, async (req, res) => {
  const { email, code, rememberMe } = req.body;
  if (!email || !code) {
    return res.status(400).json({ error: 'Email et code requis' });
  }
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Email invalide' });
  }

  const emailHash     = hashEmail(email.toLowerCase().trim());
  const inputCodeHash = hashOTP(code);

  try {
    const otpResult = await db.query(
      `SELECT id FROM otp_codes
       WHERE email_hash = $1 AND code_hash = $2 AND used = FALSE AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [emailHash, inputCodeHash]
    );

    if (!otpResult.rows.length) {
      return res.status(401).json({ error: 'Code invalide ou expiré' });
    }

    await db.query('UPDATE otp_codes SET used = TRUE WHERE id = $1', [otpResult.rows[0].id]);

    const userResult = await db.query(
      `SELECT id, email_encrypted, nom_encrypted, prenom_encrypted, is_admin
       FROM users WHERE email_hash = $1 AND is_active = TRUE`,
      [emailHash]
    );

    if (!userResult.rows.length) {
      return res.status(401).json({ error: 'Utilisateur non autorisé' });
    }

    const user = decryptUser(userResult.rows[0]);
    await db.query('UPDATE users SET last_login = NOW() WHERE id = $1', [user.id]);

    const expiresIn = rememberMe ? '180d' : '24h';
    const token = jwt.sign(
      { userId: user.id },           // isAdmin retiré : non utilisé par authMiddleware (re-fetch DB)
      process.env.JWT_SECRET,
      { expiresIn }
    );

    setTokenCookie(res, token, !!rememberMe);

    return res.json({
      success: true,
      user: { id: user.id, email: user.email, nom: user.nom, prenom: user.prenom, isAdmin: user.is_admin },
      expiresIn,
    });

  } catch (err) {
    console.error('Erreur verify-code:', err);
    return res.status(500).json({ error: 'Erreur serveur. Veuillez réessayer.' });
  }
});

// ── POST /api/auth/request-access ────────────────────────────

router.post('/request-access', accessRequestIpLimiter, accessRequestLimiter, async (req, res) => {
  const { email, message } = req.body;
  if (!isValidEmail(email)) {
    return res.status(400).json({ error: 'Email invalide' });
  }
  if (message && String(message).length > 500) {
    return res.status(400).json({ error: 'Message trop long (500 caractères max)' });
  }
  try {
    await sendAccessRequest(email.toLowerCase().trim(), message || '');
    return res.json({ success: true });
  } catch (err) {
    console.error('Erreur request-access:', err);
    return res.status(500).json({ error: 'Erreur lors de l\'envoi. Veuillez réessayer.' });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────

router.post('/logout', (req, res) => {
  clearTokenCookie(res);
  return res.json({ success: true });
});

// ── GET /api/auth/me ──────────────────────────────────────────

router.get('/me', authMiddleware, (req, res) => {
  const { id, email, nom, prenom, is_admin } = req.user;
  return res.json({ user: { id, email, nom, prenom, isAdmin: is_admin } });
});

module.exports = router;
