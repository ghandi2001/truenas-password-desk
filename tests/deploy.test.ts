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

test('offline setup fails before database work when prerequisites are missing', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'password-offline-'));
  try {
    await mkdir(join(dir, 'scripts'));
    await mkdir(join(dir, 'bin'));
    await copyFile('scripts/setup-db.sh', join(dir, 'scripts/setup-db.sh'));
    const log = join(dir, 'calls');
    await writeFile(
      join(dir, 'bin/docker'),
      `#!/bin/sh
printf '%s\\n' "$*" >> "$CALL_LOG"
case "$*" in
  info) [ "$FAIL_AT" != daemon ] || exit 1 ;;
  "compose config --quiet") [ "$FAIL_AT" != config ] || exit 1 ;;
  "compose config --images db migrate")
    [ "$FAIL_AT" != resolution ] || exit 1
    [ "$FAIL_AT" != empty ] || exit 0
    printf 'fixture-migrate\\npostgres:17-bookworm\\n' ;;
  "image inspect $FAIL_AT") exit 1 ;;
esac
`,
      { mode: 0o700 },
    );
    for (const scenario of [
      { failAt: 'daemon', calls: ['info'], message: /Start Docker/ },
      { failAt: 'env', calls: ['info'], message: /Copy .env.example/ },
      { failAt: 'config', calls: ['info', 'compose config --quiet'] },
      {
        failAt: 'resolution',
        calls: [
          'info',
          'compose config --quiet',
          'compose config --images db migrate',
        ],
      },
      {
        failAt: 'empty',
        calls: [
          'info',
          'compose config --quiet',
          'compose config --images db migrate',
        ],
        message: /resolve.*images/i,
      },
      {
        failAt: 'fixture-migrate',
        calls: [
          'info',
          'compose config --quiet',
          'compose config --images db migrate',
          'image inspect fixture-migrate',
        ],
        message: /docker load/,
      },
      {
        failAt: 'postgres:17-bookworm',
        calls: [
          'info',
          'compose config --quiet',
          'compose config --images db migrate',
          'image inspect fixture-migrate',
          'image inspect postgres:17-bookworm',
        ],
        message: /docker load/,
      },
    ]) {
      await t.test(scenario.failAt, async () => {
        await writeFile(log, '');
        await writeFile(
          join(dir, '.env'),
          'POSTGRES_PASSWORD=fixture-secret\\n',
        );
        if (scenario.failAt === 'env') await rm(join(dir, '.env'));
        const result = spawnSync('sh', [join(dir, 'scripts/setup-db.sh')], {
          env: {
            ...process.env,
            PATH: join(dir, 'bin') + ':' + process.env.PATH,
            CALL_LOG: log,
            FAIL_AT: scenario.failAt,
          },
          encoding: 'utf8',
        });
        assert.notEqual(result.status, 0);
        assert.deepEqual(
          (await readFile(log, 'utf8')).trim().split('\n'),
          scenario.calls,
        );
        if (scenario.message) assert.match(result.stderr, scenario.message);
        assert.doesNotMatch(
          result.stdout + result.stderr,
          /Setup complete|fixture-secret/,
        );
      });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('deployment modes order database setup and stop on failure', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'password-deploy-'));
  try {
    await mkdir(join(dir, 'scripts'));
    await mkdir(join(dir, 'bin'));
    await copyFile('scripts/deploy.sh', join(dir, 'scripts/deploy.sh'));
    await copyFile('scripts/setup-db.sh', join(dir, 'scripts/setup-db.sh'));
    const envFile = 'POSTGRES_PASSWORD=fixture\n';
    await writeFile(join(dir, '.env'), envFile);
    await writeFile(
      join(dir, 'bin/docker'),
      `#!/bin/sh
printf '%s\\n' "$*" >> "$CALL_LOG"
case "$*" in
  "compose config --quiet") [ "$APP_HOST" = "$EXPECTED_HOST" ] || exit 1 ;;
  "compose config --images db migrate") printf 'fixture-migrate\\npostgres:17-bookworm\\n' ;;
  *"npm run db:migrate"*) [ "$FAIL_MIGRATION" != 1 ] || exit 1 ;;
  *"npm run db:seed"*) [ "$FAIL_SEED" != 1 ] || exit 1 ;;
esac
`,
      { mode: 0o700 },
    );
    const log = join(dir, 'calls');
    for (const scenario of [
      {
        name: 'full deployment',
        args: [],
        seed: true,
        launch: true,
        status: 0,
      },
      {
        name: 'failed deployment migration',
        args: [],
        migrationFails: true,
        status: 1,
      },
      { name: 'database only', args: ['--database-only'], status: 0 },
      { name: 'setup only', args: ['--setup-only'], seed: true, status: 0 },
      {
        name: 'failed setup migration',
        args: ['--setup-only'],
        migrationFails: true,
        status: 1,
      },
      {
        name: 'failed setup seed',
        args: ['--setup-only'],
        seed: true,
        seedFails: true,
        status: 1,
      },
      {
        name: 'standalone setup',
        script: 'setup-db.sh',
        args: [],
        seed: true,
        status: 0,
      },
      {
        name: 'standalone migration failure',
        script: 'setup-db.sh',
        args: [],
        migrationFails: true,
        status: 1,
      },
      {
        name: 'standalone seed failure',
        script: 'setup-db.sh',
        args: [],
        seed: true,
        seedFails: true,
        status: 1,
      },
      { name: 'unknown mode', args: ['--unknown'], status: 2 },
    ]) {
      await t.test(scenario.name, async () => {
        await writeFile(log, '');
        const result = spawnSync(
          'sh',
          [
            join(dir, 'scripts', scenario.script ?? 'deploy.sh'),
            ...scenario.args,
          ],
          {
            env: {
              ...process.env,
              PATH: join(dir, 'bin') + ':' + process.env.PATH,
              APP_HOST: 'fixture.example',
              EXPECTED_HOST:
                scenario.script || scenario.args.length
                  ? 'localhost'
                  : 'fixture.example',
              CALL_LOG: log,
              FAIL_MIGRATION: scenario.migrationFails ? '1' : '0',
              FAIL_SEED: scenario.seedFails ? '1' : '0',
            },
            encoding: 'utf8',
          },
        );
        const calls = (await readFile(log, 'utf8'))
          .trim()
          .split('\n')
          .filter(Boolean);
        assert.equal(result.status, scenario.status, result.stderr);
        assert.equal(await readFile(join(dir, '.env'), 'utf8'), envFile);
        if (scenario.status === 2) {
          assert.deepEqual(calls, []);
          assert.match(result.stderr, /Usage:.*--setup-only/);
          return;
        }
        const deploy = !scenario.script && scenario.args.length === 0;
        assert.deepEqual(calls, [
          'info',
          'compose config --quiet',
          ...(scenario.script
            ? [
                'compose config --images db migrate',
                'image inspect fixture-migrate',
                'image inspect postgres:17-bookworm',
                'compose up -d --wait --no-build --pull never db',
                'compose run --rm --no-deps --pull never -e CHECKPOINT_DISABLE=1 migrate npm run db:migrate',
                ...(scenario.seed
                  ? [
                      'compose run --rm --no-deps --pull never -e CHECKPOINT_DISABLE=1 migrate npm run db:seed',
                    ]
                  : []),
              ]
            : [
                ...(deploy
                  ? [
                      'compose build app migrate',
                      'compose run --rm --no-deps migrate npx tsx -e require("./src/server/config").loadConfig()',
                    ]
                  : ['compose build migrate']),
                'compose up -d --wait db',
                'compose run --rm --no-deps migrate npm run db:migrate',
                ...(scenario.seed
                  ? ['compose run --rm --no-deps migrate npm run db:seed']
                  : []),
              ]),
          ...(scenario.launch ? ['compose up -d --wait app proxy'] : []),
        ]);
        if (scenario.script || scenario.args[0] === '--setup-only') {
          if (scenario.status === 0)
            assert.match(result.stdout, /Setup complete/);
          else assert.doesNotMatch(result.stdout, /Setup complete/);
        }
        if (scenario.status !== 0)
          assert.doesNotMatch(result.stdout, /Deployment complete/);
      });
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
