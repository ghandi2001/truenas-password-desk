import { readdir, readFile } from 'node:fs/promises';
async function scan(dir: string): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = dir + '/' + entry.name;
    if (entry.isDirectory()) {
      await scan(path);
      continue;
    }
    if (!path.endsWith('.js')) continue;
    const content = await readFile(path, 'utf8');
    for (const forbidden of [
      'TRUENAS_API_KEY',
      'TRUENAS_URL',
      'fixture-api-key-not-real',
      'browser-fixture-not-a-real-key',
      'user.set_password',
      'verify_smb.py',
    ])
      if (content.includes(forbidden))
        throw Error('Backend material found in browser bundle.');
  }
}
scan('.next/static')
  .then(() =>
    process.stdout.write(
      'Browser bundles contain no backend configuration or NAS adapter.\n',
    ),
  )
  .catch(() => {
    process.stderr.write('Browser bundle check failed.\n');
    process.exitCode = 1;
  });
