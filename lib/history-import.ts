// Загрузка и удаление демонстрационной истории за 90 дней в рабочей смене (действие администратора).
// Все записи помечены synthetic: true и не смешиваются с реальными нарядами при удалении.
import { db, get } from './server';
import { namespace } from './context';
import { catalogs, generateHistory, historyMasters, historyWorkers } from './history-seed';

async function batch(statements: D1PreparedStatement[]) {
  for (let i = 0; i < statements.length; i += 50) await db().batch(statements.slice(i, i + 50));
}

export async function importHistory() {
  const ns = namespace();
  const statements: D1PreparedStatement[] = [];
  // Справочники приводятся к демонстрационным (id совпадают с исходными примерами).
  for (const [kind, items] of Object.entries(catalogs())) {
    for (const item of items as any[])
      statements.push(
        db()
          .prepare(
            'INSERT INTO records(id,kind,data,version) VALUES(?,?,?,0) ON CONFLICT(id) DO UPDATE SET data=excluded.data,version=records.version+1',
          )
          .bind(ns + kind + ':' + item.id, ns + kind, JSON.stringify(item)),
      );
  }
  // Сотрудники истории: реальные учётки worker1/worker2/master сохраняются, недостающие
  // создаются без пароля (войти под ними нельзя) и не выводятся на смену.
  let createdUsers = 0;
  for (const person of [...historyMasters, ...historyWorkers]) {
    const existing = await get('users', person.id);
    if (existing) {
      const patch: any = { ...existing };
      if (!existing.spec) patch.spec = person.spec;
      if (!existing.grade && person.grade) patch.grade = person.grade;
      if (!existing.brigade && person.brigade) patch.brigade = person.brigade;
      delete patch.version;
      statements.push(
        db()
          .prepare('UPDATE records SET data=?,version=version+1 WHERE id=?')
          .bind(JSON.stringify(patch), ns + 'users:' + person.id),
      );
    } else {
      createdUsers++;
      statements.push(
        db()
          .prepare('INSERT OR IGNORE INTO records(id,kind,data,version) VALUES(?,?,?,0)')
          .bind(
            ns + 'users:' + person.id,
            ns + 'users',
            JSON.stringify({ ...person, synthetic: true, onShift: false, created: new Date().toISOString() }),
          ),
      );
    }
  }
  const orders = generateHistory(Date.now());
  for (const o of orders)
    statements.push(
      db()
        .prepare('INSERT OR IGNORE INTO records(id,kind,data,version) VALUES(?,?,?,0)')
        .bind(ns + 'orders:' + o.id, ns + 'orders', JSON.stringify(o)),
    );
  await batch(statements);
  await db()
    .prepare(
      'INSERT INTO records(id,kind,data,version) VALUES(?,?,?,0) ON CONFLICT(id) DO UPDATE SET data=excluded.data',
    )
    .bind(
      ns + 'meta:history',
      ns + 'meta',
      JSON.stringify({ importedAt: new Date().toISOString(), orders: orders.length }),
    )
    .run();
  return { orders: orders.length, createdUsers };
}

export async function clearHistory() {
  const ns = namespace();
  const r = await db()
    .prepare("DELETE FROM records WHERE kind=? AND json_extract(data,'$.synthetic')=1")
    .bind(ns + 'orders')
    .run();
  await db()
    .prepare('DELETE FROM records WHERE id=?')
    .bind(ns + 'meta:history')
    .run();
  return { removed: r.meta.changes || 0 };
}

export async function historyStatus() {
  const r: any = await db()
    .prepare('SELECT data FROM records WHERE id=?')
    .bind(namespace() + 'meta:history')
    .first();
  return r ? JSON.parse(r.data) : null;
}
