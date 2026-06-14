'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = new Set([
  'app:getState',
  'db:create', 'db:open',
  'auth:setupAdmin', 'auth:login', 'auth:logout', 'auth:changePassword',
  'users:list', 'users:create', 'users:update', 'users:resetPassword', 'users:history',
  'types:list', 'types:create', 'types:update', 'types:delete',
  'records:list', 'records:get', 'records:create', 'records:update',
  'records:delete', 'records:history',
  'rewind:list', 'rewind:revert',
  'import:pickFile', 'import:preview', 'import:buildResolution', 'import:commit', 'import:cancel',
  'stats:get',
  'file:pick', 'file:openPath', 'file:showInFolder',
]);

contextBridge.exposeInMainWorld('archiveApi', {
  invoke(channel, payload) {
    if (!CHANNELS.has(channel)) {
      return Promise.resolve({ ok: false, error: { code: 'BAD_CHANNEL', message: `Unbekannter Kanal: ${channel}` } });
    }
    return ipcRenderer.invoke(channel, payload);
  },
});
