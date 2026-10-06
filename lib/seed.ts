// Начальное наполнение базы. Справочники и история берутся из генератора lib/history-seed.ts.
// В рабочей смене (WORKSPACE_MODE) история не создаётся автоматически: её загружает администратор
// кнопкой «Загрузить демонстрационную историю» (lib/history-import.ts), и её можно удалить.
import { catalogs, generateHistory, historyMasters, historyWorkers } from './history-seed';

export function makeSeed() {
  const { areas, equipment, codes, materials } = catalogs();
  // В демо-песочнице вход по ПИН-коду; в рабочей смене пользователи задаются INITIAL_USERS.
  const users: any[] = [
    ...historyMasters.map((m, i) => ({ ...m, pin: String(4101 + i) })),
    { id: 'manager', role: 'manager', name: 'Виктор Орлов', spec: 'Начальник участка', pin: '4301' },
    { id: 'admin', role: 'admin', name: 'Администратор', spec: 'Системный администратор', pin: '4401' },
    ...historyWorkers.map((w, i) => ({ ...w, onShift: i < 12, pin: String(4201 + i) })),
  ];
  const now = Date.now();
  const orders: any[] = generateHistory(now);
  // Несколько текущих нарядов, чтобы демо-смена не была пустой.
  const live: [string, string, string, string, string, number, string][] = [
    ['Течь масла на насосе', 'e0', 'worker1', 'emergency', 'issued', 45, 'Г-01'],
    ['Шум подшипника привода конвейера', 'e1', 'hw04', 'high', 'working', -25, 'М-02'],
    ['Заменить защитный кожух', 'e5', 'hw08', 'normal', 'queued', 150, 'М-03'],
    ['Плановый осмотр дробилки', 'e2', 'hw06', 'planned', 'accepted', 240, 'С-01'],
  ];
  live.forEach(([title, eq, worker, priority, status, dueMin], i) => {
    const e = equipment.find((x) => x.id === eq)!;
    const created = new Date(now - 3600000).toISOString();
    orders.push({
      id: 'live' + i,
      number: 2001 + i,
      title,
      description:
        i === 0
          ? 'Обнаружена течь масла в районе уплотнения. Устранить неисправность и проверить герметичность.'
          : 'Выполнить осмотр и устранить выявленную неисправность.',
      equipment: eq,
      area: e.area,
      worker,
      members: [worker],
      master: 'master',
      priority,
      type: priority === 'planned' ? 'planned' : 'unplanned',
      status,
      created,
      updatedAt: created,
      acceptedAt: status === 'issued' ? undefined : created,
      due: new Date(now + dueMin * 60000).toISOString(),
      started: status === 'working' ? new Date(now - 3000000).toISOString() : null,
      activeSince: status === 'working' ? new Date(now - 3000000).toISOString() : null,
      activeMs: 0,
      norm: 90,
      complexity: 1,
      photos: [],
      history: [{ at: created, actor: 'master', text: 'Наряд выдан' }],
    });
  });
  return { users, areas, equipment, codes, materials, orders };
}
