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

const DRIVE_SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

const createDriveAuth = () => {
  const jsonRaw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!jsonRaw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON manquant dans les variables d\'env');

  let credentials;
  try {
    credentials = JSON.parse(jsonRaw);
  } catch {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON : JSON invalide');
  }

  return new google.auth.GoogleAuth({
    credentials,
    scopes: DRIVE_SCOPES,
  });
};

const getFreshAuthClient = async () => {
  const auth = createDriveAuth();
  return auth.getClient();
};

const getDrive = () => {
  if (_drive) return _drive;

  const auth = createDriveAuth();

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

const FOLDER_MIME = 'application/vnd.google-apps.folder';

const ZIP_LIMITS = {
  MAX_SELECTED_ITEMS: 50,
  MAX_DEPTH: 5,
  MAX_FILES: 200,
  MAX_ESTIMATED_BYTES: 300 * 1024 * 1024, // 300 Mo estimés
};

const GOOGLE_MIME_EXPORTS = {
  'application/vnd.google-apps.document':     'application/pdf',
  'application/vnd.google-apps.spreadsheet':  'application/pdf',
  'application/vnd.google-apps.presentation': 'application/pdf',
  'application/vnd.google-apps.drawing':      'image/png',
};

const isGoogleNativeType = (mimeType) =>
  mimeType?.startsWith('application/vnd.google-apps.');

const safeZipName = (name) =>
  String(name || 'sans-nom')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);

const makeUniqueZipPath = (path, usedPaths) => {
  if (!usedPaths.has(path)) {
    usedPaths.add(path);
    return path;
  }

  const lastSlashIndex = path.lastIndexOf('/');
  const dir = lastSlashIndex >= 0 ? path.slice(0, lastSlashIndex + 1) : '';
  const file = lastSlashIndex >= 0 ? path.slice(lastSlashIndex + 1) : path;

  const dotIndex = file.lastIndexOf('.');
  const base = dotIndex > 0 ? file.slice(0, dotIndex) : file;
  const ext = dotIndex > 0 ? file.slice(dotIndex) : '';

  let i = 2;
  let candidate;

  do {
    candidate = `${dir}${base} (${i})${ext}`;
    i += 1;
  } while (usedPaths.has(candidate));

  usedPaths.add(candidate);
  return candidate;
};

const getZipFileName = (meta) => {
  const { name, mimeType } = meta;

  if (isGoogleNativeType(mimeType)) {
    const exportMime = GOOGLE_MIME_EXPORTS[mimeType] || 'application/pdf';
    const exportExt = exportMime === 'image/png' ? '.png' : '.pdf';
    return name.endsWith(exportExt) ? name : name + exportExt;
  }

  return name;
};

// ── Options communes Shared Drives ───────────────────────────
// Ces paramètres sont requis pour que les requêtes fonctionnent aussi bien
// sur les My Drives classiques que sur les Shared Drives (lecteurs partagés).

const SHARED_DRIVES_OPTS = {
  supportsAllDrives:         true,
  includeItemsFromAllDrives: true,
};

const listFolderRaw = async (folderId) => {
  const drive = getDrive();
  const allFiles = [];
  let pageToken = undefined;

  do {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime)',
      orderBy: 'folder,name asc',
      pageSize: 1000,
      pageToken,
      ...SHARED_DRIVES_OPTS,
    });

    allFiles.push(...(response.data.files || []));
    pageToken = response.data.nextPageToken;
  } while (pageToken);

  return allFiles;
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
    if (mimeType !== FOLDER_MIME) {
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
      fields: 'nextPageToken, files(id, name, mimeType, size, modifiedTime, thumbnailLink, thumbnailVersion, hasThumbnail)',
      orderBy: 'folder,name asc',
      pageSize: 1000,
      pageToken,
      ...SHARED_DRIVES_OPTS,
    });
    allFiles.push(...(response.data.files || []));
    pageToken = response.data.nextPageToken;
  } while (pageToken);

  return allFiles.map(f => ({
    id:               f.id,
    name:             f.name,
    mimeType:         f.mimeType,
    isFolder:         f.mimeType === FOLDER_MIME,
    isGoogleDoc:      isGoogleNativeType(f.mimeType),
    size:             f.size ? formatSize(parseInt(f.size)) : null,
    modifiedTime:     f.modifiedTime,
    thumbnail:        f.thumbnailLink || null,
    thumbnailVersion: f.thumbnailVersion || null,
    hasThumbnail:     Boolean(f.thumbnailLink || f.hasThumbnail),
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

// ── Pré-analyse des éléments à zipper ───────────────────────

const collectZipItem = async (itemId, basePath, depth, state, existingMeta = null) => {
  const meta = existingMeta || await getFileMetadata(itemId);
  const cleanName = safeZipName(meta.name);

  if (meta.mimeType === FOLDER_MIME) {
    const folderPath = basePath ? `${basePath}/${cleanName}` : cleanName;

    state.entries.push({
      type: 'folder',
      zipPath: makeUniqueZipPath(`${folderPath}/`, state.usedPaths),
    });

    if (depth >= ZIP_LIMITS.MAX_DEPTH) {
      state.entries.push({
        type: 'note',
        zipPath: makeUniqueZipPath(
          `${folderPath}/[dossier trop profond - télécharger séparément].txt`,
          state.usedPaths
        ),
        content: 'Ce dossier dépasse la profondeur maximale autorisée pour un téléchargement ZIP groupé. Merci de le télécharger séparément.',
      });
      return;
    }

    const children = await listFolderRaw(itemId);

    for (const child of children) {
      await collectZipItem(child.id, folderPath, depth + 1, state, child);
    }

    return;
  }

  state.fileCount += 1;

  if (state.fileCount > ZIP_LIMITS.MAX_FILES) {
    throw Object.assign(
      new Error(`Téléchargement trop volumineux : maximum ${ZIP_LIMITS.MAX_FILES} fichiers dans un ZIP.`),
      { status: 400 }
    );
  }

  const estimatedSize = Number.parseInt(meta.size || '0', 10) || 0;
  state.estimatedBytes += estimatedSize;

  if (state.estimatedBytes > ZIP_LIMITS.MAX_ESTIMATED_BYTES) {
    throw Object.assign(
      new Error('Téléchargement trop volumineux : la taille totale estimée dépasse 300 Mo.'),
      { status: 400 }
    );
  }

  const fileName = safeZipName(getZipFileName(meta));
  const zipPath = basePath ? `${basePath}/${fileName}` : fileName;

  state.entries.push({
    type: 'file',
    fileId: itemId,
    meta,
    zipPath: makeUniqueZipPath(zipPath, state.usedPaths),
  });
};

const collectZipEntries = async (itemIds) => {
  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    throw Object.assign(new Error('Aucun élément sélectionné.'), { status: 400 });
  }

  if (itemIds.length > ZIP_LIMITS.MAX_SELECTED_ITEMS) {
    throw Object.assign(
      new Error(`Maximum ${ZIP_LIMITS.MAX_SELECTED_ITEMS} éléments par téléchargement ZIP.`),
      { status: 400 }
    );
  }

  const state = {
    entries: [],
    usedPaths: new Set(),
    fileCount: 0,
    estimatedBytes: 0,
  };

  for (const itemId of itemIds) {
    await collectZipItem(itemId, '', 0, state);
  }

  return {
    entries: state.entries,
    fileCount: state.fileCount,
    estimatedBytes: state.estimatedBytes,
  };
};

// ── Stream téléchargeable pour fichier ou export Google ─────

const getDownloadStream = async (fileId, existingMeta = null) => {
  const drive = getDrive();
  const meta = existingMeta || await getFileMetadata(fileId);
  const { name, mimeType } = meta;

  if (isGoogleNativeType(mimeType)) {
    const exportMime = GOOGLE_MIME_EXPORTS[mimeType] || 'application/pdf';
    const exportExt = exportMime === 'image/png' ? '.png' : '.pdf';

    const exportRes = await drive.files.export(
      { fileId, mimeType: exportMime },
      { responseType: 'stream' }
    );

    return {
      stream: exportRes.data,
      contentType: exportMime,
      fileName: name.endsWith(exportExt) ? name : name + exportExt,
    };
  }

  const dlRes = await drive.files.get(
    { fileId, alt: 'media', ...SHARED_DRIVES_OPTS },
    { responseType: 'stream' }
  );

  return {
    stream: dlRes.data,
    contentType: mimeType || 'application/octet-stream',
    fileName: name,
  };
};

const appendZipEntryToArchive = async (archive, entry) => {
  if (entry.type === 'folder') {
    archive.append('', { name: entry.zipPath });
    return;
  }

  if (entry.type === 'note') {
    archive.append(entry.content, { name: entry.zipPath });
    return;
  }

  const { stream } = await getDownloadStream(entry.fileId, entry.meta);
  archive.append(stream, { name: entry.zipPath });
};

// ── Stream d'un fichier vers la réponse HTTP ──────────────────

const streamFile = async (fileId, res) => {
  const { stream, contentType, fileName } = await getDownloadStream(fileId);

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

// ── Stream d'une vignette image ───────────────────────────────

const streamThumbnail = async (fileId, res) => {
  const drive = getDrive();

  const metaRes = await drive.files.get({
    fileId,
    fields: 'id, name, mimeType, thumbnailLink, thumbnailVersion',
    ...SHARED_DRIVES_OPTS,
  });

  const { name, mimeType, thumbnailLink, thumbnailVersion } = metaRes.data;

  if (!mimeType?.startsWith('image/')) {
    throw Object.assign(new Error('Ce fichier n’est pas une image'), { status: 400 });
  }

  if (!thumbnailLink) {
    throw Object.assign(new Error('Aucune vignette disponible'), { status: 404 });
  }

  const authClient = await getFreshAuthClient();

  const thumbRes = await authClient.request({
    url: thumbnailLink,
    responseType: 'stream',
  });

  res.setHeader('Content-Type', thumbRes.headers['content-type'] || 'image/jpeg');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(name)}`);
  res.setHeader('Cache-Control', 'private, max-age=86400, stale-while-revalidate=604800');
  res.setHeader('ETag', `"thumb-${fileId}-${thumbnailVersion || 'v0'}"`);
  res.setHeader('Vary', 'Cookie');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  return new Promise((resolve, reject) => {
    thumbRes.data.pipe(res);
    thumbRes.data.on('end', resolve);
    thumbRes.data.on('error', reject);
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
  streamThumbnail,
  isDescendantOf,
  collectZipEntries,
  appendZipEntryToArchive,
};
