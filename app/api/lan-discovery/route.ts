import { env } from 'cloudflare:workers';
import { isLanDemo } from '../../../lib/lan-mode';
export const dynamic = 'force-dynamic';
export async function GET() {
  if (!isLanDemo(env as any)) return Response.json({ error: 'LAN demo is disabled' }, { status: 404 });
  return Response.json(
    { app: 'naryadai', protocol: 1, mode: 'shared-lan-demo', path: '/demo' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
