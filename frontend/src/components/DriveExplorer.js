import { useState, useEffect, useCallback } from 'react';
import {
  Folder, FolderOpen, File, FileText, Image, Film,
  Music, Archive, Grid, Layout, ChevronRight,
  Download, Eye, ArrowLeft, Loader2, X, AlertCircle,
  RefreshCw, Home,
} from 'lucide-react';

// Compatibilité selon la version lucide installée
const Table2        = Grid;
const Presentation  = Layout;

import api from '../lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

// ── Fetch avec credentials (envoie le cookie HttpOnly nova_token) ──
// Le cookie HttpOnly n'est pas lisible par JS — c'est voulu.
// Le navigateur l'envoie automatiquement si credentials: 'include'.
// On ne touche jamais au cookie manuellement ici.

const fetchWithCredentials = (url, options = {}) =>
  fetch(url, { credentials: 'include', ...options });

// ── URL de vignette image ─────────────────────────────────────

const getThumbnailUrl = (file, coproprieteId, type) => {
  const params = new URLSearchParams({
    file_id: file.id,
    copropriete_id: coproprieteId,
    type,
  });

  if (file.thumbnailVersion) {
    params.set('v', String(file.thumbnailVersion));
  } else if (file.modifiedTime) {
    params.set('v', file.modifiedTime);
  }

  return `${API_BASE}/api/user/drive/thumbnail?${params.toString()}`;
};

// ── Icônes par type MIME ──────────────────────────────────────

const getMimeIcon = (mimeType, isFolder) => {
  if (isFolder) return { Icon: Folder, color: 'text-amber-500' };
  if (!mimeType) return { Icon: File, color: 'text-gray-400' };
  if (mimeType.includes('pdf'))                                     return { Icon: FileText,     color: 'text-red-500'     };
  if (mimeType.includes('word') || mimeType.includes('document'))  return { Icon: FileText,     color: 'text-blue-500'    };
  if (mimeType.includes('spreadsheet') || mimeType.includes('excel'))
                                                                    return { Icon: Table2,       color: 'text-emerald-600' };
  if (mimeType.includes('presentation') || mimeType.includes('powerpoint'))
                                                                    return { Icon: Presentation, color: 'text-orange-500'  };
  if (mimeType.startsWith('image/'))  return { Icon: Image,   color: 'text-purple-500' };
  if (mimeType.startsWith('video/'))  return { Icon: Film,    color: 'text-pink-500'   };
  if (mimeType.startsWith('audio/'))  return { Icon: Music,   color: 'text-indigo-500' };
  if (mimeType.includes('zip') || mimeType.includes('rar') || mimeType.includes('archive'))
                                      return { Icon: Archive, color: 'text-yellow-600' };
  if (mimeType.startsWith('text/'))   return { Icon: FileText, color: 'text-gray-500'  };
  return { Icon: File, color: 'text-gray-400' };
};

const getMimeLabel = (mimeType, isFolder) => {
  if (isFolder) return 'Dossier';
  if (!mimeType) return 'Fichier';
  if (mimeType.includes('pdf'))           return 'PDF';
  if (mimeType.includes('document'))      return 'Document Google';
  if (mimeType.includes('spreadsheet'))   return 'Feuille Google';
  if (mimeType.includes('presentation'))  return 'Présentation Google';
  if (mimeType.includes('word'))          return 'Word';
  if (mimeType.includes('excel'))         return 'Excel';
  if (mimeType.includes('powerpoint'))    return 'PowerPoint';
  if (mimeType.startsWith('image/'))      return 'Image';
  if (mimeType.startsWith('video/'))      return 'Vidéo';
  if (mimeType.startsWith('audio/'))      return 'Audio';
  if (mimeType.startsWith('text/'))       return 'Texte';
  return 'Fichier';
};

const isPreviewable = (mimeType) => {
  if (!mimeType) return false;
  return (
    mimeType.includes('pdf') ||
    mimeType.startsWith('image/') ||
    mimeType.includes('google-apps.document') ||
    mimeType.includes('google-apps.spreadsheet') ||
    mimeType.includes('google-apps.presentation')
  );
};

const formatDate = (dateStr) => {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('fr-FR', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
};

// ── FileItem ──────────────────────────────────────────────────

function FileItem({ file, coproprieteId, type, onNavigate, onPreview }) {
  const { Icon, color } = getMimeIcon(file.mimeType, file.isFolder);
  const [downloading, setDownloading] = useState(false);
  const [thumbnailError, setThumbnailError] = useState(false);

  const hasThumbnailMetadata = Boolean(
    file.hasThumbnail ||
    file.thumbnail ||
    file.thumbnailVersion
  );

  const showThumbnail =
    !file.isFolder &&
    file.mimeType?.startsWith('image/') &&
    hasThumbnailMetadata &&
    !thumbnailError;

  const handleDownload = async (e) => {
    e.stopPropagation();
    setDownloading(true);
    try {
      const url = `${API_BASE}/api/user/drive/download?file_id=${file.id}&copropriete_id=${coproprieteId}&type=${type}`;

      // Le cookie HttpOnly nova_token est envoyé automatiquement par le navigateur
      // grâce à credentials: 'include'. Aucun accès JS au cookie n'est nécessaire.
      const response = await fetchWithCredentials(url);

      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Erreur téléchargement');
      }

      const blob    = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a       = document.createElement('a');
      a.href        = blobUrl;
      a.download    = file.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(blobUrl);
    } catch (err) {
      alert('Erreur lors du téléchargement : ' + err.message);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div
      onClick={() => file.isFolder && onNavigate(file.id, file.name)}
      className={`flex items-center gap-3 p-3 rounded-xl transition-all duration-150 group
        ${file.isFolder ? 'hover:bg-amber-50 cursor-pointer' : 'hover:bg-gray-50'}`}
    >
      <div className={`flex-shrink-0 rounded-xl flex items-center justify-center overflow-hidden transition-colors
        ${showThumbnail ? 'w-28 h-28' : 'w-10 h-10'}
        ${file.isFolder ? 'bg-amber-50 group-hover:bg-amber-100' : 'bg-gray-50'}`}>
        {showThumbnail ? (
          <img
            src={getThumbnailUrl(file, coproprieteId, type)}
            alt={file.name}
            loading="lazy"
            decoding="async"
            onError={() => setThumbnailError(true)}
            className="w-full h-full object-cover"
          />
        ) : (
          <>
            <Icon size={20} className={`${color} ${file.isFolder ? 'group-hover:hidden' : ''}`} />
            {file.isFolder && <FolderOpen size={20} className={`${color} hidden group-hover:block`} />}
          </>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${file.isFolder ? 'text-gray-900' : 'text-gray-700'}`}>
          {file.name}
        </p>
        <p className="text-xs text-gray-400 flex items-center gap-2 mt-0.5">
          <span>{getMimeLabel(file.mimeType, file.isFolder)}</span>
          {file.size         && <span>· {file.size}</span>}
          {file.modifiedTime && <span>· {formatDate(file.modifiedTime)}</span>}
        </p>
      </div>

      {!file.isFolder && (
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          {isPreviewable(file.mimeType) && (
            <button
              onClick={(e) => { e.stopPropagation(); onPreview(file); }}
              title="Prévisualiser"
              className="p-2 rounded-lg hover:bg-blue-100 text-gray-400 hover:text-blue-600 transition-colors"
            >
              <Eye size={15} />
            </button>
          )}
          <button
            onClick={handleDownload}
            disabled={downloading}
            title="Télécharger"
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors disabled:opacity-50"
          >
            {downloading ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
          </button>
        </div>
      )}

      {file.isFolder && (
        <ChevronRight size={16} className="text-gray-300 group-hover:text-amber-400 transition-colors flex-shrink-0" />
      )}
    </div>
  );
}

// ── PreviewModal ──────────────────────────────────────────────

function PreviewModal({ file, coproprieteId, type, onClose }) {
  const [previewUrl, setPreviewUrl] = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);

  useEffect(() => {
    let objectUrl = null;

    const load = async () => {
      try {
        const url = `${API_BASE}/api/user/drive/preview?file_id=${file.id}&copropriete_id=${coproprieteId}&type=${type}`;
        const response = await fetchWithCredentials(url);

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          throw new Error(err.error || 'Erreur de chargement');
        }

        const blob = await response.blob();
        objectUrl  = window.URL.createObjectURL(blob);
        setPreviewUrl(objectUrl);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    load();

    return () => {
      if (objectUrl) window.URL.revokeObjectURL(objectUrl);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isImage = file.mimeType?.startsWith('image/');

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-black/90 backdrop-blur-sm">
      <div className="flex items-center justify-between px-6 py-4 bg-black/50 border-b border-white/10">
        <p className="text-white font-medium text-sm truncate max-w-lg">{file.name}</p>
        <button onClick={onClose}
          className="p-2 rounded-lg hover:bg-white/10 text-white/70 hover:text-white transition-colors">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 flex items-center justify-center overflow-hidden p-4">
        {loading && (
          <div className="flex flex-col items-center gap-3 text-white/60">
            <Loader2 size={32} className="animate-spin" />
            <p className="text-sm">Chargement...</p>
          </div>
        )}
        {error && (
          <div className="flex flex-col items-center gap-3 text-white/60">
            <AlertCircle size={32} />
            <p className="text-sm">{error}</p>
          </div>
        )}
        {previewUrl && !loading && !error && (
          isImage ? (
            <img src={previewUrl} alt={file.name}
              className="max-w-full max-h-full object-contain rounded-lg shadow-2xl" />
          ) : (
            <iframe src={previewUrl} title={file.name}
              className="w-full h-full rounded-lg shadow-2xl bg-white"
              style={{ minHeight: '70vh' }} />
          )
        )}
      </div>
    </div>
  );
}

// ── DriveExplorer ─────────────────────────────────────────────

export default function DriveExplorer({ coproprieteId, type, label, icon, onClose }) {
  const [files,         setFiles]       = useState([]);
  const [loading,       setLoading]     = useState(true);
  const [error,         setError]       = useState(null);
  const [rootFolderId,  setRoot]        = useState(null);
  const [currentFolderId, setCurrent]  = useState(null);
  const [breadcrumbs,   setBreadcrumbs] = useState([]);
  const [preview,       setPreview]     = useState(null);

  const fetchFolder = useCallback(async (folderId = null) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ copropriete_id: coproprieteId, type });
      if (folderId) params.set('folder_id', folderId);
      const { data } = await api.get(`/api/user/drive/list?${params}`);
      setFiles(data.files);
      setRoot(data.rootFolderId);
      setCurrent(data.currentFolderId);
    } catch (err) {
      setError(err.response?.data?.error || 'Erreur de chargement');
    } finally {
      setLoading(false);
    }
  }, [coproprieteId, type]);

  useEffect(() => { fetchFolder(); }, [fetchFolder]);

  const navigateInto = (folderId, folderName) => {
    setBreadcrumbs(prev => [...prev, { id: folderId, name: folderName }]);
    fetchFolder(folderId);
  };

  const navigateTo = (index) => {
    if (index === -1) {
      setBreadcrumbs([]);
      fetchFolder(null);
    } else {
      const crumb = breadcrumbs[index];
      setBreadcrumbs(prev => prev.slice(0, index + 1));
      fetchFolder(crumb.id);
    }
  };

  const goBack = () => {
    if (!breadcrumbs.length) return;
    navigateTo(breadcrumbs.length - 2);
  };

  const folders   = files.filter(f => f.isFolder);
  const documents = files.filter(f => !f.isFolder);

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-stretch sm:items-center justify-center sm:p-4 bg-black/40 backdrop-blur-sm"
        onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      >
        <div className="bg-white w-full sm:rounded-2xl shadow-2xl flex flex-col"
          style={{ maxWidth: 720, maxHeight: '90vh', height: '100%' }}>

          {/* Header */}
          <div className="flex items-center gap-3 px-5 py-4 border-b border-gray-100 flex-shrink-0">
            <div className="text-xl">{icon}</div>
            <div className="flex-1 min-w-0">
              <h2 className="font-bold text-gray-900 text-base truncate">{label}</h2>
              <div className="flex items-center gap-1 text-xs text-gray-400 mt-0.5 flex-wrap">
                <button onClick={() => navigateTo(-1)}
                  className="hover:text-brand-600 transition-colors flex items-center gap-1">
                  <Home size={11} /> Racine
                </button>
                {breadcrumbs.map((crumb, i) => (
                  <span key={i} className="flex items-center gap-1">
                    <ChevronRight size={10} />
                    <button onClick={() => navigateTo(i)}
                      className="hover:text-brand-600 transition-colors truncate max-w-[120px]">
                      {crumb.name}
                    </button>
                  </span>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              <button
                onClick={() => fetchFolder(currentFolderId !== rootFolderId ? currentFolderId : null)}
                title="Actualiser"
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                <RefreshCw size={16} />
              </button>
              <button onClick={onClose}
                className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                <X size={18} />
              </button>
            </div>
          </div>

          {/* Bouton retour */}
          {breadcrumbs.length > 0 && (
            <button onClick={goBack}
              className="flex items-center gap-2 px-5 py-2.5 text-sm text-brand-600 hover:bg-brand-50 transition-colors border-b border-gray-50 flex-shrink-0">
              <ArrowLeft size={15} /> Retour
            </button>
          )}

          {/* Contenu */}
          <div className="flex-1 overflow-y-auto">
            {loading && (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <Loader2 size={28} className="animate-spin text-brand-600" />
                <p className="text-sm text-gray-400">Chargement...</p>
              </div>
            )}
            {error && (
              <div className="flex flex-col items-center justify-center py-20 gap-3 px-6 text-center">
                <AlertCircle size={28} className="text-red-400" />
                <p className="text-sm text-red-500">{error}</p>
                <button onClick={() => fetchFolder(currentFolderId)}
                  className="text-xs text-brand-600 hover:underline">Réessayer</button>
              </div>
            )}
            {!loading && !error && files.length === 0 && (
              <div className="flex flex-col items-center justify-center py-20 gap-3 text-gray-400">
                <FolderOpen size={32} className="text-gray-200" />
                <p className="text-sm">Ce dossier est vide.</p>
              </div>
            )}
            {!loading && !error && files.length > 0 && (
              <div className="p-3">
                {folders.length > 0 && (
                  <div className="mb-2">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 py-1.5">
                      Dossiers ({folders.length})
                    </p>
                    {folders.map(file => (
                      <FileItem key={file.id} file={file} coproprieteId={coproprieteId}
                        type={type} onNavigate={navigateInto} onPreview={setPreview} />
                    ))}
                  </div>
                )}
                {documents.length > 0 && (
                  <div>
                    {folders.length > 0 && (
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider px-3 py-1.5 mt-2">
                        Fichiers ({documents.length})
                      </p>
                    )}
                    {documents.map(file => (
                      <FileItem key={file.id} file={file} coproprieteId={coproprieteId}
                        type={type} onNavigate={navigateInto} onPreview={setPreview} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="px-5 py-3 border-t border-gray-100 text-xs text-gray-400 text-center flex-shrink-0">
            {!loading && !error && (
              <span>
                {folders.length} dossier{folders.length > 1 ? 's' : ''} · {documents.length} fichier{documents.length > 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      </div>

      {preview && (
        <PreviewModal
          file={preview} coproprieteId={coproprieteId}
          type={type} onClose={() => setPreview(null)}
        />
      )}
    </>
  );
}
