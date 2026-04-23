import { useState, useEffect } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import toast from 'react-hot-toast';
import { Users, Building2, FolderKey, Clock, ArrowRight } from 'lucide-react';
import { adminAPI } from '../../lib/api';
import { withAuth, useAuth } from '../../lib/auth';
import Layout from '../../components/Layout';

const StatCard = ({ icon: Icon, label, value, color, href }) => (
  <Link href={href || '#'} className="card hover:shadow-md transition-all duration-200 group cursor-pointer">
    <div className="flex items-center justify-between mb-3">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${color}`}>
        <Icon size={20} />
      </div>
      {href && (
        <ArrowRight size={16} className="text-gray-300 group-hover:text-brand-500 transition-colors" />
      )}
    </div>
    <div className="text-3xl font-bold text-gray-900 mb-1">{value ?? '—'}</div>
    <div className="text-sm text-gray-500">{label}</div>
  </Link>
);

function AdminPage() {
  const { user } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const { data } = await adminAPI.getStats();
        setStats(data.stats);
      } catch {
        toast.error('Impossible de charger les statistiques.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('fr-FR', {
      day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  return (
    <>
      <Head><title>Administration — Nova Copro</title></Head>
      <Layout title="Tableau de bord administration">
        <div className="max-w-5xl mx-auto">

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-1">Administration</h1>
            <p className="text-gray-500">Bienvenue {user?.prenom}. Gérez ici les accès et les copropriétés.</p>
          </div>

          {/* Stats */}
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
              {[1, 2, 3].map(i => (
                <div key={i} className="card animate-pulse">
                  <div className="w-11 h-11 bg-gray-100 rounded-xl mb-3" />
                  <div className="h-8 bg-gray-100 rounded w-16 mb-2" />
                  <div className="h-4 bg-gray-100 rounded w-24" />
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
              <StatCard
                icon={Users}
                label="Utilisateurs actifs"
                value={stats?.nb_utilisateurs}
                color="bg-blue-100 text-blue-700"
                href="/admin/users"
              />
              <StatCard
                icon={Building2}
                label="Copropriétés"
                value={stats?.nb_coproprietes}
                color="bg-emerald-100 text-emerald-700"
                href="/admin/coproprietes"
              />
              <StatCard
                icon={FolderKey}
                label="Accès configurés"
                value={stats?.nb_acces}
                color="bg-amber-100 text-amber-700"
              />
            </div>
          )}

          {/* Accès rapides */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
            <Link href="/admin/users" className="card hover:shadow-md transition-all group flex items-center gap-4">
              <div className="w-12 h-12 bg-brand-50 rounded-xl flex items-center justify-center text-brand-600 text-2xl">
                👤
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 group-hover:text-brand-700 transition-colors">
                  Gérer les utilisateurs
                </h3>
                <p className="text-sm text-gray-500">Ajouter, modifier, supprimer des accès</p>
              </div>
              <ArrowRight size={18} className="text-gray-300 group-hover:text-brand-500 transition-colors" />
            </Link>

            <Link href="/admin/coproprietes" className="card hover:shadow-md transition-all group flex items-center gap-4">
              <div className="w-12 h-12 bg-emerald-50 rounded-xl flex items-center justify-center text-2xl">
                🏢
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 group-hover:text-emerald-700 transition-colors">
                  Gérer les copropriétés
                </h3>
                <p className="text-sm text-gray-500">Configurer les dossiers Drive par immeuble</p>
              </div>
              <ArrowRight size={18} className="text-gray-300 group-hover:text-emerald-500 transition-colors" />
            </Link>
          </div>

          {/* Dernières connexions */}
          <div className="card">
            <h2 className="text-base font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <Clock size={18} className="text-gray-400" />
              Dernières connexions
            </h2>
            {loading ? (
              <div className="space-y-3">
                {[1,2,3].map(i => (
                  <div key={i} className="h-10 bg-gray-100 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : stats?.recent_logins?.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">Aucune connexion enregistrée.</p>
            ) : (
              <div className="divide-y divide-gray-50">
                {stats?.recent_logins?.map((item, i) => (
                  <div key={i} className="py-3 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                        {[item.prenom?.[0], item.nom?.[0]].filter(Boolean).join('') || '?'}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">
                          {[item.prenom, item.nom].filter(Boolean).join(' ') || item.email}
                        </p>
                        <p className="text-xs text-gray-400">{item.email}</p>
                      </div>
                    </div>
                    <p className="text-xs text-gray-400 flex-shrink-0">{formatDate(item.last_login)}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Layout>
    </>
  );
}

export default withAuth(AdminPage, { adminOnly: true });
