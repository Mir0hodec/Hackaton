// Подсказки мастеру при выдаче наряда:
//  • шифр неисправности и норматив времени по тексту описания (ключевые слова);
//  • подбор исполнителя: доступность, специальность, опыт на этом оборудовании, рейтинг, очередь.
// Это прозрачная скоринговая модель на истории нарядов: каждое слагаемое объясняется мастеру,
// решение о назначении остаётся за ним.
import { closed, rating } from './domain';

const keywordCodes: [RegExp, string][] = [
  [/станци[яи] смазк|централизованн/i, 'С-03'],
  [/течь|подтек|утечк[аи] масл|масл[оа] теч/i, 'Г-01'],
  [/рвд|рукав/i, 'Г-03'],
  [/гидронасос|давлени[ея] в гидро/i, 'Г-02'],
  [/гидрораспредел/i, 'Г-04'],
  [/подшипник|гул|шум|нагрев/i, 'М-02'],
  [/вибрац|крепл|болт|разболт/i, 'М-03'],
  [/уплотн|сальник|манжет/i, 'М-01'],
  [/лент[аыу]|футеровк|износ/i, 'М-04'],
  [/кабел|изоляц|провод/i, 'Э-01'],
  [/двигател|электродвиг|мотор/i, 'Э-02'],
  [/пускател|не запуска|автомат|щит/i, 'Э-03'],
  [/датчик|кип|сигнал/i, 'Э-04'],
  [/воздух|пневмосет|травит/i, 'П-01'],
  [/пневмоцилиндр/i, 'П-02'],
  [/клапан|пневмораспредел/i, 'П-03'],
  [/фильтр|влагоотдел|конденсат/i, 'П-04'],
  [/перегрев/i, 'С-04'],
  [/загрязн|обводн|грязн[оа]е масл/i, 'С-02'],
  [/смазк|скрип|сух/i, 'С-01'],
];

/** Наиболее вероятный шифр по описанию проблемы, или null. */
export function suggestCode(text: string, codes: any[]) {
  for (const [pattern, id] of keywordCodes) {
    if (pattern.test(text || '')) {
      const code = codes.find((c) => c.id === id);
      if (code) return { id: code.id, name: code.name, norm: Number(code.norm) || 90 };
    }
  }
  return null;
}

export function specialtyForCode(code: string | null | undefined) {
  if (!code) return null;
  if (code.startsWith('Э')) return 'Электрик';
  if (code === 'М-04') return 'Сварщик';
  return 'Слесарь';
}

const typeByName: [RegExp, string][] = [
  [/насос/i, 'pump'],
  [/конвейер|перегружат/i, 'conveyor'],
  [/дробилк/i, 'crusher'],
  [/мельниц/i, 'mill'],
  [/компрессор/i, 'compressor'],
  [/электродвиг|двигател/i, 'motor'],
  [/подстанц|трансформ/i, 'electrical'],
];

export function equipmentType(eq: any) {
  if (eq?.type) return eq.type;
  return typeByName.find(([re]) => re.test(eq?.name || ''))?.[1] || 'other';
}

const sameSpecialty = (worker: any, spec: string | null) =>
  !!spec &&
  String(worker.spec || '')
    .toLowerCase()
    .startsWith(spec.toLowerCase().slice(0, 5));

const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10,
    m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many;
};

export type Recommendation = {
  id: string;
  name: string;
  spec: string;
  score: number;
  available: string;
  reasons: string[];
};

/**
 * Ранжирует исполнителей смены для нового наряда.
 * Баллы: доступность до 40, специальность 25, опыт на оборудовании до 20, рейтинг до 10, разряд до 5.
 */
export function recommendWorkers(input: {
  orders: any[];
  users: any[];
  equipment: any[];
  codes: any[];
  worklogs?: any[];
  equipmentId: string;
  text?: string;
  exclude?: string[];
}): { code: ReturnType<typeof suggestCode>; specialty: string | null; ranked: Recommendation[] } {
  const { orders, users, equipment, codes, worklogs = [] } = input;
  const eq = equipment.find((e) => e.id === input.equipmentId);
  const code = suggestCode(input.text || '', codes);
  // Если по тексту шифр не ясен — берём самую частую категорию неисправностей этого оборудования.
  let specialty = specialtyForCode(code?.id);
  if (!specialty && eq) {
    const counts: Record<string, number> = {};
    for (const o of orders)
      if (o.equipment === eq.id && o.report?.code) {
        const s = specialtyForCode(o.report.code)!;
        counts[s] = (counts[s] || 0) + 1;
      }
    specialty = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'Слесарь';
  }
  const type = equipmentType(eq);
  const typeName = eq?.name?.split(' ')[0]?.toLowerCase() || 'оборудовании';
  const sameType = new Set(equipment.filter((e) => equipmentType(e) === type).map((e) => e.id));
  const active = orders.filter((o) => !closed(o));

  const ranked: Recommendation[] = users
    .filter((w) => w.role === 'worker' && w.onShift && !w.disabled && !input.exclude?.includes(w.id))
    .map((w) => {
      const reasons: string[] = [];
      let score = 0;
      const jobs = active.filter((o) => o.worker === w.id || o.members?.includes(w.id));
      const working = jobs.find((o) => o.status === 'working');
      const personal = worklogs
        .find((l: any) => l.id === w.id)
        ?.entries?.find((c: any) => c.status === 'active');
      let available = 'Свободен';
      if (working || personal) {
        available = working ? `Выполняет №${working.number}` : 'Занят';
        score += 5;
        reasons.push(working ? `занят нарядом №${working.number}` : 'занят текущей работой');
      } else if (jobs.length) {
        available = `В очереди: ${jobs.length}`;
        score += Math.max(10, 30 - jobs.length * 8);
        reasons.push(`в очереди ${jobs.length} ${plural(jobs.length, 'наряд', 'наряда', 'нарядов')}`);
      } else {
        score += 40;
        reasons.push('свободен');
      }
      if (sameSpecialty(w, specialty)) {
        score += 25;
        reasons.push(`${String(w.spec).toLowerCase()} — нужная специальность`);
      } else if (specialty)
        reasons.push(`специальность «${w.spec || '—'}», нужен ${specialty.toLowerCase()}`);

      const done = orders.filter(
        (o) => o.status === 'closed' && (o.worker === w.id || o.members?.includes(w.id)),
      );
      const onThis = done.filter((o) => o.equipment === input.equipmentId);
      const onType = done.filter((o) => sameType.has(o.equipment));
      if (onType.length) {
        const avg = onType.reduce((s, o) => s + (o.masterScore ?? o.check?.score ?? 4), 0) / onType.length;
        score += Math.min(20, onType.length * 1.5) * (avg / 5);
        reasons.push(
          onThis.length
            ? `${onThis.length} ${plural(onThis.length, 'ремонт', 'ремонта', 'ремонтов')} этого оборудования, средняя оценка ${avg.toFixed(1)}`
            : `${onType.length} ${plural(onType.length, 'ремонт', 'ремонта', 'ремонтов')} похожего оборудования (${typeName}), средняя оценка ${avg.toFixed(1)}`,
        );
      }
      const r = rating(orders, w.id);
      if (r.count) {
        score += (r.score / 100) * 10;
        reasons.push(`рейтинг ${r.score}/100`);
      }
      score += Math.min(5, Number(w.grade) || 0);
      return { id: w.id, name: w.name, spec: w.spec || '', score: Math.round(score), available, reasons };
    })
    .sort((a, b) => b.score - a.score);
  return { code, specialty, ranked };
}
