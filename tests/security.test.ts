import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/server/config';
import {
  createToken,
  digest,
  passwordError,
  hashPassword,
  verifyPassword,
  checkOrigin,
} from '../src/server/security';
const env = {
  APP_URL: 'https://password.example.com',
  DATABASE_URL: 'postgresql://test:test@localhost/test',
  TRUENAS_URL: 'https://nas.example.com',
  TRUENAS_API_KEY: 'fixture-not-a-real-api-key',
  SESSION_SECRET: 's'.repeat(64),
};
test('configuration fails closed without a valid HTTPS NAS origin or secrets', () => {
  assert.equal(loadConfig(env).nasUrl, env.TRUENAS_URL);
  assert.equal(
    loadConfig({ ...env, TRUENAS_URL: 'https://192.0.2.1' }).nasUrl,
    'https://192.0.2.1',
  );
  for (const value of [
    '',
    'http://nas.example.com',
    'https://a:b@nas.example.com',
    'https://nas.example.com/path',
    'https://nas.example.com?x=y',
  ])
    assert.throws(() => loadConfig({ ...env, TRUENAS_URL: value }));
  assert.throws(() => loadConfig({ ...env, TRUENAS_API_KEY: '' }));
  assert.throws(() => loadConfig({ ...env, SESSION_SECRET: 'short' }));
});
test('tokens are opaque, unique, and stored only as digests', () => {
  const tokens = Array.from({ length: 1000 }, createToken);
  assert.equal(new Set(tokens).size, 1000);
  assert.ok(tokens.every((t) => /^[A-Za-z0-9_-]{43}$/.test(t)));
  assert.equal(digest(tokens[0]).length, 64);
  assert.notEqual(digest(tokens[0]), tokens[0]);
});
test('Argon2id hashes are salted and reject wrong passwords', async () => {
  const a = await hashPassword('a good sample passphrase!');
  const b = await hashPassword('a good sample passphrase!');
  assert.ok(a.startsWith('$argon2id$'));
  assert.notEqual(a, b);
  assert.equal(await verifyPassword(a, 'a good sample passphrase!'), true);
  assert.equal(await verifyPassword(a, 'wrong'), false);
});
test('password policy enforces only minimum length, match, and input safety', () => {
  // Below minimum at the configured default of 8.
  assert.ok(passwordError('abcdefg', 'abcdefg', 8));
  // Minimum length passes with no composition requirements.
  assert.equal(passwordError('abcdefgh', 'abcdefgh', 8), null);
  assert.equal(passwordError('password', 'password', 8), null);
  assert.equal(passwordError('LongUsername', 'LongUsername', 8), null);
  assert.equal(passwordError('aaaaaaaa', 'aaaaaaaa', 8), null);
  // Confirmation must match.
  assert.ok(passwordError('abcdefgh', 'different', 8));
  // Empty, NUL, and over-512-byte values are rejected.
  assert.ok(passwordError('', '', 8));
  assert.ok(passwordError('ab\0cdefg', 'ab\0cdefg', 8));
  assert.ok(passwordError('x'.repeat(513), 'x'.repeat(513), 8));
  // Spaces are preserved, not trimmed.
  assert.equal(passwordError('  winter  ', '  winter  ', 8), null);
});
test('CSRF accepts only exact origin and JSON writes', () => {
  const c = loadConfig(env);
  assert.doesNotThrow(() =>
    checkOrigin(
      new Request(c.appUrl, {
        method: 'POST',
        headers: { origin: c.appUrl, 'content-type': 'application/json' },
      }),
      c,
    ),
  );
  for (const origin of ['', 'https://evil.example.com', 'null'])
    assert.throws(() =>
      checkOrigin(
        new Request(c.appUrl, {
          method: 'POST',
          headers: { origin, 'content-type': 'application/json' },
        }),
        c,
      ),
    );
});
