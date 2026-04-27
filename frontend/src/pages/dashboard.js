import { useState, useEffect } from 'react';
import Head from 'next/head';
import toast from 'react-hot-toast';
import { AlertCircle, RefreshCw, FolderOpen } from 'lucide-react';
import { userAPI } from '../lib/api';
import { withAuth, useAuth } from '../lib/auth';
import Layout from '../components/Layout';
import DriveExplorer from '../components/DriveExplorer';

const FOLDER_STYLES = {
  copropriete: { bg: 'bg-blue-50 hover:bg-blue-100', border: 'border-blue-100', icon: 'bg-blue-100 text-blue-700', badge: 'bg-blue-600' },
  personnel:   { bg: 'bg-emerald-50 hover:bg-emerald-100', border: 'border-emerald-100', icon: 'bg-emerald-100 text-emerald-700', badge: 'bg-emerald-600' },
  conseil:     { bg: 'bg-amber-50 hover:bg-amber-100', border: 'border-amber-100', icon: 'bg-amber-100 text-amber-700', badge: 'bg-amber-600' },
};

function FolderCard({ folder, coproprieteId, onOpen }) {
  const styles = FOLDER_STYLES[folder.type] || FOLDER_STYLES.copropriete;

  return (
    <button
      onClick={() => onOpen(folder)}
      className={`w-full text-left ${styles.bg} border ${styles.border} rounded-xl p-4
        flex items-center gap-4 transition-all duration-200 hover:shadow-md group`}
    >
      <div className={`${styles.icon} w-11 h-11 rounded-xl flex items-center justify-center text-xl flex-shrink-0`}>
        {folder.icon}
      </div>
      <div className="flex-1 min-w-0">
        <h3 className="font-semibold text-gray-900 text-sm mb-0.5">{folder.label}</h3>
        <p className="text-xs text-gray-500 leading-relaxed">{folder.description}</p>
      </div>
      <div className="flex items-center gap-1.5 flex-shrink-0 text-xs font-semibold text-gray-400 group-hover:text-gray-600 transition-colors">
        <FolderOpen size={15} />
        <span className="hidden sm:inline">Ouvrir</span>
      </div>
    </button>
  );
}

function CoproprieteCard({ copropriete, onOpen }) {
  return (
    <div className="card">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <h2 className="text-lg font-bold text-gray-900">{copropriete.nom}</h2>
          {copropriete.adresse && (
            <p className="text-sm text-gray-500 mt-0.5">{copropriete.adresse}</p>
          )}
        </div>
        {copropriete.isConseilSyndical && (
          <span className="flex-shrink-0 bg-amber-100 text-amber-700 text-xs font-semibold px-2.5 py-1 rounded-full">
            Conseil syndical
          </span>
        )}
      </div>

      {copropriete.folders.length > 0 ? (
        <div className="space-y-3">
          {copropriete.folders.map(folder => (
            <FolderCard
              key={folder.type}
              folder={folder}
              coproprieteId={copropriete.id}
              onOpen={(f) => onOpen(copropriete.id, f)}
            />
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 text-gray-400 text-sm py-4">
          <AlertCircle size={16} />
          <span>Aucun dossier configuré pour le moment.</span>
        </div>
      )}
    </div>
  );
}

function Dashboard() {
  const { user } = useAuth();
  const [coproprietes, setCoproprietes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [explorer, setExplorer] = useState(null); // { coproprieteId, folder }

  const fetchFolders = async () => {
    setLoading(true);
    try {
      const { data } = await userAPI.getFolders();
      setCoproprietes(data.coproprietes);
    } catch {
      toast.error('Impossible de charger vos dossiers.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchFolders(); }, []);

  const totalFolders = coproprietes.reduce((acc, c) => acc + c.folders.length, 0);

  return (
    <>
      <Head><title>Mes documents — Nova Copro</title></Head>
      <Layout title="Mes documents">
        <div className="max-w-3xl mx-auto">

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-1">
              Bonjour{user?.prenom ? `, ${user.prenom}` : ''} 👋
            </h1>
            <p className="text-gray-500">
              {loading ? '…' : coproprietes.length === 0
                ? 'Aucun accès configuré pour le moment.'
                : `${coproprietes.length} copropriété${coproprietes.length > 1 ? 's' : ''} · ${totalFolders} espace${totalFolders > 1 ? 's' : ''} documentaire${totalFolders > 1 ? 's' : ''}`
              }
            </p>
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-24 gap-4">
              <div className="w-10 h-10 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
              <p className="text-gray-400 text-sm">Chargement de vos espaces documentaires…</p>
            </div>
          ) : coproprietes.length === 0 ? (
            <div className="card text-center py-16">
              <div className="text-5xl mb-4">📂</div>
              <h2 className="text-lg font-semibold text-gray-700 mb-2">Aucun accès configuré</h2>
              <p className="text-gray-400 text-sm max-w-sm mx-auto">
                Vos accès documentaires ne sont pas encore configurés.
                Contactez votre gestionnaire de copropriété.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {coproprietes.map(copro => (
                <CoproprieteCard
                  key={copro.id}
                  copropriete={copro}
                  onOpen={(coproprieteId, folder) => setExplorer({ coproprieteId, folder })}
                />
              ))}
            </div>
          )}

          {!loading && coproprietes.length > 0 && (
            <button onClick={fetchFolders}
              className="mt-6 flex items-center gap-2 text-sm text-gray-400 hover:text-gray-600 transition-colors mx-auto">
              <RefreshCw size={14} /> Actualiser
            </button>
          )}
        </div>

        {/* Explorateur Drive en modal */}
        {explorer && (
          <DriveExplorer
            coproprieteId={explorer.coproprieteId}
            type={explorer.folder.type}
            label={explorer.folder.label}
            icon={explorer.folder.icon}
            onClose={() => setExplorer(null)}
          />
        )}
      </Layout>
    </>
  );
}

export default withAuth(Dashboard);
