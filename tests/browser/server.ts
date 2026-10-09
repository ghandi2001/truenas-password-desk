import { PGlite } from '@electric-sql/pglite';
import { createServer } from 'pglite-server';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { hashPassword } from '../../src/server/security';
async function main() {
  const pg = new PGlite();
  await pg.waitReady;
  for (const p of ['202609250001_initial', '202609250002_claim_guard'])
    await pg.exec(
      await readFile(`prisma/migrations/${p}/migration.sql`, 'utf8'),
    );
  const server = createServer(pg);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const a = server.address();
  if (!a || typeof a === 'string') throw Error();
  const databaseUrl = `postgresql://fixture:fixture@127.0.0.1:${a.port}/postgres?connection_limit=1`;
  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  await db.admin.create({
    data: {
      username: 'operator',
      passwordHash: await hashPassword('Browser fixture passphrase!'),
    },
  });
  await db.$disconnect();
  await pg.exec('DEALLOCATE ALL');
  const child = spawn(
    process.execPath,
    [
      'node_modules/next/dist/bin/next',
      'dev',
      '--hostname',
      '127.0.0.1',
      '--port',
      '3100',
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        NEXT_TELEMETRY_DISABLED: '1',
        APP_URL: 'http://127.0.0.1:3100',
        DATABASE_URL: databaseUrl,
        TRUENAS_URL: 'https://nas.invalid',
        TRUENAS_API_KEY: 'browser-fixture-not-a-real-key',
        SESSION_SECRET: 's'.repeat(64),
      },
    },
  );
  // Never forward request/error output from a server exercising password routes.
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  const stop = () => {
    child.kill('SIGTERM');
    server.close();
    void pg.close();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  child.on('exit', () => {
    stop();
    process.exit(0);
  });
}
void main();
