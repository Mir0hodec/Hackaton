import { env } from 'cloudflare:workers';
import { GET as read, POST as write } from '../service/route';
import { inDemo, startDemo, changeDemoRole } from '../../../lib/demo-server';
import { sameOrigin } from '../../../lib/server';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  if ((env as any).WORKSPACE_MODE === 'true')
    return Response.json({ error: 'Демонстрационный режим отключён в общей смене' }, { status: 403 });
  return inDemo(req, () => read(req));
}
export async function POST(req: Request) {
  if ((env as any).WORKSPACE_MODE === 'true') {
    // Тело нужно дочитать: иначе локальный workerd перезапускает воркер и роняет следующий запрос.
    await req.arrayBuffer().catch(() => null);
    return Response.json({ error: 'Демонстрационный режим отключён в общей смене' }, { status: 403 });
  }
  try {
    sameOrigin(req);
    const body: any = await req.clone().json();
    if (body.action === 'demo-start') return startDemo(req);
    if (body.action === 'demo-role') return changeDemoRole(req, String(body.id));
    if (['login', 'logout'].includes(body.action))
      return Response.json({ error: 'В демо используйте переключатель ролей' }, { status: 400 });
    return inDemo(req, () => write(req));
  } catch {
    return Response.json({ error: 'Не удалось открыть демонстрационную среду' }, { status: 503 });
  }
}
