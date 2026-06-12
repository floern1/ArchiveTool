'use strict';

/* Cross-platform test launcher. Runs the test suite through the Electron
 * binary in "run as node" mode so that better-sqlite3 (compiled for
 * Electron's ABI by `electron-builder install-app-deps`) loads correctly.
 * Falls back to plain Node if Electron is not installed. */

const { spawnSync } = require('child_process');
const path = require('path');

let electronPath = null;
try {
  electronPath = require('electron'); // resolves to the binary path
} catch (_) { /* electron not installed – use plain node */ }

const script = path.join(__dirname, 'run-tests.js');
const res = electronPath
  ? spawnSync(electronPath, [script], {
      stdio: 'inherit',
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    })
  : spawnSync(process.execPath, [script], { stdio: 'inherit' });

process.exit(res.status === null ? 1 : res.status);
