// Интеграция с 1С / ERP / системой ТОиР: выгрузка нарядов в нормализованном виде за период.
// Доступ по сервисному токену INTEGRATION_TOKEN (заголовок Authorization: Bearer …).
// GET /api/integration/orders?from=2026-10-01&to=2026-10-31&format=json|csv
import { env } from 'cloudflare:workers';
import { list } from '../../../../lib/server';
import { activeMinutes, equipmentDowntime } from '../../../../lib/timing';

export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const token = (env as any).INTEGRATION_TOKEN;
  if (!token || req.headers.get('authorization') !== 'Bearer ' + token)
    return Response.json({ error: 'Нет доступа' }, { status: 401 });
  const p = new URL(req.url).searchParams;
  const from = Date.parse(p.get('from') || '') || Date.now() - 30 * 86400000;
  const to = Date.parse(p.get('to') || '') || Date.now() + 60000;
  const [orders, users, equipment, areas] = await Promise.all(
    ['orders', 'users', 'equipment', 'areas'].map(list),
  );
  const name = (items: any[], id: string) => items.find((x) => x.id === id)?.name || '';
  const inventory = (id: string) => equipment.find((x) => x.id === id)?.inventory || '';
  const rows = orders
    .filter((o) => Date.parse(o.created) >= from && Date.parse(o.created) < to)
    .sort((a, b) => a.number - b.number)
    .map((o) => ({
      number: o.number,
      type: o.type === 'planned' ? 'ППР' : 'Внеплановый',
      priority: o.priority,
      status: o.status,
      title: o.title,
      area: name(areas, o.area),
      equipment: name(equipment, o.equipment),
      inventoryNumber: inventory(o.equipment),
      workerId: o.worker,
      worker: name(users, o.worker),
      masterId: o.master,
      created: o.created,
      accepted: o.acceptedAt || null,
      started: o.started || null,
      finished: o.finished || null,
      closed: o.closedAt || null,
      due: o.due,
      normMinutes: o.norm,
      activeMinutes: activeMinutes(o),
      downtimeMinutes: equipmentDowntime(o),
      faultCode: o.report?.code || null,
      works: o.report?.works || null,
      materials: (o.report?.materials || []).map((m: any) => ({
        id: m.id,
        name: m.name,
        quantity: m.qty,
        unit: m.unit,
      })),
      score: o.masterScore ?? o.check?.score ?? null,
      verdict: o.check?.verdict || null,
      synthetic: !!o.synthetic,
    }));
  if (p.get('format') === 'csv') {
    const head = [
      'number',
      'type',
      'status',
      'title',
      'area',
      'equipment',
      'inventoryNumber',
      'worker',
      'created',
      'closed',
      'normMinutes',
      'activeMinutes',
      'downtimeMinutes',
      'faultCode',
      'score',
    ];
    const esc = (v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const csv = [head.join(';'), ...rows.map((r: any) => head.map((h) => esc(r[h])).join(';'))].join('\r\n');
    return new Response('\ufeff' + csv, {
      headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  return Response.json(
    { from: new Date(from).toISOString(), to: new Date(to).toISOString(), count: rows.length, orders: rows },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
