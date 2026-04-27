import { useState, useEffect } from 'react';
import Head from 'next/head';
import { Search, RefreshCw, Shield, Filter } from 'lucide-react';
import { withAuth } from '../../lib/auth';
import Layout from '../../components/Layout';
import { adminAPI } from '../../lib/api';

const ACTION_LABELS = {
  'user.create':       'Utilisateur créé',
  'user.update':       'Utilisateur modifié',
  'user.delete':       'Utilisateur supprimé',
  'copropriete.create':'Copropriété créée',
  'copropriete.update':'Copropriété modifiée',
  'copropriete.delete':'Copropriété supprimée',
  'acces.upsert':      'Accès créé/modifié',
  'acces.update':      'Accès modifié',
  'acces.delete':      'Accès supprimé',
  'import':            'Import Excel',
};

const ACTION_COLORS = {
  'user.create':       'bg-blue-100 text-blue-700',
  'user.update':       'bg-blue-50 text-blue-600',
  'user.delete':       'bg-red-100 text-red-700',
  'copropriete.create':'bg-emerald-100 text-emerald-700',
  'copropriete.update':'bg-emerald-50 text-emerald-600',
  'copropriete.delete':'bg-red-100 text-red-700',
  'acces.upsert':      'bg-purple-100 text-purple-700',
  'acces.update':      'bg-purple-50 text-purple-600',
  'acces.delete':      'bg-red-100 text-red-700',
  'import':            'bg-amber-100 text-amber-700',
};

function AdminAudit() {
  const [logs,    setLogs]    = useState([]);
  const [total,   setTotal]   = useState(0);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ action: '', since: '', until: '' });
  const [page,    setPage]    = useState(0);
  const LIMIT = 50;

  const fetchLogs = async (f = filters, p = page) => {
    setLoading(true);
    try {
      const params = { limit: LIMIT, offset: p * LIMIT };
      if (f.action) params.action = f.action;
      if (f.since)  params.since  = f.since;
      if (f.until)  params.until  = f.until + 'T23:59:59';
      const { data } = await adminAPI.getAuditLog(params);
      setLogs(data.logs);
      setTotal(data.total);
    } catch {
      // silencieux
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchLogs(); }, []); // eslint-disable-line

  const applyFilters = () => { setPage(0); fetchLogs(filters, 0); };
  const resetFilters = () => {
    const empty = { action: '', since: '', until: '' };
    setFilters(empty);
    setPage(0);
    fetchLogs(empty, 0);
  };

  const formatDate = (d) => new Date(d).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });

  const totalPages = Math.ceil(total / LIMIT);

  return (
    <>
      <Head><title>Journal d'audit — Nova Copro Admin</title></Head>
      <Layout title="Journal d'audit">
        <div className="max-w-5xl mx-auto">

          <div className="mb-6 flex items-center justify-between flex-wrap gap-3">
            <div>
              <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <Shield size={22} className="text-brand-600" /> Journal d'audit
              </h1>
              <p className="text-gray-500 text-sm mt-0.5">
                {total} opération{total !== 1 ? 's' : ''} enregistrée{total !== 1 ? 's' : ''}
              </p>
            </div>
            <button onClick={() => fetchLogs()} disabled={loading}
              className="btn-secondary inline-flex items-center gap-2 py-2 px-4 text-sm">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Actualiser
            </button>
          </div>

          {/* Filtres */}
          <div className="card mb-4">
            <div className="flex items-center gap-2 mb-3 text-sm font-medium text-gray-700">
              <Filter size={14} /> Filtres
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Type d'action</label>
                <select
                  value={filters.action}
                  onChange={(e) => setFilters(f => ({ ...f, action: e.target.value }))}
                  className="input-field text-sm"
                >
                  <option value="">Toutes les actions</option>
                  {Object.entries(ACTION_LABELS).map(([k, v]) => (
                    <option key={k} value={k}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">À partir du</label>
                <input type="date" value={filters.since}
                  onChange={(e) => setFilters(f => ({ ...f, since: e.target.value }))}
                  className="input-field text-sm" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Jusqu'au</label>
                <input type="date" value={filters.until}
                  onChange={(e) => setFilters(f => ({ ...f, until: e.target.value }))}
                  className="input-field text-sm" />
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <button onClick={applyFilters}
                className="btn-primary py-1.5 px-4 text-sm inline-flex items-center gap-2">
                <Search size={13} /> Filtrer
              </button>
              <button onClick={resetFilters} className="btn-secondary py-1.5 px-4 text-sm">
                Réinitialiser
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="card overflow-hidden p-0">
            {loading ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-8 h-8 border-4 border-brand-600 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : logs.length === 0 ? (
              <div className="text-center py-16 text-gray-400">
                <Shield size={32} className="mx-auto mb-2 opacity-30" />
                <p className="text-sm">Aucune opération trouvée</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 bg-gray-50">
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Date</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Action</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Admin</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Détail</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">IP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {logs.map(log => (
                      <tr key={log.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap font-mono">
                          {formatDate(log.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ACTION_COLORS[log.action] || 'bg-gray-100 text-gray-600'}`}>
                            {ACTION_LABELS[log.action] || log.action}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-700">
                          {log.admin?.prenom || ''} {log.admin?.nom || ''}
                          {log.admin?.email && (
                            <div className="text-gray-400">{log.admin.email}</div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500 max-w-xs">
                          {log.detail && (
                            <span className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded truncate block max-w-xs" title={JSON.stringify(log.detail)}>
                              {JSON.stringify(log.detail)}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-400 font-mono">
                          {log.ip_address || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between mt-4">
              <p className="text-sm text-gray-500">
                Page {page + 1} / {totalPages} · {total} résultats
              </p>
              <div className="flex gap-2">
                <button disabled={page === 0}
                  onClick={() => { const p = page - 1; setPage(p); fetchLogs(filters, p); }}
                  className="btn-secondary py-1.5 px-4 text-sm disabled:opacity-40">
                  Précédent
                </button>
                <button disabled={page >= totalPages - 1}
                  onClick={() => { const p = page + 1; setPage(p); fetchLogs(filters, p); }}
                  className="btn-secondary py-1.5 px-4 text-sm disabled:opacity-40">
                  Suivant
                </button>
              </div>
            </div>
          )}
        </div>
      </Layout>
    </>
  );
}

export default withAuth(AdminAudit, { adminOnly: true });
