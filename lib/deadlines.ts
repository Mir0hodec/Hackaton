import { checkWorkDeadlines } from './workcards';
import { db, list } from './server';
import { namespace } from './context';
import { notifyUsers } from './web-push';
import { closed, statuses, formatServerClock } from './domain';
import { loadSettings } from './settings';
import { recommendWorkers } from './recommend';

const minutesText = (m: number) => {
  const total = Math.ceil(m);
  return total >= 60 ? `${Math.floor(total / 60)} ч ${total % 60} мин` : `${total} мин`;
};

/** Записывает уведомление адресатам один раз (по id) и возвращает true, если оно новое. */
export async function storeAlert(record: {
  id: string;
  order?: string;
  title: string;
  text: string;
  to: string[];
  emergency?: boolean;
  kind?: string;
}) {
  const value = { ...record, to: [...new Set(record.to.filter(Boolean))], created: new Date().toISOString() };
  const result = await db()
    .prepare('INSERT OR IGNORE INTO records(id,kind,data,version) VALUES(?,?,?,0)')
    .bind(namespace() + record.id, namespace() + 'alerts', JSON.stringify(value))
    .run();
  return !!result.meta.changes;
}

export async function checkDeadlines(origin: string) {
  const now = Date.now();
  const slot = Math.floor(now / 30000);
  const lock = await db()
    .prepare('INSERT OR IGNORE INTO records(id,kind,data,version) VALUES(?,?,?,0)')
    .bind(namespace() + 'deadline-tick:' + slot, namespace() + 'deadline-ticks', String(now))
    .run();
  if (!lock.meta.changes) return 0;
  const settings = await loadSettings();
  const [orders, users, equipment, areas, codes, worklogs] = await Promise.all(
    ['orders', 'users', 'equipment', 'areas', 'codes', 'worklogs'].map(list),
  );
  let created = await checkWorkDeadlines(origin);
  const recipients = new Set<string>();
  const name = (items: any[], id: string) => items.find((x) => x.id === id)?.name || id;
  for (const o of orders.filter((o) => !closed(o))) {
    const left = (Date.parse(o.due) - now) / 60000,
      age = (now - Date.parse(o.created)) / 60000;
    const assigned = o.members || [o.worker];
    const targets: { kind: string; title: string; to: string[]; body: string }[] = [];
    const since = o.status === 'working' && o.activeSince ? ` с ${formatServerClock(o.activeSince)}` : '';
    const context =
      `${name(equipment, o.equipment)}, ${name(areas, o.area)}. Исполнитель: ${name(users, o.worker)}. ` +
      `Статус: ${String(statuses[o.status]).toLowerCase()}${since}.` +
      (o.lastComment ? ` Последний комментарий: «${o.lastComment}».` : '');
    if (left <= settings.remindBeforeMin && left > 0)
      targets.push({
        kind: 'soon',
        title: `Наряд №${o.number}: до срока ${minutesText(left)}`,
        to: assigned,
        body: context,
      });
    if (left <= 0)
      targets.push({
        kind: 'late:' + Math.floor(-left / settings.repeatEveryMin),
        title: `Наряд №${o.number} просрочен на ${minutesText(-left)}`,
        to: [
          ...assigned,
          o.master,
          ...(left <= -settings.escalateManagerAfterMin
            ? users.filter((u) => u.role === 'manager').map((u) => u.id)
            : []),
        ],
        body: context,
      });
    const timeout =
      o.priority === 'emergency' ? settings.acceptTimeoutEmergencyMin : settings.acceptTimeoutMin;
    if (o.status === 'issued' && age >= timeout) {
      const best = recommendWorkers({
        orders,
        users,
        equipment,
        codes,
        worklogs,
        equipmentId: o.equipment,
        text: `${o.title} ${o.description || ''}`,
        exclude: assigned,
      }).ranked[0];
      targets.push({
        kind: 'unaccepted',
        title: `Наряд №${o.number} не принят за ${Math.floor(age)} мин`,
        to: [o.master],
        body:
          context +
          (best
            ? ` Предлагаемая замена: ${best.name} (${best.reasons.slice(0, 2).join(', ')}). Мастер проверяет допуск.`
            : ' Свободной замены на смене нет.'),
      });
    }
    for (const a of targets) {
      const fresh = await storeAlert({
        id: 'alert:' + o.id + ':' + a.kind,
        order: o.id,
        title: a.title,
        text: a.body,
        to: a.to,
        emergency: o.priority === 'emergency' || a.kind.startsWith('late'),
        kind: a.kind.split(':')[0],
      });
      if (fresh) {
        created++;
        a.to.forEach((x) => recipients.add(x));
      }
    }
  }
  await notifyUsers([...recipients], origin).catch(() => {});
  await db()
    .prepare('DELETE FROM records WHERE kind=? AND CAST(data AS INTEGER)<?')
    .bind(namespace() + 'deadline-ticks', now - 86400000)
    .run();
  return created;
}
