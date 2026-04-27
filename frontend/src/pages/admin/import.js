import { useState, useRef } from 'react';
import Head from 'next/head';
import toast from 'react-hot-toast';
import {
  Upload, Download, CheckCircle, XCircle, AlertTriangle,
  FileSpreadsheet, Eye, Play, AlertCircle,
} from 'lucide-react';
import { withAuth } from '../../lib/auth';
import Layout from '../../components/Layout';
import { importAPI } from '../../lib/api';

function StatusBadge({ status }) {
  if (status === 'ok') return (
    <span className="inline-flex items-center gap-1 text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full font-medium">
      <CheckCircle size={11} /> OK
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1 text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded-full font-medium">
      <XCircle size={11} /> Erreur
    </span>
  );
}

function AdminImport() {
  const [file,    setFile]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [report,  setReport]  = useState(null);
  const fileRef = useRef();

  const handleDownloadTemplate = async () => {
    try {
      const { data } = await importAPI.getTemplate();
      const url = window.URL.createObjectURL(data);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'nova-copro-modele-import.xlsx';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      toast.error('Erreur lors du téléchargement du modèle.');
    }
  };

  const runImport = async (dryRun) => {
    if (!file) { toast.error('Sélectionnez un fichier Excel'); return; }
    setLoading(true);
    setReport(null);
    try {
      const { data } = await importAPI.upload(file, dryRun);
      setReport(data.report);
      if (dryRun) {
        toast('Simulation terminée — aucune donnée modifiée.', { icon: '🔍' });
      } else if (data.report.errors.length === 0) {
        toast.success(`Import terminé : ${data.report.total} ligne(s) traitée(s)`);
      } else {
        toast(`Import terminé avec ${data.report.errors.length} erreur(s)`, { icon: '⚠️' });
      }
    } catch (err) {
      toast.error(err.response?.data?.error || 'Erreur lors de l\'import.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Head><title>Import Excel — Nova Copro Admin</title></Head>
      <Layout title="Import Excel">
        <div className="max-w-3xl mx-auto">

          <div className="mb-8">
            <h1 className="text-2xl font-bold text-gray-900 mb-1">Import depuis Excel</h1>
            <p className="text-gray-500">
              Importez utilisateurs, copropriétés et accès depuis un fichier Excel.
              Utilisez d'abord <strong>Simuler</strong> pour vérifier le résultat avant d'écrire.
            </p>
          </div>

          {/* Étape 1 : Modèle */}
          <div className="card mb-4">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-emerald-50 rounded-xl flex items-center justify-center text-emerald-600 flex-shrink-0 text-lg font-bold">1</div>
              <div className="flex-1">
                <h2 className="font-semibold text-gray-900 mb-1">Télécharger le modèle</h2>
                <p className="text-sm text-gray-500 mb-3">
                  Remplissez le fichier Excel. Une ligne = un accès (un utilisateur dans une copropriété).
                </p>
                <button onClick={handleDownloadTemplate}
                  className="btn-secondary inline-flex items-center gap-2 py-2 px-4 text-sm">
                  <Download size={15} /> Télécharger le modèle .xlsx
                </button>
              </div>
            </div>
          </div>

          {/* Colonnes attendues */}
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 mb-4 overflow-x-auto">
            <p className="text-xs font-semibold text-gray-600 mb-2 uppercase tracking-wide">Colonnes attendues</p>
            <div className="flex gap-2 flex-wrap">
              {[
                { col: 'email', required: true },
                { col: 'nom', required: false },
                { col: 'prenom', required: false },
                { col: 'copropriete_nom', required: true },
                { col: 'adresse_copropriete', required: false },
                { col: 'code_postal', required: false },
                { col: 'ville', required: false },
                { col: 'drive_url_copropriete', required: false },
                { col: 'drive_url_personnel', required: false },
                { col: 'drive_url_conseil', required: false },
                { col: 'is_conseil_syndical', required: false },
              ].map(({ col, required }) => (
                <span key={col}
                  className={`text-xs px-2 py-1 rounded-lg font-mono ${required ? 'bg-brand-100 text-brand-700 font-semibold' : 'bg-gray-100 text-gray-600'}`}>
                  {col}{required ? ' *' : ''}
                </span>
              ))}
            </div>
            <p className="text-xs text-gray-400 mt-2">
              * Requis · Cellule Drive vide = conserver l'URL existante · is_conseil_syndical : "oui" ou "non"
            </p>
            <p className="text-xs text-amber-600 mt-1">
              ⚠️ Les URLs Drive ne sont pas vérifiées lors de l'import — tester les accès manuellement ou lancer <code className="font-mono">npm run drive:sync:dry</code> après import.
            </p>
          </div>

          {/* Étape 2 : Upload + actions */}
          <div className="card mb-4">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 bg-brand-50 rounded-xl flex items-center justify-center text-brand-600 flex-shrink-0 text-lg font-bold">2</div>
              <div className="flex-1">
                <h2 className="font-semibold text-gray-900 mb-1">Choisir un fichier</h2>

                <div
                  onClick={() => fileRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) setFile(f); }}
                  className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors mb-3
                    ${file ? 'border-brand-400 bg-brand-50' : 'border-gray-200 hover:border-brand-300 hover:bg-gray-50'}`}
                >
                  <input ref={fileRef} type="file" accept=".xlsx" className="hidden"
                    onChange={(e) => setFile(e.target.files[0])} />
                  {file ? (
                    <div className="flex items-center justify-center gap-3">
                      <FileSpreadsheet size={24} className="text-brand-600" />
                      <div className="text-left">
                        <p className="text-sm font-semibold text-gray-900">{file.name}</p>
                        <p className="text-xs text-gray-500">{(file.size / 1024).toFixed(1)} KB</p>
                      </div>
                    </div>
                  ) : (
                    <div>
                      <Upload size={24} className="text-gray-300 mx-auto mb-2" />
                      <p className="text-sm text-gray-500">
                        Glissez votre fichier ici ou <span className="text-brand-600 font-medium">cliquez pour parcourir</span>
                      </p>
                      <p className="text-xs text-gray-400 mt-1">.xlsx — 5 MB max</p>
                    </div>
                  )}
                </div>

                <div className="flex gap-3 flex-wrap">
                  {file && (
                    <button onClick={() => { setFile(null); setReport(null); }}
                      className="btn-secondary py-2 px-4 text-sm">
                      Changer
                    </button>
                  )}
                  {/* Bouton Simuler (dry-run) */}
                  <button onClick={() => runImport(true)} disabled={!file || loading}
                    className="inline-flex items-center gap-2 py-2 px-5 text-sm rounded-xl border-2 border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 disabled:opacity-40 transition-colors font-medium">
                    {loading
                      ? <div className="w-4 h-4 border-2 border-amber-500 border-t-transparent rounded-full animate-spin" />
                      : <Eye size={15} />}
                    Simuler
                  </button>
                  {/* Bouton Import réel */}
                  <button onClick={() => runImport(false)} disabled={!file || loading}
                    className="btn-primary flex items-center gap-2 py-2 px-5 text-sm">
                    {loading
                      ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      : <Play size={15} />}
                    Lancer l'import
                  </button>
                </div>
                <p className="text-xs text-gray-400 mt-2">
                  💡 Commencez par <strong>Simuler</strong> pour vérifier le résultat sans modifier la base.
                </p>
              </div>
            </div>
          </div>

          {/* Rapport */}
          {report && (
            <div className="card">
              <h2 className="font-semibold text-gray-900 mb-1 flex items-center gap-2">
                {report.dry_run && <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">Simulation — rien n'a été écrit</span>}
                {!report.dry_run && report.errors.length === 0 && <CheckCircle size={18} className="text-emerald-500" />}
                {!report.dry_run && report.errors.length > 0 && <AlertTriangle size={18} className="text-amber-500" />}
                Rapport {report.dry_run ? 'de simulation' : 'd\'import'}
              </h2>

              {/* Stats */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-5 mt-4">
                {[
                  { label: 'Lignes',                  value: report.total,               color: 'bg-gray-100 text-gray-700' },
                  { label: 'Utilisateurs créés',      value: report.created_users,       color: 'bg-blue-100 text-blue-700' },
                  { label: 'Utilisateurs mis à jour', value: report.updated_users,       color: 'bg-blue-50 text-blue-600' },
                  { label: 'Copropriétés créées',     value: report.created_coproprietes, color: 'bg-emerald-100 text-emerald-700' },
                  { label: 'Accès créés/mis à jour',  value: report.created_acces + report.updated_acces, color: 'bg-emerald-50 text-emerald-600' },
                  { label: 'Erreurs',                 value: report.errors.length,       color: report.errors.length > 0 ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-400' },
                ].map(({ label, value, color }) => (
                  <div key={label} className={`${color} rounded-xl p-3 text-center`}>
                    <div className="text-2xl font-bold">{value}</div>
                    <div className="text-xs mt-0.5">{label}</div>
                  </div>
                ))}
              </div>

              {/* URLs qui seraient écrasées */}
              {report.overwritten_urls?.length > 0 && (
                <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <p className="text-sm font-semibold text-amber-700 mb-2 flex items-center gap-2">
                    <AlertCircle size={15} />
                    {report.overwritten_urls.length} URL(s) Drive {report.dry_run ? 'seraient modifiées' : 'modifiées'}
                  </p>
                  <div className="space-y-2 max-h-48 overflow-y-auto">
                    {report.overwritten_urls.map((ow, i) => (
                      <div key={i} className="text-xs bg-white rounded-lg p-2 border border-amber-100">
                        <span className="font-mono text-amber-600">L.{ow.line} · {ow.field}</span>
                        <div className="text-gray-400 truncate mt-0.5">Avant : {ow.old}</div>
                        <div className="text-gray-700 truncate">Après : {ow.new}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Détail ligne par ligne */}
              <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto rounded-xl border border-gray-100">
                {report.details.map((d, i) => (
                  <div key={i} className={`flex items-center gap-3 px-4 py-3 text-sm ${d.status === 'error' ? 'bg-red-50' : ''}`}>
                    <span className="text-xs text-gray-400 font-mono w-12 flex-shrink-0">L.{d.line}</span>
                    <StatusBadge status={d.status} />
                    <span className="text-gray-600 text-xs truncate flex-1">{d.email}</span>
                    <span className="text-gray-400 text-xs truncate hidden sm:block">{d.copropriete}</span>
                    {d.error ? (
                      <span className="text-red-500 text-xs flex-shrink-0">{d.error}</span>
                    ) : (
                      <span className="text-gray-400 text-xs flex-shrink-0">{d.actions?.join(' · ')}</span>
                    )}
                  </div>
                ))}
              </div>

              {/* CTA import réel après simulation */}
              {!report.dry_run && report.errors.length === 0 && report.created_acces + report.updated_acces > 0 && (
                <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-xl">
                  <p className="text-sm text-blue-700 font-medium mb-1">⚡ Synchronisation Drive recommandée</p>
                  <p className="text-sm text-blue-600">
                    Les accès ont été mis à jour dans Nova Copro. Pour appliquer les changements sur Google Drive :
                  </p>
                  <pre className="text-xs bg-blue-100 rounded p-2 mt-2 text-blue-800 font-mono">npm run drive:sync:dry{"
"}npm run drive:sync</pre>
                </div>
              )}
              {report.dry_run && report.errors.length === 0 && (
                <div className="mt-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-center justify-between gap-4">
                  <p className="text-sm text-emerald-700">
                    La simulation n'a trouvé aucune erreur. Vous pouvez lancer l'import réel.
                  </p>
                  <button onClick={() => runImport(false)} disabled={loading}
                    className="btn-primary flex items-center gap-2 py-2 px-4 text-sm flex-shrink-0">
                    <Play size={14} /> Lancer l'import
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </Layout>
    </>
  );
}

export default withAuth(AdminImport, { adminOnly: true });
