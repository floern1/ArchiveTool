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
const fs = require('fs');
const db = require('./db');
const settings = require('./settings');

const session = { user: null };

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
