import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { db } from '../src/server/db';
import { seedInitialAdmin } from '../src/server/seed';
import {
  hashPassword,
  passwordError,
  usernamePattern,
} from '../src/server/security';
async function main() {
  const initialOnly = process.argv.includes('--initial');
  if (initialOnly && (await db.admin.count())) {
    process.stdout.write('Initial admin already exists; nothing changed.\n');
    await db.$disconnect();
    return;
  }
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
    const created = initialOnly
      ? await seedInitialAdmin(db, username, password, confirm)
      : !!(await db.admin.create({
          data: { username, passwordHash: await hashPassword(password) },
        }));
    process.stdout.write(
      created
        ? 'Admin created. No default password is configured.\n'
        : 'Initial admin already exists; nothing changed.\n',
    );
  } finally {
    rl.close();
    await db.$disconnect();
  }
}
function createRandomPlaceholder() {
  return 'not-the-current-admin-password';
}
main().catch(async () => {
  await db.$disconnect();
  process.stderr.write(
    'Admin creation failed. Check configuration, unique username, database, and password policy.\n',
  );
  process.exitCode = 1;
});
