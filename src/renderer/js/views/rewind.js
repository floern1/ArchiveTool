'use strict';

/* Rewind: review the most recent changes and undo them. A bulk import is shown
 * (and undone) as a single step; every undo is itself logged in the history, so
 * it can be reverted again. Administrators only. */

window.AT = window.AT || {};

(function (AT) {
  const { h, api, apiSafe, toast } = AT;

  const ACTION_LABEL = { create: 'angelegt', update: 'geändert', delete: 'gelöscht' };
  const ACTION_ICON = { create: '➕', update: '✏️', delete: '🗑️', import: '📥' };

  let container = null;

  function opTitle(op) {
    if (op.kind === 'batch') {
      const parts = [];
      if (op.creates) parts.push(`${op.creates.toLocaleString('de-DE')} angelegt`);
      if (op.updates) parts.push(`${op.updates.toLocaleString('de-DE')} aktualisiert`);
      if (op.deletes) parts.push(`${op.deletes.toLocaleString('de-DE')} gelöscht`);
      return [
        h('strong', {}, `${op.docTypeIcon || '📥'} Import: ${op.count.toLocaleString('de-DE')} Einträge`),
        parts.length ? h('span', { class: 'cell-soft' }, `  (${parts.join(', ')})`) : null,
      ];
    }
    return [
      `${op.docTypeIcon || ''} `,
      h('span', { class: 'cell-id' }, op.archiveId),
      ` ${ACTION_LABEL[op.action] || op.action}`,
    ];
  }

  async function revert(op) {
    const what = op.kind === 'batch'
      ? `den gesamten Import (${op.count.toLocaleString('de-DE')} Einträge)`
      : `die Änderung an „${op.archiveId}“`;
    const yes = await AT.confirmDialog({
      title: 'Änderung rückgängig machen',
      message: `Soll ${what} rückgängig gemacht werden? Der vorherige Stand wird wiederhergestellt; `
        + 'der Vorgang wird in der Historie protokolliert und lässt sich erneut rückgängig machen.',
      confirmLabel: 'Rückgängig machen', danger: true,
    });
    if (!yes) return;
    try {
      const res = await api('rewind:revert',
        op.kind === 'batch' ? { batchId: op.batchId } : { historyId: op.historyId });
      const n = res.reverted || 0;
      if (n > 0) toast(`${n.toLocaleString('de-DE')} ${n === 1 ? 'Eintrag' : 'Einträge'} wurde${n === 1 ? '' : 'n'} rückgängig gemacht.`, 'success');
      if (res.skipped && res.skipped.length) {
        toast(`${res.skipped.length.toLocaleString('de-DE')} Einträge konnten nicht rückgängig gemacht werden (zwischenzeitlich geändert).`, 'error');
      }
      load();
    } catch (e) {
      toast(e.message, 'error');
    }
  }

  function opRow(op) {
    const revertable = op.revertableCount > 0;
    const note = op.kind === 'batch' && op.revertableCount < op.count
      ? h('div', { class: 'meta-line', style: 'margin-top:4px' },
          op.revertableCount === 0
            ? 'Nicht mehr rückgängig machbar – alle betroffenen Einträge wurden zwischenzeitlich geändert.'
            : `${op.revertableCount.toLocaleString('de-DE')} von ${op.count.toLocaleString('de-DE')} Einträgen sind noch rückgängig machbar.`)
      : (!revertable
          ? h('div', { class: 'meta-line', style: 'margin-top:4px' }, 'Nicht mehr rückgängig machbar – der Eintrag wurde zwischenzeitlich geändert.')
          : null);

    return h('div', { class: 'rewind-item' },
      h('div', { class: `activity-dot ${op.kind === 'batch' ? 'import' : op.action}` }, op.kind === 'batch' ? ACTION_ICON.import : (ACTION_ICON[op.action] || '•')),
      h('div', { class: 'rewind-main' },
        h('div', { class: 'rewind-title' }, opTitle(op)),
        h('div', { class: 'meta-line' },
          `${op.changedByDisplay || 'Unbekannt'} · ${AT.fmtDateTime(op.changedAt)}`),
        note),
      h('div', { class: 'rewind-actions' },
        h('button', {
          class: 'btn small danger', disabled: !revertable,
          title: revertable ? '' : 'Diese Änderung kann nicht mehr rückgängig gemacht werden.',
          onclick: () => revert(op),
        }, '↩ Rückgängig')));
  }

  async function load() {
    const ops = await apiSafe('rewind:list', { limit: 100 });
    if (!ops) return;
    const listEl = container.querySelector('#rewind-list');
    if (!listEl) return;
    if (ops.length === 0) {
      listEl.replaceChildren(h('div', { class: 'card' },
        h('div', { class: 'empty-state' },
          h('div', { class: 'big' }, '↩'),
          h('p', {}, 'Noch keine Änderungen vorhanden, die rückgängig gemacht werden könnten.'))));
      return;
    }
    listEl.replaceChildren(
      h('div', { class: 'card' }, h('div', { class: 'rewind-list' }, ops.map(opRow))));
  }

  AT.views = AT.views || {};
  AT.views.rewind = async function renderRewind(c) {
    container = c;
    container.replaceChildren(
      h('div', { class: 'view-header' },
        h('div', {},
          h('h2', {}, 'Rückgängig'),
          h('p', { class: 'view-sub' },
            'Die letzten Änderungen überblicken und bei Bedarf zurücknehmen. '
            + 'Importe werden als ein Schritt behandelt.'))),
      h('div', { id: 'rewind-list' }, h('p', { class: 'cell-soft' }, 'Wird geladen …')));
    await load();
  };

})(window.AT);
