import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, copyFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const SECRET_VALUE = 's3cret-value-do-not-print';

async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), 'password-setup-host-'));
  await mkdir(join(dir, 'scripts'));
  await copyFile('scripts/setup-host.sh', join(dir, 'scripts/setup-host.sh'));
  await copyFile('scripts/deploy.sh', join(dir, 'scripts/deploy.sh'));
  // The real prepare script is only invoked (not duplicated); copy it so the
  // fixture exercises the actual delegation.
  await mkdir(join(dir, '.build-cache'), { recursive: true });
  await writeFile(join(dir, '.build-cache/manifest.json'), '[]');
  await writeFile(join(dir, '.build-cache/archive.tgz'), 'stub');
  return dir;
}

// docker stub: logs invocation, answers probes, and can simulate failures.
const dockerStub = `#!/bin/sh
printf '%s\\n' "$*" >> "$CALL_LOG"
case "$1 $2" in
  'info --format') [ "$DOCKER_ARCH" ] && printf '%s\\n' "$DOCKER_ARCH" || printf 'x86_64\\n'; exit 0 ;;
esac
case "$1" in info) [ "$FAIL_DOCKER" != 1 ] && exit 0 || exit 1 ;; esac
case "$1 $2" in 'compose version') exit 0 ;; esac
case "$1 $2" in 'compose config') [ "$FAIL_COMPOSE" != 1 ] && exit 0 || exit 1 ;; esac
exit 0
`;

async function run(dir, args, env = {}) {
  return runWithInput(dir, args, undefined, env);
}

function runWithInput(dir, args, input, env = {}) {
  return spawnSync('sh', [join(dir, 'scripts/setup-host.sh'), ...args], {
    env: {
      ...process.env,
      PATH: join(dir, 'bin') + ':' + process.env.PATH,
      CALL_LOG: join(dir, 'calls'),
      ...env,
    },
    input,
    encoding: 'utf8',
  });
}

test('check reports readiness names-only and never mutates or prints env values', async () => {
  const dir = await fixture();
  try {
    await mkdir(join(dir, 'bin'));
    await writeFile(join(dir, 'bin/docker'), dockerStub, { mode: 0o700 });
    await writeFile(
      join(dir, '.env'),
      `TRUENAS_API_KEY=${SECRET_VALUE}\nSESSION_SECRET=${SECRET_VALUE}\n`,
      { mode: 0o600 },
    );
    const result = await run(dir, ['--check']);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('TRUENAS_API_KEY'), 'lists variable names');
    assert.ok(!result.stdout.includes(SECRET_VALUE), 'must not print values');
    assert.ok(
      result.stdout.includes('does not authenticate with TrueNAS'),
      'states the non-authentication guarantee',
    );
    const calls = await readFileSafe(join(dir, 'calls'));
    for (const mutating of ['build', 'up ', 'run ', 'create']) {
      assert.ok(!calls.includes(mutating), `--check must not run: ${mutating}`);
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('check flags missing .env and missing build cache with the exact remedy', async () => {
  const dir = await fixture();
  try {
    await mkdir(join(dir, 'bin'));
    await writeFile(join(dir, 'bin/docker'), dockerStub, { mode: 0o700 });
    await rm(join(dir, '.build-cache'), { recursive: true, force: true });
    const result = await run(dir, ['--check']);
    assert.equal(result.status, 0);
    assert.ok(result.stdout.includes('.env: MISSING'));
    assert.ok(result.stdout.includes('build cache: MISSING'));
    assert.ok(
      result.stdout.includes('python3 scripts/prepare-build-cache.py --arch x64'),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('check exits nonzero on unsupported architecture with actionable message', async () => {
  const dir = await fixture();
  try {
    await mkdir(join(dir, 'bin'));
    await writeFile(join(dir, 'bin/docker'), dockerStub, { mode: 0o700 });
    const result = await run(dir, ['--check'], { DOCKER_ARCH: 'riscv64' });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('Unsupported build architecture'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('prepare-cache delegates to the existing python script with the mapped arch', async () => {
  const dir = await fixture();
  try {
    await mkdir(join(dir, 'bin'));
    await writeFile(join(dir, 'bin/docker'), dockerStub, { mode: 0o700 });
    const py = join(dir, 'bin/python3');
    await writeFile(
      py,
      `#!/bin/sh
printf 'py %s\\n' "$*" >> "$CALL_LOG"
`,
      { mode: 0o700 },
    );
    const result = await run(dir, ['--prepare-cache', 'arm64']);
    assert.equal(result.status, 0, result.stderr);
    const calls = await readFileSafe(join(dir, 'calls'));
    assert.ok(calls.includes('py scripts/prepare-build-cache.py --arch arm64'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('deploy requires confirmation, quiet config, and delegates to deploy.sh once', async () => {
  const dir = await fixture();
  try {
    await mkdir(join(dir, 'bin'));
    await writeFile(join(dir, 'bin/docker'), dockerStub, { mode: 0o700 });
    await writeFile(join(dir, '.env'), `POSTGRES_PASSWORD=${SECRET_VALUE}\n`, {
      mode: 0o600,
    });
    // deploy.sh stub logs that delegation happened.
    await writeFile(
      join(dir, 'scripts/deploy.sh'),
      `#!/bin/sh
printf 'deploy.sh %s\\n' "$*" >> "$CALL_LOG"
`,
      { mode: 0o700 },
    );
    // `script` gives the child a pty so the script's tty gate passes and the
    // confirmation is read the way a human operator types it.
    const result = spawnSync(
      'script',
      ['-qec', `sh ${join(dir, 'scripts/setup-host.sh')} --deploy`, '/dev/null'],
      {
        env: {
          ...process.env,
          PATH: join(dir, 'bin') + ':' + process.env.PATH,
          CALL_LOG: join(dir, 'calls'),
        },
        input: 'DEPLOY\n',
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 0, result.stderr);
    const calls = await readFileSafe(join(dir, 'calls'));
    assert.ok(calls.includes('compose config --quiet'));
    assert.equal(calls.split('deploy.sh').length - 1, 1, 'exactly one delegation');
    assert.ok(!result.stdout.includes(SECRET_VALUE));
    assert.ok(!calls.includes(SECRET_VALUE));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('deploy aborts without DEPLOY confirmation and touches nothing', async () => {
  const dir = await fixture();
  try {
    await mkdir(join(dir, 'bin'));
    await writeFile(join(dir, 'bin/docker'), dockerStub, { mode: 0o700 });
    await writeFile(join(dir, '.env'), 'POSTGRES_PASSWORD=x\n', {
      mode: 0o600,
    });
    await writeFile(
      join(dir, 'scripts/deploy.sh'),
      `#!/bin/sh
printf 'deploy.sh %s\\n' "$*" >> "$CALL_LOG"
`,
      { mode: 0o700 },
    );
    const result = spawnSync(
      'script',
      ['-qec', `sh ${join(dir, 'scripts/setup-host.sh')} --deploy`, '/dev/null'],
      {
        env: {
          ...process.env,
          PATH: join(dir, 'bin') + ':' + process.env.PATH,
          CALL_LOG: join(dir, 'calls'),
        },
        input: 'no\n',
        encoding: 'utf8',
      },
    );
    assert.equal(result.status, 1);
    const calls = await readFileSafe(join(dir, 'calls'));
    assert.ok(!calls.includes('deploy.sh'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('deploy refuses to run without a tty', async () => {
  const dir = await fixture();
  try {
    await mkdir(join(dir, 'bin'));
    await writeFile(join(dir, 'bin/docker'), dockerStub, { mode: 0o700 });
    await writeFile(join(dir, '.env'), 'POSTGRES_PASSWORD=x\n', {
      mode: 0o600,
    });
    const result = await run(dir, ['--deploy']);
    // spawnSync pipes stdio by default: no tty available.
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('interactive terminal'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('deploy blocks on missing build cache before any docker build call', async () => {
  const dir = await fixture();
  try {
    await mkdir(join(dir, 'bin'));
    await writeFile(join(dir, 'bin/docker'), dockerStub, { mode: 0o700 });
    await writeFile(join(dir, '.env'), 'POSTGRES_PASSWORD=x\n', {
      mode: 0o600,
    });
    await rm(join(dir, '.build-cache'), { recursive: true, force: true });
    const result = await run(dir, ['--deploy']);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes('prepare-cache'));
    const calls = await readFileSafe(join(dir, 'calls'));
    assert.ok(!calls.includes('build'));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function readFileSafe(path) {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return '';
  }
}
