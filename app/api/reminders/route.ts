import { env } from 'cloudflare:workers';
import { checkDeadlines } from '../../../lib/deadlines';
import { initialize } from '../../../lib/server';
export async function POST(req: Request) {
  await req.arrayBuffer().catch(() => null); // недочитанное тело роняет воркер в локальном workerd
  const key = (env as any).REMINDER_TOKEN;
  if (!key || req.headers.get('authorization') !== 'Bearer ' + key)
    return Response.json({ error: 'Нет доступа' }, { status: 401 });
  await initialize();
  const created = await checkDeadlines(new URL(req.url).origin);
  return Response.json({ ok: true, created }, { headers: { 'Cache-Control': 'no-store' } });
}
