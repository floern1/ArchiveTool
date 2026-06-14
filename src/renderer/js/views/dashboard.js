'use strict';

/* Dashboard: key figures, charts and the latest activity from the history. */

window.AT = window.AT || {};

(function (AT) {
  const { h } = AT;

  const ACTION_LABEL = { create: 'angelegt', update: 'geändert', delete: 'gelöscht' };
  const ACTION_ICON = { create: '➕', update: '✏️', delete: '🗑️', import: '📥' };

  const MONTH_NAMES = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];

  function statCard(icon, value, label) {
    return h('div', { class: 'card stat-card' },
      h('div', { class: 'stat-icon' }, icon),
      h('div', { class: 'stat-value' }, value.toLocaleString('de-DE')),
      h('div', { class: 'stat-label' }, label));
  }

  function typeChart(byType) {
    if (byType.length === 0) {
      return h('p', { class: 'cell-soft' }, 'Noch keine Dokumenttypen angelegt.');
    }
    const max = Math.max(...byType.map((t) => t.count), 1);
    return byType.map((t) => h('div', { class: 'hbar-row' },
      h('div', { class: 'hbar-label', title: t.name }, `${t.icon} ${t.name}`),
      h('div', { class: 'hbar-track' },
        h('div', { class: 'hbar-fill', style: `width:${Math.round((t.count / max) * 100)}%` })),
      h('div', { class: 'hbar-count' }, String(t.count))));
  }

  function lastTwelveMonths() {
    const months = [];
    const now = new Date();
    for (let i = 11; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return months;
  }

  function monthChart(perMonth) {
    const counts = Object.fromEntries(perMonth.map((m) => [m.month, m.count]));
    const months = lastTwelveMonths();
    const max = Math.max(...months.map((m) => counts[m] || 0), 1);
    return h('div', { class: 'vbar-chart' },
      months.map((m) => {
        const count = counts[m] || 0;
        const label = MONTH_NAMES[Number(m.slice(5)) - 1];
        return h('div', { class: 'vbar', title: `${label} ${m.slice(0, 4)}: ${count}` },
          h('div', { class: 'vbar-value' }, count ? String(count) : ''),
          h('div', { class: 'vbar-fill', style: `height:${Math.max(Math.round((count / max) * 96), 2)}px` }),
          h('div', { class: 'vbar-label' }, label));
      }));
  }

  function activityList(items) {
    if (items.length === 0) {
      return h('p', { class: 'cell-soft' }, 'Noch keine Aktivitäten.');
    }
    return items.map((a) => h('div', { class: 'activity-item' },
      h('div', { class: `activity-dot ${a.action}` }, ACTION_ICON[a.action] || '•'),
      h('div', { class: 'activity-text' }, activityText(a)),
      h('div', { class: 'activity-time' }, AT.relTime(a.changed_at))));
  }

  // A bulk import is collapsed into one line ("hat 1.234 Einträge importiert"),
  // individual edits keep naming the affected archive entry.
  function activityText(a) {
    if (a.action === 'import') {
      return [
        h('strong', {}, a.changed_by_display || 'Unbekannt'),
        ` hat ${a.doc_type_icon || '📥'} `,
        h('strong', {}, (a.count || 1).toLocaleString('de-DE')),
        ` ${a.count === 1 ? 'Eintrag' : 'Einträge'} importiert`,
      ];
    }
    return [
      h('strong', {}, a.changed_by_display || 'Unbekannt'),
      ` hat ${a.doc_type_icon || ''} `,
      h('span', { class: 'cell-id' }, a.archive_id),
      ` ${ACTION_LABEL[a.action] || a.action}`,
    ];
  }

  AT.views = AT.views || {};
  AT.views.dashboard = async function renderDashboard(container) {
    const stats = await AT.apiSafe('stats:get');
    if (!stats) return;

    container.replaceChildren(
      h('div', { class: 'view-header' },
        h('div', {},
          h('h2', {}, 'Dashboard'),
          h('p', { class: 'view-sub' }, 'Überblick über das Vereinsarchiv'))),
      h('div', { class: 'stat-grid' },
        statCard('🗃️', stats.totalRecords, 'Archiveinträge'),
        statCard('🧩', stats.totalTypes, 'Dokumenttypen'),
        statCard('👥', stats.totalUsers, 'Aktive Benutzer'),
        statCard('🕘', stats.totalChanges, 'Protokollierte Änderungen')),
      h('div', { class: 'dash-grid' },
        h('div', { class: 'dash-col' },
          h('div', { class: 'card panel' },
            h('h3', {}, 'Einträge pro Dokumenttyp'),
            typeChart(stats.byType)),
          h('div', { class: 'card panel' },
            h('h3', {}, 'Neue Einträge (letzte 12 Monate)'),
            monthChart(stats.perMonth)),
          stats.topContributors.length > 0
            ? h('div', { class: 'card panel' },
                h('h3', {}, 'Aktivste Mitglieder'),
                stats.topContributors.map((c) => h('div', { class: 'hbar-row' },
                  h('div', { class: 'hbar-label' }, c.name || 'Unbekannt'),
                  h('div', { class: 'hbar-track' },
                    h('div', {
                      class: 'hbar-fill',
                      style: `width:${Math.round((c.count / stats.topContributors[0].count) * 100)}%`,
                    })),
                  h('div', { class: 'hbar-count' }, String(c.count)))))
            : null),
        h('div', { class: 'card panel' },
          h('h3', {}, 'Letzte Aktivitäten'),
          activityList(stats.recentActivity))));
  };

})(window.AT);
