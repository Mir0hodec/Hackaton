// Аналитика истории нарядов (ТЗ 6.5, 6.6, 7): сводки, рейтинги, материалы, простои,
// поиск аномалий и прогноз отказов. Чистые функции без доступа к базе — их же вызывает
// ИИ-ассистент мастера. Каждый вывод — статистический сигнал с числами и рекомендацией.
import { brigadeRating, closed, rating, ratingWeights } from './domain';
import { activeMinutes, equipmentDowntime } from './timing';
import { materialUsage } from './material-usage';
import { isNight } from './shift';

const DAY = 86400000;
const PPR_WINDOW = 3 * DAY; // «вскоре после ППР»
export type Dataset = {
  orders: any[];
  users: any[];
  equipment: any[];
  areas: any[];
  codes: any[];
  materials?: any[];
};
export type Filters = {
  from: number;
  to: number;
  area?: string;
  equipment?: string;
  worker?: string;
  brigade?: number;
};

export type Insight = {
  id: string;
  kind: 'frequent' | 'repeat' | 'after_ppr' | 'shift' | 'worker' | 'materials' | 'trend' | 'downtime';
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  recommendation: string;
  equipment?: string;
  worker?: string;
  metric?: number;
  orderIds?: string[];
};

// Что проверить при повторяющемся шифре неисправности.
const codeAdvice: Record<string, string> = {
  'М-01': 'проверить биение вала и качество посадочных поверхностей под уплотнение',
  'М-02': 'проверить соосность привода, натяжение и качество смазки подшипниковых узлов',
  'М-03': 'проверить фундамент, балансировку и момент затяжки крепежа',
  'М-04': 'пересмотреть периодичность замены изнашиваемых элементов и материал футеровки',
  'Э-01': 'проверить трассу и защиту кабеля от механических повреждений и вибрации',
  'Э-02': 'проверить нагрузку и охлаждение двигателя, состояние подшипников и центровку',
  'Э-03': 'проверить пускорегулирующую аппаратуру и качество контактов в щите',
  'Э-04': 'проверить крепление и защиту датчика, условия эксплуатации',
  'Г-01': 'проверить уплотнения, давление и температуру масла в гидросистеме',
  'Г-02': 'проверить чистоту масла и фильтрацию, износ гидронасоса',
  'Г-03': 'проверить трассировку рукавов, радиусы изгиба и защиту от трения',
  'Г-04': 'проверить чистоту масла и состояние гидрораспределителя',
  'П-01': 'провести обход пневмосети на утечки',
  'П-02': 'проверить подготовку воздуха и состояние пневмоцилиндров',
  'П-03': 'проверить подготовку воздуха и клапаны',
  'П-04': 'проверить работу осушителя и слив конденсата',
  'С-01': 'пересмотреть карту смазки и периодичность обходов',
  'С-02': 'найти источник обводнения масла, проверить сапуны и уплотнения',
  'С-03': 'проверить станцию централизованной смазки и линии подачи',
  'С-04': 'проверить смазку и охлаждение узла, режим нагрузки',
};

const fmt1 = (n: number) => (Math.round(n * 10) / 10).toLocaleString('ru-RU');
const pct = (n: number) => Math.round(n * 100) + '%';
const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10,
    m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many;
};
const ts = (iso?: string | null) => (iso ? Date.parse(iso) : NaN);
const closedAt = (o: any) => ts(o.closedAt || o.finished);
const minutesBetween = (a?: string, b?: string) => (a && b ? (ts(b) - ts(a)) / 60000 : NaN);
const avg = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);

function filterOrders(d: Dataset, f: Filters) {
  const brigadeOf = new Map(d.users.map((u) => [u.id, u.brigade]));
  return d.orders.filter((o) => {
    const t = ts(o.created);
    if (!(t >= f.from && t < f.to)) return false;
    if (f.area && o.area !== f.area) return false;
    if (f.equipment && o.equipment !== f.equipment) return false;
    if (f.worker && o.worker !== f.worker && !o.members?.includes(f.worker)) return false;
    if (
      f.brigade &&
      (o.brigade
        ? Number(o.brigade) !== f.brigade
        : ![o.worker, ...(o.members || [])].some((id) => brigadeOf.get(id) === f.brigade))
    )
      return false;
    return true;
  });
}

export function summary(orders: any[], now = Date.now()) {
  const done = orders.filter((o) => o.status === 'closed');
  const reaction = orders.map((o) => minutesBetween(o.created, o.acceptedAt)).filter((x) => x >= 0);
  const completion = done
    .map((o) => minutesBetween(o.created, o.closedAt || o.finished))
    .filter((x) => x >= 0);
  const onTime = done.filter((o) => closedAt(o) <= ts(o.due) || ts(o.finished) <= ts(o.due)).length;
  const downtime = orders.reduce((s, o) => s + equipmentDowntime(o), 0);
  const scores = done.map((o) => o.masterScore ?? o.check?.score).filter((x) => x != null);
  return {
    issued: orders.length,
    closed: done.length,
    active: orders.filter((o) => !closed(o)).length,
    overdue: orders.filter((o) => !closed(o) && ts(o.due) < now).length,
    rejected: orders.filter((o) => o.status === 'rejected' || o.rejections?.length).length,
    cancelled: orders.filter((o) => o.status === 'cancelled').length,
    inReview: orders.filter((o) => o.status === 'review').length,
    unplanned: orders.filter((o) => o.type === 'unplanned').length,
    planned: orders.filter((o) => o.type === 'planned').length,
    emergency: orders.filter((o) => o.priority === 'emergency').length,
    avgReactionMin: Math.round(avg(reaction)),
    avgActiveMin: Math.round(avg(done.map((o) => activeMinutes(o)))),
    avgCompletionMin: Math.round(avg(completion)),
    onTimeShare: done.length ? onTime / done.length : 0,
    downtimeHours: Math.round(downtime / 6) / 10,
    avgScore: scores.length ? Math.round(avg(scores) * 10) / 10 : null,
  };
}

export function workload(d: Dataset, orders: any[]) {
  return d.users
    .filter((u) => u.role === 'worker')
    .map((u) => {
      const mine = orders.filter((o) => o.worker === u.id || o.members?.includes(u.id));
      const activeMin = mine.reduce((s, o) => s + (Number(o.activeMs) || 0) / 60000, 0);
      return {
        id: u.id,
        name: u.name,
        spec: u.spec,
        brigade: u.brigade,
        onShift: !!u.onShift,
        issued: mine.length,
        closed: mine.filter((o) => o.status === 'closed').length,
        active: mine.filter((o) => !closed(o)).length,
        activeHours: Math.round(activeMin / 6) / 10,
      };
    })
    .filter((w) => w.issued || w.onShift)
    .sort((a, b) => b.issued - a.issued);
}

export function ratings(d: Dataset, orders: any[]) {
  const workers = d.users
    .filter((u) => u.role === 'worker')
    .map((u) => ({ id: u.id, name: u.name, spec: u.spec, brigade: u.brigade, ...rating(orders, u.id) }))
    .filter((r) => r.count)
    .sort((a, b) => b.score - a.score);
  const brigades = [...new Set(d.users.filter((u) => u.role === 'worker').map((u) => Number(u.brigade) || 1))]
    .sort((a, b) => a - b)
    .map((b) => ({ brigade: b, ...brigadeRating(orders, d.users, b) }))
    .filter((r) => r.count);
  return { workers, brigades, weights: ratingWeights };
}

/** Пояснение рейтинга простым языком (ТЗ 6.6: «из чего сложился рейтинг»). */
export function explainRating(r: any, teamAvg?: { quality: number; onTime: number; returns: number }) {
  if (!r?.count) return 'Закрытых нарядов за период нет — рейтинг не рассчитан.';
  const parts = [
    `Качество ${fmt1(r.quality)}/5 даёт ${Math.round(r.parts.quality)} из ${ratingWeights.quality} баллов`,
    `в срок закрыто ${pct(r.onTime)} нарядов — ${Math.round(r.parts.onTime)} из ${ratingWeights.onTime}`,
    `без доработок и повторных отказов ${pct(1 - r.returns)} — ${Math.round(r.parts.returns)} из ${ratingWeights.returns}`,
    `объём с учётом сложности — ${Math.round(r.parts.volume)} из ${ratingWeights.volume}`,
  ];
  if (r.penalty) parts.push(`штраф за отказы без уважительной причины: ${Math.round(r.parts.penalty)}`);
  let advice = '';
  if (teamAvg) {
    if (r.returns > teamAvg.returns * 1.5 && r.returns > 0.1)
      advice = ' Больше всего баллов теряется на доработках: проверяйте результат пробным пуском до отчёта.';
    else if (r.onTime < teamAvg.onTime - 0.1)
      advice = ' Больше всего баллов теряется на сроках: сообщайте мастеру о задержках заранее.';
    else if (r.quality < teamAvg.quality - 0.3)
      advice = ' Резерв — качество: уточняйте у мастера замечания по отчётам.';
  }
  return `Рейтинг ${r.score}/100: ${parts.join('; ')}.${advice}`;
}

export function equipmentStats(d: Dataset, orders: any[]) {
  const codeName = new Map(d.codes.map((c) => [c.id, c.name]));
  return d.equipment
    .map((e) => {
      const mine = orders.filter(
        (o) => o.equipment === e.id && !['cancelled', 'rejected'].includes(o.status),
      );
      const unplanned = mine.filter((o) => o.type === 'unplanned');
      const byCode: Record<string, number> = {};
      for (const o of unplanned) if (o.report?.code) byCode[o.report.code] = (byCode[o.report.code] || 0) + 1;
      const [topCode, topCount] = Object.entries(byCode).sort((a, b) => b[1] - a[1])[0] || [null, 0];
      const downtimePlanned = mine
        .filter((o) => o.type === 'planned')
        .reduce((s, o) => s + equipmentDowntime(o), 0);
      const downtimeUnplanned = unplanned.reduce((s, o) => s + equipmentDowntime(o), 0);
      return {
        id: e.id,
        name: e.name,
        area: e.area,
        critical: !!e.critical,
        orders: mine.length,
        unplanned: unplanned.length,
        planned: mine.length - unplanned.length,
        downtimeHours: Math.round((downtimePlanned + downtimeUnplanned) / 6) / 10,
        downtimeUnplannedHours: Math.round(downtimeUnplanned / 6) / 10,
        downtimePlannedHours: Math.round(downtimePlanned / 6) / 10,
        topCode,
        topCodeName: topCode ? codeName.get(topCode) : null,
        topCodeCount: topCount,
        byCode,
      };
    })
    .filter((e) => e.orders)
    .sort((a, b) => b.unplanned - a.unplanned || b.downtimeHours - a.downtimeHours);
}

export function areaStats(d: Dataset, orders: any[]) {
  return d.areas
    .map((a) => {
      const mine = orders.filter((o) => o.area === a.id && !['cancelled', 'rejected'].includes(o.status));
      const unplanned = mine.filter((o) => o.type === 'unplanned');
      return {
        id: a.id,
        name: a.name,
        orders: mine.length,
        unplanned: unplanned.length,
        night: unplanned.filter((o) => isNight(ts(o.created))).length,
        day: unplanned.filter((o) => !isNight(ts(o.created))).length,
        downtimeHours: Math.round(mine.reduce((s, o) => s + equipmentDowntime(o), 0) / 6) / 10,
      };
    })
    .sort((a, b) => b.unplanned - a.unplanned);
}

export function materialStats(d: Dataset, orders: any[]) {
  const byArea = new Map<string, any>();
  const byWorker = new Map<string, any>();
  const deviations: any[] = [];
  const areaName = new Map(d.areas.map((a) => [a.id, a.name]));
  const userName = new Map(d.users.map((u) => [u.id, u.name]));
  const eqName = new Map(d.equipment.map((e) => [e.id, e.name]));
  for (const o of orders) {
    if (['cancelled', 'rejected'].includes(o.status)) continue;
    for (const m of o.report?.materials || []) {
      const over = m.qty > m.norm;
      const a = byArea.get(o.area) || { id: o.area, name: areaName.get(o.area) || o.area, lines: 0, over: 0 };
      a.lines++;
      if (over) a.over++;
      byArea.set(o.area, a);
      const w = byWorker.get(o.worker) || {
        id: o.worker,
        name: userName.get(o.worker) || o.worker,
        lines: 0,
        over: 0,
      };
      w.lines++;
      if (over) w.over++;
      byWorker.set(o.worker, w);
      if (over)
        deviations.push({
          order: o.id,
          number: o.number,
          material: m.name,
          qty: m.qty,
          unit: m.unit,
          norm: m.norm,
          ratio: Math.round((m.qty / m.norm) * 10) / 10,
          equipment: eqName.get(o.equipment) || o.equipment,
          worker: userName.get(o.worker) || o.worker,
        });
    }
  }
  return {
    materials: materialUsage(orders),
    byArea: materialUsage(orders, 'area').map((m) => ({ ...m, groupName: areaName.get(m.group) || m.group })),
    byEquipment: materialUsage(orders, 'equipment').map((m) => ({
      ...m,
      groupName: eqName.get(m.group) || m.group,
    })),
    byWorker: materialUsage(orders, 'worker').map((m) => ({
      ...m,
      groupName: userName.get(m.group) || m.group,
    })),
    areas: [...byArea.values()],
    workers: [...byWorker.values()].sort((a, b) => b.over - a.over),
    deviations: deviations.sort((a, b) => b.ratio - a.ratio).slice(0, 30),
  };
}

/** Повтор того же шифра на том же оборудовании в течение 7 дней после закрытия ремонта. */
function repeatsAfter(orders: any[]) {
  const unplanned = orders.filter(
    (o) => o.type === 'unplanned' && !['cancelled', 'rejected'].includes(o.status),
  );
  const result: { first: any; next: any }[] = [];
  for (const o of orders) {
    if (o.status !== 'closed' || o.type !== 'unplanned' || !o.report?.code) continue;
    const end = closedAt(o);
    const next = unplanned.find(
      (n) =>
        n.id !== o.id &&
        n.equipment === o.equipment &&
        n.report?.code === o.report.code &&
        ts(n.created) > end &&
        ts(n.created) - end <= 7 * DAY,
    );
    if (next) result.push({ first: o, next });
  }
  return result;
}

/** Поиск закономерностей. orders — наряды выбранного периода, now — граница для трендов. */
export function findInsights(d: Dataset, orders: any[], f: Filters): Insight[] {
  orders = orders.filter((o) => !['cancelled', 'rejected'].includes(o.status));
  const out: Insight[] = [];
  const eqName = new Map(d.equipment.map((e) => [e.id, e.name]));
  const codeName = new Map(d.codes.map((c) => [c.id, c.name]));
  const userName = new Map(d.users.map((u) => [u.id, u.name]));
  const days = Math.max(1, Math.round((Math.min(f.to, Date.now()) - f.from) / DAY));
  const unplanned = orders.filter(
    (o) => o.type === 'unplanned' && !['cancelled', 'rejected'].includes(o.status),
  );

  // 1. Частые поломки и большой простой.
  const eqStats = equipmentStats(d, orders);
  const eligibleEquipment = d.equipment.filter(
    (e) => (!f.equipment || e.id === f.equipment) && (!f.area || e.area === f.area),
  );
  const mean = unplanned.length / Math.max(1, eligibleEquipment.length);
  for (const e of eqStats
    .filter((e) => eligibleEquipment.length > 1 && e.unplanned >= Math.max(4, mean * 2))
    .slice(0, 3)) {
    const ratio = e.unplanned / Math.max(mean, 0.1);
    out.push({
      id: 'frequent:' + e.id,
      kind: 'frequent',
      severity: ratio >= 2.5 ? 'high' : 'medium',
      equipment: e.id,
      metric: e.unplanned,
      title: `${e.name}: частые внеплановые остановки`,
      detail:
        `${e.unplanned} ${plural(e.unplanned, 'внеплановый наряд', 'внеплановых наряда', 'внеплановых нарядов')} за ${days} дн. — в ${fmt1(ratio)} раза больше среднего по оборудованию (${fmt1(mean)}). ` +
        (e.topCode
          ? `${e.topCodeCount} из них — шифр ${e.topCode} (${String(e.topCodeName || '').toLowerCase()}). `
          : '') +
        `Простой: ${fmt1(e.downtimeUnplannedHours)} ч.`,
      recommendation: `Рекомендуем ${codeAdvice[e.topCode || ''] || 'разобрать причины повторяющихся остановок'} и включить узел в план ППР.`,
    });
  }

  // 2. Повтор одной неисправности: ремонт не устраняет причину.
  const repeats = repeatsAfter(orders);
  const repeatByEq = new Map<string, { first: any; next: any }[]>();
  for (const r of repeats)
    repeatByEq.set(r.first.equipment, [...(repeatByEq.get(r.first.equipment) || []), r]);
  for (const [eq, list] of [...repeatByEq.entries()]
    .filter(([, l]) => l.length >= 3)
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 2)) {
    const code = list[0].first.report.code;
    out.push({
      id: 'repeat:' + eq,
      kind: 'repeat',
      severity: list.length >= 6 ? 'high' : 'medium',
      equipment: eq,
      metric: list.length,
      title: `${eqName.get(eq)}: неисправность повторяется после ремонта`,
      detail: `${list.length} раз тот же шифр (${code} — ${String(codeName.get(code) || '').toLowerCase()}) повторился в течение 7 дней после закрытия ремонта.`,
      recommendation: `Повторный шифр — сигнал для проверки: проведите разбор первопричины — ${codeAdvice[code] || 'проверьте условия эксплуатации'}.`,
    });
  }

  // 3. Отказы вскоре после планового ремонта — сигнал о качестве ППР. Частота отказов в 3 дня
  // после ППР сравнивается с частотой в остальное время у того же оборудования.
  const periodEnd = Math.min(f.to, Date.now());
  const plannedDone = orders.filter((o) => o.type === 'planned' && o.status === 'closed');
  for (const e of d.equipment) {
    const pprs = plannedDone
      .filter((p) => p.equipment === e.id)
      .map(closedAt)
      .sort((a, b) => a - b);
    if (pprs.length < 3) continue;
    const windows: [number, number][] = [];
    for (const t of pprs) {
      const w: [number, number] = [t, Math.min(t + PPR_WINDOW, periodEnd)];
      const last = windows[windows.length - 1];
      if (last && w[0] <= last[1]) last[1] = Math.max(last[1], w[1]);
      else windows.push(w);
    }
    const inDays = windows.reduce((s, [a, b]) => s + (b - a), 0) / DAY;
    const outDays = Math.max(1, (periodEnd - f.from) / DAY - inDays);
    const mine = unplanned.filter((u) => u.equipment === e.id);
    const inside = mine.filter((u) => windows.some(([a, b]) => ts(u.created) > a && ts(u.created) <= b));
    const rateIn = inside.length / Math.max(1, inDays);
    const rateOut = (mine.length - inside.length) / outDays;
    const followed = pprs.filter((t) =>
      mine.some((u) => ts(u.created) > t && ts(u.created) - t <= PPR_WINDOW),
    ).length;
    if (inside.length >= 5 && followed / pprs.length >= 0.6 && rateIn >= 4 * Math.max(rateOut, 0.01)) {
      const codes: Record<string, number> = {};
      for (const u of inside) if (u.report?.code) codes[u.report.code] = (codes[u.report.code] || 0) + 1;
      const top = Object.entries(codes)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 2)
        .map(([c]) => c);
      out.push({
        id: 'after_ppr:' + e.id,
        kind: 'after_ppr',
        severity: 'high',
        equipment: e.id,
        metric: rateIn / Math.max(rateOut, 0.01),
        title: `${e.name}: отказы вскоре после ППР`,
        detail: `После ${followed} из ${pprs.length} плановых ремонтов в течение 3 дней последовал внеплановый отказ${top.length ? ` (${top.join(', ')})` : ''}. Частота отказов после ППР в ${fmt1(rateIn / Math.max(rateOut, 0.01))} раза выше, чем в остальное время.`,
        recommendation:
          'Проверьте состав и качество работ ППР на этом оборудовании, сборку и регулировку узлов, контрольный пуск после ремонта.',
      });
    }
  }

  // 4. Связь отказов со сменой (временем суток) по участкам.
  for (const a of areaStats(d, orders)) {
    if (a.unplanned < 10) continue;
    if (a.night >= a.day * 1.5)
      out.push({
        id: 'shift:' + a.id,
        kind: 'shift',
        severity: a.night >= a.day * 2 ? 'high' : 'medium',
        metric: a.night / Math.max(1, a.day),
        title: `${a.name}: ночью отказов больше`,
        detail: `Ночная смена — ${a.night} внеплановых нарядов, дневная — ${a.day} (в ${fmt1(a.night / Math.max(1, a.day))} раза больше).`,
        recommendation:
          'Проверьте режим загрузки оборудования и обходы ночной смены, укомплектованность ночных бригад.',
      });
    else if (a.day >= a.night * 1.8 && a.day >= 10)
      out.push({
        id: 'shift:' + a.id,
        kind: 'shift',
        severity: 'low',
        metric: a.day / Math.max(1, a.night),
        title: `${a.name}: днём отказов больше`,
        detail: `Дневная смена — ${a.day} внеплановых нарядов, ночная — ${a.night}.`,
        recommendation: 'Сопоставьте с графиком загрузки и технологических переключений.',
      });
  }

  // 5. Исполнители с частыми доработками и повторными отказами.
  const r = ratings(d, orders).workers.filter((w) => w.count >= 12);
  const teamReturns = avg(r.map((w) => w.returns));
  for (const w of r.filter((w) => w.returns >= Math.max(0.2, teamReturns * 2.5)).slice(0, 2))
    out.push({
      id: 'worker:' + w.id,
      kind: 'worker',
      severity: w.returns >= 0.3 ? 'high' : 'medium',
      worker: w.id,
      metric: w.returns,
      title: `${w.name}: частые доработки`,
      detail: `${pct(w.returns)} закрытых нарядов возвращались на доработку или с повторным отказом за 7 дней (в среднем по смене ${pct(teamReturns)}); повторов той же неисправности — ${w.repeatCount}.`,
      recommendation:
        'Назначьте наставника, разберите типовые ошибки и усилите приёмку его нарядов мастером.',
    });

  // 6. Аномальный расход материалов (бригады и исполнители).
  const brigadeOf = new Map(d.users.map((u) => [u.id, Number(u.brigade) || 1]));
  const brig = new Map<number, { lines: number; over: number }>();
  for (const o of orders)
    for (const m of o.report?.materials || []) {
      const b = Number(o.brigade) || brigadeOf.get(o.worker) || 1;
      const row = brig.get(b) || { lines: 0, over: 0 };
      row.lines++;
      if (m.qty > m.norm) row.over++;
      brig.set(b, row);
    }
  const shares = [...brig.entries()].map(([b, x]) => ({ b, share: x.over / Math.max(1, x.lines), ...x }));
  for (const s of shares) {
    const others = shares.filter((x) => x.b !== s.b);
    const rest =
      others.reduce((a, x) => a + x.over, 0) /
      Math.max(
        1,
        others.reduce((a, x) => a + x.lines, 0),
      );
    if (s.lines >= 20 && s.share >= 0.15 && s.share >= rest * 3)
      out.push({
        id: 'materials:brigade:' + s.b,
        kind: 'materials',
        severity: 'high',
        metric: s.share,
        title: `Бригада ${s.b}: перерасход материалов`,
        detail: `Списание выше справочного ориентира в ${pct(s.share)} позиций (${s.over} из ${s.lines}); у остальных бригад — ${pct(rest)}.`,
        recommendation:
          'Проверьте фактические остатки и обоснования списаний бригады, актуальность нормативов расхода.',
      });
  }

  // 7. Рост числа отказов — прогноз вероятного отказа: устойчивый рост три месяца подряд.
  const end = Math.min(f.to, Date.now());
  if (end - f.from >= 60 * DAY) {
    const trends = d.equipment
      .map((e) => {
        const mine = unplanned.filter((o) => o.equipment === e.id);
        const months = [2, 1, 0].map(
          (k) =>
            mine.filter(
              (o) => ts(o.created) >= end - (k + 1) * 30 * DAY && ts(o.created) < end - k * 30 * DAY,
            ).length,
        );
        return { e, months };
      })
      .filter(({ months: [m0, m1, m2] }) => m0 < m1 && m1 < m2 && m2 >= 7 && m2 >= 3 * Math.max(1, m0))
      .sort((a, b) => b.months[2] / Math.max(1, b.months[0]) - a.months[2] / Math.max(1, a.months[0]))
      .slice(0, 2);
    for (const { e, months } of trends) {
      const growth = months[2] / Math.max(1, months[1]);
      out.push({
        id: 'trend:' + e.id,
        kind: 'trend',
        severity: 'high',
        equipment: e.id,
        metric: growth,
        title: `${e.name}: растёт число отказов`,
        detail: `Внеплановые наряды по месяцам: ${months.join(' → ')}. Некалиброванная экстраполяция при сохранении тенденции: около ${Math.round(months[2] * growth)} отказов.`,
        recommendation:
          'Рост частоты требует проверки. Это не вероятность аварии; запланируйте диагностику (вибро- и термоконтроль) и уточните причины роста.',
      });
    }
  }

  // 8. Наибольший простой.
  const topDowntime = eqStats
    .filter((e) => e.downtimeUnplannedHours > 0)
    .sort((a, b) => b.downtimeUnplannedHours - a.downtimeUnplannedHours)[0];
  if (topDowntime && !out.some((i) => i.equipment === topDowntime.id))
    out.push({
      id: 'downtime:' + topDowntime.id,
      kind: 'downtime',
      severity: 'low',
      equipment: topDowntime.id,
      metric: topDowntime.downtimeUnplannedHours,
      title: `${topDowntime.name}: наибольший внеплановый простой`,
      detail: `${fmt1(topDowntime.downtimeUnplannedHours)} ч внепланового простоя за период.`,
      recommendation: 'Оцените запас запчастей и время реакции по этому оборудованию.',
    });

  const order = { high: 0, medium: 1, low: 2 };
  return out
    .sort((a, b) => order[a.severity] - order[b.severity])
    .map((i) => {
      let evidence = orders;
      if (i.kind === 'repeat')
        evidence = repeats.filter((r) => r.first.equipment === i.equipment).flatMap((r) => [r.first, r.next]);
      else if (i.kind === 'after_ppr')
        evidence = unplanned.filter(
          (u) =>
            u.equipment === i.equipment &&
            plannedDone.some(
              (p) =>
                p.equipment === u.equipment &&
                ts(u.created) > closedAt(p) &&
                ts(u.created) - closedAt(p) <= PPR_WINDOW,
            ),
        );
      else if (i.equipment) evidence = unplanned.filter((o) => o.equipment === i.equipment);
      else if (i.worker)
        evidence = orders.filter((o) => o.worker === i.worker || o.members?.includes(i.worker));
      else if (i.kind === 'shift') evidence = unplanned.filter((o) => o.area === i.id.slice('shift:'.length));
      else if (i.kind === 'materials')
        evidence = orders.filter(
          (o) =>
            (Number(o.brigade) || brigadeOf.get(o.worker) || 1) === Number(i.id.split(':').at(-1)) &&
            o.report?.materials?.some((m: any) => Number(m.qty) > Number(m.norm)),
        );
      return { ...i, orderIds: [...new Set(evidence.map((o) => o.id))].slice(0, 8) };
    });
}

export function analyze(d: Dataset, f: Filters) {
  const orders = filterOrders(d, f);
  const s = summary(orders);
  const insights = findInsights(d, orders, f);
  const evidenceIds = new Set(insights.flatMap((i) => i.orderIds || []));
  const r = ratings(d, orders);
  const team = {
    quality: avg(r.workers.map((w) => w.quality)),
    onTime: avg(r.workers.map((w) => w.onTime)),
    returns: avg(r.workers.map((w) => w.returns)),
  };
  return {
    period: { from: new Date(f.from).toISOString(), to: new Date(f.to).toISOString() },
    summary: s,
    workload: workload(d, orders),
    ratings: {
      ...r,
      workers: r.workers.map((w) => ({ ...w, explanation: explainRating(w, team) })),
      brigades: r.brigades.map((b) => ({ ...b, explanation: explainRating(b, team) })),
    },
    equipment: equipmentStats(d, orders).slice(0, 25),
    areas: areaStats(d, orders),
    materials: materialStats(d, orders),
    insights,
    evidenceOrders: orders.filter((o) => evidenceIds.has(o.id)).map((o) => ({ id: o.id, number: o.number })),
  };
}

/** Текстовая сводка без модели — запасной вариант и основа для промпта. */
export function narrative(a: ReturnType<typeof analyze>) {
  const s = a.summary;
  const lines = [
    `Выдано ${s.issued} ${plural(s.issued, 'наряд', 'наряда', 'нарядов')}, закрыто ${s.closed}, в работе ${s.active}, просрочено ${s.overdue}, отклонено ${s.rejected}.`,
    `Среднее время реакции — ${s.avgReactionMin} мин, выполнения — ${Math.round(s.avgCompletionMin / 6) / 10} ч; в срок закрыто ${pct(s.onTimeShare)}. Простой оборудования — ${fmt1(s.downtimeHours)} ч.`,
  ];
  const best = a.ratings.workers[0];
  if (best) lines.push(`Лучший результат: ${best.name} — ${best.score}/100.`);
  if (a.insights.length)
    lines.push(
      'Главное: ' +
        a.insights
          .slice(0, 3)
          .map((i) => i.title)
          .join('; ') +
        '.',
    );
  return lines.join(' ');
}
