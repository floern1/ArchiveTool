'use strict';

/**
 * Password hashing with Node's built-in scrypt — no external dependencies.
 * Stored format: scrypt$N$r$p$<salt hex>$<hash hex>
 */

const crypto = require('crypto');

const SCRYPT = { N: 16384, r: 8, p: 1, keyLen: 32, saltLen: 16 };

function hashPassword(password) {
  const salt = crypto.randomBytes(SCRYPT.saltLen);
  const hash = crypto.scryptSync(String(password), salt, SCRYPT.keyLen, {
    N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p,
  });
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${hash.toString('hex')}`;
}

function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltHex, hashHex] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const expected = Buffer.from(hashHex, 'hex');
    const actual = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), expected.length, {
      N: Number(N), r: Number(r), p: Number(p),
    });
    return crypto.timingSafeEqual(actual, expected);
  } catch (_) {
    return false;
  }
}

module.exports = { hashPassword, verifyPassword };
