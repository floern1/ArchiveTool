'use strict';

/**
 * Import helpers for Archivverwaltung-BGV-WK.
 *
 * Reads tabular sources (Excel `.xlsx` exports – e.g. from Citavi – and plain
 * `.csv`) and prepares them for import. Everything in this module is pure
 * (no database access) so it can be unit-tested in isolation:
 *
 *  - reading `.xlsx` without any third-party dependency (a `.xlsx` is a ZIP
 *    archive of XML parts; we read the ZIP central directory ourselves and
 *    inflate the relevant parts with Node's built-in `zlib`),
 *  - analysing the columns (fill rate, sample values, a conservative type
 *    guess) so the UI can show a checklist of candidate fields,
 *  - coercing raw cell values to the target field type (numbers, dates –
 *    including Excel serial dates –, yes/no, text),
 *  - building the rows to import and detecting redundant (duplicate) rows.
 *
 * The actual writing to the database (creating fields, inserting records) is
 * done in db.js so this module stays free of native dependencies.
 */

const fs = require('fs');
const zlib = require('zlib');
const path = require('path');

/* ------------------------------------------------------------------ */
/* XML helpers                                                         */
/* ------------------------------------------------------------------ */

function decodeXml(s) {
  if (s.indexOf('&') === -1) return s;
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}

/** Column letters (A, B, …, AA) → zero-based index. */
function colLettersToIndex(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) {
    n = n * 26 + (letters.charCodeAt(i) - 64);
  }
  return n - 1;
}

/** Zero-based index → column letters (0 → A, 26 → AA). */
function indexToColLetters(index) {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* Minimal ZIP reader (central directory + DEFLATE/STORE)              */
/* ------------------------------------------------------------------ */

const EOCD_SIG = 0x06054b50;
const CD_SIG = 0x02014b50;
const LFH_SIG = 0x04034b50;

function readZipEntries(buf) {
  // Locate the End-Of-Central-Directory record near the end of the file.
  let eocd = -1;
  const minStart = Math.max(0, buf.length - 22 - 0xffff);
  for (let i = buf.length - 22; i >= minStart; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Die Datei ist kein gültiges xlsx-/ZIP-Archiv.');
  const cdCount = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff) {
    throw new Error('Die Datei verwendet das ZIP64-Format und kann nicht gelesen werden. Bitte als CSV exportieren.');
  }

  const entries = new Map();
  let p = cdOffset;
  for (let n = 0; n < cdCount && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== CD_SIG) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { method, compSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function readZipFile(buf, entry) {
  const lo = entry.localOffset;
  if (buf.readUInt32LE(lo) !== LFH_SIG) throw new Error('Beschädigtes ZIP-Archiv (Local File Header).');
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const dataStart = lo + 30 + nameLen + extraLen;
  const data = buf.subarray(dataStart, dataStart + entry.compSize);
  if (entry.method === 0) return data;          // stored
  if (entry.method === 8) return zlib.inflateRawSync(data); // deflate
  throw new Error('Nicht unterstützte ZIP-Komprimierung: ' + entry.method);
}

/* ------------------------------------------------------------------ */
/* xlsx parsing                                                        */
/* ------------------------------------------------------------------ */

/** Parse xl/sharedStrings.xml into an array of plain strings. */
function parseSharedStrings(xml) {
  const out = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
  let m;
  while ((m = siRe.exec(xml)) !== null) {
    const inner = m[1];
    let text = '';
    let tm;
    tRe.lastIndex = 0;
    while ((tm = tRe.exec(inner)) !== null) text += tm[1];
    out.push(decodeXml(text));
  }
  return out;
}

/**
 * Parse a worksheet XML into a dense 2-D array of strings (row 0 = header).
 * Cells are placed by their `r` reference so sparse rows line up correctly.
 */
function parseSheet(xml, shared) {
  const rowsByIndex = [];
  let maxCol = 0;
  let autoRow = 0;

  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  let rm;
  while ((rm = rowRe.exec(xml)) !== null) {
    const rowAttrs = rm[1] || '';
    const body = rm[2];
    const rNum = /\sr="(\d+)"/.exec(rowAttrs);
    const rowIndex = rNum ? parseInt(rNum[1], 10) - 1 : autoRow;
    autoRow = rowIndex + 1;
    const arr = [];
    if (body) {
      let cm;
      cellRe.lastIndex = 0;
      let autoCol = 0;
      while ((cm = cellRe.exec(body)) !== null) {
        const cAttrs = cm[1] || '';
        const content = cm[2];
        const refM = /\sr="([A-Z]+)\d+"/.exec(cAttrs);
        const colIndex = refM ? colLettersToIndex(refM[1]) : autoCol;
        autoCol = colIndex + 1;
        let val = '';
        if (content) {
          const tM = /t="([^"]+)"/.exec(cAttrs);
          const t = tM ? tM[1] : null;
          const vM = /<v>([\s\S]*?)<\/v>/.exec(content);
          if (t === 's' && vM) {
            val = shared[parseInt(vM[1], 10)] || '';
          } else if (t === 'inlineStr') {
            const isM = /<t[^>]*>([\s\S]*?)<\/t>/.exec(content);
            val = isM ? decodeXml(isM[1]) : '';
          } else if (t === 'str' && vM) {
            val = decodeXml(vM[1]);
          } else if (vM) {
            val = vM[1];
          }
        }
        arr[colIndex] = val;
        if (colIndex + 1 > maxCol) maxCol = colIndex + 1;
      }
    }
    rowsByIndex[rowIndex] = arr;
  }

  const rows = [];
  for (let i = 0; i < rowsByIndex.length; i++) {
    const src = rowsByIndex[i] || [];
    const dense = new Array(maxCol);
    for (let c = 0; c < maxCol; c++) dense[c] = src[c] != null ? src[c] : '';
    rows.push(dense);
  }
  return rows;
}

/** Read an .xlsx file buffer → { sheetName, rows }. */
function readXlsx(buf) {
  const entries = readZipEntries(buf);
  const text = (name) => (entries.has(name) ? readZipFile(buf, entries.get(name)).toString('utf8') : null);

  const sharedXml = text('xl/sharedStrings.xml');
  const shared = sharedXml ? parseSharedStrings(sharedXml) : [];

  // Resolve the first worksheet via workbook.xml + its relationships.
  const wb = text('xl/workbook.xml') || '';
  let sheetName = 'Tabelle1';
  let rid = null;
  const sheetTag = /<sheet\b[^>]*>/i.exec(wb);
  if (sheetTag) {
    const nm = /name="([^"]*)"/.exec(sheetTag[0]);
    if (nm) sheetName = decodeXml(nm[1]);
    const ri = /r:id="([^"]*)"/.exec(sheetTag[0]);
    if (ri) rid = ri[1];
  }

  let sheetPath = 'xl/worksheets/sheet1.xml';
  const rels = text('xl/_rels/workbook.xml.rels');
  if (rels && rid) {
    const relRe = new RegExp('<Relationship\\b[^>]*Id="' + rid + '"[^>]*>', 'i');
    const relM = relRe.exec(rels);
    if (relM) {
      const tg = /Target="([^"]*)"/.exec(relM[0]);
      if (tg) {
        let target = tg[1].replace(/^\//, '');
        sheetPath = target.startsWith('xl/') ? target : 'xl/' + target;
      }
    }
  }

  let sheetXml = entries.has(sheetPath)
    ? readZipFile(buf, entries.get(sheetPath)).toString('utf8')
    : text('xl/worksheets/sheet1.xml');
  if (!sheetXml) throw new Error('In der Arbeitsmappe wurde keine Tabelle gefunden.');

  return { sheetName, rows: parseSheet(sheetXml, shared) };
}

/* ------------------------------------------------------------------ */
/* CSV parsing                                                         */
/* ------------------------------------------------------------------ */

/** Parse CSV/TSV text with quote handling and delimiter auto-detection. */
function parseCsv(textInput) {
  let text = textInput;
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // strip BOM
  // Detect the delimiter from the first line.
  const firstLine = text.split(/\r?\n/, 1)[0] || '';
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let inQ = false;
  for (const ch of firstLine) {
    if (ch === '"') inQ = !inQ;
    else if (!inQ && counts[ch] !== undefined) counts[ch]++;
  }
  let delim = ',';
  let best = -1;
  for (const d of [';', ',', '\t']) {
    if (counts[d] > best) { best = counts[d]; delim = d; }
  }

  const rows = [];
  let row = [];
  let field = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else q = false;
      } else field += ch;
    } else if (ch === '"') {
      q = true;
    } else if (ch === delim) {
      row.push(field); field = '';
    } else if (ch === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else if (ch === '\r') {
      // handled by following \n; ignore lone \r within line
      if (text[i + 1] !== '\n') { row.push(field); field = ''; rows.push(row); row = []; }
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }

  // Normalise to a rectangular grid.
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  return rows.map((r) => {
    const dense = new Array(width);
    for (let c = 0; c < width; c++) dense[c] = (r[c] != null ? String(r[c]).trim() : '');
    return dense;
  });
}

/** Read any supported file → { sheetName, rows }. Dispatches on extension. */
function readWorkbook(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.csv' || ext === '.tsv' || ext === '.txt') {
    const rows = parseCsv(fs.readFileSync(filePath, 'utf8'));
    return { sheetName: path.basename(filePath), rows };
  }
  if (ext === '.xlsx' || ext === '.xlsm') {
    return readXlsx(fs.readFileSync(filePath));
  }
  throw new Error('Nicht unterstütztes Dateiformat: ' + ext + ' (erlaubt: .xlsx, .csv).');
}

/* ------------------------------------------------------------------ */
/* Column analysis / type inference                                    */
/* ------------------------------------------------------------------ */

/** Derive a valid technical field name from a label (mirrors db.js). */
function deriveFieldName(label) {
  let name = String(label || '').toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50);
  if (!/^[a-z]/.test(name)) name = 'f_' + name;
  return name.slice(0, 50);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;
const DDMMYYYY_RE = /^\d{1,2}[.\/]\d{1,2}[.\/]\d{2,4}$/;
const NUMERIC_RE = /^-?\d+([.,]\d+)?$/;

// Headers that strongly suggest a date column. Combined with values that look
// like Excel date serials, this lets us recognise Citavi date exports (which
// store dates as plain serial numbers) without mistaking year columns (e.g.
// "Jahr" = 1929) for dates.
const DATE_HEADER_RE = /datum|erfasst am|ge[äa]ndert am|zugriff|ver[öo]ffentlich|\bam\b|\bdate\b|aufnahme|aufgenommen/i;
// Plausible Excel serial-date range: ~1954-10 (20000) … ~2064 (60000).
const SERIAL_MIN = 20000;
const SERIAL_MAX = 60000;

/** Conservative field-type guess from a sample of non-empty values. */
function inferFieldType(values, header) {
  if (!values || values.length === 0) return 'text';
  let allNumeric = true;
  let longOrMultiline = false;
  let allDateStr = true;
  let allSerial = true;
  for (const raw of values) {
    const s = String(raw).trim();
    if (s.includes('\n') || s.length > 80) longOrMultiline = true;
    if (!NUMERIC_RE.test(s)) allNumeric = false;
    if (!(DATE_RE.test(s) || DDMMYYYY_RE.test(s))) allDateStr = false;
    const n = Number(s.replace(',', '.'));
    if (!(Number.isFinite(n) && n >= SERIAL_MIN && n <= SERIAL_MAX)) allSerial = false;
  }
  if (longOrMultiline) return 'textarea';
  if (allDateStr) return 'date';                               // explicit date strings
  if (allSerial && header && DATE_HEADER_RE.test(header)) return 'date'; // serial dates in a date column
  if (allNumeric) return 'number';
  return 'text';
}

/**
 * Analyse columns of a parsed sheet.
 * Returns one entry per column with header, fill rate, samples and a guess.
 */
function analyzeColumns(rows) {
  const header = rows[0] || [];
  const data = rows.slice(1);
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  const columns = [];
  for (let c = 0; c < width; c++) {
    let filled = 0;
    const samples = [];
    const seen = new Set();
    const typeSample = [];
    for (const r of data) {
      const v = (r[c] != null ? String(r[c]) : '').trim();
      if (!v) continue;
      filled++;
      if (typeSample.length < 300) typeSample.push(v);
      if (samples.length < 5 && !seen.has(v)) {
        seen.add(v);
        samples.push(v.length > 80 ? v.slice(0, 80) + '…' : v);
      }
    }
    const headerText = (header[c] != null ? String(header[c]) : '').trim();
    const label = headerText || `Spalte ${indexToColLetters(c)}`;
    columns.push({
      index: c,
      header: label,
      hasHeader: !!headerText,
      filled,
      total: data.length,
      pct: data.length ? Math.round((filled / data.length) * 1000) / 10 : 0,
      samples,
      inferredType: inferFieldType(typeSample, headerText),
      suggestedLabel: label,
      suggestedName: deriveFieldName(headerText || ('spalte_' + indexToColLetters(c))),
    });
  }
  return columns;
}

/* ------------------------------------------------------------------ */
/* Value coercion                                                      */
/* ------------------------------------------------------------------ */

function pad2(n) { return String(n).length < 2 ? '0' + n : String(n); }

/** Excel serial date (1900 system) → ISO yyyy-mm-dd, or undefined. */
function excelSerialToISODate(n) {
  if (!(n > 0) || n > 2958465) return undefined; // 2958465 ≈ year 9999
  const ms = Math.round((n - 25569) * 86400 * 1000); // 25569 = 1900-system epoch → 1970-01-01
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString().slice(0, 10);
}

/** Best-effort conversion of any value to ISO yyyy-mm-dd, or undefined. */
function toISODate(value) {
  const s = String(value).trim();
  if (DATE_RE.test(s)) return s.slice(0, 10);
  if (/^\d+(\.\d+)?$/.test(s)) {
    const iso = excelSerialToISODate(Number(s));
    if (iso) return iso;
  }
  const m = DDMMYYYY_RE.exec(s);
  if (m) {
    const parts = s.split(/[.\/]/);
    let [d, mo, y] = parts;
    if (y.length === 2) y = '20' + y;
    return `${y}-${pad2(mo)}-${pad2(d)}`;
  }
  const t = Date.parse(s);
  if (!Number.isNaN(t)) return new Date(t).toISOString().slice(0, 10);
  return undefined;
}

const TRUE_RE = /^(1|true|wahr|ja|yes|y|x)$/i;

/** Coerce a raw cell value to the given field type. Empty → undefined. */
function coerceValue(raw, fieldType) {
  if (raw == null) return undefined;
  const v = typeof raw === 'string' ? raw.trim() : raw;
  if (v === '') return undefined;
  switch (fieldType) {
    case 'number': {
      const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
      return Number.isFinite(n) ? n : undefined;
    }
    case 'date':
      return toISODate(v);
    case 'boolean':
      return TRUE_RE.test(String(v));
    default:
      return String(v);
  }
}

/* ------------------------------------------------------------------ */
/* Archive IDs / row building                                          */
/* ------------------------------------------------------------------ */

/** Reduce an arbitrary value to a valid archive id, or '' if impossible. */
function sanitizeArchiveId(value) {
  let s = String(value == null ? '' : value).trim();
  if (!s) return '';
  s = s.replace(/[^A-Za-z0-9._/ -]+/g, '-'); // replace disallowed characters
  s = s.replace(/^[^A-Za-z0-9]+/, '');       // must start alphanumeric
  s = s.slice(0, 100);
  s = s.replace(/[^A-Za-z0-9]+$/, '');       // must end alphanumeric
  return s;
}

function generatedId(prefix, counter) {
  return `${prefix || 'IMP-'}${String(counter).padStart(5, '0')}`;
}

/**
 * Build the rows to import.
 *  - dataRows: raw 2-D rows (without header)
 *  - effectiveColumns: [{ index, name, fieldType }] – columns to keep
 *  - archiveId: { mode:'column', index } | { mode:'generate', prefix }
 * Returns [{ archiveId, data, sourceRowNumber }].
 */
function buildImportRows(dataRows, effectiveColumns, archiveId) {
  const out = [];
  let counter = 0;
  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    const data = {};
    for (const col of effectiveColumns) {
      const coerced = coerceValue(row[col.index], col.fieldType);
      if (coerced !== undefined) data[col.name] = coerced;
    }
    let aid;
    if (archiveId.mode === 'generate') {
      aid = generatedId(archiveId.prefix, ++counter);
    } else {
      aid = sanitizeArchiveId(row[archiveId.index]);
      if (!aid) aid = generatedId(archiveId.prefix, ++counter);
    }
    out.push({ archiveId: aid, data, sourceRowNumber: i + 2 });
  }
  return out;
}

/**
 * Detect redundant rows: rows that share the same value across the chosen key
 * columns (original column indices). Returns a summary, not the full list.
 */
function findDuplicates(dataRows, keyIndices) {
  const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();
  const SEP = '␟';
  const groups = new Map();
  for (let i = 0; i < dataRows.length; i++) {
    const key = keyIndices.map((ci) => norm(dataRows[i][ci])).join(SEP);
    if (key.split(SEP).join('') === '') continue; // all key columns empty
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i + 2); // 1-based + header offset
  }
  let duplicateGroups = 0;
  let duplicateRows = 0;
  const examples = [];
  for (const [key, rowsArr] of groups) {
    if (rowsArr.length > 1) {
      duplicateGroups++;
      duplicateRows += rowsArr.length - 1;
      if (examples.length < 10) {
        examples.push({ value: key.split(SEP).join(' | '), count: rowsArr.length, rows: rowsArr.slice(0, 8) });
      }
    }
  }
  return { duplicateGroups, duplicateRows, examples };
}

/**
 * Resolve redundant rows: for every group of rows that share the same value
 * across the chosen key columns, decide which rows to drop.
 *
 *  - keyIndices: original column indices that define a duplicate.
 *  - weights: optional array (indexed like dataRows). When given, the row with
 *    the highest weight in a group is kept (ties → first); otherwise the first
 *    occurrence is kept. Use e.g. the number of populated fields as weight to
 *    keep the most complete record.
 *
 * Returns a Set of zero-based row indices that should be skipped.
 */
function withinFileDropIndices(dataRows, keyIndices, weights) {
  const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();
  const SEP = '␟';
  const groups = new Map();
  for (let i = 0; i < dataRows.length; i++) {
    const key = keyIndices.map((ci) => norm(dataRows[i][ci])).join(SEP);
    if (key.split(SEP).join('') === '') continue; // all key columns empty
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  }
  const drop = new Set();
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue;
    let keep = idxs[0];
    if (weights) {
      for (const i of idxs) {
        if ((weights[i] || 0) > (weights[keep] || 0)) keep = i;
      }
    }
    for (const i of idxs) {
      if (i !== keep) drop.add(i);
    }
  }
  return drop;
}

/**
 * Group rows that share the same value across the key columns. Unlike
 * findDuplicates (which only counts) this returns the actual member row indices
 * for groups with more than one member, so they can be reviewed and merged.
 */
function groupDuplicateRows(dataRows, keyIndices) {
  const norm = (v) => String(v == null ? '' : v).trim().toLowerCase();
  const SEP = '␟';
  const map = new Map();
  for (let i = 0; i < dataRows.length; i++) {
    const key = keyIndices.map((ci) => norm(dataRows[i][ci])).join(SEP);
    if (key.split(SEP).join('') === '') continue; // all key columns empty
    if (!map.has(key)) map.set(key, { key, display: key.split(SEP).join(' | '), members: [] });
    map.get(key).members.push(i);
  }
  return [...map.values()].filter((g) => g.members.length > 1);
}

/** Index of the record with the most populated fields (ties → first). */
function mostCompleteIndex(records) {
  let best = 0;
  let bestN = -1;
  records.forEach((r, i) => {
    const n = Object.keys(r || {}).length;
    if (n > bestN) { bestN = n; best = i; }
  });
  return best;
}

/**
 * Merge several record data objects into one.
 *  - records: array of data objects.
 *  - masterIndex: the primary record; its values win by default.
 *  - overrides: optional { fieldName: indexIntoRecords } to force a field's
 *    value to come from a specific record.
 * For every field, the value is taken from the override record (if non-empty),
 * else from the master (if non-empty), else from the first record that has it
 * (so empty master fields are filled from the others).
 */
function mergeData(records, masterIndex, overrides) {
  const out = {};
  const master = records[masterIndex] || {};
  const keys = new Set();
  for (const r of records) for (const k of Object.keys(r || {})) keys.add(k);
  for (const k of keys) {
    const ovIdx = overrides && overrides[k] != null ? overrides[k] : null;
    if (ovIdx != null && records[ovIdx] && records[ovIdx][k] !== undefined && records[ovIdx][k] !== '') {
      out[k] = records[ovIdx][k];
      continue;
    }
    if (master[k] !== undefined && master[k] !== '') { out[k] = master[k]; continue; }
    for (const r of records) {
      if (r && r[k] !== undefined && r[k] !== '') { out[k] = r[k]; break; }
    }
  }
  return out;
}

module.exports = {
  // file reading
  readWorkbook,
  readXlsx,
  parseCsv,
  parseSheet,
  parseSharedStrings,
  // analysis
  analyzeColumns,
  inferFieldType,
  deriveFieldName,
  indexToColLetters,
  colLettersToIndex,
  // coercion / rows
  coerceValue,
  toISODate,
  excelSerialToISODate,
  sanitizeArchiveId,
  buildImportRows,
  findDuplicates,
  withinFileDropIndices,
  groupDuplicateRows,
  mostCompleteIndex,
  mergeData,
};
