'use strict';

/* Sheet / "Übersicht" view — Excel-like table per document type.
 * All fields are shown as columns; cell content scrolls vertically
 * so every field value is fully readable. */

window.AT = window.AT || {};

(function (AT) {
  const { h, apiSafe } = AT;

  const state = {
    docTypeId: 0,
  };

  let docTypes = [];
  let container = null;

  function typeById(id) {
    return docTypes.find((t) => t.id === id) || null;
  }

  /* ---------------- table rendering ---------------- */

  function renderTable(listEl) {
    const type = state.docTypeId ? typeById(state.docTypeId) : null;
    if (!type) {
      listEl.replaceChildren(h('p', { class: 'cell-soft' }, 'Bitte wählen Sie einen Dokumenttyp aus.'));
      return;
    }

    const fields = type.fields;
    if (fields.length === 0) {
      listEl.replaceChildren(h('p', { class: 'cell-soft' }, 'Dieser Dokumenttyp hat noch keine Felder.'));
      return;
    }

    // Fetch all records for this type
    apiSafe('records:list', {
      docTypeId: state.docTypeId,
      sort: 'archive_id',
      dir: 'asc',
      limit: 500,
      offset: 0,
    }).then(result => {
      if (!result) return;
      doRender(listEl, type, fields, result.records);
    });
  }

  function doRender(listEl, type, fields, records) {
    if (records.length === 0) {
      listEl.replaceChildren(
        h('div', { class: 'card' },
          h('div', { class: 'empty-state' },
            h('div', { class: 'big' }, '📋'),
            h('p', {}, `Noch keine Einträge für ${type.icon} ${type.name}.`))));
      return;
    }

    // Build header row
    const headCells = [
      h('th', { class: 'sheet-col sheet-id' }, 'Archiv-ID'),
    ];
    for (const f of fields) {
      headCells.push(h('th', { class: 'sheet-col', title: f.label }, f.label));
    }
    const head = h('tr', {}, headCells);

    // Build data rows
    const rows = records.map(r => {
      const rowCells = [
        h('td', { class: 'sheet-cell cell-id' }, r.archive_id),
      ];
      for (const f of fields) {
        const val = AT.formatFieldValue(f, r.data[f.name]);
        rowCells.push(h('td', {
          class: 'sheet-cell',
          title: String(r.data[f.name] ?? ''),
        }, val));
      }
      return h('tr', {}, rowCells);
    });

    listEl.replaceChildren(
      h('div', { class: 'card sheet-wrap' },
        h('div', { class: 'sheet-scroll' },
          h('table', { class: 'sheet' },
            h('thead', {}, head),
            h('tbody', {}, rows)))));
  }

  /* ---------------- view entry point ---------------- */

  AT.views = AT.views || {};
  AT.views.sheets = async function renderSheets(c) {
    container = c;
    docTypes = (await apiSafe('types:list')) || [];

    // Validate saved selection
    if (!docTypes.some(t => t.id === state.docTypeId)) {
      state.docTypeId = 0;
    }

    const listEl = h('div', { id: 'sheet-list' });

    const typeSelect = h('select', {
      onchange: () => {
        state.docTypeId = Number(typeSelect.value);
        renderTable(listEl);
      },
    },
      h('option', { value: 0, selected: state.docTypeId === 0 }, '— Dokumenttyp wählen —'),
      docTypes.map(t => h('option', {
        value: t.id,
        selected: t.id === state.docTypeId,
      }, `${t.icon} ${t.name}`)));

    c.replaceChildren(
      h('div', { class: 'view-header' },
        h('div', {},
          h('h2', {}, 'Übersicht'),
          h('p', { class: 'view-sub' }, 'Tabellenartige Darstellung nach Dokumenttyp')),
        h('div', { class: 'spacer' }),
        typeSelect),
      listEl);

    if (state.docTypeId) renderTable(listEl);
  };

})(window.AT);
