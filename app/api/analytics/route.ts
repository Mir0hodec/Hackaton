// Аналитика и отчёты за период с фильтрами (ТЗ 6.5–6.6, 7). Считается на сервере по всей истории,
// чтобы телефоны не загружали сотни нарядов. ИИ-сводка — по запросу (ai=1), обезличенная и кэшируемая.
import { actor, db, hash, list } from '../../../lib/server';
import { namespace } from '../../../lib/context';
import { analyze, narrative, explainRating } from '../../../lib/analytics';
import { rating } from '../../../lib/domain';
import { llmInfo, llmJson } from '../../../lib/llm';

export const dynamic = 'force-dynamic';
const json = (data: any, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(req: Request) {
  try {
    const u = await actor(req);
    if (!u) return json({ error: 'Войдите в систему' }, 401);
    const p = new URL(req.url).searchParams;
    const now = Date.now();
    const from = Date.parse(p.get('from') || '') || now - 30 * 86400000;
    const to = Date.parse(p.get('to') || '') || now + 60000;
    const [orders, users, equipment, areas, codes, materials] = await Promise.all(
      ['orders', 'users', 'equipment', 'areas', 'codes', 'materials'].map(list),
    );
    const dataset = { orders, users, equipment, areas, codes, materials };

    // Исполнитель видит только свой рейтинг и его объяснение.
    if (u.role === 'worker') {
      const mine = orders.filter((o) => Date.parse(o.created) >= from && Date.parse(o.created) < to);
      const r = rating(mine, u.id);
      return json({ self: { ...r, explanation: explainRating(r) } });
    }

    const filters = {
      from,
      to,
      area: p.get('area') || undefined,
      equipment: p.get('equipment') || undefined,
      worker: p.get('worker') || undefined,
      brigade: Number(p.get('brigade')) || undefined,
    };
    const result = analyze(dataset, filters);
    const text = narrative(result);
    let ai: any = null;
    if (p.get('ai') === '1' && llmInfo().provider) ai = await aiNarrative(result, filters, users);
    return json({ ...result, narrative: text, ai, llm: !!llmInfo().provider });
  } catch (e: any) {
    console.error(e);
    return json({ error: 'Не удалось построить отчёт' }, 500);
  }
}

/** Сводка простым языком от модели. Имена исполнителей заменяются кодами и подставляются обратно. */
async function aiNarrative(result: any, filters: any, users: any[]) {
  const key =
    namespace() +
    'ai-narrative:' +
    (await hash(JSON.stringify({ f: filters, s: result.summary, i: result.insights.map((i: any) => i.id) })));
  const cached: any = await db().prepare('SELECT data FROM records WHERE id=?').bind(key).first();
  if (cached) {
    const value = JSON.parse(cached.data);
    if (Date.now() - Date.parse(value.created) < 30 * 60000) return value;
  }
  const names = new Map<string, string>();
  users.forEach((u: any, i: number) => names.set(u.name, `Сотрудник-${i + 1}`));
  const mask = (t: string) => {
    let s = String(t);
    for (const [name, code] of names) s = s.replaceAll(name, code);
    return s;
  };
  const unmask = (t: string) => {
    let s = String(t);
    for (const [name, code] of names) s = s.replaceAll(code, name);
    return s;
  };
  const payload = {
    period: result.period,
    summary: result.summary,
    insights: result.insights.map((i: any) => ({
      title: mask(i.title),
      detail: mask(i.detail),
      recommendation: i.recommendation,
    })),
    topEquipment: result.equipment
      .slice(0, 5)
      .map((e: any) => ({
        name: e.name,
        unplanned: e.unplanned,
        downtimeHours: e.downtimeHours,
        topCode: e.topCode,
      })),
    ratings: result.ratings.workers
      .slice(0, 15)
      .map((w: any) => ({ who: mask(w.name), score: w.score, onTime: w.onTime, returns: w.returns })),
    brigades: result.ratings.brigades.map((b: any) => ({ brigade: b.brigade, score: b.score })),
  };
  const out = await llmJson<{ summary: string; recommendations: string[] }>({
    system:
      'Ты — аналитик службы главного механика горно-обогатительного предприятия. По статистике нарядов напиши короткую сводку для мастера и начальника участка: 3–5 предложений простым языком о главном за период и 3–5 конкретных рекомендаций с указанием оборудования. Опирайся только на переданные числа, не придумывай данных. Коды «Сотрудник-N» оставляй как есть. Это рекомендации, решение принимает человек.',
    parts: [{ type: 'text', text: JSON.stringify(payload) }],
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['summary', 'recommendations'],
      properties: {
        summary: { type: 'string' },
        recommendations: { type: 'array', items: { type: 'string' } },
      },
    },
    effort: 'low',
    maxTokens: 4000,
    mock: () => ({
      summary: 'Тестовая сводка: ' + narrative(result),
      recommendations: result.insights.slice(0, 3).map((i: any) => i.recommendation),
    }),
  }).catch((e) => {
    console.error('AI narrative failed:', e);
    return null;
  });
  if (!out) return null;
  const value = {
    summary: unmask(out.summary),
    recommendations: out.recommendations.map(unmask).slice(0, 6),
    model: llmInfo().model,
    created: new Date().toISOString(),
  };
  await db()
    .prepare(
      'INSERT INTO records(id,kind,data,version) VALUES(?,?,?,0) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
    )
    .bind(key, namespace() + 'ai-cache', JSON.stringify(value))
    .run();
  return value;
}
