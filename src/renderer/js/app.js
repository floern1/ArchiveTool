'use strict';

/* Application shell: database selection, first-run setup, login and the
 * navigation between the main views. */

window.AT = window.AT || {};

(function (AT) {
  const { h, $, api, apiSafe, toast } = AT;

  AT.state = { currentUser: null, dbPath: null };

  /* ---------------- screen switching ---------------- */

  function showScreen(id) {
    $('#screen-start').classList.toggle('hidden', id !== 'start');
    $('#screen-main').classList.toggle('hidden', id !== 'main');
  }

  function setStartContent(...nodes) {
    $('#start-content').replaceChildren(...nodes);
    $('#start-footer').textContent = AT.state.dbPath ? `Datenbank: ${AT.state.dbPath}` : '';
    showScreen('start');
  }

  /* ---------------- start screens ---------------- */

  function renderDbChooser() {
    setStartContent(
      h('div', { class: 'start-hint' },
        'Willkommen! Wählen Sie die gemeinsame Archiv-Datenbank aus – ',
        'typischerweise eine Datei auf dem Netzlaufwerk des Vereins – ',
        'oder legen Sie eine neue Datenbank an.'),
      h('div', { class: 'start-actions' },
        h('button', {
          class: 'btn primary block',
          onclick: async () => { const s = await apiSafe('db:open'); if (s) applyState(s); },
        }, '📂 Bestehende Datenbank öffnen'),
        h('button', {
          class: 'btn block',
          onclick: async () => { const s = await apiSafe('db:create'); if (s) applyState(s); },
        }, '✨ Neue Datenbank anlegen')));
  }

  function renderAdminSetup() {
    const username = h('input', { type: 'text', placeholder: 'z. B. m.schmidt' });
    const display = h('input', { type: 'text', placeholder: 'z. B. Maria Schmidt' });
    const pw1 = h('input', { type: 'password', placeholder: 'Mindestens 6 Zeichen' });
    const pw2 = h('input', { type: 'password', placeholder: 'Passwort wiederholen' });
    const submit = async () => {
      if (pw1.value !== pw2.value) {
        toast('Die Passwörter stimmen nicht überein.', 'error');
        return;
      }
      try {
        const s = await api('auth:setupAdmin', {
          username: username.value, displayName: display.value, password: pw1.value,
        });
        toast('Administratorkonto wurde angelegt. Willkommen!', 'success');
        applyState(s);
      } catch (e) {
        toast(e.message, 'error');
      }
    };
    setStartContent(
      h('div', { class: 'start-hint' },
        'Diese Datenbank ist neu. Legen Sie das erste Administratorkonto an. ',
        'Weitere Mitglieder können Sie später unter „Benutzer“ hinzufügen.'),
      h('form', { onsubmit: (e) => { e.preventDefault(); submit(); } },
        h('div', { class: 'form-group' }, h('label', {}, 'Benutzername ', h('span', { class: 'req' }, '*')), username),
        h('div', { class: 'form-group' }, h('label', {}, 'Anzeigename'), display),
        h('div', { class: 'form-group' }, h('label', {}, 'Passwort ', h('span', { class: 'req' }, '*')), pw1),
        h('div', { class: 'form-group' }, h('label', {}, 'Passwort wiederholen ', h('span', { class: 'req' }, '*')), pw2),
        h('button', { class: 'btn primary block', type: 'submit' }, 'Konto anlegen und starten')));
  }

  function renderLogin() {
    const username = h('input', { type: 'text', autocomplete: 'username' });
    const password = h('input', { type: 'password', autocomplete: 'current-password' });
    const submit = async () => {
      try {
        const s = await api('auth:login', { username: username.value, password: password.value });
        applyState(s);
      } catch (e) {
        toast(e.message, 'error');
        password.value = '';
        password.focus();
      }
    };
    setStartContent(
      h('form', { onsubmit: (e) => { e.preventDefault(); submit(); } },
        h('div', { class: 'form-group' }, h('label', {}, 'Benutzername'), username),
        h('div', { class: 'form-group' }, h('label', {}, 'Passwort'), password),
        h('button', { class: 'btn primary block', type: 'submit' }, 'Anmelden')),
      h('div', { class: 'start-links' },
        h('button', {
          class: 'link-btn',
          onclick: async () => { const s = await apiSafe('db:open'); if (s) applyState(s); },
        }, 'Andere Datenbank öffnen …')));
    username.focus();
  }

  /* ---------------- main screen ---------------- */

  let currentView = 'dashboard';

  async function navigate(view) {
    currentView = view;
    AT.$$('.nav-item').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
    const content = $('#content');
    content.replaceChildren(h('p', { class: 'cell-soft' }, 'Wird geladen …'));
    if (AT.views[view]) await AT.views[view](content);
  }

  // Allow views to navigate programmatically (e.g. import → archive).
  AT.go = navigate;

  function renderMain() {
    const user = AT.state.currentUser;
    $('#user-name').textContent = user.display_name;
    $('#user-role').textContent = user.role === 'admin' ? 'Administrator' : 'Mitglied';
    $('#user-avatar').textContent = (user.display_name || '?').trim().charAt(0).toUpperCase();
    $('#sidebar-db-path').textContent = AT.state.dbPath || '–';
    $('#sidebar-db').title = AT.state.dbPath || '';
    AT.$$('.admin-only').forEach((el) => el.classList.toggle('hidden', user.role !== 'admin'));
    showScreen('main');
    navigate(['users', 'import'].includes(currentView) && user.role !== 'admin' ? 'dashboard' : currentView);
  }

  /* ---------------- state handling ---------------- */

  function applyState(s) {
    AT.state.currentUser = s.currentUser;
    AT.state.dbPath = s.dbPath;
    if (!s.dbOpen) {
      renderDbChooser();
    } else if (s.needsAdmin) {
      renderAdminSetup();
    } else if (!s.currentUser) {
      renderLogin();
    } else {
      renderMain();
    }
  }

  /* ---------------- account menu ---------------- */

  function openChangePassword() {
    const current = h('input', { type: 'password' });
    const pw1 = h('input', { type: 'password', placeholder: 'Mindestens 6 Zeichen' });
    const pw2 = h('input', { type: 'password' });
    const modal = AT.openModal({
      title: 'Eigenes Passwort ändern',
      body: h('div', {},
        h('div', { class: 'form-group' }, h('label', {}, 'Aktuelles Passwort'), current),
        h('div', { class: 'form-group' }, h('label', {}, 'Neues Passwort'), pw1),
        h('div', { class: 'form-group' }, h('label', {}, 'Neues Passwort wiederholen'), pw2)),
      footer: [
        h('button', { class: 'btn', onclick: () => modal.close() }, 'Abbrechen'),
        h('button', {
          class: 'btn primary',
          onclick: async () => {
            if (pw1.value !== pw2.value) {
              toast('Die neuen Passwörter stimmen nicht überein.', 'error');
              return;
            }
            try {
              await api('auth:changePassword', { currentPassword: current.value, newPassword: pw1.value });
              toast('Ihr Passwort wurde geändert.', 'success');
              modal.close();
            } catch (e) {
              toast(e.message, 'error');
            }
          },
        }, 'Ändern'),
      ],
    });
  }

  function openUserMenu() {
    const modal = AT.openModal({
      title: 'Konto',
      body: h('div', { class: 'start-actions' },
        h('button', {
          class: 'btn block',
          onclick: () => { modal.close(); openChangePassword(); },
        }, '🔑 Passwort ändern'),
        h('button', {
          class: 'btn block',
          onclick: async () => {
            modal.close();
            const s = await apiSafe('db:open');
            if (s) applyState(s);
          },
        }, '📂 Andere Datenbank öffnen'),
        h('button', {
          class: 'btn block',
          onclick: async () => {
            modal.close();
            const s = await apiSafe('auth:logout');
            if (s) { currentView = 'dashboard'; applyState(s); }
          },
        }, '🚪 Abmelden')),
    });
  }

  /* ---------------- boot ---------------- */

  document.addEventListener('DOMContentLoaded', async () => {
    $('#sidebar-nav').addEventListener('click', (e) => {
      const btn = e.target.closest('.nav-item');
      if (btn) navigate(btn.dataset.view);
    });
    $('#btn-user-menu').addEventListener('click', openUserMenu);
    const s = await apiSafe('app:getState');
    if (s) applyState(s);
    else setStartContent(h('p', {}, 'Die Anwendung konnte nicht initialisiert werden.'));
  });

})(window.AT);
