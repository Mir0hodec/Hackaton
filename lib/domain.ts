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
// Какие материалы ожидаемы для категории шифра (М — механика, Э — электрика, Г — гидравлика,
// П — пневматика, С — смазка). Расходники общего назначения подходят к любому шифру.
const materialsByCategory: Record<string, RegExp> = {
  М: /подшипник|манжет|кольц|набивк|болт|гайк|шайб|лент|ролик|клей|футеров|смазк|муфт|ремен|электрод/i,
  Э: /кабел|наконечник|изолент|пускател|выключател|датчик|предохранител|муфт|подшипник|смазк/i,
  Г: /масл|рукав|фильтр|кольц|фитинг|ремкомплект|герметик|манжет/i,
  П: /пневмо|фильтр|влагоотдел|трубк|фитинг|кольц/i,
  С: /смазк|масл|трубк|фильтр/i,
};
const generalMaterials = /ветош|очистител|обезжирив/i;

/** Немедленная проверка отчёта по правилам (без внешней модели). Формирует и отчёт исполнителю. */
export function evaluate(o: any, report: any, duplicate = false, photoIssues: string[] = []) {
  const issues: string[] = [];
  const strengths: string[] = [];
  const improvements: string[] = [];
  const works = String(report.works || '').trim();
  if (works.length < 12) {
    issues.push('Недостаточно подробно описаны выполненные работы.');
    improvements.push(
      'Опишите, что именно сделано и как проверен результат (пробный пуск, отсутствие течи).',
    );
  } else strengths.push('Выполненные работы описаны.');
  if (!report.code) {
    issues.push('Не указан шифр неисправности.');
    improvements.push('Выберите шифр неисправности из справочника.');
  }
  if (o.type === 'unplanned' && !report.photos?.length) {
    issues.push('Для внепланового ремонта требуется фото после выполнения.');
    improvements.push('Приложите фото узла после ремонта.');
  } else if (report.photos?.length) strengths.push('Приложено фото после выполнения.');
  if (duplicate)
    issues.push('Обнаружена повторная загрузка ранее использованного изображения. Нужна проверка мастером.');
  issues.push(...photoIssues);
  const excess = (report.materials || []).filter((m: any) => m.qty > m.norm);
  if (excess.length) {
    issues.push(
      'Расход выше справочного ориентира: ' +
        excess.map((m: any) => `${m.name} — ${m.qty} ${m.unit} при ориентире ${m.norm}`).join('; ') +
        '. Обоснуйте расход.',
    );
    improvements.push('Указывайте фактический расход и причину превышения в комментарии.');
  }
  const category = String(report.code || '').charAt(0);
  const expected = materialsByCategory[category];
  const odd = expected
    ? (report.materials || []).filter((m: any) => !expected.test(m.name) && !generalMaterials.test(m.name))
    : [];
  if (odd.length)
    issues.push(
      `Материалы нетипичны для шифра ${report.code}: ${odd.map((m: any) => m.name).join(', ')}. Проверьте списание.`,
    );
  else if ((report.materials || []).length && !excess.length)
    strengths.push('Списанные материалы соответствуют работе.');
  const mins = activeMinutes(o);
  const norm = Number(o.norm) || 0;
  if (mins < 1) issues.push('Время выполнения менее минуты. Мастеру следует проверить хронологию.');
  else if (norm && mins > norm * 1.5) {
    issues.push(`Время выполнения ${mins} мин заметно выше норматива ${norm} мин.`);
    improvements.push('Если работа сложнее типовой, отметьте причину в комментарии.');
  } else if (norm && mins <= norm) strengths.push(`Уложились в норматив: ${mins} из ${norm} мин.`);
  if (o.due && Date.now() > Date.parse(o.due))
    improvements.push('Наряд закрыт после срока — сообщайте мастеру о задержке заранее.');
  const checks = [
    {
      id: 'works',
      label: 'Описание работ',
      status: works.length >= 12 ? 'pass' : 'fail',
      detail:
        works.length >= 12
          ? 'Выполненные работы описаны.'
          : 'Недостаточно подробно описаны выполненные работы.',
    },
    {
      id: 'code',
      label: 'Шифр неисправности',
      status: report.code ? 'pass' : 'fail',
      detail: report.code ? `Указан шифр ${report.code}.` : 'Не указан шифр неисправности.',
    },
    {
      id: 'photos',
      label: 'Фото после ремонта',
      status: o.type === 'planned' || report.photos?.length ? 'pass' : 'fail',
      detail: report.photos?.length
        ? `Приложено ${report.photos.length} фото. Наличие файла не подтверждает качество ремонта.`
        : o.type === 'planned'
          ? 'Для планового осмотра фото необязательно.'
          : 'Для внепланового ремонта требуется фото после выполнения.',
    },
    {
      id: 'materials',
      label: 'Расход материалов',
      status: excess.length || odd.length ? 'review' : 'pass',
      detail:
        excess.length || odd.length
          ? issues.filter((i) => /расход|материал/i.test(i)).join(' ')
          : 'Списанные количества не превышают справочные ориентиры; необходимость расхода проверяет мастер.',
    },
    {
      id: 'time',
      label: 'Время и норматив',
      status: mins < 1 || (norm && mins > norm * 1.5) ? 'review' : 'pass',
      detail: `Активное время ${mins} мин${norm ? `, норматив ${norm} мин (${Math.round((mins / norm) * 100)}%)` : ''}.`,
    },
    {
      id: 'visual',
      label: 'Визуальная проверка',
      status: 'review',
      detail:
        'По правилам проверено наличие фото и метаданные. Содержание изображений проверяет мастер или подключённая модель.',
    },
  ];
  const subjects = [
    { name: 'герметичность', re: /теч|масл|уплотн|гермет|проклад/i },
    { name: 'электрика', re: /электр|кабел|изоляц|напряж|ламп|замыкан/i },
    { name: 'подшипники и вибрация', re: /подшип|вибрац|гул|соос|баланс/i },
    { name: 'крепления', re: /болт|креп|ослаб|затяж/i },
  ];
  const problem = subjects.filter((s) => s.re.test(o.title + ' ' + (o.description || '')));
  const work = subjects.filter((s) => s.re.test(works));
  if (problem.length && work.length && !problem.some((p) => work.some((w) => w.name === p.name))) {
    const detail = `В проблеме: ${problem.map((x) => x.name).join(', ')}; в отчёте: ${work.map((x) => x.name).join(', ')}. Уточните, как работы устраняют исходную проблему. Это сигнал по ключевым словам, не смысловой анализ.`;
    checks.push({
      id: 'correspondence',
      label: 'Сопоставление по ключевым словам',
      status: 'review',
      detail,
    });
    issues.push(detail);
  }
  const verdict = issues.some((x) => /требуется|Не указан|Недостаточно/.test(x))
    ? 'rework'
    : issues.length
      ? 'remarks'
      : 'accepted';
  const score = Math.max(
    1,
    Math.min(5 - issues.length, verdict === 'rework' ? 2 : verdict === 'remarks' ? 4 : 5),
  );
  return {
    score,
    checks,
    needsMasterCheck: true,
    issues,
    verdict,
    minutes: mins,
    norm,
    strengths,
    improvements,
    summaryForWorker:
      verdict === 'rework'
        ? 'Отчёт возвращён: исправьте замечания и отправьте снова.'
        : verdict === 'remarks'
          ? 'Отчёт принят на проверку с замечаниями. Окончательную оценку поставит мастер.'
          : 'Отчёт заполнен полностью. Окончательную оценку поставит мастер.',
    mode: 'rules',
    note: 'Формальная проверка по правилам: полнота, фото, материалы, время. Окончательное решение принимает мастер.',
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
    (o: any) =>
      o.brigade
        ? o.brigade === brigade
        : members.has(o.worker) || o.members?.some((m: string) => members.has(m)),
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
        o.type === 'unplanned' &&
        next.id !== o.id &&
        next.equipment === o.equipment &&
        next.type === 'unplanned' &&
        !['cancelled', 'rejected'].includes(next.status) &&
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
