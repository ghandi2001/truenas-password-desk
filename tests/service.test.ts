import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'pglite-server';
import { PrismaClient } from '@prisma/client';
import { loadConfig } from '../src/server/config';
import { createToken, digest, hashPassword } from '../src/server/security';
import { Service } from '../src/server/service';
import { NasFailure } from '../src/server/truenas';

test('database-backed admin, link lifecycle, binding, limiting and concurrency', async () => {
  const pg = new PGlite();
  await pg.waitReady;
  for (const p of ['202609250001_initial', '202609250002_claim_guard'])
    await pg.exec(
      await readFile(`prisma/migrations/${p}/migration.sql`, 'utf8'),
    );
  const server = createServer(pg);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw Error();
  const db = new PrismaClient({
    datasourceUrl: `postgresql://test:test@127.0.0.1:${addr.port}/postgres?connection_limit=1`,
    log: [],
  });
  const c = loadConfig({
    APP_URL: 'https://password.example.com',
    DATABASE_URL: 'postgresql://test:test@localhost/test',
    TRUENAS_URL: 'https://nas.example.com',
    TRUENAS_API_KEY: 'fixture-api-key-not-real',
    TRUENAS_API_VERSION: 'v25.10',
    SESSION_SECRET: 's'.repeat(64),
  });
  let calls = 0;
  let fail = false;
  let uncertain = false;
  const service = new Service(db, c, async (u, old, next) => {
    assert.equal(u, 'alice');
    assert.equal(old, 'Current fixture!');
    assert.equal(next, 'New fixture passphrase!');
    calls++;
    if (fail) throw new NasFailure(uncertain);
  });
  const password = 'Admin fixture passphrase!';
  try {
    const admin = await db.admin.create({
      data: {
        username: 'operator',
        passwordHash: await hashPassword(password),
      },
    });
    await assert.rejects(service.login('operator', 'wrong', 'ip'));
    await assert.rejects(service.login('missing', password, 'ip'));
    const login = await service.login('operator', password, 'ip');
    assert.equal((await service.session(login.token))?.adminId, admin.id);
    assert.equal(await service.session(createToken()), null);
    await service.logout(login.token, 'ip');
    assert.equal(await service.session(login.token), null);
    const issued = await service.createLink(
      admin.id,
      { username: 'alice', minutes: 30, note: 'Support' },
      'ip',
    );
    const token = issued.url.split('/').pop()!;
    const row = await db.passwordLink.findUniqueOrThrow({
      where: { id: issued.id },
    });
    assert.equal(row.tokenHash, digest(token));
    assert.equal(
      JSON.stringify(await service.listLinks()).includes(token),
      false,
    );
    assert.ok(await service.validLink(token));
    assert.equal(await service.validLink('invalid'), null);
    await service.change(
      token,
      {
        currentPassword: 'Current fixture!',
        newPassword: 'New fixture passphrase!',
        confirmPassword: 'New fixture passphrase!',
      },
      'ip',
    );
    assert.equal(calls, 1);
    assert.equal(await service.validLink(token), null);
    await assert.rejects(
      service.change(
        token,
        {
          currentPassword: 'Current fixture!',
          newPassword: 'New fixture passphrase!',
          confirmPassword: 'New fixture passphrase!',
        },
        'ip',
      ),
    );
    assert.equal(calls, 1);
    const make = async () => {
      const l = await service.createLink(
        admin.id,
        { username: 'alice', minutes: 30, note: '' },
        'ip',
      );
      return { ...l, token: l.url.split('/').pop()! };
    };
    const revoked = await make();
    await service.revoke(admin.id, revoked.id, 'ip');
    assert.equal(await service.validLink(revoked.token), null);
    const expired = await make();
    await db.passwordLink.update({
      where: { id: expired.id },
      data: { expiresAt: new Date(0) },
    });
    assert.equal(await service.validLink(expired.token), null);
    const bound = await make();
    const data = {
      currentPassword: 'Current fixture!',
      newPassword: 'New fixture passphrase!',
      confirmPassword: 'New fixture passphrase!',
    };
    await assert.rejects(
      service.change(bound.token, { ...data, username: 'bob' }, 'ip'),
    );
    assert.equal(calls, 1);
    await assert.rejects(
      service.change(
        bound.token,
        { ...data, confirmPassword: 'mismatch' },
        'ip',
      ),
    );
    fail = true;
    await assert.rejects(service.change(bound.token, data, 'other-ip'));
    assert.ok(await service.validLink(bound.token));
    uncertain = true;
    await assert.rejects(service.change(bound.token, data, 'other-ip'));
    assert.equal(await service.validLink(bound.token), null);
    await assert.rejects(service.revoke(admin.id, bound.id, 'ip'));
    // Operator reconciliation is deliberately outside the public API.
    await db.passwordLink.update({
      where: { id: bound.id },
      data: { revokedAt: new Date() },
    });
    await db.rateLimit.deleteMany();
    fail = false;
    const race = await make();
    const before = calls;
    const results = await Promise.allSettled([
      service.change(race.token, data, 'race-ip'),
      service.change(race.token, data, 'race-ip'),
    ]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(calls, before + 1);
    for (let i = 0; i < c.maxAttempts; i++)
      assert.equal(await service.limit('test-bucket', c.maxAttempts), true);
    assert.equal(await service.limit('test-bucket', c.maxAttempts), false);
    const dump = JSON.stringify(await db.audit.findMany());
    for (const secret of [
      password,
      token,
      'Current fixture!',
      'New fixture passphrase!',
      c.apiKey,
    ])
      assert.equal(dump.includes(secret), false);
  } finally {
    await db.$disconnect();
    await new Promise<void>((r) => server.close(() => r()));
    await pg.close();
  }
});
