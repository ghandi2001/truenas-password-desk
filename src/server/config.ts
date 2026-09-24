import { z } from 'zod';

const origin = (secure: boolean) =>
  z
    .string()
    .url()
    .refine((value) => {
      const u = new URL(value);
      return (
        !u.username &&
        !u.password &&
        u.pathname === '/' &&
        !u.search &&
        !u.hash &&
        (u.protocol === 'https:' ||
          (!secure &&
            u.protocol === 'http:' &&
            ['localhost', '127.0.0.1'].includes(u.hostname))) &&
        !value.includes('YOUR_TRUENAS')
      );
    });
const secret = z
  .string()
  .min(16)
  .refine((v) => !v.includes('REPLACE_'));
const schema = z.object({
  APP_URL: origin(false),
  DATABASE_URL: z.string().regex(/^postgres(ql)?:\/\//),
  TRUENAS_URL: origin(true),
  TRUENAS_API_KEY: secret,
  TRUENAS_API_VERSION: z.literal('v25.10'),
  SESSION_SECRET: secret.min(48),
  PASSWORD_LINK_TTL_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(1440)
    .default(30),
  PASSWORD_MIN_LENGTH: z.coerce.number().int().min(12).max(128).default(12),
  RATE_LIMIT_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  RATE_LIMIT_WINDOW_MINUTES: z.coerce
    .number()
    .int()
    .min(1)
    .max(1440)
    .default(15),
  SMB_PYTHON: z.string().min(1).default('python3'),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
});
export function loadConfig(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
) {
  const parsed = schema.safeParse(env);
  if (!parsed.success)
    throw new Error(
      `Configuration error: check ${[...new Set(parsed.error.issues.map((i) => i.path[0]))].join(', ')}. Values are redacted.`,
    );
  const e = parsed.data;
  if (env.NODE_ENV === 'production' && !e.APP_URL.startsWith('https://'))
    throw new Error(
      'Configuration error: APP_URL requires HTTPS in production.',
    );
  return {
    appUrl: new URL(e.APP_URL).origin,
    databaseUrl: e.DATABASE_URL,
    nasUrl: new URL(e.TRUENAS_URL).origin,
    apiKey: e.TRUENAS_API_KEY,
    apiVersion: e.TRUENAS_API_VERSION,
    sessionSecret: e.SESSION_SECRET,
    ttlMinutes: e.PASSWORD_LINK_TTL_MINUTES,
    minLength: e.PASSWORD_MIN_LENGTH,
    maxAttempts: e.RATE_LIMIT_MAX_ATTEMPTS,
    windowMinutes: e.RATE_LIMIT_WINDOW_MINUTES,
    python: e.SMB_PYTHON,
    trustProxy: e.TRUST_PROXY === 'true',
  };
}
export type Config = ReturnType<typeof loadConfig>;
