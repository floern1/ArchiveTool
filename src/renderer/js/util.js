'use strict';

/* DOM and formatting helpers shared by all views. */

window.AT = window.AT || {};

(function (AT) {

  AT.$ = (sel, root) => (root || document).querySelector(sel);
  AT.$$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /** Is the currently logged-in user an administrator? */
  AT.isAdmin = () => !!(AT.state && AT.state.currentUser && AT.state.currentUser.role === 'admin');

  /** Create an element: h('div', {class:'x', onclick:fn}, child1, 'text', ...) */
  AT.h = function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2), v);
      } else if (k === 'class') {
        el.className = v;
      } else if (k === 'dataset') {
        Object.assign(el.dataset, v);
      } else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'required') {
        el[k] = !!v;
      } else if (k === 'value') {
        el.value = v;
      } else {
        el.setAttribute(k, v);
      }
    }
    for (const child of children.flat(Infinity)) {
      if (child === null || child === undefined || child === false) continue;
      el.append(child instanceof Node ? child : document.createTextNode(String(child)));
    }
    return el;
  };

  /** replaceChildren that accepts nested arrays and skips null/undefined/false. */
  AT.setChildren = function (el, ...children) {
    el.replaceChildren(...children.flat(Infinity)
      .filter((c) => c !== null && c !== undefined && c !== false)
      .map((c) => (c instanceof Node ? c : document.createTextNode(String(c)))));
  };

  AT.fmtDateTime = function (iso) {
    if (!iso) return '–';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleString('de-DE', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  };

  AT.fmtDate = function (iso) {
    if (!iso) return '–';
    const d = new Date(iso + (iso.length === 10 ? 'T00:00:00' : ''));
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  AT.relTime = function (iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'gerade eben';
    if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min.`;
    if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std.`;
    if (diff < 86400 * 7) return `vor ${Math.floor(diff / 86400)} Tg.`;
    return AT.fmtDateTime(iso);
  };

  AT.debounce = function (fn, ms) {
    let t = null;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), ms);
    };
  };

  /* ---------------- Toasts ---------------- */

  AT.toast = function (message, kind = 'info', ms = 3500) {
    const root = AT.$('#toast-root');
    const el = AT.h('div', { class: `toast ${kind}` }, message);
    root.append(el);
    setTimeout(() => el.remove(), ms);
  };

  /* ---------------- Modals ---------------- */

  /**
   * openModal({title, body, footer, wide, onClose}) → {close, el}
   * body/footer: Node | Node[]
   */
  AT.openModal = function ({ title, body, footer, wide, onClose }) {
    const root = AT.$('#modal-root');
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', escHandler);
      backdrop.remove();
      if (onClose) onClose();
    };
    const modal = AT.h('div', { class: `modal${wide ? ' wide' : ''}` },
      AT.h('div', { class: 'modal-header' },
        AT.h('h3', {}, title),
        AT.h('button', { class: 'icon-btn', title: 'Schließen', onclick: close }, '✕')),
      AT.h('div', { class: 'modal-body' }, body),
      footer ? AT.h('div', { class: 'modal-footer' }, footer) : null,
    );
    const backdrop = AT.h('div', {
      class: 'modal-backdrop',
      onmousedown: (e) => { if (e.target === backdrop) close(); },
    }, modal);
    const escHandler = (e) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', escHandler);
    root.append(backdrop);
    const firstInput = modal.querySelector('input, select, textarea');
    if (firstInput) firstInput.focus();
    return { close, el: modal };
  };

  /** Promise<boolean> confirmation dialog. */
  AT.confirmDialog = function ({ title, message, confirmLabel = 'OK', danger = false }) {
    return new Promise((resolve) => {
      const m = AT.openModal({
        title,
        body: AT.h('p', { style: 'margin:0; line-height:1.55' }, message),
        footer: [
          AT.h('button', { class: 'btn', onclick: () => { m.close(); resolve(false); } }, 'Abbrechen'),
          AT.h('button', {
            class: `btn ${danger ? 'danger' : 'primary'}`,
            onclick: () => { m.close(); resolve(true); },
          }, confirmLabel),
        ],
        onClose: () => resolve(false),
      });
    });
  };

  /* ---------------- Misc ---------------- */

  AT.FIELD_TYPE_LABELS = {
    text: 'Text (einzeilig)',
    textarea: 'Text (mehrzeilig)',
    number: 'Zahl',
    date: 'Datum',
    filepath: 'Datei-Pfad',
    boolean: 'Ja/Nein',
    select: 'Auswahlliste',
  };

  // EAD(DDB) Findbuch role a field plays in the export to archive.nrw.de.
  AT.EAD_ROLE_LABELS = {
    none: '– kein EAD-Export –',
    unittitle: 'Titel (unittitle)',
    unitdate: 'Laufzeit (unitdate)',
    scopecontent: 'Enthält/Beschreibung (scopecontent)',
    extent: 'Umfang (extent)',
    genreform: 'Archivalientyp (genreform)',
    language: 'Sprache (language)',
    accessrestrict: 'Zugangsbeschränkung (accessrestrict)',
  };

  AT.formatFieldValue = function (field, value) {
    if (value === undefined || value === null || value === '') return '–';
    switch (field.field_type) {
      case 'date': return AT.fmtDate(value);
      case 'boolean': return value ? 'Ja' : 'Nein';
      // no thousands grouping: numeric fields are mostly years (1952, not 1.952)
      case 'number': return Number(value).toLocaleString('de-DE', { useGrouping: false, maximumFractionDigits: 10 });
      default: return String(value);
    }
  };

})(window.AT);
