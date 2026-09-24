import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WebSocketServer } from 'ws';
import { TrueNasClient, NasFailure } from '../src/server/truenas';
import { loadConfig } from '../src/server/config';
const config = loadConfig({
  APP_URL: 'https://password.example.com',
  DATABASE_URL: 'postgresql://test:test@localhost/test',
  TRUENAS_URL: 'https://nas.example.com',
  TRUENAS_API_VERSION: 'v25.10',
  TRUENAS_API_KEY: 'fixture-not-a-real-key',
  SESSION_SECRET: 's'.repeat(64),
});
async function fixture(mode: string, verified = true) {
  const server = new WebSocketServer({ port: 0 });
  await new Promise<void>((r) => server.on('listening', r));
  const methods: string[] = [];
  server.on('connection', (s) =>
    s.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      methods.push(m.method);
      if (mode === 'timeout') return;
      if (m.method === 'user.set_password') {
        assert.deepEqual(m.params, [
          {
            username: 'alice',
            old_password: 'Current fixture!',
            new_password: 'New fixture passphrase!',
          },
        ]);
        if (mode === 'disconnect') {
          s.close();
          return;
        }
      }
      const result =
        m.method === 'auth.login_with_api_key'
          ? mode !== 'auth'
          : m.method === 'system.version'
            ? mode === 'version'
              ? '26.0.0'
              : 'TrueNAS-25.10.0'
            : null;
      s.send(
        JSON.stringify({
          jsonrpc: '2.0',
          id: m.id,
          ...(mode === 'failure' && m.method === 'user.set_password'
            ? { error: { code: -32602, message: 'sensitive upstream text' } }
            : { result }),
        }),
      );
    }),
  );
  const address = server.address();
  if (typeof address !== 'object' || !address) throw Error();
  const client = new TrueNasClient(
    config,
    async () => verified,
    `ws://127.0.0.1:${address.port}`,
    100,
  );
  return {
    client,
    methods,
    close: async () => {
      client.close();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
test('exact JSON-RPC contract succeeds only after current SMB password verification', async () => {
  const f = await fixture('success');
  try {
    await f.client.setUserPassword(
      'alice',
      'Current fixture!',
      'New fixture passphrase!',
    );
    assert.deepEqual(f.methods, [
      'auth.login_with_api_key',
      'system.version',
      'user.set_password',
    ]);
  } finally {
    await f.close();
  }
});
for (const mode of ['auth', 'version', 'timeout', 'failure', 'disconnect'])
  test(`NAS ${mode} is a safe failure`, async () => {
    const f = await fixture(mode);
    try {
      await assert.rejects(
        f.client.setUserPassword(
          'alice',
          'Current fixture!',
          'New fixture passphrase!',
        ),
        (e: unknown) =>
          e instanceof NasFailure &&
          !e.message.includes('sensitive') &&
          e.uncertain === (mode === 'disconnect' || mode === 'failure'),
      );
    } finally {
      await f.close();
    }
  });
test('wrong current password never dispatches mutation', async () => {
  const f = await fixture('success', false);
  try {
    await assert.rejects(
      f.client.setUserPassword(
        'alice',
        'Current fixture!',
        'New fixture passphrase!',
      ),
    );
    assert.ok(!f.methods.includes('user.set_password'));
  } finally {
    await f.close();
  }
});
