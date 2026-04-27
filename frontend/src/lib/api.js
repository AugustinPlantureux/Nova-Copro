/**
 * Client HTTP (axios)
 *
 * Le token JWT est stocké dans un cookie HttpOnly posé par le backend.
 * → Le frontend ne peut pas le lire depuis JS (résistant au XSS).
 * → axios envoie le cookie automatiquement grâce à `withCredentials: true`.
 *
 * La session côté frontend repose uniquement sur le cookie `nova_user`
 * (non HttpOnly, contient uniquement les infos d'affichage — pas le token).
 */

import axios from 'axios';
import Cookies from 'js-cookie';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const api = axios.create({
  baseURL:         API_URL,
  timeout:         15000,
  withCredentials: true, // envoie le cookie HttpOnly nova_token automatiquement
  headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
});

// ── Codes d'erreur auth nécessitant une purge de session ──────
const AUTH_ERROR_CODES = new Set([
  'TOKEN_MISSING',
  'TOKEN_EXPIRED',
  'TOKEN_INVALID',
  'SESSION_INVALID',
]);

// ── Gérer tous les 401 auth ───────────────────────────────────
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      const code = error.response?.data?.code;

      if (AUTH_ERROR_CODES.has(code)) {
        clearSession(); // supprime nova_user (le cookie HttpOnly est effacé par le backend)
        const reason = code === 'TOKEN_EXPIRED' ? 'expired' : 'invalid';
        window.location.href = `/?session=${reason}`;
        return; // interrompre la chaîne de promesses
      }
    }
    return Promise.reject(error);
  }
);

// ── Auth ──────────────────────────────────────────────────────
export const authAPI = {
  sendCode:   (email) =>
    api.post('/api/auth/send-code', { email }),

  verifyCode: (email, code, rememberMe) =>
    api.post('/api/auth/verify-code', { email, code, rememberMe }),

  // Le backend pose le cookie HttpOnly nova_token.
  // Le frontend sauvegarde uniquement nova_user (infos d'affichage).

  logout: () => {
    clearSession();
    // Le backend efface le cookie HttpOnly nova_token
    return api.post('/api/auth/logout').catch(() => {});
  },

  me: () => api.get('/api/auth/me'),

  requestAccess: (email, message) =>
    api.post('/api/auth/request-access', { email, message }),
};

// ── User ──────────────────────────────────────────────────────
export const userAPI = {
  getFolders: () => api.get('/api/user/folders'),
  getProfile: () => api.get('/api/user/profile'),
};

// ── Admin ─────────────────────────────────────────────────────
export const adminAPI = {
  getStats: () => api.get('/api/admin/stats'),

  getCoproprietes:   ()        => api.get('/api/admin/coproprietes'),
  getCopropriete:    (id)      => api.get(`/api/admin/coproprietes/${id}`),
  createCopropriete: (data)    => api.post('/api/admin/coproprietes', data),
  updateCopropriete: (id,data) => api.put(`/api/admin/coproprietes/${id}`, data),
  deleteCopropriete: (id)      => api.delete(`/api/admin/coproprietes/${id}`),

  getUsers:   ()        => api.get('/api/admin/users'),
  getUser:    (id)      => api.get(`/api/admin/users/${id}`),
  createUser: (data)    => api.post('/api/admin/users', data),
  updateUser: (id,data) => api.put(`/api/admin/users/${id}`, data),
  deleteUser: (id)      => api.delete(`/api/admin/users/${id}`),

  upsertAcces: (data)    => api.post('/api/admin/acces', data),
  updateAcces: (id,data) => api.put(`/api/admin/acces/${id}`, data),
  deleteAcces: (id)      => api.delete(`/api/admin/acces/${id}`),

  getAuditLog: (params) => api.get('/api/admin/audit', { params }),
};

// ── Import ────────────────────────────────────────────────────
export const importAPI = {
  getTemplate: () =>
    api.get('/api/admin/import/template', { responseType: 'blob' }),

  upload: (file, dryRun = false) => {
    const form = new FormData();
    form.append('file', file);
    // Ne pas forcer Content-Type — axios le gère avec le bon boundary pour FormData
    return api.post(`/api/admin/import${dryRun ? '?dry_run=true' : ''}`, form);
  },
};

// ── Session helpers ───────────────────────────────────────────
// Note : seul nova_user est géré ici (infos d'affichage).
// Le token JWT est dans un cookie HttpOnly géré exclusivement par le backend.

const IS_PROD = typeof window !== 'undefined' && window.location.protocol === 'https:';
const COOKIE_OPTS = { secure: IS_PROD, sameSite: 'Strict' };

export const saveSession = (user, rememberMe) => {
  const expires = rememberMe ? 180 : 1;
  Cookies.set('nova_user', JSON.stringify(user), { expires, ...COOKIE_OPTS });
};

export const getSession = () => {
  const userRaw = Cookies.get('nova_user');
  if (!userRaw) return null;
  try {
    return { user: JSON.parse(userRaw) };
  } catch {
    return null;
  }
};

export const clearSession = () => {
  Cookies.remove('nova_user', COOKIE_OPTS);
};

export default api;
