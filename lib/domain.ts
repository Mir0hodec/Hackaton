import { activeMinutes } from './timing';
export const roles: any = {
  master: 'Мастер',
  worker: 'Исполнитель',
  manager: 'Руководитель',
  admin: 'Администратор',
};
export const statuses: any = {
  issued: 'Выдан',
  accepted: 'Принят',
  queued: 'В очереди',
  working: 'В работе',
  paused: 'Приостановлен',
  review: 'На проверке',
  rework: 'На доработке',
  closed: 'Закрыт',
  rejected: 'Отклонён',
  cancelled: 'Отменён',
};
export const priorities: any = {
  emergency: 'Аварийный',
  high: 'Высокий',
  normal: 'Обычный',
  planned: 'Плановый',
};
export const closed = (o: any) => ['closed', 'cancelled', 'rejected'].includes(o.status);
export const overdue = (o: any) => !closed(o) && Date.parse(o.due) < Date.now();
export function evaluate(o: any, report: any, duplicate = false) {
  const issues: string[] = [];
  if (!report.works?.trim() || report.works.trim().length < 12)
    issues.push('Недостаточно подробно описаны выполненные работы.');
  if (!report.code) issues.push('Не указан шифр неисправности.');
  if (o.type === 'unplanned' && !report.photos?.length)
    issues.push('Для внепланового ремонта требуется фото после выполнения.');
  if (duplicate)
    issues.push('Обнаружена повторная загрузка ранее использованного изображения. Нужна проверка мастером.');
  if (report.materials?.some((m: any) => m.qty > m.norm))
    issues.push('Расход материалов превышает справочный ориентир. Обоснуйте расход.');
  const mins = activeMinutes(o);
  if (mins < 1) issues.push('Время выполнения менее минуты. Мастеру следует проверить хронологию.');
  const score = Math.max(1, 5 - issues.length);
  return {
    score,
    issues,
    verdict: issues.some((x) => /требуется|Не указан|Недостаточно/.test(x))
      ? 'rework'
      : issues.length
        ? 'remarks'
        : 'accepted',
    minutes: mins,
    mode: 'rules',
    note: 'Автоматическая проверка по правилам. Смысловой анализ текста и содержимого фото внешней ИИ-моделью пока не подключён. Окончательное решение принимает мастер.',
  };
}
/** Число отказов от нарядов без уважительной причины (оценку причины ставит мастер). */
export function unjustifiedRejections(orders: any[], belongsWorker: (id: string) => boolean) {
  let count = 0;
  for (const o of orders) {
    if (o.rejections?.length)
      count += o.rejections.filter((r: any) => r.unjustified === true && belongsWorker(r.worker)).length;
    else if (o.status === 'rejected' && o.rejectionUnjustified === true && belongsWorker(o.worker)) count++;
  }
  return count;
}

const emptyRating = {
  score: 0,
  count: 0,
  quality: 0,
  onTime: 0,
  returns: 0,
  repeatCount: 0,
  volume: 0,
  penalty: 0,
  parts: { quality: 0, onTime: 0, returns: 0, volume: 0, penalty: 0 },
};

// Веса рейтинга (сумма 100): качество 50, сроки 30, без доработок и повторов 15, объём 5.
// Штраф −2 балла за каждый отказ без уважительной причины, не более −10.
export const ratingWeights = {
  quality: 50,
  onTime: 30,
  returns: 15,
  volume: 5,
  penaltyPerRejection: 2,
  maxPenalty: 10,
};

export function rating(orders: any[], id: string) {
  return ratingBy(
    orders,
    (o: any) => o.worker === id || o.members?.includes(id),
    (w) => w === id,
  );
}

/** Рейтинг бригады: те же составляющие по всем нарядам её участников. */
export function brigadeRating(orders: any[], users: any[], brigade: number) {
  const members = new Set(users.filter((u) => u.role === 'worker' && u.brigade === brigade).map((u) => u.id));
  return ratingBy(
    orders,
    (o: any) => members.has(o.worker) || o.members?.some((m: string) => members.has(m)),
    (w) => members.has(w),
  );
}

function ratingBy(orders: any[], belongs: (o: any) => boolean, belongsWorker: (id: string) => boolean) {
  const a = orders.filter((o) => belongs(o) && o.status === 'closed');
  const penalty = unjustifiedRejections(orders, belongsWorker);
  if (!a.length) return { ...emptyRating, penalty };
  const quality = a.reduce((s, o) => s + (o.masterScore ?? o.check?.score ?? 4), 0) / a.length;
  const onTime = a.filter((o) => Date.parse(o.finished || o.due) <= Date.parse(o.due)).length / a.length;
  const repeated = (o: any) =>
    orders.some(
      (next) =>
        next.id !== o.id &&
        next.equipment === o.equipment &&
        next.type === 'unplanned' &&
        !!o.report?.code &&
        next.report?.code === o.report?.code &&
        Date.parse(next.created) > Date.parse(o.closedAt || o.finished) &&
        Date.parse(next.created) - Date.parse(o.closedAt || o.finished) <= 7 * 86400000,
    );
  const repeatCount = a.filter(repeated).length;
  const returns = a.filter((o) => o.returned || repeated(o)).length / a.length;
  const volume = a.reduce((s, o) => s + (Number(o.complexity) || 1), 0);
  const w = ratingWeights;
  const parts = {
    quality: (quality / 5) * w.quality,
    onTime: onTime * w.onTime,
    returns: (1 - returns) * w.returns,
    volume: Math.min(volume / 30, 1) * w.volume,
    penalty: -Math.min(penalty * w.penaltyPerRejection, w.maxPenalty),
  };
  return {
    score: Math.max(
      0,
      Math.round(parts.quality + parts.onTime + parts.returns + parts.volume + parts.penalty),
    ),
    count: a.length,
    quality,
    onTime,
    returns,
    repeatCount,
    volume,
    penalty,
    parts,
  };
}

/** Часовой пояс предприятия для текстов уведомлений, которые формирует сервер. */
export const TZ = 'Asia/Qostanay';
export const formatServerTime = (iso: string) =>
  new Date(iso).toLocaleString('ru-RU', {
    timeZone: TZ,
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
export const formatServerClock = (iso: string) =>
  new Date(iso).toLocaleTimeString('ru-RU', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
