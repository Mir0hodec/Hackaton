import { closed } from './domain';
export const wasQueued = (o: any) =>
  !!o.queuedAt || !!o.history?.some((h: any) => h.text?.startsWith('Поставлен в очередь'));
export function queueHead(orders: any[], worker: string) {
  return (
    orders
      .filter(
        (o) =>
          !closed(o) &&
          (o.status === 'queued' || (o.status === 'accepted' && wasQueued(o))) &&
          (o.worker === worker || o.members?.includes(worker)),
      )
      .sort((a, b) => {
        const time = (o: any) =>
          Date.parse(
            o.queuedAt ||
              o.history?.findLast((h: any) => h.text?.startsWith('Поставлен в очередь'))?.at ||
              o.created,
          );
        return (
          time(a) - time(b) || Number(a.number) - Number(b.number) || String(a.id).localeCompare(String(b.id))
        );
      })[0] || null
  );
}
