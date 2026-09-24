import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { db } from '../src/server/db';
import { loadConfig } from '../src/server/config';
import {
  hashPassword,
  passwordError,
  usernamePattern,
} from '../src/server/security';
async function main() {
  loadConfig();
  if (!process.stdin.isTTY)
    throw Error('Run admin:create in an interactive terminal.');
  let hidden = false;
  const output = new Writable({
    write(chunk, encoding, cb) {
      if (!hidden) process.stdout.write(chunk, encoding);
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  try {
    const username = await rl.question('Admin username: ');
    if (!usernamePattern.test(username)) throw Error('Invalid username.');
    process.stdout.write('Admin password (hidden): ');
    hidden = true;
    const password = await rl.question('');
    process.stdout.write('\nConfirm password (hidden): ');
    const confirm = await rl.question('');
    hidden = false;
    process.stdout.write('\n');
    const error = passwordError(
      createRandomPlaceholder(),
      password,
      confirm,
      username,
      12,
    );
    if (error) throw Error(error);
    await db.admin.create({
      data: { username, passwordHash: await hashPassword(password) },
    });
    process.stdout.write('Admin created. No default password is configured.\n');
  } finally {
    rl.close();
    await db.$disconnect();
  }
}
function createRandomPlaceholder() {
  return 'not-the-current-admin-password';
}
main().catch(() => {
  process.stderr.write(
    'Admin creation failed. Check configuration, unique username, database, and password policy.\n',
  );
  process.exitCode = 1;
});
