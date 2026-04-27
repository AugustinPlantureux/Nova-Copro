/**
 * Utilitaires de validation communs
 */

/**
 * Vérifie qu'un email a un format valide.
 * Plus strict que email.includes('@') — exige au minimum local@domain.ext
 */
const isValidEmail = (email) =>
  /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());

module.exports = { isValidEmail };
