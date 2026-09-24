import { isIP } from 'node:net';
import { z } from 'zod';
import { Service, SafeError, genericFailure } from './service';
import { checkOrigin, privateDigest, equal, tokenPattern } from './security';
const json = (
  data: unknown,
  status = 200,
  headers: Record<string, string> = {},
) =>
  Response.json(data, {
    status,
    headers: {
      'Cache-Control': 'no-store',
      'Referrer-Policy': 'no-referrer',
      ...headers,
    },
  });
async function body(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new SafeError('Invalid request.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 8192) {
        await reader.cancel();
        throw new SafeError('Invalid request.', 413);
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch (e) {
    if (e instanceof SafeError) throw e;
    throw new SafeError('Invalid request.');
  }
}
export function handler(service: Service) {
  const c = service.config;
  const cookieName = c.appUrl.startsWith('https:')
    ? '__Host-session'
    : 'dev-session';
  const cookie = (token: string, age: number) =>
    `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${c.appUrl.startsWith('https:') ? '; Secure' : ''}`;
  return async (req: Request, path: string[]) => {
    try {
      const method = req.method;
      const endpoint = path.join('/');
      let ip = 'untrusted-proxy';
      if (c.trustProxy) {
        const value = req.headers
          .get('x-forwarded-for')
          ?.split(',')
          .pop()
          ?.trim();
        if (value && isIP(value)) ip = value;
      }
      if (endpoint === 'health' && method === 'GET') {
        await service.db.$queryRaw`SELECT 1`;
        return json({ status: 'ok' });
      }
      if (method !== 'GET') {
        try {
          checkOrigin(req, c);
        } catch {
          throw new SafeError('Request denied.', 403);
        }
      }
      const token =
        req.headers
          .get('cookie')
          ?.split(';')
          .map((v) => v.trim())
          .find((v) => v.startsWith(cookieName + '='))
          ?.slice(cookieName.length + 1) ?? '';
      if (endpoint === 'admin/login' && method === 'POST') {
        const p = z
          .object({
            username: z.string().min(1).max(64),
            password: z.string().min(1).max(512),
          })
          .strict()
          .safeParse(await body(req));
        if (!p.success) throw new SafeError('Unable to sign in.', 401);
        const login = await service.login(p.data.username, p.data.password, ip);
        return json({ ok: true }, 200, {
          'Set-Cookie': cookie(login.token, 8 * 3600),
        });
      }
      if (path[0] === 'admin') {
        const session = await service.session(token);
        if (!session) throw new SafeError('Sign in required.', 401);
        const csrf = privateDigest('csrf:' + token, c.sessionSecret);
        if (
          method !== 'GET' &&
          !equal(req.headers.get('x-csrf-token') ?? '', csrf)
        )
          throw new SafeError('Request denied.', 403);
        if (endpoint === 'admin/session' && method === 'GET')
          return json({
            username: session.admin.username,
            csrf,
            defaultMinutes: c.ttlMinutes,
          });
        if (endpoint === 'admin/logout' && method === 'POST') {
          await service.logout(token, ip);
          return json({ ok: true }, 200, { 'Set-Cookie': cookie('', 0) });
        }
        if (endpoint === 'admin/password-links') {
          if (method === 'GET')
            return json({ links: await service.listLinks() });
          if (method === 'POST') {
            if (!(await service.limit('create:' + session.adminId, 30)))
              throw new SafeError('Too many requests.', 429);
            return json(
              await service.createLink(session.adminId, await body(req), ip),
              201,
            );
          }
        }
        if (
          path.length === 4 &&
          path[1] === 'password-links' &&
          path[3] === 'revoke' &&
          method === 'POST'
        ) {
          if (!z.string().uuid().safeParse(path[2]).success)
            throw new SafeError('Invalid request.');
          await service.revoke(session.adminId, path[2], ip);
          return json({ ok: true });
        }
        if (endpoint === 'admin/audit-logs' && method === 'GET')
          return json({
            logs: await service.db.audit.findMany({
              orderBy: { createdAt: 'desc' },
              take: 200,
            }),
          });
      }
      if (path[0] === 'password-change' && path.length === 2) {
        if (
          !(await service.limit('public-ip:' + ip, method === 'GET' ? 120 : 20))
        )
          throw new SafeError(genericFailure, 429);
        if (!tokenPattern.test(path[1])) throw new SafeError(genericFailure);
        if (method === 'GET') {
          if (!(await service.validLink(path[1])))
            throw new SafeError(
              'This link is unavailable. Ask your administrator for a new link.',
              404,
            );
          return json({ valid: true, minLength: c.minLength });
        }
        if (method === 'POST') {
          await service.change(path[1], await body(req), ip);
          return json({ ok: true, message: 'Your password has been changed.' });
        }
      }
      return json({ error: 'Not found.' }, 404);
    } catch (e) {
      return json(
        {
          error:
            e instanceof SafeError
              ? e.message
              : 'Unable to complete the request. Please try again later.',
        },
        e instanceof SafeError ? e.status : 503,
      );
    }
  };
}
