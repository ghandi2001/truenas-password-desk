import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'pglite-server';
import { PrismaClient } from '@prisma/client';
import { readFile } from 'node:fs/promises';
import { seedInitialAdmin } from '../src/server/seed';
import { verifyPassword } from '../src/server/security';

test('initial admin seeding validates policy and never changes an existing administrator', async () => {
  const pg = new PGlite();
  await pg.exec(
    await readFile(
      'prisma/migrations/202609250001_initial/migration.sql',
      'utf8',
    ),
  );
  const server = createServer(pg);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw Error();
  const db = new PrismaClient({
    datasourceUrl: `postgresql://fixture:fixture@127.0.0.1:${address.port}/postgres?connection_limit=1`,
  });
  try {
    await assert.rejects(seedInitialAdmin(db, 'operator', 'weak', 'weak'));
    assert.equal(await db.admin.count(), 0);
    const password = 'Initial fixture passphrase!';
    assert.equal(
      await seedInitialAdmin(db, 'operator', password, password),
      true,
    );
    const original = await db.admin.findUniqueOrThrow({
      where: { username: 'operator' },
    });
    assert.equal(await verifyPassword(original.passwordHash, password), true);
    assert.equal(
      await seedInitialAdmin(
        db,
        'another',
        'Other fixture passphrase!',
        'Other fixture passphrase!',
      ),
      false,
    );
    assert.equal(await db.admin.count(), 1);
    assert.equal(
      (await db.admin.findUniqueOrThrow({ where: { username: 'operator' } }))
        .passwordHash,
      original.passwordHash,
    );
  } finally {
    await db.$disconnect();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pg.close();
  }
});
