'use strict';

/* Import wizard: bring an external table (e.g. a Citavi Excel export) into the
 * archive. Three steps:
 *   1. choose the file,
 *   2. decide per column whether to keep it – as a new field or mapped onto an
 *      existing one – with the fill rate shown as a checklist,
 *   3. check for redundant (duplicate) entries, then import.
 */

window.AT = window.AT || {};

(function (AT) {
  const { h, api, apiSafe, toast } = AT;

  const ICON_CHOICES = ['📥', '📄', '📕', '🖼️', '🎞️', '📰', '🗺️', '📜', '🏺', '✉️', '📦'];

  let container = null;
  let types = [];
  let state = null;

  function freshState() {
    return {
      token: null,
      fileName: '',
      sheetName: '',
      totalRows: 0,
      columns: [],
      mapping: [],          // per column: { index, action, label, name, fieldType, required, targetName }
      target: { mode: 'new', newTypeName: '', newTypeIcon: ICON_CHOICES[0], docTypeId: null },
      archiveId: { mode: 'generate', index: null, prefix: 'IMP-' },
      dedupeColumns: [],
      onDuplicate: 'skip',
      withinFileDuplicates: 'all',
      step: 1,
    };
  }

  /* ---------------- helpers ---------------- */

  function pctClass(pct) {
    if (pct >= 60) return 'green';
    if (pct >= 20) return 'amber';
    return 'red';
  }

  function guessArchiveIdColumn(columns) {
    const re = /signatur|laufnummer|laufnr|nummer|\bid\b|kennung/i;
    let best = null;
    for (const c of columns) {
      if (c.pct < 50) continue;
      if (re.test(c.header)) {
        if (!best || c.pct > best.pct) best = c;
      }
    }
    return best;
  }

  function initFromAnalysis(data) {
    state = freshState();
    state.token = data.token;
    state.fileName = data.fileName;
    state.sheetName = data.sheetName;
    state.totalRows = data.totalRows;
    state.columns = data.columns;
    state.mapping = data.columns.map((c) => ({
      index: c.index,
      action: c.hasHeader && c.pct > 0 ? 'new' : 'ignore',
      label: c.suggestedLabel,
      name: c.suggestedName,
      fieldType: c.inferredType,
      required: false,
      targetName: '',
    }));
    const guess = guessArchiveIdColumn(data.columns);
    if (guess) {
      state.archiveId = { mode: 'column', index: guess.index, prefix: 'IMP-' };
      state.dedupeColumns = [guess.index];
    } else {
      state.archiveId = { mode: 'generate', index: null, prefix: 'IMP-' };
      state.dedupeColumns = [];
    }
    state.step = 2;
  }

  /* ---------------- step 1: choose file ---------------- */

  function renderStep1() {
    container.replaceChildren(
      header(),
      h('div', { class: 'card import-intro' },
        h('div', { class: 'empty-state' },
          h('div', { class: 'big' }, '📥'),
          h('h3', { style: 'margin-bottom:8px' }, 'Datei importieren'),
          h('p', {},
            'Importieren Sie einen Tabellen-Export (z. B. aus Citavi) als ',
            h('strong', {}, 'Excel-Datei (.xlsx)'), ' oder ', h('strong', {}, 'CSV'), '. ',
            'Im nächsten Schritt entscheiden Sie pro Spalte, ob sie übernommen wird – ',
            'jeweils mit Angabe, zu wie viel Prozent sie befüllt ist.'),
          h('div', { style: 'margin-top:18px' },
            h('button', {
              class: 'btn primary',
              onclick: async () => {
                const data = await apiSafe('import:pickFile');
                if (!data) return; // cancelled or error (toast already shown)
                initFromAnalysis(data);
                render();
              },
            }, '📂 Datei auswählen …')))));
  }

  /* ---------------- step 2: fields & mapping ---------------- */

  function targetFields() {
    if (state.target.mode !== 'existing' || !state.target.docTypeId) return [];
    const t = types.find((x) => x.id === state.target.docTypeId);
    return t ? t.fields : [];
  }

  function renderTargetChooser() {
    const newNameInput = h('input', {
      type: 'text', value: state.target.newTypeName,
      placeholder: 'z. B. Literaturarchiv, Citavi-Bestand …',
      oninput: (e) => { state.target.newTypeName = e.target.value; },
    });

    const iconWrap = h('div', { style: 'display:flex; gap:4px; flex-wrap:wrap; margin-top:6px' });
    function renderIcons() {
      AT.setChildren(iconWrap, ICON_CHOICES.map((i) => h('button', {
        type: 'button', class: 'btn small',
        style: i === state.target.newTypeIcon ? 'border-color:var(--accent); background:var(--accent-soft)' : '',
        onclick: () => { state.target.newTypeIcon = i; renderIcons(); },
      }, i)));
    }
    renderIcons();

    const newBox = h('div', { class: 'import-target-detail' },
      h('label', {}, 'Name des neuen Dokumenttyps ', h('span', { class: 'req' }, '*')),
      newNameInput, iconWrap);

    const typeSelect = h('select', {
      onchange: (e) => { state.target.docTypeId = Number(e.target.value) || null; render(); },
    },
      h('option', { value: '' }, '– bitte wählen –'),
      types.map((t) => h('option', { value: t.id, selected: t.id === state.target.docTypeId }, `${t.icon} ${t.name} (${t.recordCount})`)));
    const existingBox = h('div', { class: 'import-target-detail' },
      h('label', {}, 'Bestehender Dokumenttyp'), typeSelect);

    const modeRadios = h('div', { class: 'import-radio-row' },
      radio('imp-target', 'new', state.target.mode === 'new', 'Neuen Dokumenttyp anlegen', () => { state.target.mode = 'new'; render(); }),
      radio('imp-target', 'existing', state.target.mode === 'existing', 'In bestehenden Dokumenttyp importieren', () => { state.target.mode = 'existing'; render(); }));

    return h('div', { class: 'card import-section' },
      h('h3', {}, '1) Ziel'),
      modeRadios,
      state.target.mode === 'new' ? newBox
        : (types.length ? existingBox
          : h('p', { class: 'meta-line' }, 'Es sind noch keine Dokumenttypen vorhanden – legen Sie einen neuen an.')));
  }

  function renderArchiveIdChooser() {
    const colSelect = h('select', {
      disabled: state.archiveId.mode !== 'column',
      onchange: (e) => { state.archiveId.index = Number(e.target.value); },
    }, state.columns.map((c) => h('option', {
      value: c.index, selected: c.index === state.archiveId.index,
    }, `${c.header} — ${c.pct}% befüllt`)));

    const prefixInput = h('input', {
      type: 'text', value: state.archiveId.prefix, style: 'max-width:160px',
      oninput: (e) => { state.archiveId.prefix = e.target.value; },
    });

    return h('div', { class: 'card import-section' },
      h('h3', {}, '2) Archiv-ID (Pflicht, eindeutig)'),
      h('div', { class: 'import-radio-row' },
        radio('imp-aid', 'column', state.archiveId.mode === 'column', 'Aus einer Spalte übernehmen', () => { state.archiveId.mode = 'column'; if (state.archiveId.index == null && state.columns[0]) state.archiveId.index = state.columns[0].index; render(); }),
        radio('imp-aid', 'generate', state.archiveId.mode === 'generate', 'Automatisch erzeugen', () => { state.archiveId.mode = 'generate'; render(); })),
      state.archiveId.mode === 'column'
        ? h('div', { class: 'import-target-detail' }, h('label', {}, 'Quellspalte'), colSelect,
            h('p', { class: 'meta-line' }, 'Leere oder ungültige Werte werden automatisch mit einer laufenden Nummer ersetzt.'))
        : h('div', { class: 'import-target-detail' }, h('label', {}, 'Präfix für laufende Nummern'), prefixInput,
            h('p', { class: 'meta-line' }, `Es entstehen IDs wie „${(state.archiveId.prefix || 'IMP-')}00001“.`)));
  }

  function actionOptions(entry) {
    const opts = [
      h('option', { value: 'ignore', selected: entry.action === 'ignore' }, 'Ignorieren'),
      h('option', { value: 'new', selected: entry.action === 'new' }, '➕ Als neues Feld'),
    ];
    for (const f of targetFields()) {
      opts.push(h('option', {
        value: 'existing:' + f.name,
        selected: entry.action === 'existing' && entry.targetName === f.name,
      }, `→ ${f.label}`));
    }
    return opts;
  }

  function renderColumnRow(col) {
    const entry = state.mapping[col.index];
    const extraCell = h('td', { class: 'import-extra' });

    function renderExtra() {
      if (entry.action === 'new') {
        AT.setChildren(extraCell,
          h('div', { class: 'import-newfield' },
            h('input', {
              type: 'text', value: entry.label, placeholder: 'Feldbezeichnung',
              oninput: (e) => { entry.label = e.target.value; },
            }),
            h('select', { onchange: (e) => { entry.fieldType = e.target.value; } },
              Object.entries(AT.FIELD_TYPE_LABELS)
                .filter(([v]) => v !== 'select') // selects need predefined options
                .map(([v, label]) => h('option', { value: v, selected: entry.fieldType === v }, label))),
            h('label', { class: 'checkbox-row', title: 'Pflichtfeld' },
              h('input', { type: 'checkbox', checked: entry.required, onchange: (e) => { entry.required = e.target.checked; } }), ' Pflicht')));
      } else {
        extraCell.replaceChildren();
      }
    }

    const keep = h('input', {
      type: 'checkbox', checked: entry.action !== 'ignore',
      onchange: (e) => {
        entry.action = e.target.checked ? (targetFields().length && entry.targetName ? 'existing' : 'new') : 'ignore';
        actionSelect.value = entry.action === 'existing' ? 'existing:' + entry.targetName : entry.action;
        renderExtra();
      },
    });

    const actionSelect = h('select', {
      onchange: (e) => {
        const v = e.target.value;
        if (v.startsWith('existing:')) { entry.action = 'existing'; entry.targetName = v.slice('existing:'.length); }
        else { entry.action = v; }
        keep.checked = entry.action !== 'ignore';
        renderExtra();
      },
    }, actionOptions(entry));

    renderExtra();

    const sample = col.samples.length
      ? col.samples.slice(0, 2).join(' · ')
      : '(leer)';

    return h('tr', { class: entry.action === 'ignore' ? 'import-row-off' : '' },
      h('td', { style: 'text-align:center' }, keep),
      h('td', {},
        h('div', { class: 'import-col-head' }, col.header),
        h('div', { class: 'import-col-sample', title: col.samples.join('\n') }, sample)),
      h('td', { class: 'import-fill' },
        h('div', { class: 'import-fill-bar' },
          h('div', { class: `import-fill-val ${pctClass(col.pct)}`, style: `width:${Math.max(col.pct, 2)}%` })),
        h('span', { class: 'import-fill-pct' }, `${col.pct}%`)),
      h('td', {}, actionSelect),
      extraCell);
  }

  function renderColumnsTable() {
    const onlyFilled = state.onlyFilled !== false;
    const cols = state.columns
      .filter((c) => !onlyFilled || c.pct > 0)
      .slice()
      .sort((a, b) => b.pct - a.pct);

    const head = h('tr', {},
      h('th', { style: 'width:40px' }, '✓'),
      h('th', {}, 'Spalte aus der Datei'),
      h('th', { style: 'width:150px' }, 'Befüllung'),
      h('th', { style: 'width:160px' }, 'Zuordnung'),
      h('th', {}, 'Neues Feld'));

    const keptCount = state.mapping.filter((m) => m.action !== 'ignore').length;

    return h('div', { class: 'card import-section' },
      h('div', { class: 'import-fields-head' },
        h('h3', {}, '3) Felder zuordnen'),
        h('div', { class: 'spacer' }),
        h('span', { class: 'badge accent' }, `${keptCount} Felder ausgewählt`),
        h('label', { class: 'checkbox-row' },
          h('input', {
            type: 'checkbox', checked: onlyFilled,
            onchange: (e) => { state.onlyFilled = e.target.checked; render(); },
          }), ' Nur befüllte Spalten'),
        h('button', { class: 'btn small', onclick: () => { setAll('new'); render(); } }, 'Alle übernehmen'),
        h('button', { class: 'btn small', onclick: () => { setAll('ignore'); render(); } }, 'Keine')),
      h('p', { class: 'view-sub', style: 'margin:0 0 10px' },
        'Häkchen setzen, um eine Spalte zu übernehmen. „Als neues Feld“ legt ein Eigenschaftsfeld an; ',
        'alternativ lässt sich eine Spalte einem bereits bestehenden, anders benannten Feld zuordnen.'),
      h('div', { class: 'table-wrap' },
        h('table', { class: 'data import-table' }, h('thead', {}, head), h('tbody', {}, cols.map(renderColumnRow)))));

    function setAll(action) {
      for (const c of state.columns) {
        const m = state.mapping[c.index];
        if (action === 'new') { if (c.pct > 0) m.action = 'new'; }
        else m.action = 'ignore';
      }
    }
  }

  function step2Valid() {
    if (state.target.mode === 'new' && !state.target.newTypeName.trim()) {
      toast('Bitte geben Sie einen Namen für den neuen Dokumenttyp an.', 'error');
      return false;
    }
    if (state.target.mode === 'existing' && !state.target.docTypeId) {
      toast('Bitte wählen Sie einen bestehenden Dokumenttyp aus.', 'error');
      return false;
    }
    if (!state.mapping.some((m) => m.action !== 'ignore')) {
      toast('Bitte wählen Sie mindestens eine Spalte zur Übernahme aus.', 'error');
      return false;
    }
    return true;
  }

  function renderStep2() {
    container.replaceChildren(
      header(),
      stepper(2),
      renderTargetChooser(),
      renderArchiveIdChooser(),
      renderColumnsTable(),
      h('div', { class: 'import-actions' },
        h('button', { class: 'btn', onclick: cancelImport }, 'Abbrechen'),
        h('div', { class: 'spacer' }),
        h('button', {
          class: 'btn primary',
          onclick: () => { if (step2Valid()) { state.step = 3; render(); } },
        }, 'Weiter zur Dublettenprüfung →')));
  }

  /* ---------------- step 3: duplicates & import ---------------- */

  function commitPayload() {
    return {
      token: state.token,
      target: state.target.mode === 'new'
        ? { mode: 'new', newTypeName: state.target.newTypeName, newTypeIcon: state.target.newTypeIcon }
        : { mode: 'existing', docTypeId: state.target.docTypeId },
      mapping: state.mapping,
      archiveId: state.archiveId.mode === 'column'
        ? { mode: 'column', index: state.archiveId.index, prefix: state.archiveId.prefix }
        : { mode: 'generate', prefix: state.archiveId.prefix },
      dedupeColumns: state.dedupeColumns,
      withinFileDuplicates: state.withinFileDuplicates,
    };
  }

  function renderDedupeChooser(resultBox) {
    const candidates = state.columns.filter((c) => c.pct > 0);
    const checks = candidates.map((c) => h('label', { class: 'import-dedupe-col' },
      h('input', {
        type: 'checkbox', checked: state.dedupeColumns.includes(c.index),
        onchange: (e) => {
          if (e.target.checked) { if (!state.dedupeColumns.includes(c.index)) state.dedupeColumns.push(c.index); }
          else state.dedupeColumns = state.dedupeColumns.filter((i) => i !== c.index);
        },
      }), ` ${c.header}`));

    return h('div', { class: 'card import-section' },
      h('h3', {}, 'Redundanzprüfung'),
      h('p', { class: 'view-sub', style: 'margin:0 0 10px' },
        'Wählen Sie die Spalten, die einen Eintrag eindeutig kennzeichnen. ',
        'Geprüft wird, ob Zeilen ',
        h('strong', {}, 'innerhalb der Datei'), ' doppelt vorkommen und ob Archiv-IDs ',
        h('strong', {}, 'bereits in der Datenbank'), ' existieren.'),
      h('div', { class: 'import-dedupe-cols' }, checks.length ? checks : h('span', { class: 'meta-line' }, 'Keine befüllten Spalten.')),
      h('div', { style: 'margin-top:12px' },
        h('button', {
          class: 'btn',
          onclick: async () => {
            resultBox.replaceChildren(h('p', { class: 'cell-soft' }, 'Wird geprüft …'));
            const preview = await apiSafe('import:preview', {
              ...commitPayload(),
              dedupeColumns: state.dedupeColumns,
            });
            if (!preview) { resultBox.replaceChildren(); return; }
            renderPreviewResult(resultBox, preview);
          },
        }, '🔍 Auf Dubletten prüfen')),
      resultBox);
  }

  function renderPreviewResult(box, p) {
    const items = [];
    items.push(h('div', { class: 'import-stat' },
      h('span', { class: 'import-stat-num' }, p.totalRows.toLocaleString('de-DE')),
      h('span', {}, 'Zeilen insgesamt')));
    items.push(h('div', { class: 'import-stat' },
      h('span', { class: `import-stat-num ${p.withinFile.duplicateRows ? 'amber' : 'green'}` }, p.withinFile.duplicateRows.toLocaleString('de-DE')),
      h('span', {}, `redundante Zeilen in der Datei (${p.withinFile.duplicateGroups} Gruppen)`)));
    items.push(h('div', { class: 'import-stat' },
      h('span', { class: `import-stat-num ${p.existingCollisions ? 'amber' : 'green'}` }, p.existingCollisions.toLocaleString('de-DE')),
      h('span', {}, 'Archiv-IDs existieren bereits in der Datenbank')));

    const detail = [];
    if (p.withinFile.examples.length) {
      detail.push(h('div', { class: 'import-detail-block' },
        h('strong', {}, 'Beispiele doppelter Werte:'),
        h('ul', {}, p.withinFile.examples.slice(0, 6).map((ex) =>
          h('li', {}, `„${ex.value}“ – ${ex.count}× (Zeilen ${ex.rows.join(', ')})`)))));
    }
    if (p.collisionExamples && p.collisionExamples.length) {
      detail.push(h('div', { class: 'import-detail-block' },
        h('strong', {}, 'Bereits vorhandene IDs:'),
        h('div', { class: 'import-chips' }, p.collisionExamples.slice(0, 12).map((id) => h('span', { class: 'badge' }, id)))));
    }

    // Resolution for redundant rows *within the file* (by the key columns).
    const hasWithinFile = p.withinFile.duplicateRows > 0;
    const withinHandling = h('div', { class: 'import-section', style: 'border:none; padding:14px 0 0' },
      h('label', { style: 'font-weight:600; display:block; margin-bottom:6px' }, 'Umgang mit Dubletten innerhalb der Datei:'),
      h('div', { class: 'import-radio-row' },
        radio('imp-within', 'all', state.withinFileDuplicates === 'all', 'Alle importieren (nichts entfernen)', () => { state.withinFileDuplicates = 'all'; }),
        radio('imp-within', 'first', state.withinFileDuplicates === 'first', 'Nur den ersten Treffer je Schlüssel importieren', () => { state.withinFileDuplicates = 'first'; }),
        radio('imp-within', 'mostComplete', state.withinFileDuplicates === 'mostComplete', 'Den am besten befüllten Eintrag je Schlüssel behalten', () => { state.withinFileDuplicates = 'mostComplete'; })));

    // Resolution for archive ids that already exist in the database.
    const hasCollisions = p.existingCollisions > 0;
    const dupHandling = h('div', { class: 'import-section', style: 'border:none; padding:14px 0 0' },
      h('label', { style: 'font-weight:600; display:block; margin-bottom:6px' }, 'Umgang mit bereits vorhandenen Archiv-IDs:'),
      h('div', { class: 'import-radio-row' },
        radio('imp-dup', 'skip', state.onDuplicate === 'skip', 'Überspringen (vorhandene Einträge unverändert lassen)', () => { state.onDuplicate = 'skip'; }),
        radio('imp-dup', 'overwrite', state.onDuplicate === 'overwrite', 'Aktualisieren (importierte Felder in vorhandene Einträge übernehmen)', () => { state.onDuplicate = 'overwrite'; })));

    box.replaceChildren(
      h('div', { class: 'import-stats' }, items),
      detail.length ? h('div', {}, detail) : null,
      hasWithinFile ? withinHandling : null,
      hasCollisions ? dupHandling : null);
  }

  function renderStep3() {
    const resultBox = h('div', { style: 'margin-top:14px' });
    container.replaceChildren(
      header(),
      stepper(3),
      renderDedupeChooser(resultBox),
      h('div', { class: 'import-actions' },
        h('button', { class: 'btn', onclick: () => { state.step = 2; render(); } }, '← Zurück'),
        h('div', { class: 'spacer' }),
        h('button', { class: 'btn danger-soft', onclick: cancelImport }, 'Abbrechen'),
        h('button', { class: 'btn primary', onclick: runImport }, '✅ Import starten')));
  }

  async function runImport() {
    const overlay = h('div', { class: 'import-running' },
      h('div', { class: 'spinner' }), h('p', {}, `${state.totalRows.toLocaleString('de-DE')} Zeilen werden importiert – bitte warten …`));
    container.append(overlay);
    try {
      const summary = await api('import:commit', { ...commitPayload(), onDuplicate: state.onDuplicate });
      state.summary = summary;
      state.step = 4;
      render();
    } catch (e) {
      overlay.remove();
      toast(e.message, 'error');
    }
  }

  /* ---------------- step 4: result ---------------- */

  function renderResult() {
    const s = state.summary;
    const detailList = (arr, label, cls) => arr.length
      ? h('details', { class: 'import-detail-block' },
          h('summary', {}, h('span', { class: `badge ${cls}` }, `${arr.length}`), ` ${label}`),
          h('ul', {}, arr.slice(0, 200).map((x) =>
            h('li', {}, `${x.archiveId || '(leer)'}${x.row ? ` (Zeile ${x.row})` : ''}: ${x.reason}`))),
          arr.length > 200 ? h('p', { class: 'meta-line' }, `… und ${arr.length - 200} weitere`) : null)
      : null;

    container.replaceChildren(
      header(),
      h('div', { class: 'card import-section' },
        h('div', { class: 'empty-state', style: 'padding:32px 20px' },
          h('div', { class: 'big' }, s.failed.length ? '⚠️' : '🎉'),
          h('h3', {}, 'Import abgeschlossen'),
          h('div', { class: 'import-stats', style: 'justify-content:center; margin-top:18px' },
            h('div', { class: 'import-stat' }, h('span', { class: 'import-stat-num green' }, s.created.toLocaleString('de-DE')), h('span', {}, 'neu angelegt')),
            h('div', { class: 'import-stat' }, h('span', { class: 'import-stat-num' }, s.updated.toLocaleString('de-DE')), h('span', {}, 'aktualisiert')),
            h('div', { class: 'import-stat' }, h('span', { class: 'import-stat-num amber' }, s.skipped.length.toLocaleString('de-DE')), h('span', {}, 'übersprungen')),
            h('div', { class: 'import-stat' }, h('span', { class: `import-stat-num ${s.failed.length ? 'red' : ''}` }, s.failed.length.toLocaleString('de-DE')), h('span', {}, 'fehlerhaft')))),
        detailList(s.skipped, 'übersprungen', 'amber'),
        detailList(s.failed, 'fehlerhaft (nicht importiert)', 'red'),
        h('div', { class: 'import-actions', style: 'margin-top:18px' },
          h('button', { class: 'btn', onclick: () => { state = freshState(); render(); } }, 'Weiteren Import starten'),
          h('div', { class: 'spacer' }),
          h('button', {
            class: 'btn primary',
            onclick: () => { if (AT.go) AT.go('records'); },
          }, 'Zum Archiv →'))));
  }

  /* ---------------- shared chrome ---------------- */

  function header() {
    return h('div', { class: 'view-header' },
      h('div', {},
        h('h2', {}, 'Import'),
        h('p', { class: 'view-sub' },
          state.fileName ? `Datei: ${state.fileName}` : 'Citavi-/Excel-/CSV-Daten in das Archiv übernehmen')));
  }

  function stepper(active) {
    const steps = [[2, 'Felder zuordnen'], [3, 'Dubletten prüfen'], [4, 'Ergebnis']];
    return h('div', { class: 'import-stepper' },
      steps.map(([n, label], i) => h('div', {
        class: 'import-step' + (n === active ? ' active' : '') + (n < active ? ' done' : ''),
      }, h('span', { class: 'import-step-no' }, i + 1), label)));
  }

  function radio(name, value, checked, label, onchange) {
    return h('label', { class: 'import-radio' },
      h('input', { type: 'radio', name, checked, onchange: (e) => { if (e.target.checked) onchange(); } }),
      ' ', label);
  }

  async function cancelImport() {
    if (state && state.token) await apiSafe('import:cancel', { token: state.token });
    state = freshState();
    state.step = 1;
    render();
  }

  /* ---------------- dispatch ---------------- */

  function render() {
    if (!state) state = freshState();
    if (state.step === 1) return renderStep1();
    if (state.step === 2) return renderStep2();
    if (state.step === 3) return renderStep3();
    if (state.step === 4) return renderResult();
  }

  AT.views = AT.views || {};
  AT.views.import = async function renderImport(c) {
    container = c;
    types = (await apiSafe('types:list')) || [];
    if (!state) state = freshState();
    // Returning to the view keeps an in-progress wizard; otherwise start fresh.
    if (!state.token) state.step = 1;
    render();
  };

})(window.AT);
