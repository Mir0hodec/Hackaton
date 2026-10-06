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
export function rating(orders: any[], id: string) {
  const belongs = (o: any) => o.worker === id || o.members?.includes(id);
  const a = orders.filter((o) => belongs(o) && o.status === 'closed');
  if (!a.length) return { score: 0, count: 0, quality: 0, onTime: 0, returns: 0, repeatCount: 0, volume: 0 };
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
  const penalty = orders.filter(
    (o) => belongs(o) && o.status === 'rejected' && o.rejectionUnjustified === true,
  ).length;
  return {
    score: Math.max(
      0,
      Math.round(
        (quality / 5) * 50 +
          onTime * 30 +
          (1 - returns) * 15 +
          Math.min(volume / 30, 1) * 5 -
          Math.min(penalty * 2, 10),
      ),
    ),
    count: a.length,
    quality,
    onTime,
    returns,
    repeatCount,
    volume,
  };
}
