'use strict';

/* User administration (admins only): create accounts, change roles,
 * deactivate accounts, reset passwords. */

window.AT = window.AT || {};

(function (AT) {
  const { h, api, apiSafe, toast } = AT;

  const ROLE_LABEL = { admin: 'Administrator', member: 'Mitglied' };

  function openUserForm(user, onSaved) {
    const isNew = !user;
    const usernameInput = h('input', { type: 'text', value: user ? user.username : '', disabled: !isNew });
    const displayInput = h('input', { type: 'text', value: user ? user.display_name : '' });
    const roleSelect = h('select', {},
      h('option', { value: 'member', selected: !user || user.role === 'member' }, ROLE_LABEL.member),
      h('option', { value: 'admin', selected: user && user.role === 'admin' }, ROLE_LABEL.admin));
    const activeCheck = h('input', { type: 'checkbox', checked: !user || !!user.active });
    const passwordInput = h('input', { type: 'password', placeholder: 'Mindestens 6 Zeichen' });

    const modal = AT.openModal({
      title: isNew ? 'Neuer Benutzer' : `Benutzer bearbeiten: ${user.username}`,
      body: h('div', {},
        h('div', { class: 'form-group' },
          h('label', {}, 'Benutzername ', isNew ? h('span', { class: 'req' }, '*') : null),
          usernameInput),
        h('div', { class: 'form-group' },
          h('label', {}, 'Anzeigename'),
          displayInput),
        h('div', { class: 'form-group' },
          h('label', {}, 'Rolle'),
          roleSelect),
        isNew
          ? h('div', { class: 'form-group' },
              h('label', {}, 'Passwort ', h('span', { class: 'req' }, '*')),
              passwordInput)
          : h('div', { class: 'form-group' },
              h('label', { class: 'checkbox-row' }, activeCheck, ' Konto aktiv')),
      ),
      footer: [
        h('button', { class: 'btn', onclick: () => modal.close() }, 'Abbrechen'),
        h('button', {
          class: 'btn primary',
          onclick: async () => {
            try {
              if (isNew) {
                await api('users:create', {
                  username: usernameInput.value,
                  displayName: displayInput.value,
                  password: passwordInput.value,
                  role: roleSelect.value,
                });
                toast('Benutzer wurde angelegt.', 'success');
              } else {
                await api('users:update', {
                  id: user.id,
                  displayName: displayInput.value,
                  role: roleSelect.value,
                  active: activeCheck.checked,
                });
                toast('Benutzer wurde gespeichert.', 'success');
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

  function openResetPassword(user) {
    const pw1 = h('input', { type: 'password', placeholder: 'Neues Passwort (min. 6 Zeichen)' });
    const pw2 = h('input', { type: 'password', placeholder: 'Neues Passwort wiederholen' });
    const modal = AT.openModal({
      title: `Passwort zurücksetzen: ${user.username}`,
      body: h('div', {},
        h('div', { class: 'form-group' }, h('label', {}, 'Neues Passwort'), pw1),
        h('div', { class: 'form-group' }, h('label', {}, 'Wiederholung'), pw2)),
      footer: [
        h('button', { class: 'btn', onclick: () => modal.close() }, 'Abbrechen'),
        h('button', {
          class: 'btn primary',
          onclick: async () => {
            if (pw1.value !== pw2.value) {
              toast('Die Passwörter stimmen nicht überein.', 'error');
              return;
            }
            try {
              await api('users:resetPassword', { id: user.id, newPassword: pw1.value });
              toast(`Passwort für „${user.username}“ wurde zurückgesetzt.`, 'success');
              modal.close();
            } catch (e) {
              toast(e.message, 'error');
            }
          },
        }, 'Zurücksetzen'),
      ],
    });
  }

  const ACTION_LABEL = { create: 'angelegt', update: 'geändert', delete: 'gelöscht', import: 'importiert' };
  const ACTION_ICON = { create: '➕', update: '✏️', delete: '🗑️', import: '📥' };

  async function openUserHistory(user) {
    const data = await apiSafe('users:history', { id: user.id });
    if (!data) return;
    const s = data.summary;

    const stat = (value, label) => h('div', { class: 'user-hist-stat' },
      h('span', { class: 'user-hist-num' }, value.toLocaleString('de-DE')),
      h('span', { class: 'user-hist-label' }, label));

    const recent = data.recent.length
      ? data.recent.map((a) => h('div', { class: 'activity-item' },
          h('div', { class: `activity-dot ${a.action}` }, ACTION_ICON[a.action] || '•'),
          h('div', { class: 'activity-text' },
            a.action === 'import'
              ? [h('strong', {}, (a.count || 1).toLocaleString('de-DE')), ` ${a.count === 1 ? 'Eintrag' : 'Einträge'} importiert `,
                 a.docTypeName ? h('span', { class: 'cell-soft' }, `(${a.docTypeIcon || ''} ${a.docTypeName})`) : null]
              : [`${a.docTypeIcon || ''} `, h('span', { class: 'cell-id' }, a.archiveId),
                 ` ${ACTION_LABEL[a.action] || a.action}`]),
          h('div', { class: 'activity-time' }, AT.relTime(a.changedAt))))
      : [h('p', { class: 'cell-soft' }, 'Dieser Benutzer hat noch keine Änderungen vorgenommen.')];

    AT.openModal({
      title: `Verlauf: ${user.display_name}`,
      wide: true,
      body: h('div', {},
        h('div', { class: 'user-hist-stats' },
          stat(s.total, 'Änderungen gesamt'),
          stat(s.creates, 'angelegt'),
          stat(s.updates, 'geändert'),
          stat(s.deletes, 'gelöscht'),
          stat(s.imports, 'Importe')),
        h('p', { class: 'meta-line' },
          s.lastActive ? `Zuletzt aktiv: ${AT.fmtDateTime(s.lastActive)}` : 'Noch keine Aktivität.'),
        h('h3', { style: 'margin:14px 0 4px; font-size:15px' }, 'Letzte Vorgänge'),
        h('div', { class: 'history-scroll' }, recent)),
    });
  }

  AT.views = AT.views || {};
  AT.views.users = async function renderUsers(container) {
    const users = await apiSafe('users:list');
    if (!users) return;

    const rows = users.map((u) => h('tr', {},
      h('td', { class: 'cell-id' }, u.username),
      h('td', {}, u.display_name),
      h('td', {}, h('span', { class: `badge ${u.role === 'admin' ? 'accent' : ''}` }, ROLE_LABEL[u.role] || u.role)),
      h('td', {}, u.active
        ? h('span', { class: 'badge green' }, 'aktiv')
        : h('span', { class: 'badge red' }, 'deaktiviert')),
      h('td', { class: 'cell-soft' }, AT.fmtDateTime(u.created_at)),
      h('td', { style: 'text-align:right; white-space:nowrap' },
        h('button', { class: 'btn small', onclick: () => openUserHistory(u) }, '🕘 Verlauf'),
        ' ',
        h('button', { class: 'btn small', onclick: () => openUserForm(u, () => AT.views.users(container)) }, 'Bearbeiten'),
        ' ',
        h('button', { class: 'btn small', onclick: () => openResetPassword(u) }, 'Passwort'))));

    container.replaceChildren(
      h('div', { class: 'view-header' },
        h('div', {},
          h('h2', {}, 'Benutzer'),
          h('p', { class: 'view-sub' }, 'Zugänge der Vereinsmitglieder verwalten')),
        h('div', { class: 'spacer' }),
        h('button', {
          class: 'btn primary',
          onclick: () => openUserForm(null, () => AT.views.users(container)),
        }, '＋ Neuer Benutzer')),
      h('div', { class: 'card table-wrap' },
        h('table', { class: 'data' },
          h('thead', {}, h('tr', {},
            h('th', {}, 'Benutzername'),
            h('th', {}, 'Anzeigename'),
            h('th', {}, 'Rolle'),
            h('th', {}, 'Status'),
            h('th', {}, 'Angelegt'),
            h('th', {}))),
          h('tbody', {}, rows))));
  };

})(window.AT);
