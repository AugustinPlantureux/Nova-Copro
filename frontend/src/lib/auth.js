import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import { getSession, clearSession, authAPI } from './api';

const AuthContext = createContext(null);

export const AuthProvider = ({ children }) => {
  const [user, setUser]       = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Vérifier la session au chargement
  useEffect(() => {
    const session = getSession();
    if (session) {
      setUser(session.user);
    }
    setLoading(false);
  }, []);

  const login = useCallback((userData) => {
    setUser(userData);
  }, []);

  const logout = useCallback(async () => {
    try { await authAPI.logout(); } catch {}
    clearSession();
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

// HOC pour protéger les pages
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
            <p className="text-gray-500 text-sm">Chargement...</p>
          </div>
        </div>
      );
    }

    if (adminOnly && !isAdmin) return null;

    return <Component {...props} />;
  };
};
