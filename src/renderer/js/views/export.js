'use strict';

/* Export wizard: turn the recorded entries into an EAD(DDB) 1.1 Findbuch XML
 * file for manual upload to the Archivportal NRW (archive.nrw.de). Steps:
 *   1. Archiv-Stammdaten (Repository/corpname, Sparte, ISIL) + Findbuch-Kopf,
 *   2. Auswahl des Dokumenttyps, Umfang (Suche) und EAD-Feldrollen,
 *   3. Prüfung der Pflichtangaben und Export in eine Datei.
 */

window.AT = window.AT || {};

(function (AT) {
  const { h, api, apiSafe, toast } = AT;

  let container = null;
  let types = [];
  let sparten = [];
  let state = null;

  function freshState() {
    return {
      step: 1,
      meta: { archive_name: '', archive_sparte: '', archive_isil: '', archive_address: '', bestand_signatur: '', bestand_titel: '' },
      eadid: '',
      docTypeId: null,
      search: '',
      roleOverrides: {},   // fieldName -> EAD role for this export
      report: null,
      result: null,
    };
  }

  function currentType() {
    return types.find((t) => t.id === state.docTypeId) || null;
  }

  function findbuchPayload() {
    return {
      eadid: (state.eadid || '').trim(),
      titleproper: state.meta.bestand_titel || '',
      unitid: state.meta.bestand_signatur || '',
    };
  }

  function selectionPayload() {
    return {
      docTypeId: state.docTypeId,
      search: state.search ? state.search.trim() : undefined,
      roleOverrides: state.roleOverrides,
      findbuch: findbuchPayload(),
    };
  }

  function suggestEadid() {
    const isil = (state.meta.archive_isil || '').trim();
    const sig = (state.meta.bestand_signatur || '').trim();
    const base = [isil, sig].filter(Boolean).join('_') || 'findbuch';
    return base.replace(/[^A-Za-z0-9_.-]+/g, '_').replace(/^_+|_+$/g, '');
  }

  /* ---------------- step 1: Stammdaten ---------------- */

  function field(labelText, key, opts = {}) {
    const input = h('input', {
      type: 'text', value: state.meta[key] || '',
      placeholder: opts.placeholder || '',
      oninput: (e) => { state.meta[key] = e.target.value; },
    });
    return h('div', { class: 'form-group' },
      h('label', {}, labelText, opts.required ? h('span', { class: 'req' }, ' *') : null),
      input,
      opts.hint ? h('p', { class: 'meta-line' }, opts.hint) : null);
  }

  function renderStep1() {
    const sparteSelect = h('select', {
      onchange: (e) => { state.meta.archive_sparte = e.target.value; },
    },
      h('option', { value: '' }, '– bitte wählen –'),
      sparten.map((s) => h('option', { value: s, selected: s === state.meta.archive_sparte }, s)));

    const eadidInput = h('input', {
      type: 'text', value: state.eadid || '',
      placeholder: 'eindeutige, dauerhafte ID des Findbuchs',
      oninput: (e) => { state.eadid = e.target.value; },
    });

    container.replaceChildren(
      header(),
      stepper(1),
      h('div', { class: 'card import-section' },
        h('h3', {}, '1) Archiv-Stammdaten'),
        h('p', { class: 'view-sub', style: 'margin:0 0 12px' },
          'Diese Angaben gelten für das gesamte Archiv und werden in der Datenbank gespeichert. ',
          'Sie füllen den Repository-Block (corpname) der EAD-Datei.'),
        field('Archivname (corpname)', 'archive_name', { required: true, placeholder: 'z. B. Stadtarchiv Musterstadt' }),
        h('div', { class: 'form-group' },
          h('label', {}, 'Archivsparte (corpname role)', h('span', { class: 'req' }, ' *')),
          sparteSelect,
          h('p', { class: 'meta-line' }, 'Muss einem der vom Portal erlaubten Werte entsprechen.')),
        field('ISIL', 'archive_isil', { placeholder: 'z. B. DE-1234', hint: 'Standardisierte Archivkennung (mainagencycode/corpname id).' }),
        field('Adresse', 'archive_address', { placeholder: 'optional' })),
      h('div', { class: 'card import-section' },
        h('h3', {}, '2) Findbuch-Kopf'),
        field('Bestandstitel (titleproper)', 'bestand_titel', { required: true, placeholder: 'z. B. Bestand Fotosammlung' }),
        field('Bestandssignatur (unitid)', 'bestand_signatur', { placeholder: 'z. B. F 1' }),
        h('div', { class: 'form-group' },
          h('label', {}, 'Findbuch-ID (eadid)', h('span', { class: 'req' }, ' *')),
          h('div', { class: 'input-with-btn' }, eadidInput,
            h('button', {
              class: 'btn', type: 'button',
              onclick: () => { state.eadid = suggestEadid(); render(); },
            }, 'Vorschlag')),
          h('p', { class: 'meta-line' }, 'Muss eindeutig sein – bei erneutem Upload überschreibt der gleiche Wert die vorige Fassung.'))),
      h('div', { class: 'import-actions' },
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn primary', onclick: saveStep1 }, 'Speichern & weiter →')));
  }

  async function saveStep1() {
    try {
      await api('export:setConfig', { meta: state.meta });
    } catch (e) {
      toast(e.message, 'error');
      return;
    }
    state.step = 2;
    render();
  }

  /* ---------------- step 2: Auswahl & Feldrollen ---------------- */

  function onTypeChosen(id) {
    state.docTypeId = id;
    state.roleOverrides = {};
    const t = currentType();
    if (t) for (const f of t.fields) state.roleOverrides[f.name] = f.ead_role || 'none';
    render();
  }

  function renderRolesTable() {
    const t = currentType();
    if (!t) return null;
    const rows = t.fields.map((f) => h('tr', {},
      h('td', { class: 'import-col-head' }, f.label,
        h('span', { style: 'font-weight:400; color:var(--text-faint)' }, `  (${AT.FIELD_TYPE_LABELS[f.field_type]})`)),
      h('td', {},
        h('select', {
          onchange: (e) => { state.roleOverrides[f.name] = e.target.value; },
        }, Object.entries(AT.EAD_ROLE_LABELS).map(([v, label]) =>
          h('option', { value: v, selected: (state.roleOverrides[f.name] || 'none') === v }, label))))));
    return h('div', { class: 'table-wrap', style: 'margin-top:10px' },
      h('table', { class: 'data' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Feld'), h('th', { style: 'width:320px' }, 'EAD-Rolle'))),
        h('tbody', {}, rows)));
  }

  function renderStep2() {
    const typeSelect = h('select', {
      onchange: (e) => onTypeChosen(Number(e.target.value) || null),
    },
      h('option', { value: '' }, '– bitte wählen –'),
      types.map((t) => h('option', { value: t.id, selected: t.id === state.docTypeId }, `${t.icon} ${t.name} (${t.recordCount})`)));

    const searchInput = h('input', {
      type: 'text', value: state.search,
      placeholder: '🔍 nur Einträge, die zu diesem Text passen (Archiv-ID und alle Felder)',
      oninput: (e) => { state.search = e.target.value; },
    });

    container.replaceChildren(
      header(),
      stepper(2),
      h('div', { class: 'card import-section' },
        h('h3', {}, '3) Auswahl'),
        h('div', { class: 'form-group' }, h('label', {}, 'Dokumenttyp ', h('span', { class: 'req' }, '*')), typeSelect),
        h('div', { class: 'form-group' }, h('label', {}, 'Filter (optional)'), searchInput,
          h('p', { class: 'meta-line' }, 'Leer lassen, um alle Einträge dieses Typs zu exportieren.'))),
      state.docTypeId ? h('div', { class: 'card import-section' },
        h('h3', {}, '4) EAD-Feldrollen'),
        h('p', { class: 'view-sub', style: 'margin:0' },
          'Vorbelegt aus dem Dokumenttyp. „Titel“ ist Pflicht (genau ein Feld). ',
          'Änderungen hier gelten nur für diesen Export.'),
        renderRolesTable()) : null,
      h('div', { class: 'import-actions' },
        h('button', { class: 'btn', onclick: () => { state.step = 1; render(); } }, '← Zurück'),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn primary', onclick: goValidate }, 'Weiter zur Prüfung →')));
  }

  async function goValidate() {
    if (!state.docTypeId) { toast('Bitte wählen Sie einen Dokumenttyp.', 'error'); return; }
    const report = await apiSafe('export:validate', selectionPayload());
    if (!report) return;
    state.report = report;
    state.step = 3;
    render();
  }

  /* ---------------- step 3: Prüfung & Export ---------------- */

  function renderStep3() {
    const r = state.report;
    const stat = (num, label, cls) => h('div', { class: 'import-stat' },
      h('span', { class: `import-stat-num ${cls || ''}` }, Number(num).toLocaleString('de-DE')),
      h('span', {}, label));

    const blocks = [
      h('div', { class: 'import-stats' },
        stat(r.totalRecords, 'Einträge in der Auswahl'),
        stat(r.exportableCount, 'exportierbar', r.exportableCount === r.totalRecords ? 'green' : 'amber'),
        stat(r.recordProblems.length, 'mit Problemen', r.recordProblems.length ? 'red' : 'green')),
    ];

    if (r.metaProblems.length) {
      blocks.push(h('div', { class: 'import-detail-block' },
        h('strong', {}, '⚠️ Fehlende Pflichtangaben:'),
        h('ul', {}, r.metaProblems.map((p) => h('li', {}, p)))));
    }
    if (r.recordProblems.length) {
      blocks.push(h('details', { class: 'import-detail-block' },
        h('summary', {}, h('span', { class: 'badge red' }, String(r.recordProblems.length)), ' Einträge mit Problemen'),
        h('ul', {}, r.recordProblems.slice(0, 200).map((rp) =>
          h('li', {}, h('strong', {}, rp.archiveId), ': ', rp.problems.join(' · '))),
          r.recordProblems.length > 200 ? h('li', {}, `… und ${r.recordProblems.length - 200} weitere`) : null)));
    }
    if (r.ok && r.totalRecords > 0) {
      blocks.push(h('p', { class: 'meta-line', style: 'color:var(--text-soft)' },
        '✓ Alle Pflichtangaben vorhanden – die Datei kann erzeugt werden.'));
    }
    if (r.totalRecords === 0) {
      blocks.push(h('p', { class: 'meta-line' }, 'Die Auswahl enthält keine Einträge.'));
    }

    const canExport = r.ok && r.totalRecords > 0;
    container.replaceChildren(
      header(),
      stepper(3),
      h('div', { class: 'card import-section' },
        h('h3', {}, `5) Prüfung – ${r.docTypeName}`),
        blocks),
      h('div', { class: 'import-actions' },
        h('button', { class: 'btn', onclick: () => { state.step = 2; render(); } }, '← Zurück'),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn', onclick: goValidate }, '↻ Erneut prüfen'),
        h('button', {
          class: 'btn primary', disabled: !canExport,
          title: canExport ? '' : 'Bitte zuerst alle Probleme beheben.',
          onclick: doExport,
        }, '⬆️ EAD-Datei exportieren')));
  }

  async function doExport() {
    try {
      const res = await api('export:run', selectionPayload());
      if (res.canceled) return; // user dismissed the save dialog
      state.result = res;
      state.step = 4;
      render();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  /* ---------------- step 4: Ergebnis ---------------- */

  function renderResult() {
    const res = state.result;
    container.replaceChildren(
      header(),
      h('div', { class: 'card import-section' },
        h('div', { class: 'empty-state', style: 'padding:32px 20px' },
          h('div', { class: 'big' }, '🎉'),
          h('h3', {}, 'Export abgeschlossen'),
          h('p', {}, `${Number(res.recordCount).toLocaleString('de-DE')} Einträge wurden als EAD-Findbuch gespeichert.`),
          h('p', { class: 'meta-line', style: 'word-break:break-all' }, res.filePath),
          h('p', { class: 'view-sub', style: 'margin-top:14px' },
            'Laden Sie die Datei nun manuell im Archivportal NRW unter „Verwaltung der Bestände → Hochladen“ hoch.'),
          h('div', { class: 'import-actions', style: 'justify-content:center; margin-top:18px' },
            h('button', { class: 'btn', onclick: () => apiSafe('file:showInFolder', { filePath: res.filePath }) }, '📁 Im Ordner zeigen'),
            h('button', { class: 'btn primary', onclick: () => { state.step = 2; state.result = null; render(); } }, 'Weiteren Export erstellen')))));
  }

  /* ---------------- chrome ---------------- */

  function header() {
    return h('div', { class: 'view-header' },
      h('div', {},
        h('h2', {}, 'Export'),
        h('p', { class: 'view-sub' }, 'Erfasste Einträge als EAD-(DDB)-Findbuch für das Archivportal NRW exportieren')));
  }

  function stepper(active) {
    const steps = [
      { id: 1, label: 'Stammdaten' },
      { id: 2, label: 'Auswahl' },
      { id: 3, label: 'Prüfung' },
      { id: 4, label: 'Ergebnis' },
    ];
    const activeIdx = steps.findIndex((s) => s.id === active);
    return h('div', { class: 'import-stepper' },
      steps.map((s, i) => h('div', {
        class: 'import-step' + (s.id === active ? ' active' : '') + (activeIdx >= 0 && i < activeIdx ? ' done' : ''),
      }, h('span', { class: 'import-step-no' }, i + 1), s.label)));
  }

  function render() {
    if (!state) state = freshState();
    if (state.step === 1) return renderStep1();
    if (state.step === 2) return renderStep2();
    if (state.step === 3) return renderStep3();
    if (state.step === 4) return renderResult();
  }

  AT.views = AT.views || {};
  AT.views.export = async function renderExport(c) {
    container = c;
    const cfg = await apiSafe('export:getConfig');
    if (!cfg) return;
    types = cfg.types || [];
    sparten = cfg.sparten || [];
    if (!state) {
      state = freshState();
      state.meta = { ...state.meta, ...(cfg.meta || {}) };
      if (!state.eadid) state.eadid = suggestEadid();
    }
    render();
  };

})(window.AT);
