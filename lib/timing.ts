export function activeMinutes(o: any, until = Date.now()) {
  let total = Number(o.activeMs) || 0;
  if (o.activeSince) total += Math.max(0, until - Date.parse(o.activeSince));
  else if (!('activeMs' in o) && o.started)
    total = Math.max(0, (o.finished ? Date.parse(o.finished) : until) - Date.parse(o.started));
  return Math.round(total / 60000);
}
export function equipmentDowntime(o: any, until = Date.now()) {
  if (!o.downtimeStarted) return o.downtime || 0;
  return (
    (Number(o.previousDowntime) || 0) +
    Math.max(
      0,
      Math.round(
        ((o.downtimeEnded ? Date.parse(o.downtimeEnded) : until) - Date.parse(o.downtimeStarted)) / 60000,
      ),
    )
  );
}
export function stopWorkClock(o: any, now: string) {
  if (o.activeSince) {
    o.activeMs = (Number(o.activeMs) || 0) + Math.max(0, Date.parse(now) - Date.parse(o.activeSince));
    o.activeSince = null;
  }
}
