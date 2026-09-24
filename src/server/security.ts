import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import argon2 from 'argon2';
import type { Config } from './config';
export const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
export const usernamePattern = /^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,63}$/;
export const createToken = () => randomBytes(32).toString('base64url');
export const digest = (value: string) =>
  createHash('sha256').update(value).digest('hex');
export const privateDigest = (value: string, secret: string) =>
  createHmac('sha256', secret).update(value).digest('hex');
export const hashPassword = (value: string) =>
  argon2.hash(value, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
export const verifyPassword = async (hash: string, value: string) => {
  try {
    return await argon2.verify(hash, value);
  } catch {
    return false;
  }
};
export function equal(a: string, b: string) {
  return (
    a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
export function passwordError(
  current: string,
  next: string,
  confirm: string,
  username: string,
  min: number,
): string | null {
  if (
    ![current, next, confirm].every(
      (p) => p.length > 0 && Buffer.byteLength(p) <= 512 && !p.includes('\0'),
    )
  )
    return 'Enter passwords of at most 512 UTF-8 bytes without NUL characters.';
  if (next !== confirm) return 'New passwords must match.';
  if ([...next].length < min) return `Use at least ${min} characters.`;
  if (next.toLowerCase() === username.toLowerCase() || next === current)
    return 'Choose a different, stronger password.';
  if (
    /^(.{1,4})\1+$/su.test(next) ||
    /^(password|qwerty|letmein|welcome|123456|abcdef)[\d!@#$]*$/i.test(next) ||
    new Set(next.toLowerCase()).size < 5
  )
    return 'Choose a less predictable password or a longer passphrase.';
  return null;
}
export function checkOrigin(req: Request, c: Config) {
  if (
    req.headers.get('origin') !== c.appUrl ||
    !req.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/json')
  )
    throw new Error('Request denied');
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none')
    throw new Error('Request denied');
}
