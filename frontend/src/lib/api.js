/**
 * Client HTTP (axios)
 *
 * Stratégie d'authentification cross-origin (Vercel + Render) :
 *
 *   Primaire  : cookie HttpOnly `nova_token` posé par le backend.
 *               Résistant au XSS. Envoyé automatiquement par le navigateur.
 *               Peut être bloqué sur certains navigateurs (Safari, Firefox strict)
 *               en cross-origin malgré SameSite=None.
 *
 *   Fallback  : cookie JS `nova_token_js` (lisible par le frontend).
 *               Envoyé en header `Authorization: Bearer` si le HttpOnly est bloqué.
 *               Le backend accepte les deux via authMiddleware.
 *
 * Cette approche garantit le fonctionnement sur TOUS les navigateurs,
 * même ceux qui bloquent les cookies tiers.
 */

import axios from 'axios';
import Cookies from 'js-cookie';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const IS_PROD  = typeof window !== 'undefined' && window.location.protocol === 'https:';
const COOKIE_OPTS = { secure: IS_PROD, sameSite: 'Strict' };

const api = axios.create({
  baseURL:         API_URL,
  timeout:         15000,
  withCredentials: true,
  headers: {
    'Content-Type':   'application/json',
    'X-Requested-With': 'XMLHttpRequest',
  },
});

// ── Injecter le Bearer token fallback si le cookie HttpOnly est absent ────
// Le backend lit d'abord req.cookies.nova_token, puis Authorization Bearer.
// Ce fallback s'active uniquement si nova_token_js est présent (posé au login).
api.interceptors.request.use((config) => {
  const fallbackToken = Cookies.get('nova_token_js');
  if (fallbackToken) {
    config.headers.Authorization = `Bearer ${fallbackToken}`;
  }
  return config;
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
        clearSession();
        const reason = code === 'TOKEN_EXPIRED' ? 'expired' : 'invalid';
        window.location.href = `/?session=${reason}`;
        return;
      }
    }
    return Promise.reject(error);
  }
);

// ── Auth ──────────────────────────────────────────────────────
export const authAPI = {
  sendCode: (email) =>
    api.post('/api/auth/send-code', { email }),

  verifyCode: (email, code, rememberMe) =>
    api.post('/api/auth/verify-code', { email, code, rememberMe }),

  logout: () => {
    clearSession();
    return api.post('/api/auth/logout').catch(() => {});
  },

  me:            () => api.get('/api/auth/me'),
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
    return api.post(`/api/admin/import${dryRun ? '?dry_run=true' : ''}`, form, {
      headers: { 'Content-Type': undefined },
    });
  },
};

// ── Session helpers ───────────────────────────────────────────

const FALLBACK_COOKIE_OPTS_PROD = { secure: true,  sameSite: 'None', expires: 180 };
const FALLBACK_COOKIE_OPTS_DEV  = { secure: false, sameSite: 'Lax',  expires: 1   };

/**
 * Sauvegarde la session après login.
 * - nova_user     : infos d'affichage (non HttpOnly, durée selon rememberMe)
 * - nova_token_js : JWT fallback (envoyé en Bearer si HttpOnly bloqué)
 */
export const saveSession = (token, user, rememberMe) => {
  const expires = rememberMe ? 180 : 1;
  Cookies.set('nova_user', JSON.stringify(user), { expires, ...COOKIE_OPTS });

  // Fallback token : mêmes options de durée, SameSite=None en prod (cross-origin)
  const fbOpts = IS_PROD
    ? { ...FALLBACK_COOKIE_OPTS_PROD, expires: rememberMe ? 180 : 1 }
    : { ...FALLBACK_COOKIE_OPTS_DEV,  expires: rememberMe ? 180 : 1 };
  Cookies.set('nova_token_js', token, fbOpts);
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
  Cookies.remove('nova_user',     COOKIE_OPTS);
  Cookies.remove('nova_token_js', IS_PROD ? { sameSite: 'None', secure: true } : {});
};

export default api;
