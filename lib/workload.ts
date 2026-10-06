// Текущая занятость исполнителей: та же логика, что в цветных статусах на панели мастера.
import { closed } from './domain';

export type WorkerState = 'free' | 'busy' | 'queue' | 'off';

export function currentWorkload(orders: any[], users: any[], worklogs: any[] = []) {
  const active = orders.filter((o) => !closed(o));
  return users
    .filter((u) => u.role === 'worker')
    .map((u) => {
      let state: WorkerState = 'free';
      let label = 'Свободен';
      if (u.disabled || !u.onShift) {
        state = 'off';
        label = u.disabled ? 'Заблокирован' : 'Не на смене';
      } else {
        const personal = worklogs
          .find((l: any) => l.id === u.id)
          ?.entries?.find((c: any) => c.status === 'active');
        const jobs = active.filter((o) => o.worker === u.id || o.members?.includes(u.id));
        const working = jobs.find((o) => o.status === 'working');
        if (working || personal) {
          state = 'busy';
          label = working ? `Выполняет №${working.number}` : 'Занят: ' + personal.title;
        } else if (jobs.length) {
          state = 'queue';
          label = `В очереди: ${jobs.length}`;
        }
      }
      return {
        id: u.id,
        name: u.name,
        spec: u.spec,
        brigade: u.brigade,
        onShift: !!u.onShift && !u.disabled,
        state,
        label,
      };
    });
}
