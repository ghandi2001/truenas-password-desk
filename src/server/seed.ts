import type { PrismaClient } from '@prisma/client';
import { hashPassword, passwordError, usernamePattern } from './security';

export async function seedInitialAdmin(
  db: PrismaClient,
  username: string,
  password: string,
  confirmation: string,
) {
  if (
    !usernamePattern.test(username) ||
    passwordError(password, confirmation, 8)
  ) {
    throw new Error('Invalid initial administrator credentials.');
  }
  const passwordHash = await hashPassword(password);
  return db.$transaction(async (tx) => {
    // Serialize only first-admin bootstraps, including separate deployment processes.
    await tx.$executeRaw`LOCK TABLE "Admin" IN EXCLUSIVE MODE`;
    if (await tx.admin.count()) return false;
    await tx.admin.create({ data: { username, passwordHash } });
    return true;
  });
}
