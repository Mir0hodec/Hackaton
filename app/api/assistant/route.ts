// ИИ-ассистент мастера и руководителя (ТЗ 6.7).
import { actor, list, sameOrigin } from '../../../lib/server';
import { assistantAnswer } from '../../../lib/assistant';
import { rateLimit } from '../../../lib/rate-limit';

export const dynamic = 'force-dynamic';
const json = (data: any, status = 200) =>
  Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export async function POST(req: Request) {
  try {
    // Тело читается до проверок: недочитанный запрос перезапускает локальный workerd.
    const b: any = await req.json().catch(() => ({}));
    sameOrigin(req);
    const u = await actor(req);
    if (!u || !['master', 'manager', 'admin'].includes(u.role)) return json({ error: 'Нет доступа' }, 403);
    if (!(await rateLimit(req, 'assistant-' + u.id, 30, 60000)))
      return json({ error: 'Слишком много запросов, подождите минуту' }, 429);
    const message = String(b.message || '')
      .trim()
      .slice(0, 1000);
    if (!message) return json({ error: 'Введите вопрос' }, 400);
    const history = (Array.isArray(b.history) ? b.history : [])
      .filter((h: any) => ['user', 'assistant'].includes(h?.role) && typeof h.text === 'string')
      .slice(-6)
      .map((h: any) => ({ role: h.role, text: h.text.slice(0, 2000) }));
    const [orders, users, equipment, areas, codes, materials, worklogs] = await Promise.all(
      ['orders', 'users', 'equipment', 'areas', 'codes', 'materials', 'worklogs'].map(list),
    );
    const answer = await assistantAnswer(
      { orders, users, equipment, areas, codes, materials, worklogs },
      message,
      history,
    );
    return json(answer);
  } catch (e: any) {
    console.error('assistant:', e);
    return json({ error: 'Ассистент временно недоступен' }, 503);
  }
}
