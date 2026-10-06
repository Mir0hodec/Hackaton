/** Separate material, unit and dimension; never sum kilograms with pieces. */
export function materialUsage(
  orders: any[],
  dimension: 'material' | 'area' | 'equipment' | 'worker' = 'material',
) {
  const groups = new Map<string, any>();
  for (const o of orders) {
    if (['cancelled', 'rejected'].includes(o.status)) continue;
    for (const m of o.report?.materials || []) {
      const qty = Number(m.qty);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const group = dimension === 'material' ? '' : String(o[dimension] || '');
      const key = JSON.stringify([group, m.id || m.name, m.unit]);
      const row = groups.get(key) || {
        id: key,
        group,
        materialId: m.id,
        name: m.name,
        unit: m.unit,
        norm: m.norm,
        qty: 0,
        orderIds: new Set<string>(),
        overIds: new Set<string>(),
      };
      row.qty += qty;
      row.orderIds.add(o.id);
      if (qty > Number(m.norm)) row.overIds.add(o.id);
      groups.set(key, row);
    }
  }
  return [...groups.values()].map(({ orderIds, overIds, ...row }) => ({
    ...row,
    qty: Math.round(row.qty * 1000) / 1000,
    orders: orderIds.size,
    over: overIds.size,
  }));
}
