import { useState, useEffect, useCallback } from 'react';
import Head from 'next/head';
import toast from 'react-hot-toast';
import { Plus, Search, Edit2, Trash2, X, Save } from 'lucide-react';
import { adminAPI } from '../../lib/api';
import { withAuth } from '../../lib/auth';
import Layout from '../../components/Layout';

// ── Modal créer/modifier utilisateur ────────────────────────
function UserModal({ user, coproprietes, onClose, onSaved }) {
  const isEdit = !!user;
  const [form, setForm] = useState({
    email: user?.email || '',
    nom: user?.nom || '',
    prenom: user?.prenom || '',
    is_admin: user?.is_admin || false,
    is_active: user?.is_active ?? true,
  });
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      if (isEdit) {
        await adminAPI.updateUser(user.id, form);
        toast.success('Utilisateur modifié.');
      } else {
        await adminAPI.createUser(form);
        toast.success('Utilisateur créé.');
      }
      onSaved();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de l\'enregistrement.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
        <div className="flex items-center justify-between p-6 border-b border-gray-100">
          <h2 className="text-lg font-bold text-gray-900">
            {isEdit ? 'Modifier l\'utilisateur' : 'Nouvel utilisateur'}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500">
            <X size={18} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Prénom</label>
              <input className="input-field text-sm py-2" value={form.prenom}
                onChange={e => setForm(f => ({ ...f, prenom: e.target.value }))} placeholder="Jean" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Nom</label>
              <input className="input-field text-sm py-2" value={form.nom}
                onChange={e => setForm(f => ({ ...f, nom: e.target.value }))} placeholder="Dupont" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Email *</label>
            <input type="email" className="input-field text-sm py-2" value={form.email} required
              onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="jean.dupont@email.com" disabled={isEdit} />
          </div>

          <div className="flex items-center justify-between py-2">
            <div>
              <p className="text-sm font-medium text-gray-700">Administrateur</p>
              <p className="text-xs text-gray-400">Accès au back-office</p>
            </div>
            <button type="button" onClick={() => setForm(f => ({ ...f, is_admin: !f.is_admin }))}
              className={`w-11 h-6 rounded-full transition-colors ${form.is_admin ? 'bg-brand-600' : 'bg-gray-200'}`}>
              <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform mx-0.5 
                ${form.is_admin ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>

          {isEdit && (
            <div className="flex items-center justify-between py-2">
              <div>
                <p className="text-sm font-medium text-gray-700">Compte actif</p>
                <p className="text-xs text-gray-400">Peut se connecter</p>
              </div>
              <button type="button" onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}
                className={`w-11 h-6 rounded-full transition-colors ${form.is_active ? 'bg-emerald-500' : 'bg-gray-200'}`}>
                <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform mx-0.5 
                  ${form.is_active ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-secondary flex-1 py-2 text-sm">Annuler</button>
            <button type="submit" disabled={loading} className="btn-primary flex-1 py-2 text-sm flex items-center justify-center gap-2">
              {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                : <><Save size={15} /><span>Enregistrer</span></>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Modal accès par copropriété ──────────────────────────────
function AccesModal({ user, userAcces, coproprietes, onClose, onSaved }) {
  const [form, setForm] = useState({
    copropriete_id: '',
    drive_url_copropriete: '',
    drive_url_personnel: '',
    drive_url_conseil: '',
    is_conseil_syndical: false,
    notes: '',
  });
  const [loading, setLoading] = useState(false);
  const [editingId, setEditingId] = useState(null);

  const startEdit = (acces) => {
    setEditingId(acces.id);
    setForm({
      copropriete_id: acces.copropriete_id,
      drive_url_copropriete: acces.drive_url_copropriete || '',
      drive_url_personnel: acces.drive_url_personnel || '',
      drive_url_conseil: acces.drive_url_conseil || '',
      is_conseil_syndical: acces.is_conseil_syndical || false,
      notes: acces.notes || '',
    });
  };

  const handleSaveAcces = async (e) => {
    e.preventDefault();
    if (!form.copropriete_id) { toast.error('Sélectionnez une copropriété'); return; }
    setLoading(true);
    try {
      if (editingId) {
        await adminAPI.updateAcces(editingId, form);
      } else {
        await adminAPI.upsertAcces({ ...form, user_id: user.id });
      }
      toast.success('Accès enregistré.');
      onSaved();
      setEditingId(null);
      setForm({ copropriete_id: '', drive_url_copropriete: '', drive_url_personnel: '',
                 drive_url_conseil: '', is_conseil_syndical: false, notes: '' });
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur.');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Supprimer cet accès ?')) return;
    try {
      await adminAPI.deleteAcces(id);
      toast.success('Accès supprimé.');
      onSaved();
    } catch {
      toast.error('Erreur lors de la suppression.');
    }
  };

  const availableCopros = coproprietes.filter(
    c => !userAcces.some(a => a.copropriete_id === c.id) || c.id === form.copropriete_id
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-6 border-b border-gray-100 sticky top-0 bg-white">
          <div>
            <h2 className="text-lg font-bold text-gray-900">Accès de {user.prenom} {user.nom}</h2>
            <p className="text-sm text-gray-400">{user.email}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-500">
            <X size={18} />
          </button>
        </div>

        <div className="p-6">
          {/* Accès existants */}
          {userAcces.length > 0 && (
            <div className="mb-6">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">Accès configurés</h3>
              <div className="space-y-2">
                {userAcces.map(acces => (
                  <div key={acces.id} className="flex items-center justify-between gap-3 p-3 bg-gray-50 rounded-xl">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{acces.copropriete_nom}</p>
                      <p className="text-xs text-gray-400">
                        {[acces.drive_url_copropriete && '📁 Copro',
                          acces.drive_url_personnel && '📄 Personnel',
                          acces.is_conseil_syndical && acces.drive_url_conseil && '🔒 Conseil'
                        ].filter(Boolean).join(' · ') || 'Aucun dossier'}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => startEdit(acces)}
                        className="p-1.5 hover:bg-blue-100 text-gray-400 hover:text-blue-600 rounded-lg transition-colors">
                        <Edit2 size={14} />
                      </button>
                      <button onClick={() => handleDelete(acces.id)}
                        className="p-1.5 hover:bg-red-100 text-gray-400 hover:text-red-600 rounded-lg transition-colors">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Formulaire ajout/modif accès */}
          <h3 className="text-sm font-semibold text-gray-700 mb-3">
            {editingId ? 'Modifier l\'accès' : '+ Ajouter un accès'}
          </h3>
          <form onSubmit={handleSaveAcces} className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Copropriété *</label>
              <select className="input-field text-sm py-2" value={form.copropriete_id}
                onChange={e => setForm(f => ({ ...f, copropriete_id: e.target.value }))}
                disabled={!!editingId}>
                <option value="">Sélectionner…</option>
                {availableCopros.map(c => (
                  <option key={c.id} value={c.id}>{c.nom}</option>
                ))}
              </select>
            </div>

            {[
              { key: 'drive_url_copropriete', label: '🏢 Lien Drive — Copropriété', placeholder: 'https://drive.google.com/drive/folders/…' },
              { key: 'drive_url_personnel',   label: '📄 Lien Drive — Personnel',   placeholder: 'https://drive.google.com/drive/folders/…' },
            ].map(({ key, label, placeholder }) => (
              <div key={key}>
                <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
                <input className="input-field text-sm py-2" value={form[key]} placeholder={placeholder}
                  onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))} />
              </div>
            ))}

            <div className="flex items-center justify-between py-1">
              <p className="text-sm text-gray-700">Membre du conseil syndical</p>
              <button type="button" onClick={() => setForm(f => ({ ...f, is_conseil_syndical: !f.is_conseil_syndical }))}
                className={`w-11 h-6 rounded-full transition-colors ${form.is_conseil_syndical ? 'bg-amber-500' : 'bg-gray-200'}`}>
                <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform mx-0.5 
                  ${form.is_conseil_syndical ? 'translate-x-5' : 'translate-x-0'}`} />
              </button>
            </div>

            {form.is_conseil_syndical && (
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">🔒 Lien Drive — Conseil syndical</label>
                <input className="input-field text-sm py-2" value={form.drive_url_conseil}
                  placeholder="https://drive.google.com/drive/folders/…"
                  onChange={e => setForm(f => ({ ...f, drive_url_conseil: e.target.value }))} />
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Notes internes</label>
              <input className="input-field text-sm py-2" value={form.notes} placeholder="Lot 12 - Propriétaire depuis 2021"
                onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} />
            </div>

            <div className="flex gap-3 pt-2">
              {editingId && (
                <button type="button" onClick={() => { setEditingId(null); setForm({ copropriete_id: '', drive_url_copropriete: '', drive_url_personnel: '', drive_url_conseil: '', is_conseil_syndical: false, notes: '' }); }}
                  className="btn-secondary flex-1 py-2 text-sm">Annuler</button>
              )}
              <button type="submit" disabled={loading}
                className="btn-primary flex-1 py-2 text-sm flex items-center justify-center gap-2">
                {loading ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <><Save size={15} /><span>{editingId ? 'Modifier' : 'Ajouter'}</span></>}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

// ── Page principale ──────────────────────────────────────────
function AdminUsers() {
  const [users, setUsers]             = useState([]);
  const [coproprietes, setCoproprietes] = useState([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [modal, setModal]             = useState(null); // null | { type, user? }
  const [accesModal, setAccesModal]   = useState(null); // null | { user, acces }

  const fetch = useCallback(async () => {
    setLoading(true);
    try {
      const [u, c] = await Promise.all([adminAPI.getUsers(), adminAPI.getCoproprietes()]);
      setUsers(u.data.users);
      setCoproprietes(c.data.coproprietes);
    } catch { toast.error('Erreur de chargement.'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetch(); }, [fetch]);

  const openAcces = async (user) => {
    const { data } = await adminAPI.getUser(user.id);
    setAccesModal({ user, acces: data.acces });
  };

  const handleDelete = async (id) => {
    if (!confirm('Supprimer cet utilisateur ?')) return;
    try {
      await adminAPI.deleteUser(id);
      toast.success('Utilisateur supprimé.');
      fetch();
    } catch { toast.error('Erreur lors de la suppression.'); }
  };

  const filtered = users.filter(u =>
    [u.email, u.nom, u.prenom].some(v => v?.toLowerCase().includes(search.toLowerCase()))
  );

  return (
    <>
      <Head><title>Utilisateurs — Nova Copro Admin</title></Head>
      <Layout title="Gestion des utilisateurs">
        <div className="max-w-5xl mx-auto">

          {/* Header */}
          <div className="flex items-center justify-between gap-4 mb-6">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Utilisateurs</h1>
              <p className="text-sm text-gray-500">{users.length} utilisateur{users.length > 1 ? 's' : ''} enregistré{users.length > 1 ? 's' : ''}</p>
            </div>
            <button onClick={() => setModal({ type: 'create' })} className="btn-primary flex items-center gap-2 py-2.5 px-5">
              <Plus size={16} />
              <span className="hidden sm:inline">Ajouter</span>
            </button>
          </div>

          {/* Search */}
          <div className="relative mb-4">
            <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input className="input-field pl-10 py-2.5 text-sm" placeholder="Rechercher par nom ou email…"
              value={search} onChange={e => setSearch(e.target.value)} />
          </div>

          {/* Table */}
          <div className="card p-0 overflow-hidden">
            {loading ? (
              <div className="p-8 text-center text-gray-400 text-sm">Chargement…</div>
            ) : filtered.length === 0 ? (
              <div className="p-8 text-center text-gray-400 text-sm">Aucun utilisateur trouvé.</div>
            ) : (
              <div className="divide-y divide-gray-50">
                {filtered.map(user => (
                  <div key={user.id} className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50/60 transition-colors">
                    {/* Avatar */}
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0
                      ${user.is_active ? 'bg-brand-100 text-brand-700' : 'bg-gray-100 text-gray-400'}`}>
                      {[user.prenom?.[0], user.nom?.[0]].filter(Boolean).join('') || '?'}
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-semibold text-gray-900 truncate">
                          {[user.prenom, user.nom].filter(Boolean).join(' ') || '—'}
                        </p>
                        {user.is_admin && (
                          <span className="bg-brand-100 text-brand-700 text-xs font-medium px-2 py-0.5 rounded-full">Admin</span>
                        )}
                        {!user.is_active && (
                          <span className="bg-red-100 text-red-600 text-xs font-medium px-2 py-0.5 rounded-full">Inactif</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 truncate">{user.email}</p>
                      {user.coproprietes_noms?.length > 0 && (
                        <p className="text-xs text-gray-400 mt-0.5">
                          {user.nb_coproprietes} copropriété{user.nb_coproprietes > 1 ? 's' : ''}
                        </p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={() => openAcces(user)} title="Gérer les accès"
                        className="p-2 hover:bg-amber-50 text-gray-400 hover:text-amber-600 rounded-lg transition-colors">
                        <FolderKey size={15} />
                      </button>
                      <button onClick={() => setModal({ type: 'edit', user })} title="Modifier"
                        className="p-2 hover:bg-blue-50 text-gray-400 hover:text-blue-600 rounded-lg transition-colors">
                        <Edit2 size={15} />
                      </button>
                      <button onClick={() => handleDelete(user.id)} title="Supprimer"
                        className="p-2 hover:bg-red-50 text-gray-400 hover:text-red-600 rounded-lg transition-colors">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Modals */}
        {modal && (
          <UserModal
            user={modal.user}
            coproprietes={coproprietes}
            onClose={() => setModal(null)}
            onSaved={fetch}
          />
        )}
        {accesModal && (
          <AccesModal
            user={accesModal.user}
            userAcces={accesModal.acces}
            coproprietes={coproprietes}
            onClose={() => setAccesModal(null)}
            onSaved={async () => {
              const { data } = await adminAPI.getUser(accesModal.user.id);
              setAccesModal(prev => ({ ...prev, acces: data.acces }));
              fetch();
            }}
          />
        )}
      </Layout>
    </>
  );
}

// Icône manquante dans les imports
function FolderKey({ size, className }) {
  return <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none"
    stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M10 20H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H20a2 2 0 0 1 2 2v2"/>
    <circle cx="16" cy="20" r="2"/><path d="m22 14-4.5 4.5"/><path d="M20 22v.01"/>
  </svg>;
}

export default withAuth(AdminUsers, { adminOnly: true });
