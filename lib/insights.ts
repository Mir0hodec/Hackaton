export function insights(orders: any[], equipment: any[]) {
  const result: { title: string; detail: string; recommendation: string }[] = [];
  const unplanned = orders.filter((o) => o.type === 'unplanned');
  const counts = equipment.map((eq) => ({
    ...eq,
    count: unplanned.filter((o) => o.equipment === eq.id).length,
  }));
  const average = unplanned.length / Math.max(1, equipment.length);
  for (const eq of counts
    .filter((eq) => eq.count >= 3 && eq.count >= average * 2)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)) {
    result.push({
      title: eq.name + ': частые неисправности',
      detail: `${eq.count} внеплановых нарядов; среднее по оборудованию за выбранный период — ${average.toFixed(1)}.`,
      recommendation:
        'Проверьте повторяющиеся шифры и включите обследование причины в план ремонта. Это статистический сигнал, а не установленная причина.',
    });
  }
  let afterPlanned = 0;
  for (const o of unplanned) {
    if (
      orders.some(
        (p) =>
          p.type === 'planned' &&
          p.equipment === o.equipment &&
          p.status === 'closed' &&
          Date.parse(o.created) > Date.parse(p.closedAt || p.finished) &&
          Date.parse(o.created) - Date.parse(p.closedAt || p.finished) <= 7 * 86400000,
      )
    )
      afterPlanned++;
  }
  if (afterPlanned)
    result.push({
      title: 'Отказы после планового ремонта',
      detail: `${afterPlanned} внеплановых нарядов появились в течение 7 дней после планового ремонта.`,
      recommendation:
        'Сопоставьте состав плановых работ с последующей неисправностью; проверьте качество контрольного пуска.',
    });
  const excess = orders.filter((o) => o.report?.materials?.some((m: any) => m.qty > m.norm));
  if (excess.length)
    result.push({
      title: 'Расход выше справочника',
      detail: `В ${excess.length} отчётах превышен справочный ориентир хотя бы по одному материалу.`,
      recommendation:
        'Попросите обоснование расхода и проверьте актуальность нормативов. Само превышение не доказывает нарушение.',
    });
  const repeats = orders.filter(
    (o) =>
      o.status === 'closed' &&
      o.report?.code &&
      unplanned.some(
        (n) =>
          n.id !== o.id &&
          n.equipment === o.equipment &&
          n.report?.code === o.report.code &&
          Date.parse(n.created) > Date.parse(o.closedAt || o.finished) &&
          Date.parse(n.created) - Date.parse(o.closedAt || o.finished) <= 7 * 86400000,
      ),
  );
  if (repeats.length)
    result.push({
      title: 'Повтор одной неисправности',
      detail: `${repeats.length} ремонтов сопровождались повтором того же шифра на том же оборудовании в течение 7 дней.`,
      recommendation:
        'Проведите разбор первопричины и проверьте условия эксплуатации, а не только заменённую деталь.',
    });
  return result;
}
