'use strict';

/* Thin wrapper around the preload bridge: unwraps {ok,data|error} and throws
 * an Error with a `.code` on failure so views can react to specific cases
 * (CONFLICT, DUPLICATE_ID, ...). */

window.AT = window.AT || {};

(function (AT) {

  AT.api = async function api(channel, payload) {
    const res = await window.archiveApi.invoke(channel, payload);
    if (!res || !res.ok) {
      const err = new Error(res && res.error ? res.error.message : 'Unbekannter Fehler');
      err.code = res && res.error ? res.error.code : 'INTERNAL';
      throw err;
    }
    return res.data;
  };

  /** api() + error toast; returns undefined on failure. */
  AT.apiSafe = async function (channel, payload) {
    try {
      return await AT.api(channel, payload);
    } catch (e) {
      AT.toast(e.message, 'error');
      return undefined;
    }
  };

})(window.AT);
