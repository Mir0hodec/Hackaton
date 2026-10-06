import { env } from 'cloudflare:workers';
import { POST as ask } from '../assistant/route';
import { inDemo } from '../../../lib/demo-server';
export const dynamic = 'force-dynamic';
export async function POST(req: Request) {
  if ((env as any).WORKSPACE_MODE === 'true') {
    await req.arrayBuffer().catch(() => null);
    return Response.json({ error: 'Демонстрационный режим отключён в общей смене' }, { status: 403 });
  }
  return inDemo(req, () => ask(req));
}
