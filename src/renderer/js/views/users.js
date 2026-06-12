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
