'use strict';

/**
 * Database layer of Archivverwaltung-BGV-WK.
 *
 * The SQLite file typically lives on a shared network drive and is opened by
 * several application instances at the same time. Two mechanisms keep
 * concurrent use safe:
 *
 *  1. SQLite file locking (journal_mode=DELETE, never WAL — WAL relies on
 *     shared memory and does not work across network file systems) plus a
 *     generous busy_timeout, so parallel commits queue up instead of failing.
 *  2. Optimistic locking on application level: every record carries a
 *     `version` counter. Updates and deletes must present the version they
 *     were based on; if another user committed in the meantime the operation
 *     is rejected with a CONFLICT error and the caller can reload.
 *
 * Every create/update/delete of a record writes a full snapshot into
 * `record_history`, so it is always traceable who changed what and when.
 */

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { hashPassword, verifyPassword } = require('./auth');

const SCHEMA_VERSION = 1;

const FIELD_TYPES = ['text', 'textarea', 'number', 'date', 'filepath', 'boolean', 'select'];

/** Alphanumeric ID, separators . _ / - allowed inside (common in archive signatures). */
const ARCHIVE_ID_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._/ -]*[A-Za-z0-9])?$/;
const ARCHIVE_ID_MAX = 100;

class AppError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

let db = null;

/* ------------------------------------------------------------------ */
/* Connection / schema                                                 */
/* ------------------------------------------------------------------ */

function openDatabase(filePath) {
  closeDatabase();
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    throw new AppError('NO_SUCH_DIR', `Verzeichnis existiert nicht: ${dir}`);
  }
  db = new Database(filePath);
  // DELETE journal (not WAL): safe on SMB/NFS network shares.
  db.pragma('journal_mode = DELETE');
  // FULL sync: maximum durability, important on network file systems.
  db.pragma('synchronous = FULL');
  // Wait up to 15s for locks held by other club members before giving up.
  db.pragma('busy_timeout = 15000');
  db.pragma('foreign_keys = ON');
  migrate();
  return filePath;
}

function closeDatabase() {
  if (db) {
    try { db.close(); } catch (_) { /* ignore */ }
    db = null;
  }
}

function isOpen() {
  return db !== null;
}

function requireDb() {
  if (!db) throw new AppError('NO_DATABASE', 'Keine Datenbank geöffnet.');
  return db;
}

function migrate() {
  const userVersion = db.pragma('user_version', { simple: true });
  if (userVersion >= SCHEMA_VERSION) return;

  const tx = db.transaction(() => {
    db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name  TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','member')),
        active        INTEGER NOT NULL DEFAULT 1,
        created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE IF NOT EXISTS doc_types (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
        icon       TEXT NOT NULL DEFAULT '📄',
        created_by INTEGER REFERENCES users(id),
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );

      CREATE TABLE IF NOT EXISTS doc_type_fields (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        doc_type_id INTEGER NOT NULL REFERENCES doc_types(id) ON DELETE CASCADE,
        name        TEXT NOT NULL,
        label       TEXT NOT NULL,
        field_type  TEXT NOT NULL CHECK (field_type IN
                      ('text','textarea','number','date','filepath','boolean','select')),
        required    INTEGER NOT NULL DEFAULT 0,
        options     TEXT,
        sort_order  INTEGER NOT NULL DEFAULT 0,
        UNIQUE (doc_type_id, name)
      );

      CREATE TABLE IF NOT EXISTS records (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        archive_id  TEXT NOT NULL UNIQUE COLLATE NOCASE,
        doc_type_id INTEGER NOT NULL REFERENCES doc_types(id),
        data        TEXT NOT NULL DEFAULT '{}',
        version     INTEGER NOT NULL DEFAULT 1,
        created_by  INTEGER REFERENCES users(id),
        created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
        updated_by  INTEGER REFERENCES users(id),
        updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX IF NOT EXISTS idx_records_type ON records(doc_type_id);
      CREATE INDEX IF NOT EXISTS idx_records_updated ON records(updated_at);

      CREATE TABLE IF NOT EXISTS record_history (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        record_id       INTEGER NOT NULL,
        archive_id      TEXT NOT NULL,
        doc_type_id     INTEGER NOT NULL,
        version         INTEGER NOT NULL,
        action          TEXT NOT NULL CHECK (action IN ('create','update','delete')),
        data            TEXT NOT NULL,
        changed_by      INTEGER REFERENCES users(id),
        changed_by_name TEXT NOT NULL DEFAULT '',
        changed_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
      );
      CREATE INDEX IF NOT EXISTS idx_history_record ON record_history(record_id);
      CREATE INDEX IF NOT EXISTS idx_history_time ON record_history(changed_at);
    `);
    db.pragma(`user_version = ${SCHEMA_VERSION}`);
  });
  tx();
}

/* ------------------------------------------------------------------ */
/* Validation helpers                                                  */
/* ------------------------------------------------------------------ */

function validateArchiveId(archiveId) {
  if (typeof archiveId !== 'string' || archiveId.trim() === '') {
    throw new AppError('VALIDATION', 'Die Archiv-ID ist ein Pflichtfeld.');
  }
  const id = archiveId.trim();
  if (id.length > ARCHIVE_ID_MAX) {
    throw new AppError('VALIDATION', `Die Archiv-ID darf höchstens ${ARCHIVE_ID_MAX} Zeichen lang sein.`);
  }
  if (!ARCHIVE_ID_RE.test(id)) {
    throw new AppError('VALIDATION',
      'Die Archiv-ID muss alphanumerisch sein (erlaubte Trennzeichen: Punkt, Unterstrich, Schrägstrich, Bindestrich, Leerzeichen; Beginn und Ende mit Buchstabe/Ziffer).');
  }
  return id;
}

function isEmptyValue(v) {
  return v === undefined || v === null || v === '' || v === false;
}

/** Validate and normalize record data against the field definitions of its type. */
function validateRecordData(fields, data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new AppError('VALIDATION', 'Ungültige Felddaten.');
  }
  const clean = {};
  for (const field of fields) {
    let value = data[field.name];
    if (typeof value === 'string') value = value.trim();
    if (isEmptyValue(value)) {
      if (field.required) {
        throw new AppError('VALIDATION', `Das Feld „${field.label}“ ist ein Pflichtfeld.`);
      }
      continue;
    }
    switch (field.field_type) {
      case 'text':
      case 'textarea':
      case 'filepath':
        if (typeof value !== 'string') {
          throw new AppError('VALIDATION', `Das Feld „${field.label}“ muss Text sein.`);
        }
        clean[field.name] = value;
        break;
      case 'number': {
        const num = typeof value === 'number' ? value : Number(String(value).replace(',', '.'));
        if (!Number.isFinite(num)) {
          throw new AppError('VALIDATION', `Das Feld „${field.label}“ muss eine Zahl sein.`);
        }
        clean[field.name] = num;
        break;
      }
      case 'date':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value)) || Number.isNaN(Date.parse(value))) {
          throw new AppError('VALIDATION', `Das Feld „${field.label}“ muss ein gültiges Datum (JJJJ-MM-TT) sein.`);
        }
        clean[field.name] = String(value);
        break;
      case 'boolean':
        clean[field.name] = value === true || value === 'true' || value === 1;
        break;
      case 'select': {
        // options is an array when fields come from getDocType(), a JSON string when raw from the table
        const options = Array.isArray(field.options) ? field.options : JSON.parse(field.options || '[]');
        if (!options.includes(value)) {
          throw new AppError('VALIDATION', `Ungültiger Wert für das Feld „${field.label}“.`);
        }
        clean[field.name] = value;
        break;
      }
      default:
        throw new AppError('VALIDATION', `Unbekannter Feldtyp: ${field.field_type}`);
    }
  }
  return clean;
}

const FIELD_NAME_RE = /^[a-z][a-z0-9_]{0,49}$/;

function validateFieldDefs(fields) {
  if (!Array.isArray(fields) || fields.length === 0) {
    throw new AppError('VALIDATION', 'Ein Dokumenttyp braucht mindestens ein Eingabefeld.');
  }
  const seen = new Set();
  return fields.map((f, i) => {
    const label = String(f.label || '').trim();
    if (!label) throw new AppError('VALIDATION', 'Jedes Feld braucht eine Bezeichnung.');
    let name = String(f.name || '').trim();
    if (!name) {
      // Derive a technical name from the label (used as JSON key).
      name = label.toLowerCase()
        .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
        .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50);
      if (!/^[a-z]/.test(name)) name = 'f_' + name;
    }
    if (!FIELD_NAME_RE.test(name)) {
      throw new AppError('VALIDATION', `Ungültiger technischer Feldname: ${name}`);
    }
    if (seen.has(name)) {
      throw new AppError('VALIDATION', `Doppelter Feldname: ${name}`);
    }
    seen.add(name);
    if (!FIELD_TYPES.includes(f.field_type)) {
      throw new AppError('VALIDATION', `Ungültiger Feldtyp: ${f.field_type}`);
    }
    let options = null;
    if (f.field_type === 'select') {
      const opts = (Array.isArray(f.options) ? f.options : String(f.options || '').split('\n'))
        .map((o) => String(o).trim()).filter(Boolean);
      if (opts.length === 0) {
        throw new AppError('VALIDATION', `Das Auswahlfeld „${label}“ braucht mindestens eine Option.`);
      }
      options = JSON.stringify(opts);
    }
    return {
      name,
      label,
      field_type: f.field_type,
      required: f.required ? 1 : 0,
      options,
      sort_order: i,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

function countUsers() {
  return requireDb().prepare('SELECT COUNT(*) AS n FROM users').get().n;
}

function sanitizeUser(row) {
  if (!row) return null;
  const { password_hash, ...rest } = row;
  return rest;
}

function createUser({ username, displayName, password, role }) {
  const d = requireDb();
  username = String(username || '').trim();
  if (!/^[A-Za-z0-9._-]{2,40}$/.test(username)) {
    throw new AppError('VALIDATION', 'Benutzername: 2–40 Zeichen, Buchstaben/Ziffern/._-');
  }
  if (typeof password !== 'string' || password.length < 6) {
    throw new AppError('VALIDATION', 'Das Passwort muss mindestens 6 Zeichen lang sein.');
  }
  if (!['admin', 'member'].includes(role)) role = 'member';
  const display = String(displayName || '').trim() || username;
  try {
    const info = d.prepare(
      'INSERT INTO users (username, display_name, password_hash, role) VALUES (?, ?, ?, ?)'
    ).run(username, display, hashPassword(password), role);
    return sanitizeUser(d.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid));
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) {
      throw new AppError('VALIDATION', `Der Benutzername „${username}“ ist bereits vergeben.`);
    }
    throw e;
  }
}

function listUsers() {
  return requireDb().prepare('SELECT * FROM users ORDER BY username').all().map(sanitizeUser);
}

function updateUser(id, { displayName, role, active }) {
  const d = requireDb();
  const user = d.prepare('SELECT * FROM users WHERE id = ?').get(id);
  if (!user) throw new AppError('NOT_FOUND', 'Benutzer nicht gefunden.');
  const newRole = ['admin', 'member'].includes(role) ? role : user.role;
  const newActive = active === undefined ? user.active : (active ? 1 : 0);
  // Never lock out the last active administrator.
  if (user.role === 'admin' && (newRole !== 'admin' || newActive === 0)) {
    const admins = d.prepare(
      "SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1 AND id != ?"
    ).get(id).n;
    if (admins === 0) {
      throw new AppError('VALIDATION', 'Der letzte aktive Administrator kann nicht deaktiviert oder herabgestuft werden.');
    }
  }
  d.prepare('UPDATE users SET display_name = ?, role = ?, active = ? WHERE id = ?')
    .run(String(displayName || '').trim() || user.display_name, newRole, newActive, id);
  return sanitizeUser(d.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

function setPassword(userId, newPassword) {
  const d = requireDb();
  if (typeof newPassword !== 'string' || newPassword.length < 6) {
    throw new AppError('VALIDATION', 'Das Passwort muss mindestens 6 Zeichen lang sein.');
  }
  const info = d.prepare('UPDATE users SET password_hash = ? WHERE id = ?')
    .run(hashPassword(newPassword), userId);
  if (info.changes === 0) throw new AppError('NOT_FOUND', 'Benutzer nicht gefunden.');
}

function verifyLogin(username, password) {
  const d = requireDb();
  const user = d.prepare('SELECT * FROM users WHERE username = ?').get(String(username || '').trim());
  if (!user || !user.active || !verifyPassword(password, user.password_hash)) {
    return null;
  }
  return sanitizeUser(user);
}

function checkPassword(userId, password) {
  const user = requireDb().prepare('SELECT * FROM users WHERE id = ?').get(userId);
  return !!user && verifyPassword(password, user.password_hash);
}

/* ------------------------------------------------------------------ */
/* Document types                                                      */
/* ------------------------------------------------------------------ */

function rowToDocType(row, d) {
  const fields = d.prepare(
    'SELECT id, name, label, field_type, required, options, sort_order FROM doc_type_fields WHERE doc_type_id = ? ORDER BY sort_order, id'
  ).all(row.id).map((f) => ({ ...f, required: !!f.required, options: f.options ? JSON.parse(f.options) : null }));
  const recordCount = d.prepare('SELECT COUNT(*) AS n FROM records WHERE doc_type_id = ?').get(row.id).n;
  return { ...row, fields, recordCount };
}

function listDocTypes() {
  const d = requireDb();
  return d.prepare('SELECT * FROM doc_types ORDER BY name').all().map((r) => rowToDocType(r, d));
}

function getDocType(id) {
  const d = requireDb();
  const row = d.prepare('SELECT * FROM doc_types WHERE id = ?').get(id);
  if (!row) throw new AppError('NOT_FOUND', 'Dokumenttyp nicht gefunden.');
  return rowToDocType(row, d);
}

function createDocType({ name, icon, fields }, actor) {
  const d = requireDb();
  name = String(name || '').trim();
  if (!name) throw new AppError('VALIDATION', 'Der Dokumenttyp braucht einen Namen.');
  const defs = validateFieldDefs(fields);
  const tx = d.transaction(() => {
    let info;
    try {
      info = d.prepare('INSERT INTO doc_types (name, icon, created_by) VALUES (?, ?, ?)')
        .run(name, String(icon || '📄').slice(0, 8), actor ? actor.id : null);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        throw new AppError('VALIDATION', `Es gibt bereits einen Dokumenttyp namens „${name}“.`);
      }
      throw e;
    }
    const ins = d.prepare(
      'INSERT INTO doc_type_fields (doc_type_id, name, label, field_type, required, options, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const f of defs) {
      ins.run(info.lastInsertRowid, f.name, f.label, f.field_type, f.required, f.options, f.sort_order);
    }
    return info.lastInsertRowid;
  });
  return getDocType(tx());
}

function updateDocType(id, { name, icon, fields }) {
  const d = requireDb();
  const existing = d.prepare('SELECT * FROM doc_types WHERE id = ?').get(id);
  if (!existing) throw new AppError('NOT_FOUND', 'Dokumenttyp nicht gefunden.');
  name = String(name || '').trim() || existing.name;
  const defs = validateFieldDefs(fields);
  const tx = d.transaction(() => {
    try {
      d.prepare('UPDATE doc_types SET name = ?, icon = ? WHERE id = ?')
        .run(name, String(icon || existing.icon).slice(0, 8), id);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        throw new AppError('VALIDATION', `Es gibt bereits einen Dokumenttyp namens „${name}“.`);
      }
      throw e;
    }
    // Replace field definitions; record data is stored as JSON snapshots and
    // therefore unaffected (values of removed fields stay in the records).
    d.prepare('DELETE FROM doc_type_fields WHERE doc_type_id = ?').run(id);
    const ins = d.prepare(
      'INSERT INTO doc_type_fields (doc_type_id, name, label, field_type, required, options, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    for (const f of defs) {
      ins.run(id, f.name, f.label, f.field_type, f.required, f.options, f.sort_order);
    }
  });
  tx();
  return getDocType(id);
}

function deleteDocType(id) {
  const d = requireDb();
  const count = d.prepare('SELECT COUNT(*) AS n FROM records WHERE doc_type_id = ?').get(id).n;
  if (count > 0) {
    throw new AppError('VALIDATION',
      `Der Dokumenttyp kann nicht gelöscht werden, es existieren noch ${count} Einträge dieses Typs.`);
  }
  const info = d.prepare('DELETE FROM doc_types WHERE id = ?').run(id);
  if (info.changes === 0) throw new AppError('NOT_FOUND', 'Dokumenttyp nicht gefunden.');
}

/* ------------------------------------------------------------------ */
/* Records                                                             */
/* ------------------------------------------------------------------ */

function rowToRecord(row) {
  return { ...row, data: JSON.parse(row.data) };
}

function writeHistory(d, record, action, actor) {
  d.prepare(`
    INSERT INTO record_history (record_id, archive_id, doc_type_id, version, action, data, changed_by, changed_by_name)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id, record.archive_id, record.doc_type_id, record.version, action,
    record.data, actor ? actor.id : null, actor ? actor.display_name : 'System'
  );
}

function createRecord({ archiveId, docTypeId, data }, actor) {
  const d = requireDb();
  const type = getDocType(docTypeId);
  const id = validateArchiveId(archiveId);
  const clean = validateRecordData(type.fields, data || {});
  const tx = d.transaction(() => {
    let info;
    try {
      info = d.prepare(
        'INSERT INTO records (archive_id, doc_type_id, data, created_by, updated_by) VALUES (?, ?, ?, ?, ?)'
      ).run(id, docTypeId, JSON.stringify(clean), actor ? actor.id : null, actor ? actor.id : null);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        throw new AppError('DUPLICATE_ID', `Die Archiv-ID „${id}“ ist bereits vergeben.`);
      }
      throw e;
    }
    const row = d.prepare('SELECT * FROM records WHERE id = ?').get(info.lastInsertRowid);
    writeHistory(d, row, 'create', actor);
    return row;
  });
  return rowToRecord(tx());
}

function conflictError(d, row) {
  const name = row.updated_by
    ? (d.prepare('SELECT display_name FROM users WHERE id = ?').get(row.updated_by) || {}).display_name
    : null;
  const when = new Date(row.updated_at);
  const stamp = Number.isNaN(when.getTime())
    ? row.updated_at
    : when.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  return new AppError('CONFLICT',
    `Der Eintrag wurde zwischenzeitlich ${name ? `von ${name} ` : ''}geändert (Stand: ${stamp} Uhr). ` +
    'Bitte laden Sie den Eintrag neu und übernehmen Sie Ihre Änderungen erneut.');
}

function updateRecord(id, { archiveId, data, expectedVersion }, actor) {
  const d = requireDb();
  const current = d.prepare('SELECT * FROM records WHERE id = ?').get(id);
  if (!current) throw new AppError('NOT_FOUND', 'Eintrag nicht gefunden (möglicherweise gelöscht).');
  const type = getDocType(current.doc_type_id);
  const newId = validateArchiveId(archiveId);
  const clean = validateRecordData(type.fields, data || {});
  const tx = d.transaction(() => {
    let info;
    try {
      // Optimistic lock: only update if nobody else bumped the version.
      info = d.prepare(
        'UPDATE records SET archive_id = ?, data = ?, version = version + 1, updated_by = ?, ' +
        "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND version = ?"
      ).run(newId, JSON.stringify(clean), actor ? actor.id : null, id, expectedVersion);
    } catch (e) {
      if (String(e.message).includes('UNIQUE')) {
        throw new AppError('DUPLICATE_ID', `Die Archiv-ID „${newId}“ ist bereits vergeben.`);
      }
      throw e;
    }
    if (info.changes === 0) {
      const row = d.prepare('SELECT * FROM records WHERE id = ?').get(id);
      if (!row) throw new AppError('NOT_FOUND', 'Der Eintrag wurde zwischenzeitlich gelöscht.');
      throw conflictError(d, row);
    }
    const row = d.prepare('SELECT * FROM records WHERE id = ?').get(id);
    writeHistory(d, row, 'update', actor);
    return row;
  });
  return rowToRecord(tx());
}

function deleteRecord(id, expectedVersion, actor) {
  const d = requireDb();
  const tx = d.transaction(() => {
    const current = d.prepare('SELECT * FROM records WHERE id = ?').get(id);
    if (!current) throw new AppError('NOT_FOUND', 'Eintrag nicht gefunden (möglicherweise bereits gelöscht).');
    if (current.version !== expectedVersion) throw conflictError(d, current);
    // History row outlives the record and documents the deletion.
    writeHistory(d, { ...current, version: current.version + 1 }, 'delete', actor);
    d.prepare('DELETE FROM records WHERE id = ? AND version = ?').run(id, expectedVersion);
  });
  tx();
}

function getRecord(id) {
  const d = requireDb();
  const row = d.prepare(`
    SELECT r.*, cu.display_name AS created_by_name, uu.display_name AS updated_by_name
    FROM records r
    LEFT JOIN users cu ON cu.id = r.created_by
    LEFT JOIN users uu ON uu.id = r.updated_by
    WHERE r.id = ?
  `).get(id);
  if (!row) throw new AppError('NOT_FOUND', 'Eintrag nicht gefunden.');
  return rowToRecord(row);
}

const SORTABLE = {
  archive_id: 'r.archive_id COLLATE NOCASE',
  created_at: 'r.created_at',
  updated_at: 'r.updated_at',
};

function listRecords({ docTypeId, search, fieldFilters, sort, dir, limit, offset } = {}) {
  const d = requireDb();
  const where = [];
  const params = [];
  if (docTypeId) {
    where.push('r.doc_type_id = ?');
    params.push(docTypeId);
  }
  if (search && String(search).trim()) {
    const like = `%${String(search).trim().replace(/[%_\\]/g, '\\$&')}%`;
    where.push(`(r.archive_id LIKE ? ESCAPE '\\' OR EXISTS (
        SELECT 1 FROM json_each(r.data) je
        WHERE CAST(je.value AS TEXT) LIKE ? ESCAPE '\\'))`);
    params.push(like, like);
  }
  if (fieldFilters && typeof fieldFilters === 'object') {
    for (const [name, value] of Object.entries(fieldFilters)) {
      if (isEmptyValue(value) || !FIELD_NAME_RE.test(name)) continue;
      where.push(`CAST(json_extract(r.data, '$.' || ?) AS TEXT) LIKE ? ESCAPE '\\'`);
      params.push(name, `%${String(value).trim().replace(/[%_\\]/g, '\\$&')}%`);
    }
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const orderCol = SORTABLE[sort] || SORTABLE.archive_id;
  const orderDir = dir === 'desc' ? 'DESC' : 'ASC';
  const lim = Math.min(Math.max(Number(limit) || 50, 1), 500);
  const off = Math.max(Number(offset) || 0, 0);

  const total = d.prepare(`SELECT COUNT(*) AS n FROM records r ${whereSql}`).get(...params).n;
  const rows = d.prepare(`
    SELECT r.id, r.archive_id, r.doc_type_id, r.data, r.version,
           r.created_at, r.updated_at,
           t.name AS doc_type_name, t.icon AS doc_type_icon,
           uu.display_name AS updated_by_name
    FROM records r
    JOIN doc_types t ON t.id = r.doc_type_id
    LEFT JOIN users uu ON uu.id = r.updated_by
    ${whereSql}
    ORDER BY ${orderCol} ${orderDir}
    LIMIT ? OFFSET ?
  `).all(...params, lim, off);
  return { total, limit: lim, offset: off, records: rows.map(rowToRecord) };
}

function getRecordHistory(recordId) {
  const d = requireDb();
  return d.prepare(`
    SELECT h.*, COALESCE(u.display_name, h.changed_by_name) AS changed_by_display
    FROM record_history h
    LEFT JOIN users u ON u.id = h.changed_by
    WHERE h.record_id = ?
    ORDER BY h.version DESC, h.id DESC
  `).all(recordId).map((r) => ({ ...r, data: JSON.parse(r.data) }));
}

/* ------------------------------------------------------------------ */
/* Dashboard                                                           */
/* ------------------------------------------------------------------ */

function getStats() {
  const d = requireDb();
  const totalRecords = d.prepare('SELECT COUNT(*) AS n FROM records').get().n;
  const totalTypes = d.prepare('SELECT COUNT(*) AS n FROM doc_types').get().n;
  const totalUsers = d.prepare('SELECT COUNT(*) AS n FROM users WHERE active = 1').get().n;
  const totalChanges = d.prepare('SELECT COUNT(*) AS n FROM record_history').get().n;
  const byType = d.prepare(`
    SELECT t.id, t.name, t.icon, COUNT(r.id) AS count
    FROM doc_types t LEFT JOIN records r ON r.doc_type_id = t.id
    GROUP BY t.id ORDER BY count DESC, t.name
  `).all();
  const perMonth = d.prepare(`
    SELECT strftime('%Y-%m', created_at) AS month, COUNT(*) AS count
    FROM records
    WHERE created_at >= datetime('now', '-11 months', 'start of month')
    GROUP BY month ORDER BY month
  `).all();
  const recentActivity = d.prepare(`
    SELECT h.action, h.archive_id, h.record_id, h.changed_at,
           COALESCE(u.display_name, h.changed_by_name) AS changed_by_display,
           t.name AS doc_type_name, t.icon AS doc_type_icon
    FROM record_history h
    LEFT JOIN users u ON u.id = h.changed_by
    LEFT JOIN doc_types t ON t.id = h.doc_type_id
    ORDER BY h.id DESC LIMIT 12
  `).all();
  const topContributors = d.prepare(`
    SELECT COALESCE(u.display_name, h.changed_by_name) AS name, COUNT(*) AS count
    FROM record_history h LEFT JOIN users u ON u.id = h.changed_by
    GROUP BY name ORDER BY count DESC LIMIT 5
  `).all();
  return { totalRecords, totalTypes, totalUsers, totalChanges, byType, perMonth, recentActivity, topContributors };
}

module.exports = {
  AppError,
  FIELD_TYPES,
  openDatabase,
  closeDatabase,
  isOpen,
  // users
  countUsers,
  createUser,
  listUsers,
  updateUser,
  setPassword,
  verifyLogin,
  checkPassword,
  // doc types
  listDocTypes,
  getDocType,
  createDocType,
  updateDocType,
  deleteDocType,
  // records
  listRecords,
  getRecord,
  createRecord,
  updateRecord,
  deleteRecord,
  getRecordHistory,
  // dashboard
  getStats,
};
