// Seed npm's content-addressed cache from SRI-verified public package archives.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const root = execFileSync('npm', ['root', '-g'], { encoding: 'utf8' }).trim();
const cacache = require(path.join(root, 'npm/node_modules/cacache'));
(async () => {
  const dir = process.argv[2];
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json')));
  for (const entry of manifest) {
    const data = fs.readFileSync(path.join(dir, entry.file));
    const actual =
      'sha512-' + crypto.createHash('sha512').update(data).digest('base64');
    if (actual !== entry.integrity)
      throw new Error('Archive integrity mismatch');
    await cacache.put(
      '/root/.npm/_cacache',
      'make-fetch-happen:request-cache:' + entry.url,
      data,
      { integrity: entry.integrity },
    );
  }
  console.log('Imported verified npm archive cache.');
})().catch(() => {
  console.error('Unable to import verified dependency cache.');
  process.exitCode = 1;
});
