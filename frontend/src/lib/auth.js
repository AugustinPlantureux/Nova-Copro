import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { getSession, clearSession, authAPI } from './api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user,    setUser]    = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // ── Vérification de session au boot ──────────────────────────
  // 1. Si nova_user cookie absent → pas de session, on s'arrête là.
  // 2. Si cookie présent → valider le token côté serveur via /api/auth/me.
  //    Le cookie HttpOnly nova_token est envoyé automatiquement (withCredentials).
  // 3. Si /me réussit → utiliser les données fraîches du serveur.
  //    On ne réécrit PAS le cookie nova_token (HttpOnly, géré par le backend).
  //    On ne réécrit PAS nova_user non plus pour ne pas altérer sa durée d'expiry.
  // 4. Si /me échoue → purge nova_user ; le handler 401 redirige vers login.

  useEffect(() => {
    const verifySession = async () => {
      const session = getSession();

      if (!session) {
        setLoading(false);
        return;
      }

      try {
        const { data } = await authAPI.me();
        // Données fraîches du serveur (nom/email peuvent avoir changé)
        setUser(data.user);
      } catch {
        // Le handler 401 d'api.js s'occupe de la redirection si auth failure.
        // Ici on nettoie juste l'état local.
        clearSession();
        setUser(null);
      } finally {
        setLoading(false);
      }
    };

    verifySession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Login ─────────────────────────────────────────────────────
  const login = useCallback((userData) => {
    setUser(userData);
  }, []);

  // ── Logout ────────────────────────────────────────────────────
  const logout = useCallback(async () => {
    try { await authAPI.logout(); } catch {}
    // Le backend a effacé le cookie HttpOnly nova_token.
    clearSession(); // supprime nova_user
    setUser(null);
    router.push('/');
  }, [router]);

  const isAdmin = user?.isAdmin === true;

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, isAdmin }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans AuthProvider');
  return ctx;
};

// ── HOC pour protéger les pages ───────────────────────────────
export const withAuth = (Component, { adminOnly = false } = {}) => {
  return function ProtectedPage(props) {
    const { user, loading, isAdmin } = useAuth();
    const router = useRouter();

    useEffect(() => {
      if (!loading) {
        if (!user) {
          router.replace('/');
        } else if (adminOnly && !isAdmin) {
          router.replace('/dashboard');
        }
      }
    }, [user, loading, isAdmin, router]);

    if (loading || !user) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
            <p className="text-gray-500 text-sm">Vérification de la session…</p>
          </div>
        </div>
      );
    }

    if (adminOnly && !isAdmin) return null;

    return <Component {...props} />;
  };
};
