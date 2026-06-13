'use strict';

/**
 * IPC layer: connects the renderer to the database. All handlers return
 * { ok: true, data } or { ok: false, error: { code, message } } so the
 * renderer can show friendly messages (e.g. for edit conflicts).
 *
 * The logged-in user is kept here in the main process; permission checks
 * (admin-only actions) are enforced on this side of the IPC boundary.
 */

const { ipcMain, dialog, shell, app } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const db = require('./db');
const settings = require('./settings');
const importer = require('./import');

const session = { user: null };

/* In-progress import sessions, keyed by an opaque token. They hold the parsed
 * file in memory between the wizard steps (analyse → preview → commit) so the
 * potentially large source file is read and parsed only once. */
const importSessions = new Map();
const IMPORT_SESSION_TTL = 60 * 60 * 1000; // 1 hour

function purgeImportSessions() {
  const now = Date.now();
  for (const [token, s] of importSessions) {
    if (now - s.createdAt > IMPORT_SESSION_TTL) importSessions.delete(token);
  }
}

function getImportSession(token) {
  purgeImportSessions();
  const s = importSessions.get(token);
  if (!s) throw new db.AppError('NOT_FOUND', 'Die Import-Sitzung ist abgelaufen. Bitte wählen Sie die Datei erneut.');
  return s;
}

function ok(data) { return { ok: true, data }; }

function fail(e) {
  if (e instanceof db.AppError) return { ok: false, error: { code: e.code, message: e.message } };
  console.error(e);
  return { ok: false, error: { code: 'INTERNAL', message: `Unerwarteter Fehler: ${e.message}` } };
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (event, payload) => {
    try {
      return ok(await fn(payload || {}, event));
    } catch (e) {
      return fail(e);
    }
  });
}

function requireUser() {
  if (!session.user) throw new db.AppError('UNAUTHORIZED', 'Bitte melden Sie sich an.');
  return session.user;
}

function requireAdmin() {
  const user = requireUser();
  if (user.role !== 'admin') {
    throw new db.AppError('FORBIDDEN', 'Diese Aktion ist Administratoren vorbehalten.');
  }
  return user;
}

function appState() {
  return {
    appVersion: app.getVersion(),
    dbPath: settings.get('databasePath'),
    dbOpen: db.isOpen(),
    needsAdmin: db.isOpen() && db.countUsers() === 0,
    currentUser: session.user,
  };
}

function tryOpenConfiguredDatabase() {
  const dbPath = settings.get('databasePath');
  if (dbPath && fs.existsSync(dbPath)) {
    try {
      db.openDatabase(dbPath);
    } catch (e) {
      console.error('Konnte konfigurierte Datenbank nicht öffnen:', e.message);
    }
  }
}

function registerIpcHandlers(getWindow) {
  /* ----- app / database selection ----- */

  handle('app:getState', () => appState());

  handle('db:create', async () => {
    const res = await dialog.showSaveDialog(getWindow(), {
      title: 'Neue Archiv-Datenbank anlegen',
      defaultPath: 'vereinsarchiv.sqlite',
      filters: [{ name: 'SQLite-Datenbank', extensions: ['sqlite'] }],
    });
    if (res.canceled || !res.filePath) return appState();
    session.user = null;
    db.openDatabase(res.filePath);
    settings.set('databasePath', res.filePath);
    return appState();
  });

  handle('db:open', async () => {
    const res = await dialog.showOpenDialog(getWindow(), {
      title: 'Bestehende Archiv-Datenbank öffnen',
      properties: ['openFile'],
      filters: [{ name: 'SQLite-Datenbank', extensions: ['sqlite', 'db'] }, { name: 'Alle Dateien', extensions: ['*'] }],
    });
    if (res.canceled || res.filePaths.length === 0) return appState();
    session.user = null;
    db.openDatabase(res.filePaths[0]);
    settings.set('databasePath', res.filePaths[0]);
    return appState();
  });

  /* ----- authentication ----- */

  handle('auth:setupAdmin', ({ username, displayName, password }) => {
    if (db.countUsers() > 0) {
      throw new db.AppError('FORBIDDEN', 'Die Ersteinrichtung wurde bereits abgeschlossen.');
    }
    const user = db.createUser({ username, displayName, password, role: 'admin' });
    session.user = user;
    return appState();
  });

  handle('auth:login', ({ username, password }) => {
    const user = db.verifyLogin(username, password);
    if (!user) {
      throw new db.AppError('AUTH_FAILED', 'Benutzername oder Passwort ist falsch (oder das Konto ist deaktiviert).');
    }
    session.user = user;
    return appState();
  });

  handle('auth:logout', () => {
    session.user = null;
    return appState();
  });

  handle('auth:changePassword', ({ currentPassword, newPassword }) => {
    const user = requireUser();
    if (!db.checkPassword(user.id, currentPassword)) {
      throw new db.AppError('AUTH_FAILED', 'Das aktuelle Passwort ist falsch.');
    }
    db.setPassword(user.id, newPassword);
    return true;
  });

  /* ----- user administration (admin only) ----- */

  handle('users:list', () => { requireAdmin(); return db.listUsers(); });
  handle('users:create', (p) => { requireAdmin(); return db.createUser(p); });
  handle('users:update', ({ id, ...rest }) => { requireAdmin(); return db.updateUser(id, rest); });
  handle('users:resetPassword', ({ id, newPassword }) => {
    requireAdmin();
    db.setPassword(id, newPassword);
    return true;
  });

  /* ----- document types ----- */

  handle('types:list', () => { requireUser(); return db.listDocTypes(); });
  handle('types:create', (p) => db.createDocType(p, requireUser()));
  handle('types:update', ({ id, ...rest }) => { requireUser(); return db.updateDocType(id, rest); });
  handle('types:delete', ({ id }) => { requireAdmin(); db.deleteDocType(id); return true; });

  /* ----- records ----- */

  handle('records:list', (p) => { requireUser(); return db.listRecords(p); });
  handle('records:get', ({ id }) => { requireUser(); return db.getRecord(id); });
  handle('records:create', (p) => db.createRecord(p, requireUser()));
  handle('records:update', ({ id, ...rest }) => db.updateRecord(id, rest, requireUser()));
  handle('records:delete', ({ id, expectedVersion }) => {
    db.deleteRecord(id, expectedVersion, requireUser());
    return true;
  });
  handle('records:history', ({ id }) => { requireUser(); return db.getRecordHistory(id); });

  /* ----- import (Citavi / Excel / CSV) ----- */

  handle('import:pickFile', async () => {
    requireAdmin();
    const res = await dialog.showOpenDialog(getWindow(), {
      title: 'Datei für den Import auswählen',
      properties: ['openFile'],
      filters: [
        { name: 'Tabellen (Excel/CSV)', extensions: ['xlsx', 'xlsm', 'csv', 'tsv', 'txt'] },
        { name: 'Alle Dateien', extensions: ['*'] },
      ],
    });
    if (res.canceled || res.filePaths.length === 0) return null;

    const filePath = res.filePaths[0];
    const { sheetName, rows } = importer.readWorkbook(filePath);
    if (rows.length < 2) {
      throw new db.AppError('VALIDATION', 'Die Datei enthält keine Datenzeilen (es wird eine Kopfzeile plus mindestens eine Zeile erwartet).');
    }
    const columns = importer.analyzeColumns(rows);
    const token = crypto.randomUUID();
    importSessions.set(token, {
      createdAt: Date.now(),
      filePath,
      sheetName,
      header: rows[0],
      dataRows: rows.slice(1),
      columns,
    });
    purgeImportSessions();
    return {
      token,
      fileName: require('path').basename(filePath),
      sheetName,
      totalRows: rows.length - 1,
      columns,
    };
  });

  handle('import:cancel', ({ token }) => {
    importSessions.delete(token);
    return true;
  });

  // Resolve the columns the user chose to keep into { index, name, fieldType }
  // and, where a new field is requested, an additive field definition.
  function resolveMapping(sessionData, mapping, type) {
    const effective = [];
    const newFieldDefs = [];
    const usedNames = new Set(type ? type.fields.map((f) => f.name) : []);
    for (const m of mapping || []) {
      if (!m || m.action === 'ignore' || m.action == null) continue;
      const col = sessionData.columns[m.index];
      if (!col) continue;
      if (m.action === 'existing') {
        const target = type && type.fields.find((f) => f.name === m.targetName);
        if (!target) throw new db.AppError('VALIDATION', `Das Zielfeld „${m.targetName}“ existiert im Dokumenttyp nicht.`);
        effective.push({ index: m.index, name: target.name, fieldType: target.field_type });
      } else if (m.action === 'new') {
        let name = importer.deriveFieldName(m.name || m.label || col.suggestedLabel);
        let base = name;
        let n = 2;
        while (usedNames.has(name)) name = `${base}_${n++}`.slice(0, 50);
        usedNames.add(name);
        const fieldType = m.fieldType || col.inferredType || 'text';
        newFieldDefs.push({
          name,
          label: String(m.label || col.suggestedLabel).trim() || name,
          field_type: fieldType,
          required: !!m.required,
        });
        effective.push({ index: m.index, name, fieldType });
      }
    }
    return { effective, newFieldDefs };
  }

  function resolveTargetType(target) {
    if (target && target.mode === 'existing') {
      return db.getDocType(target.docTypeId);
    }
    return null; // new type – created on commit
  }

  handle('import:preview', ({ token, target, mapping, archiveId, dedupeColumns }) => {
    requireAdmin();
    const s = getImportSession(token);
    const type = resolveTargetType(target);
    const { effective } = resolveMapping(s, mapping, type);
    const built = importer.buildImportRows(s.dataRows, effective, archiveId || { mode: 'generate', prefix: 'IMP-' });

    // Redundancy within the file, on the chosen key columns (default: the
    // archive-id source column, if any).
    let keyIndices = Array.isArray(dedupeColumns) && dedupeColumns.length
      ? dedupeColumns
      : (archiveId && archiveId.mode === 'column' ? [archiveId.index] : []);
    keyIndices = keyIndices.filter((i) => Number.isInteger(i) && i >= 0);
    const withinFile = keyIndices.length
      ? importer.findDuplicates(s.dataRows, keyIndices)
      : { duplicateGroups: 0, duplicateRows: 0, examples: [] };

    // Collisions with archive ids already in the database.
    const existing = db.findExistingArchiveIds(built.map((r) => r.archiveId));
    const seen = new Set();
    let existingCollisions = 0;
    let emptyIds = 0;
    const collisionExamples = [];
    for (const r of built) {
      if (!r.archiveId) { emptyIds++; continue; }
      const lower = r.archiveId.toLowerCase();
      if (existing.has(lower) && !seen.has(lower)) {
        existingCollisions++;
        if (collisionExamples.length < 10) collisionExamples.push(r.archiveId);
      }
      seen.add(lower);
    }

    return {
      totalRows: built.length,
      mappedFields: effective.length,
      withinFile,
      existingCollisions,
      collisionExamples,
      emptyIds,
    };
  });

  handle('import:commit', ({ token, target, mapping, archiveId, onDuplicate }) => {
    const actor = requireAdmin();
    const s = getImportSession(token);

    let docTypeId;
    let type = resolveTargetType(target);
    const { effective, newFieldDefs } = resolveMapping(s, mapping, type);
    if (effective.length === 0) {
      throw new db.AppError('VALIDATION', 'Es wurde keine Spalte zur Übernahme ausgewählt.');
    }

    if (type) {
      // Existing type: add any brand-new fields to its definition (record data
      // of existing entries is preserved by updateDocType).
      if (newFieldDefs.length > 0) {
        const fields = [
          ...type.fields.map((f) => ({ name: f.name, label: f.label, field_type: f.field_type, required: f.required, options: f.options })),
          ...newFieldDefs,
        ];
        type = db.updateDocType(type.id, { name: type.name, icon: type.icon, fields });
      }
      docTypeId = type.id;
    } else {
      // New type: the kept columns become its fields.
      if (newFieldDefs.length === 0) {
        throw new db.AppError('VALIDATION', 'Für einen neuen Dokumenttyp muss mindestens ein neues Feld angelegt werden.');
      }
      const created = db.createDocType({
        name: (target && target.newTypeName) || 'Import',
        icon: (target && target.newTypeIcon) || '📥',
        fields: newFieldDefs,
      }, actor);
      docTypeId = created.id;
    }

    const built = importer.buildImportRows(s.dataRows, effective, archiveId || { mode: 'generate', prefix: 'IMP-' });
    const summary = db.importRecords({
      docTypeId,
      rows: built,
      onDuplicate: onDuplicate === 'overwrite' ? 'overwrite' : 'skip',
    }, actor);

    importSessions.delete(token);
    return { ...summary, docTypeId };
  });

  /* ----- dashboard ----- */

  handle('stats:get', () => { requireUser(); return db.getStats(); });

  /* ----- file helpers (for "filepath" fields) ----- */

  handle('file:pick', async () => {
    requireUser();
    const res = await dialog.showOpenDialog(getWindow(), {
      title: 'Datei auswählen', properties: ['openFile'],
    });
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
  });

  handle('file:openPath', async ({ filePath }) => {
    requireUser();
    if (typeof filePath !== 'string' || !fs.existsSync(filePath)) {
      throw new db.AppError('NOT_FOUND', 'Die Datei wurde nicht gefunden: ' + filePath);
    }
    const err = await shell.openPath(filePath);
    if (err) throw new db.AppError('OPEN_FAILED', err);
    return true;
  });

  handle('file:showInFolder', ({ filePath }) => {
    requireUser();
    if (typeof filePath !== 'string' || !fs.existsSync(filePath)) {
      throw new db.AppError('NOT_FOUND', 'Die Datei wurde nicht gefunden: ' + filePath);
    }
    shell.showItemInFolder(filePath);
    return true;
  });
}

module.exports = { registerIpcHandlers, tryOpenConfiguredDatabase, session };
