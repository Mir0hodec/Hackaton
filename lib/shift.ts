// Время предприятия и смены. Костанай — UTC+5; расчёт не зависит от часового пояса
// сервера (Cloudflare работает в UTC) и устройства, на котором открыт отчёт.
export const ENTERPRISE_UTC_OFFSET = 5;
const OFFSET_MS = ENTERPRISE_UTC_OFFSET * 3600000;
export const DAY_SHIFT_START = 8;
export const NIGHT_SHIFT_START = 20;

/** Час (0–23) по местному времени предприятия. */
export const enterpriseHour = (time: number) => new Date(time + OFFSET_MS).getUTCHours();

/** Начало суток (00:00) по местному времени предприятия, как отметка UTC. */
export function enterpriseMidnight(time: number) {
  const d = new Date(time + OFFSET_MS);
  d.setUTCHours(0, 0, 0, 0);
  return d.getTime() - OFFSET_MS;
}

export const isNight = (time: number) => {
  const h = enterpriseHour(time);
  return h >= NIGHT_SHIFT_START || h < DAY_SHIFT_START;
};

export function shiftOf(time: number) {
  const midnight = enterpriseMidnight(time);
  const h = enterpriseHour(time);
  let start: number;
  let night = false;
  if (h >= DAY_SHIFT_START && h < NIGHT_SHIFT_START) start = midnight + DAY_SHIFT_START * 3600000;
  else {
    night = true;
    start =
      h < DAY_SHIFT_START
        ? midnight - (24 - NIGHT_SHIFT_START) * 3600000
        : midnight + NIGHT_SHIFT_START * 3600000;
  }
  return {
    start,
    end: start + 12 * 3600000,
    night,
    name: night ? 'Ночная смена 20:00–08:00' : 'Дневная смена 08:00–20:00',
  };
}

export const isNightTime = (iso: string) => isNight(Date.parse(iso));
