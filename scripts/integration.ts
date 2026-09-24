import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { loadConfig } from '../src/server/config';
import { TrueNasClient } from '../src/server/truenas';
import { passwordError, usernamePattern } from '../src/server/security';
async function main() {
  const config = loadConfig();
  if (!process.stdin.isTTY) throw Error();
  const output = new Writable({
    write(_chunk, _encoding, cb) {
      cb();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  const ask = (prompt: string) => {
    process.stdout.write(prompt);
    return rl.question('');
  };
  try {
    const consent = await ask(
      'This changes a REAL test account password. Type CHANGE TEST ACCOUNT to proceed: ',
    );
    if (consent !== 'CHANGE TEST ACCOUNT') throw Error();
    const username = await ask(
      '\nDedicated local SMB test username (hidden): ',
    );
    const old = await ask('\nCurrent test password (hidden): ');
    const next = await ask('\nNew test password (hidden): ');
    const confirm = await ask('\nConfirm new password (hidden): ');
    if (
      !usernamePattern.test(username) ||
      passwordError(old, next, confirm, username, config.minLength)
    )
      throw Error();
    await new TrueNasClient(config).setUserPassword(username, old, next);
    process.stdout.write(
      '\nPassword changed successfully. Verify SMB access with the new password.\n',
    );
  } finally {
    rl.close();
  }
}
main().catch(() => {
  process.stderr.write(
    '\nIntegration test failed or cancelled; no sensitive details are printed. If dispatched, verify account state before retrying.\n',
  );
  process.exitCode = 1;
});
