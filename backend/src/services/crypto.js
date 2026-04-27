/**
 * Service de chiffrement des données personnelles (PII)
 *
 * Principe :
 *  - nom, prenom → chiffrés AES-256-GCM avant stockage
 *  - email       → deux colonnes :
 *      email_hash      : HMAC-SHA256 pour les lookups (WHERE email_hash = ?)
 *      email_encrypted : AES-256-GCM pour l'affichage
 *
 * Versionnement de clé :
 *  - Format chiffré : "vN:iv_hex:tag_hex:cipher_b64"
 *  - KEY_VERSION (env, défaut "1") = version courante.
 *  - Clés passées dans ENCRYPTION_KEY_v1, ENCRYPTION_KEY_v2, …
 *    (ou ENCRYPTION_KEY pour la v1 sans suffixe).
 *  - decrypt() détecte automatiquement la version du chiffré.
 *
 * Codes OTP :
 *  - Générés via crypto.randomInt() (CSPRNG).
 *  - Hashés avec HMAC-SHA256 + OTP_SECRET avant stockage.
 *    → même si la base fuite, les 10^6 codes ne sont pas brute-forçables
 *      sans connaître OTP_SECRET.
 */

const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;

// ── Résolution de clé par version ────────────────────────────

const getCurrentKeyVersion = () => process.env.KEY_VERSION || '1';

const getKeyForVersion = (version) => {
  const envName = version === '1'
    ? (process.env.ENCRYPTION_KEY_v1 ? 'ENCRYPTION_KEY_v1' : 'ENCRYPTION_KEY')
    : `ENCRYPTION_KEY_v${version}`;
  const key = process.env[envName];
  if (!key || key.length !== 64) {
    throw new Error(`Clé de chiffrement manquante/invalide pour version ${version} (${envName})`);
  }
  return Buffer.from(key, 'hex');
};

const getHmacKey = () => {
  const key = process.env.HMAC_KEY;
  if (!key || key.length !== 64) {
    throw new Error('HMAC_KEY manquante/invalide (32 bytes en hex)');
  }
  return Buffer.from(key, 'hex');
};

const getOtpSecret = () => {
  const secret = process.env.OTP_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('OTP_SECRET manquant/invalide (min 32 chars)');
  }
  return secret;
};

// ── Chiffrement AES-256-GCM (versionné) ──────────────────────

const encrypt = (plaintext) => {
  if (plaintext === null || plaintext === undefined) return null;
  const version = getCurrentKeyVersion();
  const key = getKeyForVersion(version);
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v${version}:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('base64')}`;
};

const decrypt = (ciphertext) => {
  if (!ciphertext) return null;
  try {
    let version, ivHex, tagHex, encryptedB64;

    if (/^v\d+:/.test(ciphertext)) {
      // Format versionné : "vN:iv:tag:cipher"
      const parts = ciphertext.split(':');
      version      = parts[0].slice(1);
      ivHex        = parts[1];
      tagHex       = parts[2];
      encryptedB64 = parts[3];
    } else {
      // Ancien format sans version → suppose v1
      const parts = ciphertext.split(':');
      version      = '1';
      ivHex        = parts[0];
      tagHex       = parts[1];
      encryptedB64 = parts[2];
    }

    const key       = getKeyForVersion(version);
    const iv        = Buffer.from(ivHex, 'hex');
    const tag       = Buffer.from(tagHex, 'hex');
    const encrypted = Buffer.from(encryptedB64, 'base64');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted, undefined, 'utf8') + decipher.final('utf8');
  } catch {
    return '[déchiffrement impossible]';
  }
};

// ── HMAC email ───────────────────────────────────────────────

const hashEmail = (email) => {
  if (!email) return null;
  return crypto
    .createHmac('sha256', getHmacKey())
    .update(email.toLowerCase().trim())
    .digest('hex');
};

// ── OTP ──────────────────────────────────────────────────────

/**
 * Génère un code OTP à 6 chiffres via CSPRNG.
 * Retourne { code, codeHash }.
 *
 * codeHash = HMAC-SHA256(code, OTP_SECRET)
 * → même si la base fuite, un attaquant sans OTP_SECRET ne peut pas
 *   brute-forcer les 10^6 possibilités de façon utile.
 */
const generateOTP = () => {
  const code = crypto.randomInt(100000, 999999).toString();
  const codeHash = crypto
    .createHmac('sha256', getOtpSecret())
    .update(code)
    .digest('hex');
  return { code, codeHash };
};

/**
 * Hash un code OTP reçu du frontend pour comparaison avec la base.
 */
const hashOTP = (code) =>
  crypto
    .createHmac('sha256', getOtpSecret())
    .update(String(code).trim())
    .digest('hex');

// ── Helpers utilisateur ───────────────────────────────────────

/**
 * Chiffre un champ unique (email, nom, ou prenom).
 * Retourne null si la valeur est une chaîne vide ou null/undefined.
 */
const encryptField = (value) =>
  value !== undefined && value !== null && value !== '' ? encrypt(String(value)) : null;

/**
 * Prépare les champs chiffrés pour insertion/mise à jour.
 * Seuls les champs présents dans l'objet source sont générés.
 */
const encryptUser = ({ email, nom, prenom }) => {
  const result = {};
  if (email !== undefined) {
    const normalized = email ? email.toLowerCase().trim() : '';
    result.email_hash      = normalized ? hashEmail(normalized) : null;
    result.email_encrypted = normalized ? encrypt(normalized)   : null;
  }
  if (nom    !== undefined) result.nom_encrypted    = encryptField(nom);
  if (prenom !== undefined) result.prenom_encrypted = encryptField(prenom);
  return result;
};

/**
 * Déchiffre un enregistrement user venant de la base.
 * Supprime les colonnes chiffrées/hash de l'objet retourné.
 */
const decryptUser = (row) => {
  if (!row) return null;
  const { email_encrypted, nom_encrypted, prenom_encrypted, email_hash, ...rest } = row;
  return {
    ...rest,
    email:  decrypt(email_encrypted)  || null,
    nom:    decrypt(nom_encrypted)    || null,
    prenom: decrypt(prenom_encrypted) || null,
  };
};

module.exports = {
  encrypt,
  decrypt,
  hashEmail,
  encryptUser,
  decryptUser,
  generateOTP,
  hashOTP,
};
