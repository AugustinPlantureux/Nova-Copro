import axios from 'axios';
import Cookies from 'js-cookie';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const IS_PROD = process.env.NODE_ENV === 'production';

const api = axios.create({
  baseURL: API_URL,
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

// Injecter le token JWT dans chaque requête
api.interceptors.request.use((config) => {
  const token = Cookies.get('nova_token');
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// Gérer les erreurs 401 globalement
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && typeof window !== 'undefined') {
      const code = error.response?.data?.code;
      if (code === 'TOKEN_EXPIRED' || error.response?.data?.error === 'Session invalide') {
        Cookies.remove('nova_token');
        Cookies.remove('nova_user');
        window.location.href = '/?session=expired';
      }
    }
    return Promise.reject(error);
  }
);

// ── Auth ───────────────────────────────────────────────────────
export const authAPI = {
  sendCode: (email) =>
    api.post('/api/auth/send-code', { email }),

  verifyCode: (email, code, rememberMe) =>
    api.post('/api/auth/verify-code', { email, code, rememberMe }),

  logout: () => {
    Cookies.remove('nova_token');
    Cookies.remove('nova_user');
    return api.post('/api/auth/logout');
  },

  me: () => api.get('/api/auth/me'),
};

// ── User ──────────────────────────────────────────────────────
export const userAPI = {
  getFolders: () => api.get('/api/user/folders'),
  getProfile: () => api.get('/api/user/profile'),
};

// ── Admin ─────────────────────────────────────────────────────
export const adminAPI = {
  // Stats
  getStats: () => api.get('/api/admin/stats'),

  // Copropriétés
  getCoproprietes: () => api.get('/api/admin/coproprietes'),
  getCopropriete: (id) => api.get(`/api/admin/coproprietes/${id}`),
  createCopropriete: (data) => api.post('/api/admin/coproprietes', data),
  updateCopropriete: (id, data) => api.put(`/api/admin/coproprietes/${id}`, data),
  deleteCopropriete: (id) => api.delete(`/api/admin/coproprietes/${id}`),

  // Utilisateurs
  getUsers: () => api.get('/api/admin/users'),
  getUser: (id) => api.get(`/api/admin/users/${id}`),
  createUser: (data) => api.post('/api/admin/users', data),
  updateUser: (id, data) => api.put(`/api/admin/users/${id}`, data),
  deleteUser: (id) => api.delete(`/api/admin/users/${id}`),

  // Accès
  upsertAcces: (data) => api.post('/api/admin/acces', data),
  updateAcces: (id, data) => api.put(`/api/admin/acces/${id}`, data),
  deleteAcces: (id) => api.delete(`/api/admin/acces/${id}`),
};

// ── Helpers ───────────────────────────────────────────────────
export const saveSession = (token, user, rememberMe) => {
  const expires = rememberMe ? 30 : 1;
  const cookieOptions = {
    expires,
    secure: IS_PROD,       // ✅ false en local (http), true en prod (https)
    sameSite: 'Strict',
  };
  Cookies.set('nova_token', token, cookieOptions);
  Cookies.set('nova_user', JSON.stringify(user), cookieOptions);
};

export const getSession = () => {
  const token = Cookies.get('nova_token');
  const userRaw = Cookies.get('nova_user');
  if (!token || !userRaw) return null;
  try {
    return { token, user: JSON.parse(userRaw) };
  } catch {
    return null;
  }
};

export const clearSession = () => {
  Cookies.remove('nova_token');
  Cookies.remove('nova_user');
};

export default api;