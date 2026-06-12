'use strict';

/**
 * Per-machine settings (currently only the database path), stored as JSON in
 * Electron's userData directory. The database itself lives wherever the club
 * put it — typically on a shared network drive.
 */

const path = require('path');
const fs = require('fs');

let settingsFile = null;
let cache = {};

function init(userDataDir) {
  settingsFile = path.join(userDataDir, 'settings.json');
  try {
    cache = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
  } catch (_) {
    cache = {};
  }
}

function get(key, fallback = null) {
  return key in cache ? cache[key] : fallback;
}

function set(key, value) {
  cache[key] = value;
  fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(cache, null, 2));
}

module.exports = { init, get, set };
