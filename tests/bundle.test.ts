import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
async function files(dir: string): Promise<string[]> {
  const items = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      items.map((i) =>
        i.isDirectory()
          ? files(dir + '/' + i.name)
          : Promise.resolve([dir + '/' + i.name]),
      ),
    )
  ).flat();
}
test('client source has no NAS configuration, credential imports, logging or browser persistence', async () => {
  for (const root of [
    'src/components',
    'src/app/admin',
    'src/app/password-change',
  ])
    for (const file of await files(root)) {
      const text = await readFile(file, 'utf8');
      for (const forbidden of [
        'TRUENAS_API_KEY',
        'TRUENAS_URL',
        '@/server/',
        'localStorage',
        'sessionStorage',
        'console.log',
        'console.error',
      ])
        assert.equal(text.includes(forbidden), false, `${file}: ${forbidden}`);
    }
});
test('application handlers and NAS adapter do not log request values', async () => {
  for (const file of await files('src/server')) {
    const text = await readFile(file, 'utf8');
    assert.equal(
      /console\.(log|error|warn|debug)|process\.(stdout|stderr)\.write/.test(
        text,
      ),
      false,
      file,
    );
  }
});
