import { env } from 'cloudflare:workers';
import { GET as read } from '../analytics/route';
import { inDemo } from '../../../lib/demo-server';
export const dynamic = 'force-dynamic';
export async function GET(req: Request) {
  if ((env as any).WORKSPACE_MODE === 'true')
    return Response.json({ error: 'Демонстрационный режим отключён в общей смене' }, { status: 403 });
  return inDemo(req, () => read(req));
}
