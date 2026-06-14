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

console.log('\n— Import: Datei-Parsing & Hilfsfunktionen —');

const importer = require('../src/main/import');
const zlib = require('zlib');

/* Minimal STORE-method ZIP writer to build a synthetic .xlsx in memory. */
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xEDB88320 & -(c & 1));
  }
  return (~c) >>> 0;
}
function makeXlsx(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of files) {
    const data = Buffer.from(content, 'utf8');
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const lfh = Buffer.alloc(30);
    lfh.writeUInt32LE(0x04034b50, 0); lfh.writeUInt16LE(20, 4);
    lfh.writeUInt32LE(crc, 14); lfh.writeUInt32LE(data.length, 18); lfh.writeUInt32LE(data.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    const rec = Buffer.concat([lfh, nameBuf, data]);
    locals.push(rec);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6);
    cd.writeUInt32LE(crc, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28); cd.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([cd, nameBuf]));
    offset += rec.length;
  }
  const localBlob = Buffer.concat(locals);
  const centralBlob = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8); eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBlob.length, 12); eocd.writeUInt32LE(localBlob.length, 16);
  return Buffer.concat([localBlob, centralBlob, eocd]);
}

test('reads a synthetic .xlsx (shared/rich/inline strings + numbers)', () => {
  const shared = '<sst><si><t>Titel</t></si><si><t>Autor</t></si><si><t>Jahr</t></si>'
    + '<si><t>Dorfchronik</t></si><si><t>H. Meier</t></si>'
    + '<si><r><t>Mehr</t></r><r><t>zeilig &amp; toll</t></r></si></sst>';
  const sheet = '<worksheet><sheetData>'
    + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>'
    + '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="C2"><v>1952</v></c></row>'
    + '<row r="3"><c r="A3" t="s"><v>5</v></c><c r="C3"><v>2001</v></c></row>'
    + '</sheetData></worksheet>';
  const xlsxPath = path.join(tmpDir, 'fixture.xlsx');
  fs.writeFileSync(xlsxPath, makeXlsx([
    ['xl/workbook.xml', '<workbook xmlns:r="x"><sheets><sheet name="Org" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/sharedStrings.xml', shared],
    ['xl/worksheets/sheet1.xml', sheet],
  ]));
  const { sheetName, rows } = importer.readWorkbook(xlsxPath);
  assert.strictEqual(sheetName, 'Org');
  assert.deepStrictEqual(rows[0], ['Titel', 'Autor', 'Jahr']);
  assert.deepStrictEqual(rows[1], ['Dorfchronik', 'H. Meier', '1952']);
  assert.deepStrictEqual(rows[2], ['Mehrzeilig & toll', '', '2001']);

  const cols = importer.analyzeColumns(rows);
  assert.strictEqual(cols[1].pct, 50, 'Autor in 1 von 2 Datenzeilen befüllt');
  assert.strictEqual(cols[2].inferredType, 'number');
});

test('field-type inference (date strings, header-aware Excel serials, years stay numbers)', () => {
  assert.strictEqual(importer.inferFieldType(['2019-09-23', '2020-01-01'], 'Datum'), 'date');
  assert.strictEqual(importer.inferFieldType(['04.05.2020'], 'Erfasst am'), 'date');
  // serial numbers only count as dates when the header looks like a date column
  assert.strictEqual(importer.inferFieldType(['43734.37', '42411.7'], 'Erstveröffentlichung'), 'date');
  assert.strictEqual(importer.inferFieldType(['43734.37', '42411.7'], 'Einheitssachtitel'), 'number');
  // year columns must NOT become dates
  assert.strictEqual(importer.inferFieldType(['1929', '2009'], 'Jahr ermittelt'), 'number');
  assert.strictEqual(importer.inferFieldType(['Elberfeld', 'Köln'], 'Ort'), 'text');
});

test('CSV parsing with delimiter detection and quotes', () => {
  const rows = importer.parseCsv('a;b;c\n"x;1";"y\ny";z\n');
  assert.deepStrictEqual(rows[0], ['a', 'b', 'c']);
  assert.deepStrictEqual(rows[1], ['x;1', 'y\ny', 'z']);
});

test('value coercion (number, date incl. Excel serial, boolean)', () => {
  assert.strictEqual(importer.coerceValue('19,5', 'number'), 19.5);
  assert.strictEqual(importer.coerceValue('ja', 'boolean'), true);
  assert.strictEqual(importer.coerceValue('04.05.2020', 'date'), '2020-05-04');
  assert.strictEqual(importer.coerceValue('43831', 'date'), '2020-01-01'); // Excel serial
  assert.strictEqual(importer.coerceValue('', 'text'), undefined);
});

test('archive id sanitisation', () => {
  assert.strictEqual(importer.sanitizeArchiveId('FOTO-1952-001'), 'FOTO-1952-001');
  assert.strictEqual(importer.sanitizeArchiveId('  16158 '), '16158');
  assert.strictEqual(importer.sanitizeArchiveId('A 0_00; Z'), 'A 0_00- Z');
  assert.strictEqual(importer.sanitizeArchiveId('%%%'), '');
});

test('buildImportRows + duplicate detection', () => {
  const data = [['Meier', '1952'], ['Meier', '1952'], ['', '1960']];
  const eff = [{ index: 0, name: 'autor', fieldType: 'text' }, { index: 1, name: 'jahr', fieldType: 'number' }];
  const built = importer.buildImportRows(data, eff, { mode: 'column', index: 0, prefix: 'IMP-' });
  assert.strictEqual(built[0].archiveId, 'Meier');
  assert.strictEqual(built[2].archiveId, 'IMP-00001', 'empty id falls back to generated');
  assert.deepStrictEqual(built[0].data, { autor: 'Meier', jahr: 1952 });
  const dup = importer.findDuplicates(data, [0, 1]);
  assert.strictEqual(dup.duplicateGroups, 1);
  assert.strictEqual(dup.duplicateRows, 1);
});

console.log('\n— Import: Massenimport in die Datenbank —');

let importType;

test('bulk import: created / skipped (dup+collision) / failed', () => {
  importType = db.createDocType({
    name: 'Importtyp', icon: '📥',
    fields: [{ label: 'Titel', field_type: 'text', required: true }, { label: 'Jahr', field_type: 'number' }],
  }, admin);
  db.createRecord({ archiveId: 'IMP-100', docTypeId: importType.id, data: { titel: 'Bestehend' } }, admin);

  const rows = [
    { archiveId: 'IMP-001', data: { titel: 'Eins', jahr: 1990 }, sourceRowNumber: 2 },
    { archiveId: 'IMP-001', data: { titel: 'Eins-Dup' }, sourceRowNumber: 3 },   // duplicate within file
    { archiveId: 'IMP-100', data: { titel: 'Kollision' }, sourceRowNumber: 4 },  // already in db
    { archiveId: 'IMP-002', data: { jahr: 1991 }, sourceRowNumber: 5 },          // missing required title
    { archiveId: 'IMP-003', data: { titel: 'Drei' }, sourceRowNumber: 6 },
  ];
  const res = db.importRecords({ docTypeId: importType.id, rows, onDuplicate: 'skip' }, member);
  assert.strictEqual(res.created, 2, 'IMP-001 and IMP-003');
  assert.strictEqual(res.updated, 0);
  assert.strictEqual(res.skipped.length, 2, 'within-file duplicate + existing collision');
  assert.strictEqual(res.failed.length, 1, 'missing required field');
  assert.ok(db.listRecords({ search: 'IMP-003' }).total === 1);
});

test('bulk import overwrite merges into existing record', () => {
  const res = db.importRecords({
    docTypeId: importType.id,
    rows: [{ archiveId: 'IMP-100', data: { jahr: 2024 }, sourceRowNumber: 2 }],
    onDuplicate: 'overwrite',
  }, member);
  assert.strictEqual(res.updated, 1);
  const found = db.listRecords({ search: 'IMP-100' }).records[0];
  const full = db.getRecord(found.id);
  assert.strictEqual(full.data.titel, 'Bestehend', 'existing field kept');
  assert.strictEqual(full.data.jahr, 2024, 'imported field merged in');
});

test('bulk import overwrite preserves data of fields removed from the type', () => {
  // A record may carry values for fields that were later dropped from the type;
  // updateDocType keeps those in the JSON snapshot. An overwrite-import must not
  // silently discard them.
  const t = db.createDocType({
    name: 'Bestandskartei', icon: '📥',
    fields: [{ label: 'Titel', field_type: 'text', required: true }, { label: 'Altfeld', field_type: 'text' }],
  }, admin);
  db.createRecord({ archiveId: 'KART-1', docTypeId: t.id, data: { titel: 'Alt', altfeld: 'bewahren' } }, admin);
  // Drop "altfeld" from the type definition; its value survives in the record.
  db.updateDocType(t.id, { name: 'Bestandskartei', icon: '📥', fields: [{ name: 'titel', label: 'Titel', field_type: 'text', required: true }] });

  const res = db.importRecords({
    docTypeId: t.id,
    rows: [{ archiveId: 'KART-1', data: { titel: 'Neu' }, sourceRowNumber: 2 }],
    onDuplicate: 'overwrite',
  }, member);
  assert.strictEqual(res.updated, 1);
  const full = db.getRecord(db.listRecords({ search: 'KART-1' }).records[0].id);
  assert.strictEqual(full.data.titel, 'Neu', 'imported value applied');
  assert.strictEqual(full.data.altfeld, 'bewahren', 'value of removed field preserved');
});

test('withinFileDropIndices resolves redundant rows (first / most complete)', () => {
  const data = [['Meier', '1952'], ['Meier', '1952'], ['Schulz', '1960'], ['Meier', '1952']];
  // keep first of each key group → drop the later Meier/1952 rows (1 and 3)
  const first = importer.withinFileDropIndices(data, [0, 1]);
  assert.deepStrictEqual([...first].sort((a, b) => a - b), [1, 3]);
  // weighted: keep the most complete row (index 1) → drop 0 and 3
  const mostComplete = importer.withinFileDropIndices(data, [0, 1], [1, 3, 1, 2]);
  assert.deepStrictEqual([...mostComplete].sort((a, b) => a - b), [0, 3]);
  // rows whose key columns are all empty are never treated as duplicates
  assert.strictEqual(importer.withinFileDropIndices([['', ''], ['', '']], [0, 1]).size, 0);
});

test('within-file dedup keeps one record per key before import', () => {
  const t = db.createDocType({ name: 'Dedup', icon: '📥', fields: [{ label: 'Titel', field_type: 'text', required: true }] }, admin);
  const data = [['Werk A'], ['Werk A'], ['Werk B']]; // rows 0 and 1 are redundant by column 0
  const eff = [{ index: 0, name: 'titel', fieldType: 'text' }];
  const built = importer.buildImportRows(data, eff, { mode: 'generate', prefix: 'DD-' }); // distinct generated ids
  const drop = importer.withinFileDropIndices(data, [0]);
  const keep = built.filter((_, i) => !drop.has(i));
  const res = db.importRecords({ docTypeId: t.id, rows: keep, onDuplicate: 'skip' }, admin);
  assert.strictEqual(res.created, 2, 'one „Werk A“ plus „Werk B“');
});

test('groupDuplicateRows / mostCompleteIndex / mergeData', () => {
  const data = [['Werk A', 'Meier', ''], ['Werk A', '', '1950'], ['Werk B', 'Schulz', '1960']];
  const groups = importer.groupDuplicateRows(data, [0]);
  assert.strictEqual(groups.length, 1, 'only „Werk A“ is a duplicate group');
  assert.deepStrictEqual(groups[0].members, [0, 1]);

  const recs = [{ titel: 'Werk A', autor: 'Meier' }, { titel: 'Werk A', jahr: 1950 }];
  assert.strictEqual(importer.mostCompleteIndex(recs), 0);
  // master 0 wins, empty fields filled from the other → union
  assert.deepStrictEqual(importer.mergeData(recs, 0), { titel: 'Werk A', autor: 'Meier', jahr: 1950 });
  // field override: take „jahr“ from record 1 explicitly (already there), title from record 1
  assert.deepStrictEqual(importer.mergeData([{ titel: 'A', autor: 'X' }, { titel: 'B' }], 0, { titel: 1 }), { titel: 'B', autor: 'X' });
});

test('manual within-file merge produces one record per group', () => {
  const t = db.createDocType({ name: 'MergeTyp', icon: '📥', fields: [
    { label: 'Titel', field_type: 'text', required: true }, { label: 'Autor', field_type: 'text' }, { label: 'Jahr', field_type: 'number' },
  ] }, admin);
  // two redundant rows (same title) with complementary fields + a unique row
  const eff = [{ index: 0, name: 'titel', fieldType: 'text' }, { index: 1, name: 'autor', fieldType: 'text' }, { index: 2, name: 'jahr', fieldType: 'number' }];
  const data = [['Werk A', 'Meier', ''], ['Werk A', '', '1950'], ['Werk B', 'Schulz', '1961']];
  const built = importer.buildImportRows(data, eff, { mode: 'generate', prefix: 'MG-' });
  const groups = importer.groupDuplicateRows(data, [0]);
  const resolved = [];
  const consumed = new Set();
  for (const g of groups) {
    g.members.forEach((i) => consumed.add(i));
    const master = importer.mostCompleteIndex(g.members.map((i) => built[i].data));
    resolved.push({ archiveId: built[g.members[master]].archiveId, data: importer.mergeData(g.members.map((i) => built[i].data), master) });
  }
  built.forEach((r, i) => { if (!consumed.has(i)) resolved.push(r); });
  const res = db.importRecords({ docTypeId: t.id, rows: resolved, onDuplicate: 'skip' }, admin);
  assert.strictEqual(res.created, 2, 'merged „Werk A“ + „Werk B“');
  const a = db.getRecordByArchiveId(built[0].archiveId); // the merged master record
  assert.strictEqual(a.data.titel, 'Werk A');
  assert.strictEqual(a.data.autor, 'Meier', 'autor from row 1');
  assert.strictEqual(a.data.jahr, 1950, 'jahr filled from row 2');
});

test('per-id collision override (perId) beats the global strategy', () => {
  const t = db.createDocType({ name: 'PerIdTyp', icon: '📥', fields: [{ label: 'Titel', field_type: 'text', required: true }] }, admin);
  db.createRecord({ archiveId: 'PID-1', docTypeId: t.id, data: { titel: 'Alt' } }, admin);
  db.createRecord({ archiveId: 'PID-2', docTypeId: t.id, data: { titel: 'Alt2' } }, admin);
  // global skip, but PID-1 individually overwritten
  const res = db.importRecords({
    docTypeId: t.id,
    rows: [{ archiveId: 'PID-1', data: { titel: 'Neu' }, sourceRowNumber: 2 }, { archiveId: 'PID-2', data: { titel: 'Neu2' }, sourceRowNumber: 3 }],
    onDuplicate: 'skip',
    perId: { 'pid-1': 'overwrite' },
  }, admin);
  assert.strictEqual(res.updated, 1);
  assert.strictEqual(res.skipped.length, 1);
  assert.strictEqual(db.getRecordByArchiveId('PID-1').data.titel, 'Neu');
  assert.strictEqual(db.getRecordByArchiveId('PID-2').data.titel, 'Alt2', 'PID-2 left untouched');
});

test('findExistingArchiveIds reports collisions case-insensitively', () => {
  const set = db.findExistingArchiveIds(['imp-001', 'IMP-100', 'NICHT-DA']);
  assert.ok(set.has('imp-001'));
  assert.ok(set.has('imp-100'));
  assert.ok(!set.has('nicht-da'));
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
