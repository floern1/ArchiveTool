'use strict';

/**
 * EAD(DDB) 1.1 Findbuch export for the Archivportal NRW (archive.nrw.de).
 *
 * The portal only ingests EAD(DDB) XML (uploaded manually via its web UI). This
 * module turns our generic records into a valid Findbuch XML string and reports,
 * before writing, whether the data and the institution settings are complete
 * enough for a successful upload.
 *
 * Pure module (no Electron / no database) so it can be unit-tested in isolation.
 *
 * Structure produced (see manual chapter 3.2.2 and the official DDB example):
 *
 *   <ead>
 *     <eadheader><eadid mainagencycode="ISIL">EADID</eadid>
 *       <filedesc><titlestmt><titleproper>Bestandstitel</titleproper>…
 *     <archdesc level="collection" type="Findbuch">
 *       <did><unitid>Signatur</unitid><unittitle>Titel</unittitle>
 *            <repository><corpname role="Sparte" id="ISIL">Archiv</corpname>…
 *       <dsc>
 *         <c level="file" id="…"><did><unitid>archive_id</unitid>
 *              <unittitle>…</unittitle><unitdate normal="…">…</unitdate>…
 */

const { EAD_SPARTEN } = require('./db');

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Escape text for use inside an XML element or attribute value. */
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Derive a syntactically valid XML id (NCName) from an archive id, used for the
 * persistent `<c id="…">` attribute. Characters not allowed in an XML name are
 * replaced by '_'; a leading non-letter is prefixed. The human-readable
 * signature is preserved unchanged in <unitid>.
 */
function toXmlId(archiveId) {
  let id = String(archiveId == null ? '' : archiveId).replace(/[^A-Za-z0-9_.-]/g, '_');
  if (!/^[A-Za-z_]/.test(id)) id = '_' + id;
  return id;
}

/** Group the type's fields by EAD role: { role: [fieldName, …] }. */
function rolesFromFields(fields) {
  const byRole = {};
  for (const f of fields || []) {
    const role = f.ead_role || 'none';
    if (role === 'none') continue;
    (byRole[role] = byRole[role] || []).push(f.name);
  }
  return byRole;
}

function valueOf(data, name) {
  const v = data ? data[name] : undefined;
  if (v === undefined || v === null) return '';
  return typeof v === 'string' ? v.trim() : String(v);
}

/** First non-empty value among the field names mapped to a role. */
function firstValue(data, names) {
  for (const name of names || []) {
    const v = valueOf(data, name);
    if (v !== '') return v;
  }
  return '';
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

/**
 * Check records, institution meta and Findbuch header for export readiness.
 * Returns counts plus a list of problems; nothing is written.
 *
 *  - meta:     { archive_name, archive_sparte, archive_isil, … } (from db.getMeta)
 *  - findbuch: { eadid, titleproper, unitid }  (the Findbuch header)
 *  - records:  [{ archive_id, data }]
 *  - fields:   [{ name, label, field_type, ead_role }]  (of the exported type)
 */
function validateForExport({ meta = {}, findbuch = {}, records = [], fields = [] } = {}) {
  const metaProblems = [];
  if (!String(meta.archive_name || '').trim()) {
    metaProblems.push('Archivname (corpname) fehlt.');
  }
  const sparte = String(meta.archive_sparte || '').trim();
  if (!sparte) {
    metaProblems.push('Archivsparte (corpname role) fehlt.');
  } else if (!EAD_SPARTEN.includes(sparte)) {
    metaProblems.push(`Ungültige Archivsparte „${sparte}“ – muss ein Wert aus der Portal-Liste sein.`);
  }
  if (!String(findbuch.eadid || '').trim()) {
    metaProblems.push('Eindeutige Findbuch-ID (eadid) fehlt.');
  }
  if (!String(findbuch.titleproper || '').trim()) {
    metaProblems.push('Bestandstitel fehlt.');
  }

  const titleFields = (fields || []).filter((f) => f.ead_role === 'unittitle');
  if (titleFields.length === 0) {
    metaProblems.push('Kein Feld ist als Titel (unittitle) markiert – im Dokumenttyp eine EAD-Rolle „Titel“ vergeben.');
  } else if (titleFields.length > 1) {
    metaProblems.push('Mehrere Felder sind als Titel (unittitle) markiert – es ist genau eines erlaubt.');
  }

  const byRole = rolesFromFields(fields);
  const titleNames = byRole.unittitle || [];
  const dateNames = byRole.unitdate || [];

  const recordProblems = [];
  let exportableCount = 0;
  const seenIds = new Set();
  for (const r of records) {
    const problems = [];
    const archiveId = String(r.archive_id || '').trim();
    if (!archiveId) {
      problems.push('Archiv-ID fehlt.');
    } else {
      const xmlId = toXmlId(archiveId);
      if (seenIds.has(xmlId)) {
        problems.push(`Mehrdeutige persistente ID „${xmlId}“ (kollidiert mit einem anderen Eintrag).`);
      }
      seenIds.add(xmlId);
    }
    if (titleNames.length && firstValue(r.data, titleNames) === '') {
      problems.push('Titel (unittitle) ist leer – auf Ebene „file“ Pflicht.');
    }
    for (const name of dateNames) {
      const v = valueOf(r.data, name);
      if (v !== '' && !DATE_RE.test(v)) {
        problems.push(`Laufzeit „${v}“ ist kein gültiges Datum (JJJJ-MM-TT).`);
      }
    }
    if (problems.length) recordProblems.push({ archiveId: archiveId || '(leer)', problems });
    else exportableCount++;
  }

  return {
    totalRecords: records.length,
    exportableCount,
    metaProblems,
    recordProblems,
    ok: metaProblems.length === 0 && recordProblems.length === 0,
  };
}

/* ------------------------------------------------------------------ */
/* XML generation                                                     */
/* ------------------------------------------------------------------ */

/** Build one <c level="file"> component for a single record. */
function buildComponent(record, byRole) {
  const archiveId = String(record.archive_id || '').trim();
  const data = record.data || {};
  const did = [`      <unitid>${esc(archiveId)}</unitid>`];

  const title = firstValue(data, byRole.unittitle);
  did.push(`      <unittitle>${esc(title)}</unittitle>`);

  const date = firstValue(data, byRole.unitdate);
  if (date) {
    const attr = DATE_RE.test(date) ? ` normal="${esc(date)}"` : '';
    did.push(`      <unitdate${attr}>${esc(date)}</unitdate>`);
  }

  const physdesc = [];
  const extent = firstValue(data, byRole.extent);
  if (extent) physdesc.push(`        <extent>${esc(extent)}</extent>`);
  const genreform = firstValue(data, byRole.genreform);
  if (genreform) physdesc.push(`        <genreform>${esc(genreform)}</genreform>`);
  if (physdesc.length) {
    did.push('      <physdesc>', ...physdesc, '      </physdesc>');
  }

  const language = firstValue(data, byRole.language);
  if (language) {
    did.push(`      <langmaterial><language>${esc(language)}</language></langmaterial>`);
  }

  const lines = [`    <c level="file" id="${esc(toXmlId(archiveId))}">`, '      <did>'];
  for (const l of did) lines.push(l);
  lines.push('      </did>');

  const scope = firstValue(data, byRole.scopecontent);
  if (scope) {
    lines.push('      <scopecontent>', `        <p>${esc(scope)}</p>`, '      </scopecontent>');
  }
  const access = firstValue(data, byRole.accessrestrict);
  if (access) {
    lines.push('      <accessrestrict>', `        <p>${esc(access)}</p>`, '      </accessrestrict>');
  }
  lines.push('    </c>');
  return lines.join('\n');
}

/**
 * Build the full EAD(DDB) 1.1 Findbuch XML document as a string.
 * Parameters are the same as validateForExport(); the caller should validate
 * first, but generation is also defensive (empty optional values are omitted).
 */
function buildFindbuchXml({ meta = {}, findbuch = {}, records = [], fields = [] } = {}) {
  const byRole = rolesFromFields(fields);
  const isil = String(meta.archive_isil || '').trim();
  const eadid = String(findbuch.eadid || '').trim();
  const titleproper = String(findbuch.titleproper || '').trim();
  const bestandSig = String(findbuch.unitid || '').trim();
  const archiveName = String(meta.archive_name || '').trim();
  const sparte = String(meta.archive_sparte || '').trim();
  const address = String(meta.archive_address || '').trim();

  const out = [];
  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push('<ead>');

  // --- header ---
  out.push('  <eadheader>');
  out.push(`    <eadid${isil ? ` mainagencycode="${esc(isil)}"` : ''}>${esc(eadid)}</eadid>`);
  out.push('    <filedesc>');
  out.push('      <titlestmt>');
  out.push(`        <titleproper>${esc(titleproper)}</titleproper>`);
  out.push('      </titlestmt>');
  out.push('    </filedesc>');
  out.push('  </eadheader>');

  // --- archive description (collection level) ---
  out.push('  <archdesc level="collection" type="Findbuch">');
  out.push('    <did>');
  if (bestandSig) out.push(`      <unitid>${esc(bestandSig)}</unitid>`);
  out.push(`      <unittitle>${esc(titleproper)}</unittitle>`);
  out.push('      <repository>');
  out.push(`        <corpname${sparte ? ` role="${esc(sparte)}"` : ''}${isil ? ` id="${esc(isil)}"` : ''}>${esc(archiveName)}</corpname>`);
  if (address) {
    out.push('        <address>', `          <addressline>${esc(address)}</addressline>`, '        </address>');
  }
  out.push('      </repository>');
  out.push('    </did>');

  // --- components ---
  out.push('    <dsc>');
  for (const r of records) out.push(buildComponent(r, byRole));
  out.push('    </dsc>');

  out.push('  </archdesc>');
  out.push('</ead>');
  return out.join('\n') + '\n';
}

module.exports = {
  buildFindbuchXml,
  validateForExport,
  // exported for tests
  esc,
  toXmlId,
};
