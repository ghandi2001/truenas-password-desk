import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from '../src/server/http';
import { Service } from '../src/server/service';
import { PrismaClient } from '@prisma/client';
import { loadConfig } from '../src/server/config';
test('HTTP boundary blocks CSRF and protects sessions without contacting NAS', async () => {
  const c = loadConfig({
    APP_URL: 'https://password.example.com',
    DATABASE_URL: 'postgresql://test:test@localhost/test',
    TRUENAS_URL: 'https://nas.example.com',
    TRUENAS_API_KEY: 'fixture-api-key-not-real',
    TRUENAS_API_VERSION: 'v25.10',
    SESSION_SECRET: 's'.repeat(64),
  });
  const db = new PrismaClient();
  const handle = handler(new Service(db, c));
  try {
    const denied = await handle(
      new Request(c.appUrl + '/api/admin/login', {
        method: 'POST',
        headers: {
          origin: 'https://evil.example.com',
          'content-type': 'application/json',
        },
        body: '{}',
      }),
      ['admin', 'login'],
    );
    assert.equal(denied.status, 403);
    const auth = await handle(
      new Request(c.appUrl + '/api/admin/password-links'),
      ['admin', 'password-links'],
    );
    assert.equal(auth.status, 401);
    assert.equal(auth.headers.get('cache-control'), 'no-store');
    const invalid = await handle(
      new Request(c.appUrl + '/api/admin/login', {
        method: 'POST',
        headers: { origin: c.appUrl, 'content-type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: 'x', extra: true }),
      }),
      ['admin', 'login'],
    );
    assert.equal(invalid.status, 401);
  } finally {
    await db.$disconnect();
  }
});
