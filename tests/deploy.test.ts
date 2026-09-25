import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  mkdir,
  copyFile,
  writeFile,
  readFile,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

test('deployment orders migrations before seed and launch; failed migration aborts', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'password-deploy-'));
  try {
    await mkdir(join(dir, 'scripts'));
    await mkdir(join(dir, 'bin'));
    await copyFile('scripts/deploy.sh', join(dir, 'scripts/deploy.sh'));
    await writeFile(join(dir, '.env'), 'POSTGRES_PASSWORD=fixture\n');
    await writeFile(
      join(dir, 'bin/docker'),
      `#!/bin/sh
printf '%s\\n' "$*" >> "$CALL_LOG"
case "$*" in *"npm run db:migrate"*) [ "$FAIL_MIGRATION" != 1 ] || exit 1 ;; esac
`,
      { mode: 0o700 },
    );
    const log = join(dir, 'calls');
    for (const mode of ['success', 'failure', 'database']) {
      await writeFile(log, '');
      const result = spawnSync(
        'sh',
        [
          join(dir, 'scripts/deploy.sh'),
          ...(mode === 'database' ? ['--database-only'] : []),
        ],
        {
          env: {
            ...process.env,
            PATH: join(dir, 'bin') + ':' + process.env.PATH,
            CALL_LOG: log,
            FAIL_MIGRATION: mode === 'failure' ? '1' : '0',
          },
          encoding: 'utf8',
        },
      );
      const calls = await readFile(log, 'utf8');
      assert.equal(result.status, mode === 'failure' ? 1 : 0);
      assert.ok(calls.includes('npm run db:migrate'));
      if (mode === 'success') {
        assert.ok(
          calls.indexOf('npm run db:migrate') <
            calls.indexOf('npm run db:seed'),
        );
        assert.ok(
          calls.indexOf('npm run db:seed') <
            calls.indexOf('up -d --wait app proxy'),
        );
      } else {
        assert.equal(calls.includes('npm run db:seed'), false);
        assert.equal(calls.includes('up -d --wait app proxy'), false);
      }
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
