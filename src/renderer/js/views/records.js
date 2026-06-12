'use strict';

/* Archive view: search, filter, list, create, edit (with conflict handling),
 * delete and per-record change history. */

window.AT = window.AT || {};

(function (AT) {
  const { h, api, apiSafe, toast } = AT;

  const state = {
    docTypeId: 0,        // 0 = all types
    search: '',
    fieldFilters: {},
    sort: 'archive_id',
    dir: 'asc',
    offset: 0,
    limit: 50,
    showFilters: false,
  };

  let docTypes = [];
  let container = null;

  function typeById(id) {
    return docTypes.find((t) => t.id === id) || null;
  }

  /* ---------------- form inputs per field type ---------------- */

  function fieldInput(field, value) {
    const name = `f_${field.name}`;
    switch (field.field_type) {
      case 'textarea':
        return h('textarea', { id: name, value: value ?? '' });
      case 'number':
        return h('input', { type: 'number', id: name, step: 'any', value: value ?? '' });
      case 'date':
        return h('input', { type: 'date', id: name, value: value ?? '' });
      case 'boolean':
        return h('label', { class: 'checkbox-row' },
          h('input', { type: 'checkbox', id: name, checked: !!value }), ' Ja');
      case 'select': {
        const opts = field.options || [];
        return h('select', { id: name },
          h('option', { value: '' }, '– bitte wählen –'),
          opts.map((o) => h('option', { value: o, selected: o === value }, o)));
      }
      case 'filepath': {
        const input = h('input', { type: 'text', id: name, value: value ?? '', placeholder: 'Pfad zur Datei …' });
        return h('div', { class: 'input-with-btn' }, input,
          h('button', {
            class: 'btn', type: 'button',
            onclick: async () => {
              const picked = await apiSafe('file:pick');
              if (picked) input.value = picked;
            },
          }, 'Durchsuchen…'));
      }
      default:
        return h('input', { type: 'text', id: name, value: value ?? '' });
    }
  }

  function readFieldValue(field, modalEl) {
    const el = modalEl.querySelector(`#f_${field.name}`);
    if (!el) return undefined;
    if (field.field_type === 'boolean') return el.checked;
    return el.value;
  }

  /* ---------------- create / edit modal ---------------- */

  function openRecordForm({ record, presetTypeId, onSaved }) {
    const isNew = !record;
    let currentType = isNew
      ? typeById(presetTypeId) || docTypes[0]
      : typeById(record.doc_type_id);
    if (!currentType) {
      toast('Bitte legen Sie zuerst einen Dokumenttyp an.', 'error');
      return;
    }

    const conflictBox = h('div', { class: 'conflict-box hidden' });
    const fieldsWrap = h('div', {});
    let expectedVersion = record ? record.version : null;

    function renderFields(values) {
      AT.setChildren(fieldsWrap,
        currentType.fields.map((f) => h('div', { class: 'form-group' },
          h('label', { for: `f_${f.name}` }, f.label, ' ',
            f.required ? h('span', { class: 'req' }, '*') : null,
            h('span', { style: 'font-weight:400; color:var(--text-faint)' },
              `  (${AT.FIELD_TYPE_LABELS[f.field_type]})`)),
          fieldInput(f, values[f.name]))));
    }

    const idInput = h('input', {
      type: 'text', id: 'rec-archive-id',
      value: record ? record.archive_id : '',
      placeholder: 'z. B. FOTO-1952-001',
    });

    const typeSelect = h('select', {
      disabled: !isNew,
      onchange: () => {
        currentType = typeById(Number(typeSelect.value));
        renderFields({});
      },
    }, docTypes.map((t) => h('option', { value: t.id, selected: t.id === currentType.id }, `${t.icon} ${t.name}`)));

    renderFields(record ? record.data : {});

    const body = h('div', {},
      conflictBox,
      h('div', { class: 'form-group' },
        h('label', {}, 'Dokumenttyp'),
        typeSelect),
      h('div', { class: 'form-group' },
        h('label', { for: 'rec-archive-id' }, 'Archiv-ID ', h('span', { class: 'req' }, '*'),
          h('span', { style: 'font-weight:400; color:var(--text-faint)' },
            '  (eindeutig, alphanumerisch)')),
        idInput),
      h('hr', { style: 'border:none; border-top:1px solid var(--border); margin:16px 0' }),
      fieldsWrap);

    const modal = AT.openModal({
      title: isNew ? 'Neuer Eintrag' : `Eintrag bearbeiten: ${record.archive_id}`,
      wide: true,
      body,
      footer: [
        h('button', { class: 'btn', onclick: () => modal.close() }, 'Abbrechen'),
        h('button', { class: 'btn primary', onclick: save }, isNew ? 'Anlegen' : 'Speichern'),
      ],
    });

    function collectData() {
      const data = {};
      for (const f of currentType.fields) {
        data[f.name] = readFieldValue(f, modal.el);
      }
      return data;
    }

    async function save() {
      const payload = {
        archiveId: idInput.value,
        data: collectData(),
      };
      try {
        let saved;
        if (isNew) {
          saved = await api('records:create', { ...payload, docTypeId: currentType.id });
          toast(`Eintrag „${saved.archive_id}“ wurde angelegt.`, 'success');
        } else {
          saved = await api('records:update', { id: record.id, ...payload, expectedVersion });
          toast(`Eintrag „${saved.archive_id}“ wurde gespeichert.`, 'success');
        }
        modal.close();
        if (onSaved) onSaved(saved);
      } catch (e) {
        if (e.code === 'CONFLICT') {
          showConflict(e.message, payload);
        } else {
          conflictBox.classList.add('hidden');
          toast(e.message, 'error');
        }
      }
    }

    /* Another member saved this record while it was open here. Let the user
     * decide: take over the new state or overwrite it deliberately. */
    function showConflict(message, payload) {
      conflictBox.replaceChildren(
        h('strong', {}, '⚠️ Bearbeitungskonflikt'), h('br'),
        message, h('br'),
        h('div', { style: 'display:flex; gap:8px; margin-top:10px; flex-wrap:wrap' },
          h('button', {
            class: 'btn small',
            onclick: async () => {
              const fresh = await apiSafe('records:get', { id: record.id });
              if (!fresh) return;
              expectedVersion = fresh.version;
              idInput.value = fresh.archive_id;
              renderFields(fresh.data);
              conflictBox.classList.add('hidden');
              toast('Der aktuelle Stand wurde geladen. Ihre Eingaben wurden verworfen.');
            },
          }, 'Aktuellen Stand laden'),
          h('button', {
            class: 'btn small danger',
            onclick: async () => {
              const fresh = await apiSafe('records:get', { id: record.id });
              if (!fresh) return;
              try {
                const saved = await api('records:update', {
                  id: record.id, ...payload, expectedVersion: fresh.version,
                });
                toast(`Eintrag „${saved.archive_id}“ wurde gespeichert (fremde Änderung überschrieben).`, 'success');
                modal.close();
                if (onSaved) onSaved(saved);
              } catch (e2) {
                toast(e2.message, 'error');
              }
            },
          }, 'Trotzdem mit meinen Eingaben speichern')));
      conflictBox.classList.remove('hidden');
      conflictBox.scrollIntoView({ block: 'nearest' });
    }
  }

  /* ---------------- detail modal ---------------- */

  async function openRecordDetail(recordId) {
    const record = await apiSafe('records:get', { id: recordId });
    if (!record) return;
    const type = typeById(record.doc_type_id);
    const fields = type ? type.fields : [];
    const knownNames = new Set(fields.map((f) => f.name));
    const legacyKeys = Object.keys(record.data).filter((k) => !knownNames.has(k));

    const rows = [];
    for (const f of fields) {
      const value = record.data[f.name];
      rows.push(h('dt', {}, f.label));
      if (f.field_type === 'filepath' && value) {
        rows.push(h('dd', {},
          h('div', {}, value),
          h('div', { style: 'display:flex; gap:6px; margin-top:5px' },
            h('button', { class: 'btn small', onclick: () => apiSafe('file:openPath', { filePath: value }) }, 'Öffnen'),
            h('button', { class: 'btn small', onclick: () => apiSafe('file:showInFolder', { filePath: value }) }, 'Im Ordner zeigen'))));
      } else {
        rows.push(h('dd', {}, AT.formatFieldValue(f, value)));
      }
    }
    for (const key of legacyKeys) {
      rows.push(h('dt', { title: 'Feld existiert im Dokumenttyp nicht mehr' }, `${key} †`));
      rows.push(h('dd', {}, String(record.data[key])));
    }

    const modal = AT.openModal({
      title: `${type ? type.icon + ' ' : ''}${record.archive_id}`,
      wide: true,
      body: h('div', {},
        h('div', { style: 'margin-bottom:14px' },
          h('span', { class: 'badge accent' }, type ? type.name : `Typ #${record.doc_type_id}`),
          ' ',
          h('span', { class: 'badge' }, `Version ${record.version}`)),
        h('dl', { class: 'detail-grid' }, rows),
        h('p', { class: 'meta-line' },
          `Angelegt: ${AT.fmtDateTime(record.created_at)} von ${record.created_by_name || 'Unbekannt'}`,
          h('br'),
          `Zuletzt geändert: ${AT.fmtDateTime(record.updated_at)} von ${record.updated_by_name || 'Unbekannt'}`)),
      footer: [
        h('div', { class: 'left' },
          h('button', { class: 'btn', onclick: () => { openHistory(record); } }, '🕘 Historie'),
          h('button', {
            class: 'btn danger',
            onclick: async () => {
              const yes = await AT.confirmDialog({
                title: 'Eintrag löschen',
                message: `Soll der Eintrag „${record.archive_id}“ wirklich gelöscht werden? Die Löschung wird in der Historie protokolliert.`,
                confirmLabel: 'Löschen', danger: true,
              });
              if (!yes) return;
              try {
                await api('records:delete', { id: record.id, expectedVersion: record.version });
                toast(`Eintrag „${record.archive_id}“ wurde gelöscht.`, 'success');
                modal.close();
                refreshList();
              } catch (e) {
                toast(e.message, 'error');
                if (e.code === 'CONFLICT' || e.code === 'NOT_FOUND') {
                  modal.close();
                  refreshList();
                }
              }
            },
          }, '🗑️ Löschen')),
        h('button', { class: 'btn', onclick: () => modal.close() }, 'Schließen'),
        h('button', {
          class: 'btn primary',
          onclick: () => {
            modal.close();
            openRecordForm({ record, onSaved: refreshList });
          },
        }, '✏️ Bearbeiten'),
      ],
    });
  }

  /* ---------------- history modal ---------------- */

  const ACTION_BADGE = {
    create: ['green', 'Angelegt'],
    update: ['amber', 'Geändert'],
    delete: ['red', 'Gelöscht'],
  };

  function diffEntries(entry, previous) {
    const changes = [];
    const before = previous ? previous.data : {};
    const after = entry.data;
    if (previous && previous.archive_id !== entry.archive_id) {
      changes.push(h('li', {}, 'Archiv-ID: ',
        h('span', { class: 'old' }, previous.archive_id), ' → ',
        h('span', { class: 'new' }, entry.archive_id)));
    }
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) {
      const a = before[key];
      const b = after[key];
      if (JSON.stringify(a) === JSON.stringify(b)) continue;
      changes.push(h('li', {}, `${key}: `,
        h('span', { class: 'old' }, a === undefined || a === '' ? '(leer)' : String(a)), ' → ',
        h('span', { class: 'new' }, b === undefined || b === '' ? '(leer)' : String(b))));
    }
    return changes;
  }

  async function openHistory(record) {
    const history = await apiSafe('records:history', { id: record.id });
    if (!history) return;
    const items = history.map((entry, i) => {
      const previous = history[i + 1] || null; // list is newest-first
      const [badgeClass, badgeLabel] = ACTION_BADGE[entry.action] || ['', entry.action];
      const changes = entry.action === 'update' ? diffEntries(entry, previous) : [];
      return h('div', { class: 'history-item' },
        h('div', { class: 'history-head' },
          h('span', { class: `badge ${badgeClass}` }, badgeLabel),
          h('span', { class: 'badge' }, `v${entry.version}`),
          h('strong', {}, entry.changed_by_display || 'Unbekannt'),
          h('span', { class: 'history-time' }, AT.fmtDateTime(entry.changed_at))),
        entry.action === 'update' && changes.length > 0
          ? h('ul', { class: 'history-changes' }, changes)
          : null,
        entry.action === 'create'
          ? h('ul', { class: 'history-changes' },
              Object.entries(entry.data).map(([k, v]) =>
                h('li', {}, `${k}: `, h('span', { class: 'new' }, String(v)))))
          : null);
    });
    AT.openModal({
      title: `Historie: ${record.archive_id}`,
      wide: true,
      body: items.length ? h('div', {}, items) : h('p', {}, 'Keine Historie vorhanden.'),
    });
  }

  /* ---------------- list rendering ---------------- */

  async function refreshList() {
    const listEl = container && container.querySelector('#records-list');
    if (!listEl) return;
    const result = await apiSafe('records:list', {
      docTypeId: state.docTypeId || undefined,
      search: state.search,
      fieldFilters: state.docTypeId ? state.fieldFilters : undefined,
      sort: state.sort,
      dir: state.dir,
      limit: state.limit,
      offset: state.offset,
    });
    if (!result) return;
    if (result.records.length === 0 && result.total > 0 && state.offset > 0) {
      state.offset = Math.max(0, state.offset - state.limit);
      return refreshList();
    }
    renderTable(listEl, result);
  }

  function renderTable(listEl, { total, records, offset, limit }) {
    const type = state.docTypeId ? typeById(state.docTypeId) : null;
    const extraFields = type ? type.fields.slice(0, 3) : [];

    if (records.length === 0) {
      listEl.replaceChildren(
        h('div', { class: 'card' },
          h('div', { class: 'empty-state' },
            h('div', { class: 'big' }, '🗂️'),
            h('p', {}, state.search || Object.keys(state.fieldFilters).length
              ? 'Keine Einträge gefunden. Passen Sie die Suche oder Filter an.'
              : 'Noch keine Einträge vorhanden. Legen Sie den ersten Eintrag an!'))));
      return;
    }

    const head = h('tr', {},
      h('th', {}, 'Archiv-ID'),
      !type ? h('th', {}, 'Typ') : null,
      extraFields.map((f) => h('th', {}, f.label)),
      h('th', {}, 'Geändert'),
      h('th', {}, 'Von'),
      h('th', { style: 'text-align:right' }, 'Version'));

    const rows = records.map((r) => h('tr', {
      class: 'clickable',
      onclick: () => openRecordDetail(r.id),
    },
      h('td', { class: 'cell-id' }, r.archive_id),
      !type ? h('td', {}, h('span', { class: 'badge' }, `${r.doc_type_icon} ${r.doc_type_name}`)) : null,
      extraFields.map((f) => h('td', { class: 'cell-soft', title: String(r.data[f.name] ?? '') },
        AT.formatFieldValue(f, r.data[f.name]))),
      h('td', { class: 'cell-soft' }, AT.fmtDateTime(r.updated_at)),
      h('td', { class: 'cell-soft' }, r.updated_by_name || '–'),
      h('td', { class: 'cell-soft', style: 'text-align:right' }, `v${r.version}`)));

    const from = total === 0 ? 0 : offset + 1;
    const to = Math.min(offset + limit, total);

    listEl.replaceChildren(
      h('div', { class: 'card table-wrap' },
        h('table', { class: 'data' }, h('thead', {}, head), h('tbody', {}, rows))),
      h('div', { class: 'pagination' },
        h('span', {}, `${from}–${to} von ${total.toLocaleString('de-DE')} Einträgen`),
        h('button', {
          class: 'btn small', disabled: offset === 0,
          onclick: () => { state.offset = Math.max(0, offset - limit); refreshList(); },
        }, '← Zurück'),
        h('button', {
          class: 'btn small', disabled: to >= total,
          onclick: () => { state.offset = offset + limit; refreshList(); },
        }, 'Weiter →')));
  }

  /* ---------------- field filter panel ---------------- */

  function renderFilterPanel(panelEl) {
    const type = state.docTypeId ? typeById(state.docTypeId) : null;
    if (!type || !state.showFilters) {
      panelEl.classList.add('hidden');
      panelEl.replaceChildren();
      return;
    }
    panelEl.classList.remove('hidden');
    AT.setChildren(panelEl,
      type.fields.map((f) => h('div', {},
        h('label', { style: 'display:block; font-size:12px; color:var(--text-soft); font-weight:600; margin-bottom:4px' }, f.label),
        f.field_type === 'select'
          ? h('select', {
              value: state.fieldFilters[f.name] || '',
              onchange: (e) => {
                if (e.target.value) state.fieldFilters[f.name] = e.target.value;
                else delete state.fieldFilters[f.name];
                state.offset = 0;
                refreshList();
              },
            },
              h('option', { value: '' }, '– alle –'),
              (f.options || []).map((o) => h('option', { value: o, selected: state.fieldFilters[f.name] === o }, o)))
          : h('input', {
              type: 'text',
              placeholder: 'Filter …',
              value: state.fieldFilters[f.name] || '',
              oninput: AT.debounce((e) => {
                if (e.target.value.trim()) state.fieldFilters[f.name] = e.target.value.trim();
                else delete state.fieldFilters[f.name];
                state.offset = 0;
                refreshList();
              }, 300),
            }))));
  }

  /* ---------------- view entry point ---------------- */

  AT.views = AT.views || {};
  AT.views.records = async function renderRecords(c) {
    container = c;
    docTypes = (await apiSafe('types:list')) || [];
    if (!docTypes.some((t) => t.id === state.docTypeId)) {
      state.docTypeId = 0;
      state.fieldFilters = {};
    }

    const filterPanel = h('div', { class: 'card filter-panel hidden' });

    const typeSelect = h('select', {
      onchange: () => {
        state.docTypeId = Number(typeSelect.value);
        state.fieldFilters = {};
        state.offset = 0;
        renderFilterPanel(filterPanel);
        refreshList();
      },
    },
      h('option', { value: 0 }, 'Alle Dokumenttypen'),
      docTypes.map((t) => h('option', { value: t.id, selected: t.id === state.docTypeId }, `${t.icon} ${t.name}`)));

    const searchInput = h('input', {
      type: 'text',
      class: 'search-box',
      placeholder: '🔍 Suche in Archiv-ID und allen Feldern …',
      value: state.search,
      oninput: AT.debounce((e) => {
        state.search = e.target.value;
        state.offset = 0;
        refreshList();
      }, 300),
    });

    const sortSelect = h('select', {
      onchange: () => {
        const [sort, dir] = sortSelect.value.split(':');
        state.sort = sort;
        state.dir = dir;
        refreshList();
      },
    },
      [['archive_id:asc', 'Archiv-ID (A–Z)'],
       ['archive_id:desc', 'Archiv-ID (Z–A)'],
       ['updated_at:desc', 'Zuletzt geändert'],
       ['created_at:desc', 'Zuletzt angelegt']]
        .map(([v, label]) => h('option', { value: v, selected: `${state.sort}:${state.dir}` === v }, label)));

    container.replaceChildren(
      h('div', { class: 'view-header' },
        h('div', {},
          h('h2', {}, 'Archiv'),
          h('p', { class: 'view-sub' }, 'Alle Einträge des Vereinsarchivs')),
        h('div', { class: 'spacer' }),
        h('button', {
          class: 'btn primary',
          onclick: () => {
            if (docTypes.length === 0) {
              toast('Bitte legen Sie zuerst unter „Dokumenttypen“ einen Typ an.', 'error');
              return;
            }
            openRecordForm({ presetTypeId: state.docTypeId || docTypes[0].id, onSaved: refreshList });
          },
        }, '＋ Neuer Eintrag')),
      h('div', { class: 'toolbar' },
        typeSelect,
        searchInput,
        sortSelect,
        h('button', {
          class: 'btn',
          onclick: () => {
            if (!state.docTypeId) {
              toast('Feldfilter sind verfügbar, sobald ein Dokumenttyp ausgewählt ist.');
              return;
            }
            state.showFilters = !state.showFilters;
            renderFilterPanel(filterPanel);
          },
        }, '⚙ Feldfilter')),
      filterPanel,
      h('div', { id: 'records-list' }));

    renderFilterPanel(filterPanel);
    await refreshList();
  };

})(window.AT);
