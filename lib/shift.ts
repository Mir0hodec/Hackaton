// Смены предприятия: дневная 08:00–20:00 и ночная 20:00–08:00 (по местному времени устройства/сервера).
export const DAY_SHIFT_START = 8;
export const NIGHT_SHIFT_START = 20;

export function shiftOf(time: number) {
  const d = new Date(time);
  const h = d.getHours();
  const start = new Date(d);
  start.setMinutes(0, 0, 0);
  let night = false;
  if (h >= DAY_SHIFT_START && h < NIGHT_SHIFT_START) start.setHours(DAY_SHIFT_START);
  else {
    night = true;
    if (h < DAY_SHIFT_START) start.setDate(start.getDate() - 1);
    start.setHours(NIGHT_SHIFT_START);
  }
  const end = start.getTime() + 12 * 3600000;
  return {
    start: start.getTime(),
    end,
    night,
    name: night ? 'Ночная смена 20:00–08:00' : 'Дневная смена 08:00–20:00',
  };
}

export const isNightTime = (iso: string) => shiftOf(Date.parse(iso)).night;
