'use strict';

/* Test suite for the database layer: users/login, document types, records,
 * validation, optimistic locking (edit conflicts) and the change history. */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const db = require('../src/main/db');
const { hashPassword, verifyPassword } = require('../src/main/auth');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'archivtool-test-'));
const dbFile = path.join(tmpDir, 'test.sqlite');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.error(`  ✗ ${name}`);
    console.error(`    ${e.message}`);
  }
}

function expectError(code, fn) {
  try {
    fn();
  } catch (e) {
    assert.strictEqual(e.code, code, `expected error code ${code}, got ${e.code}: ${e.message}`);
    return e;
  }
  assert.fail(`expected error with code ${code}, but no error was thrown`);
}

console.log('\n— Passwort-Hashing —');

test('hash + verify roundtrip', () => {
  const hash = hashPassword('geheim123');
  assert.ok(hash.startsWith('scrypt$'));
  assert.strictEqual(verifyPassword('geheim123', hash), true);
  assert.strictEqual(verifyPassword('falsch', hash), false);
});

test('verify tolerates garbage input', () => {
  assert.strictEqual(verifyPassword('x', 'kaputt'), false);
  assert.strictEqual(verifyPassword('x', null), false);
});

console.log('\n— Datenbank / Benutzer —');

db.openDatabase(dbFile);

let admin;
let member;

test('database is created and empty', () => {
  assert.strictEqual(db.countUsers(), 0);
});

test('create admin + member', () => {
  admin = db.createUser({ username: 'maria', displayName: 'Maria Schmidt', password: 'geheim123', role: 'admin' });
  member = db.createUser({ username: 'karl', displayName: 'Karl Weber', password: 'archiv456', role: 'member' });
  assert.strictEqual(admin.role, 'admin');
  assert.strictEqual(member.role, 'member');
  assert.strictEqual(admin.password_hash, undefined, 'hash must never leave the db layer');
});

test('duplicate username rejected (case-insensitive)', () => {
  expectError('VALIDATION', () => db.createUser({ username: 'MARIA', password: 'xxxxxx', role: 'member' }));
});

test('short password rejected', () => {
  expectError('VALIDATION', () => db.createUser({ username: 'neu', password: '123', role: 'member' }));
});

test('login works, wrong password fails', () => {
  assert.ok(db.verifyLogin('maria', 'geheim123'));
  assert.strictEqual(db.verifyLogin('maria', 'falsch'), null);
  assert.strictEqual(db.verifyLogin('unbekannt', 'geheim123'), null);
});

test('deactivated user cannot log in', () => {
  db.updateUser(member.id, { displayName: member.display_name, role: 'member', active: false });
  assert.strictEqual(db.verifyLogin('karl', 'archiv456'), null);
  db.updateUser(member.id, { displayName: member.display_name, role: 'member', active: true });
  assert.ok(db.verifyLogin('karl', 'archiv456'));
});

test('last active admin cannot be demoted or deactivated', () => {
  expectError('VALIDATION', () => db.updateUser(admin.id, { displayName: 'Maria', role: 'member' }));
  expectError('VALIDATION', () => db.updateUser(admin.id, { displayName: 'Maria', role: 'admin', active: false }));
});

test('password reset', () => {
  db.setPassword(member.id, 'neues-pw');
  assert.ok(db.verifyLogin('karl', 'neues-pw'));
});

console.log('\n— Dokumenttypen —');

let bookType;

test('create doc type with typed fields', () => {
  bookType = db.createDocType({
    name: 'Bücher',
    icon: '📕',
    fields: [
      { label: 'Titel', field_type: 'text', required: true },
      { label: 'Autor', field_type: 'text' },
      { label: 'Erscheinungsjahr', field_type: 'number' },
      { label: 'Aufnahmedatum', field_type: 'date' },
      { label: 'Digitalisat', field_type: 'filepath' },
      { label: 'Ausgeliehen', field_type: 'boolean' },
      { label: 'Zustand', field_type: 'select', options: ['gut', 'mittel', 'schlecht'] },
    ],
  }, admin);
  assert.strictEqual(bookType.fields.length, 7);
  assert.strictEqual(bookType.fields[0].name, 'titel');
  assert.deepStrictEqual(bookType.fields[6].options, ['gut', 'mittel', 'schlecht']);
});

test('duplicate type name rejected', () => {
  expectError('VALIDATION', () => db.createDocType({ name: 'bücher', fields: [{ label: 'X', field_type: 'text' }] }, admin));
});

test('type without fields rejected', () => {
  expectError('VALIDATION', () => db.createDocType({ name: 'Leer', fields: [] }, admin));
});

test('select field without options rejected', () => {
  expectError('VALIDATION', () => db.createDocType({
    name: 'Kaputt', fields: [{ label: 'Wahl', field_type: 'select', options: [] }],
  }, admin));
});

test('unknown field type rejected', () => {
  expectError('VALIDATION', () => db.createDocType({
    name: 'Kaputt2', fields: [{ label: 'X', field_type: 'blob' }],
  }, admin));
});

console.log('\n— Einträge: Validierung —');

let record;

test('mandatory alphanumeric archive id is enforced', () => {
  expectError('VALIDATION', () => db.createRecord({ archiveId: '', docTypeId: bookType.id, data: { titel: 'T' } }, admin));
  expectError('VALIDATION', () => db.createRecord({ archiveId: '   ', docTypeId: bookType.id, data: { titel: 'T' } }, admin));
  expectError('VALIDATION', () => db.createRecord({ archiveId: 'AB%01', docTypeId: bookType.id, data: { titel: 'T' } }, admin));
  expectError('VALIDATION', () => db.createRecord({ archiveId: '-AB01', docTypeId: bookType.id, data: { titel: 'T' } }, admin));
});

test('required custom field is enforced', () => {
  expectError('VALIDATION', () => db.createRecord({ archiveId: 'BUCH-001', docTypeId: bookType.id, data: {} }, admin));
});

test('create record with full validation/normalization', () => {
  record = db.createRecord({
    archiveId: 'BUCH-001',
    docTypeId: bookType.id,
    data: {
      titel: '  Dorfchronik 1850–1950  ',
      autor: 'H. Meier',
      erscheinungsjahr: '1952',
      aufnahmedatum: '2026-06-12',
      ausgeliehen: false,
      zustand: 'gut',
    },
  }, admin);
  assert.strictEqual(record.archive_id, 'BUCH-001');
  assert.strictEqual(record.version, 1);
  assert.strictEqual(record.data.titel, 'Dorfchronik 1850–1950', 'values are trimmed');
  assert.strictEqual(record.data.erscheinungsjahr, 1952, 'numbers are normalized');
});

test('duplicate archive id rejected (case-insensitive)', () => {
  expectError('DUPLICATE_ID', () => db.createRecord({ archiveId: 'buch-001', docTypeId: bookType.id, data: { titel: 'X' } }, admin));
});

test('bad number / date / select values rejected', () => {
  expectError('VALIDATION', () => db.createRecord({ archiveId: 'B2', docTypeId: bookType.id, data: { titel: 'X', erscheinungsjahr: 'abc' } }, admin));
  expectError('VALIDATION', () => db.createRecord({ archiveId: 'B2', docTypeId: bookType.id, data: { titel: 'X', aufnahmedatum: '12.06.2026' } }, admin));
  expectError('VALIDATION', () => db.createRecord({ archiveId: 'B2', docTypeId: bookType.id, data: { titel: 'X', zustand: 'fantastisch' } }, admin));
});

test('decimal comma is accepted for numbers', () => {
  const r = db.createRecord({ archiveId: 'BUCH-002', docTypeId: bookType.id, data: { titel: 'Y', erscheinungsjahr: '19,5' } }, member);
  assert.strictEqual(r.data.erscheinungsjahr, 19.5);
});

console.log('\n— Einträge: Suche & Filter —');

test('search across all fields', () => {
  const res = db.listRecords({ search: 'Dorfchronik' });
  assert.strictEqual(res.total, 1);
  assert.strictEqual(res.records[0].archive_id, 'BUCH-001');
});

test('search by archive id substring', () => {
  assert.strictEqual(db.listRecords({ search: 'BUCH-00' }).total, 2);
});

test('LIKE wildcards in search are escaped', () => {
  assert.strictEqual(db.listRecords({ search: '%' }).total, 0);
});

test('field filter', () => {
  const res = db.listRecords({ docTypeId: bookType.id, fieldFilters: { autor: 'meier' } });
  assert.strictEqual(res.total, 1);
  assert.strictEqual(res.records[0].archive_id, 'BUCH-001');
});

test('pagination + sorting', () => {
  const res = db.listRecords({ sort: 'archive_id', dir: 'desc', limit: 1, offset: 0 });
  assert.strictEqual(res.total, 2);
  assert.strictEqual(res.records.length, 1);
  assert.strictEqual(res.records[0].archive_id, 'BUCH-002');
});

console.log('\n— Optimistisches Locking (Schreibkonflikte) —');

test('update with correct version succeeds and bumps version', () => {
  const updated = db.updateRecord(record.id, {
    archiveId: 'BUCH-001',
    data: { ...record.data, autor: 'Hans Meier' },
    expectedVersion: 1,
  }, member);
  assert.strictEqual(updated.version, 2);
  assert.strictEqual(updated.data.autor, 'Hans Meier');
});

test('update with stale version raises CONFLICT naming the other editor', () => {
  const err = expectError('CONFLICT', () => db.updateRecord(record.id, {
    archiveId: 'BUCH-001',
    data: { titel: 'Veraltet' },
    expectedVersion: 1, // someone (member) already saved version 2
  }, admin));
  assert.ok(err.message.includes('Karl Weber'), 'conflict message names the other editor');
});

test('delete with stale version raises CONFLICT', () => {
  expectError('CONFLICT', () => db.deleteRecord(record.id, 1, admin));
});

test('changing archive id to an existing one raises DUPLICATE_ID', () => {
  expectError('DUPLICATE_ID', () => db.updateRecord(record.id, {
    archiveId: 'BUCH-002',
    data: record.data,
    expectedVersion: 2,
  }, admin));
});

console.log('\n— Versionierung / Historie —');

test('history records who changed what and when', () => {
  const history = db.getRecordHistory(record.id);
  assert.strictEqual(history.length, 2, 'create + update');
  assert.strictEqual(history[0].action, 'update');
  assert.strictEqual(history[0].version, 2);
  assert.strictEqual(history[0].changed_by_display, 'Karl Weber');
  assert.strictEqual(history[1].action, 'create');
  assert.strictEqual(history[1].changed_by_display, 'Maria Schmidt');
  assert.strictEqual(history[1].data.autor, 'H. Meier', 'full snapshot stored');
  assert.ok(history[0].changed_at, 'timestamp stored');
});

test('deletion is recorded in history', () => {
  const extra = db.createRecord({ archiveId: 'TMP-1', docTypeId: bookType.id, data: { titel: 'Temp' } }, admin);
  db.deleteRecord(extra.id, extra.version, member);
  expectError('NOT_FOUND', () => db.getRecord(extra.id));
  const history = db.getRecordHistory(extra.id);
  assert.strictEqual(history[0].action, 'delete');
  assert.strictEqual(history[0].changed_by_display, 'Karl Weber');
});

console.log('\n— Dokumenttypen: Änderungen & Löschen —');

test('doc type with records cannot be deleted', () => {
  expectError('VALIDATION', () => db.deleteDocType(bookType.id));
});

test('empty doc type can be deleted', () => {
  const t = db.createDocType({ name: 'Wegwerf', fields: [{ label: 'X', field_type: 'text' }] }, admin);
  db.deleteDocType(t.id);
  assert.ok(!db.listDocTypes().some((x) => x.id === t.id));
});

test('editing fields keeps existing record data', () => {
  db.updateDocType(bookType.id, {
    name: 'Bücher', icon: '📕',
    fields: [
      { name: 'titel', label: 'Titel', field_type: 'text', required: true },
      { name: 'standort', label: 'Standort', field_type: 'text' },
    ],
  });
  const r = db.getRecord(record.id);
  assert.strictEqual(r.data.autor, 'Hans Meier', 'removed field value survives in record data');
});

console.log('\n— Dashboard —');

test('stats are consistent', () => {
  const stats = db.getStats();
  assert.strictEqual(stats.totalRecords, 2);
  assert.strictEqual(stats.totalUsers, 2);
  assert.ok(stats.totalChanges >= 5);
  const books = stats.byType.find((t) => t.name === 'Bücher');
  assert.strictEqual(books.count, 2);
  assert.ok(stats.perMonth.length >= 1);
  assert.ok(stats.recentActivity.length >= 5);
  assert.ok(stats.recentActivity[0].changed_by_display);
});

console.log('\n— Parallelzugriff (zweite Verbindung) —');

test('write from a second connection is detected as conflict', () => {
  // Simulates a second club member editing the same record from another PC.
  const Database = require('better-sqlite3');
  const other = new Database(dbFile);
  other.pragma('busy_timeout = 15000');
  const before = db.getRecord(record.id);
  other.prepare("UPDATE records SET version = version + 1, updated_by = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?")
    .run(member.id, record.id);
  other.close();
  expectError('CONFLICT', () => db.updateRecord(record.id, {
    archiveId: before.archive_id,
    data: before.data,
    expectedVersion: before.version,
  }, admin));
});

db.closeDatabase();
fs.rmSync(tmpDir, { recursive: true, force: true });

console.log(`\n${passed} Tests bestanden, ${failed} fehlgeschlagen.`);
process.exit(failed > 0 ? 1 : 0);
