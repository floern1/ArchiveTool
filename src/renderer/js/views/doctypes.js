'use strict';

/* Document type management: flexible definition of entry forms per type
 * (e.g. Bücher, Bilder, Filme) with typed input fields. */

window.AT = window.AT || {};

(function (AT) {
  const { h, api, apiSafe, toast } = AT;

  const ICON_CHOICES = ['📄', '📕', '🖼️', '🎞️', '📰', '🗺️', '📜', '🏺', '📼', '🎙️', '✉️', '📦'];

  let container = null;

  /* ---------------- type editor modal ---------------- */

  function emptyField() {
    return { name: '', label: '', field_type: 'text', required: false, options: [] };
  }

  function openTypeEditor(type, onSaved) {
    const isNew = !type;
    // Work on a deep copy so cancel leaves the original untouched.
    const fields = (type ? type.fields.map((f) => ({ ...f })) : [emptyField()]);

    const nameInput = h('input', {
      type: 'text', value: type ? type.name : '',
      placeholder: 'z. B. Bücher, Bilder, Filme …',
    });

    let icon = type ? type.icon : ICON_CHOICES[0];
    const iconWrap = h('div', { style: 'display:flex; gap:4px; flex-wrap:wrap' });
    function renderIcons() {
      AT.setChildren(iconWrap, ICON_CHOICES.map((i) => h('button', {
        type: 'button',
        class: 'btn small',
        style: i === icon ? 'border-color:var(--accent); background:var(--accent-soft)' : '',
        onclick: () => { icon = i; renderIcons(); },
      }, i)));
    }
    renderIcons();

    const fieldsWrap = h('div', {});

    function renderFieldRows() {
      const rows = [
        h('div', { class: 'field-editor-row field-editor-head' },
          h('div', {}, 'Bezeichnung'),
          h('div', {}, 'Datentyp'),
          h('div', {}, 'Pflicht'),
          h('div', {})),
      ];
      fields.forEach((f, i) => {
        const optionsInput = f.field_type === 'select'
          ? h('div', { class: 'field-options-input' },
              h('textarea', {
                placeholder: 'Eine Auswahl-Option pro Zeile …',
                rows: 2,
                value: Array.isArray(f.options) ? f.options.join('\n') : (f.options || ''),
                oninput: (e) => { f.options = e.target.value.split('\n'); },
              }))
          : null;
        rows.push(h('div', { class: 'field-editor-row' },
          h('input', {
            type: 'text', value: f.label, placeholder: 'z. B. Titel, Autor, Jahr …',
            oninput: (e) => { f.label = e.target.value; },
          }),
          h('select', {
            onchange: (e) => { f.field_type = e.target.value; renderFieldRows(); },
          }, Object.entries(AT.FIELD_TYPE_LABELS).map(([v, label]) =>
            h('option', { value: v, selected: f.field_type === v }, label))),
          h('label', { class: 'checkbox-row', style: 'justify-content:center; padding-top:7px' },
            h('input', {
              type: 'checkbox', checked: f.required,
              onchange: (e) => { f.required = e.target.checked; },
            })),
          h('div', { class: 'row-btns' },
            h('button', {
              class: 'icon-btn', type: 'button', title: 'Nach oben', disabled: i === 0,
              onclick: () => { [fields[i - 1], fields[i]] = [fields[i], fields[i - 1]]; renderFieldRows(); },
            }, '↑'),
            h('button', {
              class: 'icon-btn', type: 'button', title: 'Nach unten', disabled: i === fields.length - 1,
              onclick: () => { [fields[i + 1], fields[i]] = [fields[i], fields[i + 1]]; renderFieldRows(); },
            }, '↓'),
            h('button', {
              class: 'icon-btn', type: 'button', title: 'Feld entfernen',
              onclick: () => { fields.splice(i, 1); renderFieldRows(); },
            }, '✕')),
          optionsInput));
      });
      rows.push(h('div', { style: 'padding-top:10px' },
        h('button', {
          class: 'btn small', type: 'button',
          onclick: () => { fields.push(emptyField()); renderFieldRows(); },
        }, '＋ Feld hinzufügen')));
      AT.setChildren(fieldsWrap, rows);
    }
    renderFieldRows();

    const modal = AT.openModal({
      title: isNew ? 'Neuer Dokumenttyp' : `Dokumenttyp bearbeiten: ${type.name}`,
      wide: true,
      body: h('div', {},
        h('div', { class: 'form-group' },
          h('label', {}, 'Name ', h('span', { class: 'req' }, '*')), nameInput),
        h('div', { class: 'form-group' },
          h('label', {}, 'Symbol'), iconWrap),
        h('div', { class: 'form-group' },
          h('label', {}, 'Eingabefelder'),
          h('p', { class: 'view-sub', style: 'margin:0 0 6px' },
            'Die Archiv-ID ist immer Pflichtfeld und muss hier nicht definiert werden.'),
          fieldsWrap),
        !isNew && type.recordCount > 0
          ? h('p', { class: 'meta-line' },
              `Hinweis: ${type.recordCount} bestehende Einträge nutzen diesen Typ. ` +
              'Entfernte Felder bleiben in alten Einträgen erhalten und werden dort mit † angezeigt.')
          : null),
      footer: [
        h('button', { class: 'btn', onclick: () => modal.close() }, 'Abbrechen'),
        h('button', {
          class: 'btn primary',
          onclick: async () => {
            const payload = { name: nameInput.value, icon, fields };
            try {
              if (isNew) {
                await api('types:create', payload);
                toast(`Dokumenttyp „${payload.name.trim()}“ wurde angelegt.`, 'success');
              } else {
                await api('types:update', { id: type.id, ...payload });
                toast(`Dokumenttyp „${payload.name.trim()}“ wurde gespeichert.`, 'success');
              }
              modal.close();
              onSaved();
            } catch (e) {
              toast(e.message, 'error');
            }
          },
        }, isNew ? 'Anlegen' : 'Speichern'),
      ],
    });
  }

  /* ---------------- view ---------------- */

  AT.views = AT.views || {};
  AT.views.doctypes = async function renderDocTypes(c) {
    container = c;
    const types = await apiSafe('types:list');
    if (!types) return;
    const isAdmin = AT.state.currentUser && AT.state.currentUser.role === 'admin';

    const cards = types.map((t) => h('div', { class: 'card type-card' },
      h('div', { class: 'type-card-head' },
        h('div', { class: 'type-card-icon' }, t.icon),
        h('div', {},
          h('div', { class: 'type-card-title' }, t.name),
          h('div', { class: 'type-card-meta' },
            `${t.recordCount} Einträge · ${t.fields.length} Felder`))),
      h('div', { class: 'type-field-list' },
        t.fields.map((f) => h('span', { class: 'badge', title: AT.FIELD_TYPE_LABELS[f.field_type] },
          f.label, f.required ? ' *' : ''))),
      h('div', { class: 'type-card-actions' },
        isAdmin ? h('button', {
          class: 'btn small',
          onclick: () => openTypeEditor(t, () => AT.views.doctypes(container)),
        }, '✏️ Bearbeiten') : null,
        isAdmin ? h('button', {
          class: 'btn small danger',
          disabled: t.recordCount > 0,
          title: t.recordCount > 0 ? 'Es existieren noch Einträge dieses Typs.' : '',
          onclick: async () => {
            const yes = await AT.confirmDialog({
              title: 'Dokumenttyp löschen',
              message: `Soll der Dokumenttyp „${t.name}“ wirklich gelöscht werden?`,
              confirmLabel: 'Löschen', danger: true,
            });
            if (!yes) return;
            try {
              await api('types:delete', { id: t.id });
              toast(`Dokumenttyp „${t.name}“ wurde gelöscht.`, 'success');
              AT.views.doctypes(container);
            } catch (e) {
              toast(e.message, 'error');
            }
          },
        }, '🗑️ Löschen') : null)));

    container.replaceChildren(
      h('div', { class: 'view-header' },
        h('div', {},
          h('h2', {}, 'Dokumenttypen'),
          h('p', { class: 'view-sub' },
            'Definieren Sie flexibel, welche Eingabefelder ein Eintrag je Typ hat.')),
        h('div', { class: 'spacer' }),
        isAdmin ? h('button', {
          class: 'btn primary',
          onclick: () => openTypeEditor(null, () => AT.views.doctypes(container)),
        }, '＋ Neuer Dokumenttyp') : null),
      types.length === 0
        ? h('div', { class: 'card' },
            h('div', { class: 'empty-state' },
              h('div', { class: 'big' }, '🧩'),
              h('p', {}, 'Noch keine Dokumenttypen definiert.'),
              h('p', {}, 'Legen Sie z. B. „Bücher“, „Bilder“ oder „Filme“ mit passenden Feldern an.')))
        : h('div', { class: 'type-grid' }, cards));
  };

})(window.AT);
