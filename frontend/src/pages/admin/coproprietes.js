import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import toast from 'react-hot-toast';
import { Plus, Edit2, Trash2, X, Save, Building2, Users, ExternalLink } from 'lucide-react';
import { adminAPI } from '../../lib/api';
import { withAuth } from '../../lib/auth';
import Layout from '../../components/Layout';

// ── Modal copropriété ────────────────────────────────────────
function CoproprieteModal({ copropriete, onClose, onSaved }) {
  const isEdit = !!copropriete;
  const [form, setForm] = useState({
    nom: copropriete?.nom || '',
    adresse: copropriete?.adresse || '',
    code_postal: copropriete?.code_postal || '',
    ville: copropriete?.ville || '',
    drive_url_base: copropriete?.drive_url_base || '',
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!form.nom.trim()) { toast.error('Le nom est requis'); return; }
    setLoading(true);
    try {
      if (isEdit) {
        await adminAPI.updateCopropriete(copropriete.id, form);
        toast.success('Copropriété modifiée.');
      } else {
        await adminAPI.createCopropriete(form);
        toast.success('Copropriété créée.');
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de l\'enregistrement.');
    } finally {
      setLoading(false);
    }
  };

  const field = (key, label, props = {}) => (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input className="input-field text-sm py-2" value={form[key]}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} {...props} />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">
            {isEdit ? 'Modifier la copropriété' : 'Nouvelle copropriété'}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {field('nom', 'Nom de la copropriété *', { placeholder: 'Résidence Les Jardins', required: true })}
          {field('adresse', 'Adresse', { placeholder: '12 rue de la Paix' })}

          <div className="grid grid-cols-2 gap-3">
            {field('code_postal', 'Code postal', { placeholder: '75001' })}
            {field('ville', 'Ville', { placeholder: 'Paris' })}
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">
              Lien Drive racine <span className="text-gray-400">(optionnel, pour référence)</span>
            </label>
            <input className="input-field text-sm py-2" value={form.drive_url_base}
              placeholder="https://drive.google.com/drive/folders/…"
              onChange={e => setForm(f => ({ ...f, drive_url_base: e.target.value }))} />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1 py-2 text-sm">Annuler</button>
            <button type="submit" disabled={loading}
              className="btn-primary flex-1 py-2 text-sm flex items-center justify-center gap-2">
              {loading
                ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <><Save size={15} /><span>Enregistrer</span></>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Détail copropriété (slide panel) ─────────────────────────
function DetailPanel({ coproprieteId, onClose, onOpenUser }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const { data: d } = await adminAPI.getCopropriete(coproprieteId);
        setData(d);
      } catch { toast.error('Erreur de chargement.'); }
      finally { setLoading(false); }
    })();
  }, [coproprieteId]);

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-white shadow-2xl flex flex-col h-full overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 sticky top-0 bg-white z-10">
          <h2 className="font-bold text-gray-900 text-base">Détail copropriété</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500">
            <X size={18} />
          </button>
        </div>

        {loading ? (
          <div className="p-8 text-center text-gray-400 text-sm">Chargement…</div>
        ) : !data ? null : (
          <div className="p-5 flex-1">
            <div className="mb-5">
              <h3 className="text-lg font-bold text-gray-900 mb-1">{data.copropriete.nom}</h3>
              {data.copropriete.adresse && (
                <p className="text-sm text-gray-500">
                  {[data.copropriete.adresse, data.copropriete.code_postal, data.copropriete.ville].filter(Boolean).join(' ')}
                </p>
              )}
              {data.copropriete.drive_url_base && (
                <a href={data.copropriete.drive_url_base} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-700 mt-2 transition-colors">
                  <ExternalLink size={12} />
                  Ouvrir le dossier Drive racine
                </a>
              )}
            </div>

            <h4 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Users size={15} />
              Copropriétaires ({data.users.length})
            </h4>

            {data.users.length === 0 ? (
              <p className="text-sm text-gray-400">Aucun copropriétaire configuré.</p>
            ) : (
              <div className="space-y-2">
                {data.users.map(u => (
                  <div key={u.id} className="p-3 bg-gray-50 rounded-xl">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-sm font-medium text-gray-900">
                        {[u.prenom, u.nom].filter(Boolean).join(' ') || u.email}
                      </p>
                      {u.is_conseil_syndical && (
                        <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                          Conseil
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mb-1.5">{u.email}</p>
                    <div className="flex flex-wrap gap-1">
                      {u.drive_url_copropriete && (
                        <a href={u.drive_url_copropriete} target="_blank" rel="noopener noreferrer"
                          className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full flex items-center gap-1 hover:bg-blue-200 transition-colors">
                          🏢 Copro <ExternalLink size={10} />
                        </a>
                      )}
                      {u.drive_url_personnel && (
                        <a href={u.drive_url_personnel} target="_blank" rel="noopener noreferrer"
                          className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full flex items-center gap-1 hover:bg-emerald-200 transition-colors">
                          📄 Perso <ExternalLink size={10} />
                        </a>
                      )}
                      {u.is_conseil_syndical && u.drive_url_conseil && (
                        <a href={u.drive_url_conseil} target="_blank" rel="noopener noreferrer"
                          className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full flex items-center gap-1 hover:bg-amber-200 transition-colors">
                          🔒 Conseil <ExternalLink size={10} />
                        </a>
                      )}
                    </div>
                    {u.notes && <p className="text-xs text-gray-400 mt-1.5 italic">{u.notes}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Page principale ──────────────────────────────────────────
function AdminCoproprietes() {
  const [coproprietes, setCoproprietes] = useState([]);
  const [loading, setLoading]           = useState(true);
  const [modal, setModal]               = useState(null);
  const [detail, setDetail]             = useState(null);

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const { data } = await adminAPI.getCoproprietes();
      setCoproprietes(data.coproprietes);
    } catch { toast.error('Erreur de chargement.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const handleDelete = async (id, nom) => {
    if (!confirm(`Supprimer "${nom}" et tous ses accès ?`)) return;
    try {
      await adminAPI.deleteCopropriete(id);
      toast.success('Copropriété supprimée.');
      fetch();
    } catch { toast.error('Erreur lors de la suppression.'); }
  };

  return (
    <>
      <Head><title>Copropriétés — Nova Copro Admin</title></Head>
      <Layout title="Gestion des copropriétés">
        <div className="max-w-4xl mx-auto">

          <div className="flex items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Copropriétés</h1>
              <p className="text-sm text-gray-500">{coproprietes.length} immeuble{coproprietes.length > 1 ? 's' : ''} configuré{coproprietes.length > 1 ? 's' : ''}</p>
            </div>
            <button onClick={() => setModal({ type: 'create' })} className="btn-primary flex items-center gap-2 py-2.5 px-5">
              <Plus size={16} />
              <span className="hidden sm:inline">Ajouter</span>
            </button>
          </div>

          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[1,2,3].map(i => (
                <div key={i} className="card animate-pulse">
                  <div className="h-5 bg-gray-100 rounded w-2/3 mb-3" />
                  <div className="h-4 bg-gray-100 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : coproprietes.length === 0 ? (
            <div className="card text-center py-16">
              <Building2 size={40} className="text-gray-200 mx-auto mb-4" />
              <h2 className="text-lg font-semibold text-gray-600 mb-2">Aucune copropriété</h2>
              <p className="text-sm text-gray-400 mb-6">Commencez par ajouter votre premier immeuble.</p>
              <button onClick={() => setModal({ type: 'create' })} className="btn-primary inline-flex items-center gap-2">
                <Plus size={16} /> Ajouter une copropriété
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {coproprietes.map(copro => (
                <div key={copro.id}
                  className="card hover:shadow-md transition-all duration-200 cursor-pointer group"
                  onClick={() => setDetail(copro.id)}>
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center text-xl flex-shrink-0">
                        🏢
                      </div>
                      <div className="min-w-0">
                        <h2 className="font-bold text-gray-900 group-hover:text-brand-700 transition-colors truncate">
                          {copro.nom}
                        </h2>
                        {copro.ville && (
                          <p className="text-xs text-gray-400 truncate">
                            {[copro.code_postal, copro.ville].filter(Boolean).join(' ')}
                          </p>
                        )}
                      </div>
                    </div>
                    {/* Actions */}
                    <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                      onClick={e => e.stopPropagation()}>
                      <button onClick={() => setModal({ type: 'edit', copropriete: copro })}
                        className="p-1.5 hover:bg-blue-50 text-gray-400 hover:text-blue-600 rounded-lg transition-colors">
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => handleDelete(copro.id, copro.nom)}
                        className="p-1.5 hover:bg-red-50 text-gray-400 hover:text-red-600 rounded-lg transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>

                  <div className="flex items-center gap-4 text-xs text-gray-400">
                    <span className="flex items-center gap-1">
                      <Users size={12} />
                      {copro.nb_utilisateurs} copropriétaire{copro.nb_utilisateurs > 1 ? 's' : ''}
                    </span>
                    {copro.drive_url_base && (
                      <a href={copro.drive_url_base} target="_blank" rel="noopener noreferrer"
                        onClick={e => e.stopPropagation()}
                        className="flex items-center gap-1 text-brand-500 hover:text-brand-700 transition-colors">
                        <ExternalLink size={11} /> Drive
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {modal && (
          <CoproprieteModal
            copropriete={modal.copropriete}
            onClose={() => setModal(null)}
            onSaved={fetch}
          />
        )}

        {detail && (
          <DetailPanel
            coproprieteId={detail}
            onClose={() => setDetail(null)}
          />
        )}
      </Layout>
    </>
  );
}

export default withAuth(AdminCoproprietes, { adminOnly: true });
