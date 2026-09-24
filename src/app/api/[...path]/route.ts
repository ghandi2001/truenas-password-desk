import { db } from '@/server/db';
import { loadConfig } from '@/server/config';
import { Service } from '@/server/service';
import { handler } from '@/server/http';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function route(
  req: Request,
  ctx: { params: Promise<{ path: string[] }> },
) {
  return handler(new Service(db, loadConfig()))(req, (await ctx.params).path);
}
export { route as GET, route as POST };
