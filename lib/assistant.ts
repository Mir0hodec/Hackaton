// ИИ-ассистент мастера (ТЗ 6.7): отвечает на вопросы о смене по живым данным и аналитике.
// С подключённым Claude модель сама вызывает инструменты (tool use); имена сотрудников перед
// отправкой заменяются кодами. Без модели те же инструменты вызываются по распознанному намерению.
import Anthropic from '@anthropic-ai/sdk';
import { env } from 'cloudflare:workers';
import { analyze, type Dataset } from './analytics';
import { closed, statuses, priorities, formatServerTime } from './domain';
import { llmInfo } from './llm';
import { shiftOf } from './shift';
import { currentWorkload } from './workload';

const DAY = 86400000;
const norm = (s: string) =>
  String(s || '')
    .toLowerCase()
    .replace(/ё/g, 'е');
/** Совпадение по основе слова: «обогащения» ↔ «Обогащение», «электриков» ↔ «Электрик». */
const stemMatch = (text: string, name: string) => {
  const t = norm(text);
  return norm(name)
    .split(/[\s,.()«»-]+/)
    .filter((w) => w.length >= 3)
    .some((w) => t.includes(w.slice(0, Math.max(3, Math.min(w.length, 6)))));
};

export type ToolContext = Dataset & { worklogs: any[] };

function findArea(d: ToolContext, text?: string) {
  return text ? d.areas.find((a) => stemMatch(text, a.name)) : undefined;
}
function findEquipment(d: ToolContext, text?: string) {
  if (!text) return undefined;
  const t = norm(text);
  // Сначала по марке/номеру (К-3, МШЦ-3600), затем по названию.
  return (
    d.equipment.find((e) => {
      const mark = e.name.split(' ').pop() || '';
      return mark.length >= 3 && t.includes(norm(mark));
    }) || d.equipment.find((e) => stemMatch(text, e.name.split(' ').slice(0, 2).join(' ')))
  );
}
function findWorker(d: ToolContext, text?: string) {
  if (!text) return undefined;
  const t = norm(text);
  return d.users.find(
    (u) =>
      u.role === 'worker' &&
      norm(u.name)
        .split(' ')
        .some((p) => p.length > 2 && t.includes(p.slice(0, 5))),
  );
}

function periodRange(period?: string) {
  const now = Date.now();
  if (period === 'shift') {
    const s = shiftOf(now);
    return { from: s.start, to: s.end, label: 'текущую смену' };
  }
  const days = { day: 1, week: 7, month: 30, quarter: 91 }[period as 'day'] || 7;
  const label =
    { day: 'сутки', week: 'неделю', month: 'месяц', quarter: '3 месяца' }[period as 'day'] || 'неделю';
  return { from: now - days * DAY, to: now + 60000, label };
}

// ---------- Инструменты ----------
export const tools = {
  free_workers(d: ToolContext, input: { specialty?: string }) {
    const list = currentWorkload(d.orders, d.users, d.worklogs).filter(
      (w) => w.onShift && (!input.specialty || stemMatch(input.specialty, w.spec || '')),
    );
    return {
      specialty: input.specialty || null,
      free: list
        .filter((w) => w.state === 'free')
        .map((w) => ({ name: w.name, spec: w.spec, brigade: w.brigade })),
      busy: list
        .filter((w) => w.state !== 'free')
        .map((w) => ({ name: w.name, spec: w.spec, state: w.label })),
    };
  },
  overdue_orders(d: ToolContext) {
    const now = Date.now();
    const name = (items: any[], id: string) => items.find((x) => x.id === id)?.name || id;
    return d.orders
      .filter((o) => !closed(o) && Date.parse(o.due) < now)
      .sort((a, b) => Date.parse(a.due) - Date.parse(b.due))
      .map((o) => ({
        number: o.number,
        title: o.title,
        equipment: name(d.equipment, o.equipment),
        area: name(d.areas, o.area),
        worker: name(d.users, o.worker),
        status: statuses[o.status],
        priority: priorities[o.priority],
        overdueMinutes: Math.round((now - Date.parse(o.due)) / 60000),
        lastComment: o.lastComment || null,
      }));
  },
  active_orders(d: ToolContext, input: { area?: string }) {
    const area = findArea(d, input.area);
    const name = (items: any[], id: string) => items.find((x) => x.id === id)?.name || id;
    return d.orders
      .filter((o) => !closed(o) && (!area || o.area === area.id))
      .map((o) => ({
        number: o.number,
        title: o.title,
        equipment: name(d.equipment, o.equipment),
        worker: name(d.users, o.worker),
        status: statuses[o.status],
        priority: priorities[o.priority],
        due: formatServerTime(o.due),
      }));
  },
  period_report(d: ToolContext, input: { period?: string; area?: string; equipment?: string }) {
    const range = periodRange(input.period);
    const area = findArea(d, input.area);
    const eq = findEquipment(d, input.equipment);
    const a = analyze(d, { from: range.from, to: range.to, area: area?.id, equipment: eq?.id });
    return {
      period: range.label,
      area: area?.name || 'все участки',
      equipment: eq?.name || null,
      summary: a.summary,
      insights: a.insights
        .slice(0, 5)
        .map((i) => ({ title: i.title, detail: i.detail, recommendation: i.recommendation })),
      topEquipment: a.equipment
        .slice(0, 5)
        .map((e) => ({
          name: e.name,
          unplanned: e.unplanned,
          downtimeHours: e.downtimeHours,
          topCode: e.topCode,
        })),
      bestWorkers: a.ratings.workers
        .filter((w) => w.count >= 3)
        .slice(0, 3)
        .map((w) => ({ name: w.name, score: w.score })),
    };
  },
  worker_info(d: ToolContext, input: { name: string }) {
    const w = findWorker(d, input.name);
    if (!w) return { error: 'Сотрудник не найден' };
    const a = analyze(d, { from: Date.now() - 30 * DAY, to: Date.now() + 60000, worker: w.id });
    const r = a.ratings.workers.find((x) => x.id === w.id);
    const state = currentWorkload(d.orders, d.users, d.worklogs).find((x) => x.id === w.id);
    return {
      name: w.name,
      spec: w.spec,
      brigade: w.brigade,
      now: state?.label,
      rating30d: r?.score ?? null,
      explanation: r?.explanation,
      closed30d: a.summary.closed,
    };
  },
  equipment_info(d: ToolContext, input: { name: string }) {
    const eq = findEquipment(d, input.name);
    if (!eq) return { error: 'Оборудование не найдено' };
    const a = analyze(d, { from: Date.now() - 91 * DAY, to: Date.now() + 60000, equipment: eq.id });
    const stats = a.equipment.find((e) => e.id === eq.id);
    return {
      name: eq.name,
      area: d.areas.find((x) => x.id === eq.area)?.name,
      last90days: stats
        ? {
            unplanned: stats.unplanned,
            planned: stats.planned,
            downtimeHours: stats.downtimeHours,
            byCode: stats.byCode,
          }
        : null,
      insights: a.insights.filter((i) => i.equipment === eq.id).map((i) => i.title + '. ' + i.recommendation),
      active: tools.active_orders(d, {}).filter((o) => o.equipment === eq.name),
    };
  },
};

const toolDefs: Anthropic.Beta.BetaTool[] = [
  {
    name: 'free_workers',
    description:
      'Исполнители на смене: кто свободен, кто занят. Можно отфильтровать по специальности (слесарь, электрик, сварщик).',
    input_schema: {
      type: 'object',
      properties: { specialty: { type: 'string' } },
      additionalProperties: false,
    },
  },
  {
    name: 'overdue_orders',
    description: 'Просроченные наряды прямо сейчас с исполнителем, статусом и последним комментарием.',
    input_schema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'active_orders',
    description: 'Текущие наряды (выданные, в работе, в очереди), можно по участку.',
    input_schema: { type: 'object', properties: { area: { type: 'string' } }, additionalProperties: false },
  },
  {
    name: 'period_report',
    description:
      'Отчёт за период (shift, day, week, month, quarter) по участку или оборудованию: показатели, закономерности, проблемное оборудование, лучшие исполнители.',
    input_schema: {
      type: 'object',
      properties: {
        period: { type: 'string', enum: ['shift', 'day', 'week', 'month', 'quarter'] },
        area: { type: 'string' },
        equipment: { type: 'string' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'worker_info',
    description: 'Сведения об исполнителе: текущая занятость и рейтинг за 30 дней с пояснением.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'equipment_info',
    description:
      'История оборудования за 90 дней: отказы по шифрам, простой, сигналы аналитики, текущие наряды.',
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string' } },
      required: ['name'],
      additionalProperties: false,
    },
  },
];

// ---------- Ответ по правилам (без модели) ----------
function detectPeriod(t: string) {
  if (/смен/.test(t)) return 'shift';
  if (/сутк|сегодня|день/.test(t)) return 'day';
  if (/квартал|3 месяц|три месяц|90/.test(t)) return 'quarter';
  if (/месяц/.test(t)) return 'month';
  return 'week';
}

function list(items: string[]) {
  return items.map((x) => '• ' + x).join('\n');
}

export function ruleAnswer(d: ToolContext, message: string): { text: string; used: string[] } {
  const t = norm(message);
  const specialty = /электрик/.test(t)
    ? 'Электрик'
    : /слесар/.test(t)
      ? 'Слесарь'
      : /сварщ/.test(t)
        ? 'Сварщик'
        : undefined;
  if (/свобод|кто (может|есть)|кого (назнач|отправ)|доступ/.test(t)) {
    const r = tools.free_workers(d, { specialty });
    const who = specialty ? specialty.toLowerCase() + 'ов' : 'исполнителей';
    if (!r.free.length)
      return {
        used: ['free_workers'],
        text: `Свободных ${who} на смене нет.\nЗаняты:\n${list(r.busy.map((w) => `${w.name} (${w.spec}) — ${w.state}`)) || '—'}`,
      };
    return {
      used: ['free_workers'],
      text: `Свободны (${r.free.length}):\n${list(r.free.map((w) => `${w.name} — ${w.spec}, бригада ${w.brigade}`))}`,
    };
  }
  if (/просроч/.test(t)) {
    const r = tools.overdue_orders(d);
    if (!r.length) return { used: ['overdue_orders'], text: 'Просроченных нарядов нет.' };
    return {
      used: ['overdue_orders'],
      text: `Просрочено ${r.length}:\n${list(r.map((o) => `№${o.number} ${o.equipment} — просрочен на ${o.overdueMinutes} мин, ${o.worker}, ${String(o.status).toLowerCase()}${o.lastComment ? `. «${o.lastComment}»` : ''}`))}`,
    };
  }
  const eq = findEquipment(d, message);
  if (eq && /истор|оборудован|что с |как |отказ|ломает|простой/.test(t) && !/отчет|сводк/.test(t)) {
    const r = tools.equipment_info(d, { name: message });
    if ('error' in r) return { used: ['equipment_info'], text: String(r.error) };
    const codes = Object.entries(r.last90days?.byCode || {})
      .sort((a: any, b: any) => b[1] - a[1])
      .slice(0, 3)
      .map(([c, n]) => `${c} — ${n}`);
    return {
      used: ['equipment_info'],
      text: `${r.name} (${r.area}). За 90 дней: внеплановых ${r.last90days?.unplanned ?? 0}, плановых ${r.last90days?.planned ?? 0}, простой ${r.last90days?.downtimeHours ?? 0} ч.${codes.length ? `\nЧастые шифры: ${codes.join(', ')}.` : ''}${r.insights.length ? '\n' + list(r.insights) : ''}${r.active.length ? `\nВ работе: ${r.active.map((o) => '№' + o.number).join(', ')}.` : ''}`,
    };
  }
  const worker = findWorker(d, message);
  if (worker && /рейтинг|как работает|оценк|кто такой|занят|где /.test(t)) {
    const r: any = tools.worker_info(d, { name: message });
    return {
      used: ['worker_info'],
      text: `${r.name} (${r.spec}, бригада ${r.brigade}). Сейчас: ${r.now}.\n${r.explanation || 'Закрытых нарядов за 30 дней нет.'}`,
    };
  }
  if (/отчет|сводк|итог|проблем|аномал|закономер|рейтинг|лучш|анализ|статист/.test(t)) {
    const r = tools.period_report(d, { period: detectPeriod(t), area: message, equipment: message });
    const s = r.summary;
    return {
      used: ['period_report'],
      text:
        `Отчёт за ${r.period}${r.equipment ? `, ${r.equipment}` : `, ${r.area}`}:\n` +
        `Выдано ${s.issued}, закрыто ${s.closed}, просрочено ${s.overdue}, отклонено ${s.rejected}. Реакция ${s.avgReactionMin} мин, в срок ${Math.round(s.onTimeShare * 100)}%, простой ${s.downtimeHours} ч.` +
        (r.insights.length
          ? `\nГлавное:\n${list(r.insights.map((i) => `${i.title}. ${i.recommendation}`))}`
          : '\nУстойчивых сигналов нет.') +
        (r.bestWorkers.length
          ? `\nЛучшие: ${r.bestWorkers.map((w) => `${w.name} ${w.score}`).join(', ')}.`
          : ''),
    };
  }
  if (/в работе|текущ|что делает|наряд/.test(t)) {
    const r = tools.active_orders(d, { area: message });
    return {
      used: ['active_orders'],
      text: r.length
        ? `Текущие наряды (${r.length}):\n${list(r.slice(0, 12).map((o) => `№${o.number} ${o.title} — ${o.worker}, ${String(o.status).toLowerCase()}, срок ${o.due}`))}`
        : 'Текущих нарядов нет.',
    };
  }
  return {
    used: [],
    text: 'Я отвечаю по данным смены. Спросите, например:\n• Кто сейчас свободен из электриков?\n• Что просрочено на смене?\n• Сформируй отчёт за неделю по участку обогащения\n• Что с конвейером К-3?\n• Какой рейтинг у Петрова?',
  };
}

// ---------- Ответ модели с инструментами ----------
const SYSTEM = `Ты — ИИ-ассистент мастера смены «НарядAI» на горно-обогатительном предприятии АО «Костанайские Минералы». Отвечай по-русски, коротко, по делу, языком цеха. Для любых фактов о людях, нарядах, оборудовании и статистике вызывай инструменты — не придумывай данные. Коды вида «Сотрудник-N» — обезличенные имена, оставляй их как есть. Списки оформляй строками с «•». Если просят отчёт — дай цифры и 2–3 главных вывода с рекомендацией. Решения принимает мастер.`;

export async function assistantAnswer(
  d: ToolContext,
  message: string,
  history: { role: 'user' | 'assistant'; text: string }[],
) {
  const { provider, model } = llmInfo();
  if (provider !== 'claude' || !model) {
    const r = ruleAnswer(d, message);
    return { ...r, mode: 'rules' as const };
  }
  // Обезличивание: имена → коды, обратно — в готовом ответе.
  const codes = new Map<string, string>();
  d.users.forEach((u, i) => codes.set(u.name, `Сотрудник-${i + 1}`));
  const surnames = d.users
    .map((u, i) => [u.name.split(' ')[1], `Сотрудник-${i + 1}`])
    .filter(([s]) => s && s.length > 2) as [string, string][];
  const mask = (text: string) => {
    let s = text;
    for (const [name, code] of codes) s = s.replaceAll(name, code);
    for (const [sur, code] of surnames)
      s = s.replace(new RegExp(sur.slice(0, -1) + '[а-яё]{0,3}', 'gi'), code);
    return s;
  };
  const unmask = (text: string) => {
    let s = text;
    for (const [name, code] of codes) s = s.replace(new RegExp(code + '(?!\\d)', 'g'), name);
    return s;
  };
  const resolve = (input: any) => {
    const out: any = { ...input };
    if (typeof out.name === 'string') out.name = unmask(out.name);
    return out;
  };
  const client = new Anthropic({ apiKey: (env as any).ANTHROPIC_API_KEY, maxRetries: 1, timeout: 60_000 });
  const messages: Anthropic.Beta.BetaMessageParam[] = [
    ...history.slice(-6).map((h) => ({ role: h.role, content: mask(h.text) })),
    { role: 'user', content: mask(message) },
  ];
  const used: string[] = [];
  for (let step = 0; step < 5; step++) {
    const response = await client.beta.messages.create({
      model,
      max_tokens: 4000,
      system: SYSTEM,
      tools: toolDefs,
      messages,
      output_config: { effort: 'low' },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    if (response.stop_reason === 'refusal') break;
    const calls = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use');
    if (response.stop_reason !== 'tool_use' || !calls.length) {
      const text = response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n')
        .trim();
      return { text: unmask(text) || ruleAnswer(d, message).text, used, mode: 'ai' as const, model };
    }
    messages.push({ role: 'assistant', content: response.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const call of calls) {
      used.push(call.name);
      let result: unknown;
      try {
        const fn = (tools as any)[call.name];
        result = fn ? fn(d, resolve(call.input)) : { error: 'Неизвестный инструмент' };
      } catch (e: any) {
        result = { error: e.message || 'Ошибка инструмента' };
      }
      results.push({ type: 'tool_result', tool_use_id: call.id, content: mask(JSON.stringify(result)) });
    }
    messages.push({ role: 'user', content: results });
  }
  const r = ruleAnswer(d, message);
  return { ...r, mode: 'rules' as const };
}
