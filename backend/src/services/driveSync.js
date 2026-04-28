// backend/src/services/driveSync.js

const { google } = require('googleapis');
const db = require('../db');
const { decryptUser } = require('./crypto');
const { extractFolderId } = require('./drive');

const getDrive = () => {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/drive'],
  });

  return google.drive({ version: 'v3', auth });
};

const SHARED = { supportsAllDrives: true };

const getProtectedEmails = () =>
  new Set(
    (process.env.SYNC_PROTECTED_EMAILS || '')
      .split(',')
      .map(e => e.trim().toLowerCase())
      .filter(Boolean)
  );

const getSaEmail = () => {
  try {
    return JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON).client_email?.toLowerCase() || '';
  } catch {
    return '';
  }
};

const listPermissions = async (drive, folderId) => {
  try {
    const all = [];
    let pageToken = undefined;

    do {
      const res = await drive.permissions.list({
        fileId: folderId,
        fields: 'nextPageToken, permissions(id,emailAddress,role,type)',
        pageSize: 100,
        pageToken,
        ...SHARED,
      });

      all.push(...(res.data.permissions || []).filter(
        p => p.type === 'user' && p.emailAddress
      ));

      pageToken = res.data.nextPageToken;
    } while (pageToken);

    return all;
  } catch (err) {
    if (err.response?.status === 404 || err.response?.status === 403) return null;
    throw err;
  }
};

const grantAccess = async (drive, folderId, email) =>
  drive.permissions.create({
    fileId: folderId,
    sendNotificationEmail: false,
    requestBody: {
      type: 'user',
      role: 'reader',
      emailAddress: email,
    },
    ...SHARED,
  });

const revokeAccess = async (drive, folderId, permissionId) =>
  drive.permissions.delete({
    fileId: folderId,
    permissionId,
    ...SHARED,
  });

const buildExpectedAccesses = (rows, { revokeOnly = false } = {}) => {
  const expected = new Map();

  const add = (url, email) => {
    const fid = extractFolderId(url);
    if (!fid) return;
    if (!expected.has(fid)) expected.set(fid, new Set());
    expected.get(fid).add(email);
  };

  const touch = (url) => {
    const fid = extractFolderId(url);
    if (fid && !expected.has(fid)) expected.set(fid, new Set());
  };

  for (const row of rows) {
    const user = decryptUser(row);
    if (!user?.email) continue;

    const email = user.email.toLowerCase();

    if (revokeOnly || !row.is_active) {
      [
        row.drive_url_copropriete,
        row.drive_url_personnel,
        row.drive_url_conseil,
      ].filter(Boolean).forEach(touch);
      continue;
    }

    if (row.drive_url_copropriete) add(row.drive_url_copropriete, email);
    if (row.drive_url_personnel) add(row.drive_url_personnel, email);

    if (row.drive_url_conseil) {
      if (row.is_conseil_syndical) add(row.drive_url_conseil, email);
      else touch(row.drive_url_conseil);
    }
  }

  return expected;
};

const syncFolder = async (
  drive,
  folderId,
  authorizedEmails,
  report,
  { dryRun = true, revokeOnly = false, userFilter = null, protectedEmails, saEmail } = {}
) => {
  const permissions = await listPermissions(drive, folderId);

  if (permissions === null) {
    report.errors.push(`Dossier ${folderId} inaccessible`);
    return;
  }

  const existing = new Map(
    permissions.map(p => [p.emailAddress.toLowerCase(), p.id])
  );

  if (!revokeOnly) {
    for (const email of authorizedEmails) {
      if (userFilter && email !== userFilter) continue;

      if (!existing.has(email)) {
        report.granted.push({ email, folderId });
        if (!dryRun) await grantAccess(drive, folderId, email);
      }
    }
  }

  for (const [email, permId] of existing) {
    if (email === saEmail) continue;
    if (protectedEmails.has(email)) continue;
    if (userFilter && email !== userFilter) continue;

    if (!authorizedEmails.has(email)) {
      report.revoked.push({ email, folderId });
      if (!dryRun) await revokeAccess(drive, folderId, permId);
    } else if (!revokeOnly) {
      report.unchanged.push({ email, folderId });
    }
  }
};

async function runSync({
  dryRun = true,
  revokeOnly = false,
  userFilter = null,
  folderFilter = null,
} = {}) {
  const drive = getDrive();

  const { rows } = await db.query(`
    SELECT u.email_encrypted, u.nom_encrypted, u.prenom_encrypted, u.is_active,
           ua.drive_url_copropriete, ua.drive_url_personnel,
           ua.drive_url_conseil, ua.is_conseil_syndical
    FROM user_acces ua
    JOIN users u ON u.id = ua.user_id
  `);

  const expected = buildExpectedAccesses(rows, { revokeOnly });

  const historical = await db.query('SELECT folder_id FROM drive_folders_used');

  for (const { folder_id } of historical.rows) {
    if (!expected.has(folder_id)) expected.set(folder_id, new Set());
  }

  const report = {
    granted: [],
    revoked: [],
    unchanged: [],
    errors: [],
  };

  const protectedEmails = getProtectedEmails();
  const saEmail = getSaEmail();

  for (const [folderId, authorizedEmails] of expected) {
    if (folderFilter && folderId !== folderFilter) continue;

    await syncFolder(drive, folderId, authorizedEmails, report, {
      dryRun,
      revokeOnly,
      userFilter: userFilter?.toLowerCase() || null,
      protectedEmails,
      saEmail,
    });
  }

  return {
    granted: report.granted,
    revoked: report.revoked,
    unchanged: report.unchanged,
    errors: report.errors,
    counts: {
      granted: report.granted.length,
      revoked: report.revoked.length,
      unchanged: report.unchanged.length,
      errors: report.errors.length,
    },
  };
}

module.exports = { runSync };
