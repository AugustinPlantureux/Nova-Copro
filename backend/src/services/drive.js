/**
 * Service Google Drive API
 *
 * Utilise un Service Account pour accéder aux dossiers Drive.
 * Compatible Shared Drives (supportsAllDrives / includeItemsFromAllDrives).
 *
 * Variable d'env requise :
 *   GOOGLE_SERVICE_ACCOUNT_JSON  → contenu JSON du fichier de credentials
 *                                   (sur une seule ligne)
 */

const { google } = require('googleapis');

// ── Initialisation du client Drive ───────────────────────────

let _drive = null;

const getDrive = () => {
  if (_drive) return _drive;

  const jsonRaw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!jsonRaw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON manquant dans les variables d\'env');

  let credentials;
  try {
    credentials = JSON.parse(jsonRaw);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON : JSON invalide');
  }

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive.readonly'],
  });

  _drive = google.drive({ version: 'v3', auth });
  return _drive;
};

// ── Extraction d'ID depuis une URL Drive ─────────────────────

const extractFolderId = (urlOrId) => {
  if (!urlOrId) return null;
  const match = urlOrId.match(/\/folders\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(urlOrId)) return urlOrId;
  return null;
};

// ── MIME types Google → export PDF pour prévisualisation ─────

const GOOGLE_MIME_EXPORTS = {
  'application/vnd.google-apps.document':     'application/pdf',
  'application/vnd.google-apps.spreadsheet':  'application/pdf',
  'application/vnd.google-apps.presentation': 'application/pdf',
  'application/vnd.google-apps.drawing':      'image/png',
};

const isGoogleNativeType = (mimeType) =>
  mimeType?.startsWith('application/vnd.google-apps.');

// ── Options communes Shared Drives ───────────────────────────
// Ces paramètres sont requis pour que les requêtes fonctionnent aussi bien
// sur les My Drives classiques que sur les Shared Drives (lecteurs partagés).

const SHARED_DRIVES_OPTS = {
  supportsAllDrives:         true,
  includeItemsFromAllDrives: true,
};

// ── Vérification d'accessibilité d'un dossier ────────────────

/**
 * Vérifie que le service account peut accéder au dossier Drive indiqué.
 * Lève une erreur descriptive si le dossier est introuvable ou inaccessible.
 * À appeler lors de l'enregistrement d'une URL Drive.
 */
const checkFolderAccessible = async (folderId) => {
  const drive = getDrive();
  try {
    const res = await drive.files.get({
      fileId: folderId,
      fields: 'id, name, mimeType',
      ...SHARED_DRIVES_OPTS,
    });
    const { mimeType } = res.data;
    if (mimeType !== 'application/vnd.google-apps.folder') {
      throw Object.assign(new Error('L\'ID Drive ne pointe pas vers un dossier'), { status: 400 });
    }
    return res.data;
  } catch (err) {
    if (err.status) throw err; // erreur métier déjà formatée
    if (err.code === 404 || err.response?.status === 404) {
      throw Object.assign(
        new Error('Dossier Drive introuvable — vérifiez que le lien est correct et que le service account y a accès'),
        { status: 400 }
      );
    }
    if (err.code === 403 || err.response?.status === 403) {
      throw Object.assign(
        new Error('Accès refusé par Google Drive — partagez le dossier avec le service account'),
        { status: 400 }
      );
    }
    throw Object.assign(
      new Error('Impossible de vérifier l\'accès Drive : ' + err.message),
      { status: 400 }
    );
  }
};

// ── Lister le contenu d'un dossier ──────────────────────────

const listFolder = async (folderId) => {
  const drive = getDrive();
  const allFiles = [];
  let pageToken = undefined;

  // Boucle de pagination — Drive renvoie au max 1000 fichiers par page.
  do {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, thumbnailLink)',
      orderBy: 'folder,name asc',
      pageSize: 1000,
      pageToken,
      ...SHARED_DRIVES_OPTS,
    });
    allFiles.push(...(response.data.files || []));
    pageToken = response.data.nextPageToken;
  } while (pageToken);

  return allFiles.map(f => ({
    id:           f.id,
    name:         f.name,
    mimeType:     f.mimeType,
    isFolder:     f.mimeType === 'application/vnd.google-apps.folder',
    isGoogleDoc:  isGoogleNativeType(f.mimeType),
    size:         f.size ? formatSize(parseInt(f.size)) : null,
    modifiedTime: f.modifiedTime,
    thumbnail:    f.thumbnailLink || null,
  }));
};

// ── Métadonnées d'un fichier ──────────────────────────────────

const getFileMetadata = async (fileId) => {
  const drive = getDrive();
  const res = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, size, parents',
    ...SHARED_DRIVES_OPTS,
  });
  return res.data;
};

// ── Stream d'un fichier vers la réponse HTTP ──────────────────

const streamFile = async (fileId, res) => {
  const drive = getDrive();
  const meta  = await getFileMetadata(fileId);
  const { name, mimeType } = meta;

  let stream, contentType, fileName;

  if (isGoogleNativeType(mimeType)) {
    const exportMime = GOOGLE_MIME_EXPORTS[mimeType] || 'application/pdf';
    const exportExt  = exportMime === 'image/png' ? '.png' : '.pdf';
    const exportRes  = await drive.files.export(
      { fileId, mimeType: exportMime },
      { responseType: 'stream' }
    );
    stream      = exportRes.data;
    contentType = exportMime;
    fileName    = name.endsWith(exportExt) ? name : name + exportExt;
  } else {
    const dlRes = await drive.files.get(
      { fileId, alt: 'media', ...SHARED_DRIVES_OPTS },
      { responseType: 'stream' }
    );
    stream      = dlRes.data;
    contentType = mimeType || 'application/octet-stream';
    fileName    = name;
  }

  res.setHeader('Content-Type', contentType);
  res.setHeader(
    'Content-Disposition',
    `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`
  );
  res.setHeader('X-Content-Type-Options', 'nosniff');

  return new Promise((resolve, reject) => {
    stream.pipe(res);
    stream.on('end', resolve);
    stream.on('error', reject);
  });
};

// ── Stream inline (prévisualisation) ─────────────────────────

const streamPreview = async (fileId, res) => {
  const drive = getDrive();
  const meta  = await getFileMetadata(fileId);
  const { name, mimeType } = meta;

  let stream, contentType;

  if (isGoogleNativeType(mimeType)) {
    const exportMime = GOOGLE_MIME_EXPORTS[mimeType] || 'application/pdf';
    const exportRes  = await drive.files.export(
      { fileId, mimeType: exportMime },
      { responseType: 'stream' }
    );
    stream      = exportRes.data;
    contentType = exportMime;
  } else {
    const dlRes = await drive.files.get(
      { fileId, alt: 'media', ...SHARED_DRIVES_OPTS },
      { responseType: 'stream' }
    );
    stream      = dlRes.data;
    contentType = mimeType || 'application/octet-stream';
  }

  res.setHeader('Content-Type', contentType);
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  return new Promise((resolve, reject) => {
    stream.pipe(res);
    stream.on('end', resolve);
    stream.on('error', reject);
  });
};

// ── Vérification d'ascendance (sécurité accès sous-dossiers) ─

const _ancestryCache = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of _ancestryCache.entries()) {
    if (v.exp < now) _ancestryCache.delete(k);
  }
}, 15 * 60 * 1000);

const isDescendantOf = async (fileId, rootFolderId) => {
  if (fileId === rootFolderId) return true;

  const cacheKey = `${fileId}:${rootFolderId}`;
  const cached   = _ancestryCache.get(cacheKey);
  if (cached && cached.exp > Date.now()) return cached.ok;

  const drive = getDrive();
  let currentId = fileId;
  const visited = new Set();

  for (let depth = 0; depth < 20; depth++) {
    if (visited.has(currentId)) break;
    visited.add(currentId);
    try {
      const res = await drive.files.get({
        fileId: currentId,
        fields: 'parents',
        ...SHARED_DRIVES_OPTS,
      });
      const parents = res.data.parents || [];
      if (parents.includes(rootFolderId)) {
        _ancestryCache.set(cacheKey, { ok: true, exp: Date.now() + 30 * 60 * 1000 });
        return true;
      }
      if (!parents.length) break;
      currentId = parents[0];
    } catch {
      break;
    }
  }

  _ancestryCache.set(cacheKey, { ok: false, exp: Date.now() + 5 * 60 * 1000 });
  return false;
};

// ── Utilitaires ───────────────────────────────────────────────

const formatSize = (bytes) => {
  if (!bytes) return null;
  if (bytes < 1024)       return `${bytes} o`;
  if (bytes < 1024 ** 2)  return `${(bytes / 1024).toFixed(0)} Ko`;
  if (bytes < 1024 ** 3)  return `${(bytes / 1024 ** 2).toFixed(1)} Mo`;
  return `${(bytes / 1024 ** 3).toFixed(2)} Go`;
};

module.exports = {
  extractFolderId,
  checkFolderAccessible,
  listFolder,
  getFileMetadata,
  streamFile,
  streamPreview,
  isDescendantOf,
};
