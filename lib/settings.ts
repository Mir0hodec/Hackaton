// Настраиваемые пороги контроля сроков (ТЗ 6.1). Хранятся одной записью в таблице records.
import { get, save } from './server';

export const defaultSettings = {
  remindBeforeMin: 30, // напоминание исполнителю до срока
  acceptTimeoutMin: 10, // эскалация мастеру, если наряд не принят
  acceptTimeoutEmergencyMin: 3, // то же для аварийного наряда
  repeatEveryMin: 30, // повтор сообщения о просрочке
  escalateManagerAfterMin: 120, // уведомление руководителю при длительной просрочке
};
export type Settings = typeof defaultSettings;

const limits: Record<keyof Settings, [number, number]> = {
  remindBeforeMin: [5, 240],
  acceptTimeoutMin: [1, 120],
  acceptTimeoutEmergencyMin: [1, 30],
  repeatEveryMin: [5, 240],
  escalateManagerAfterMin: [15, 1440],
};

export async function loadSettings(): Promise<Settings & { version?: number }> {
  const stored = await get('settings', 'main');
  return { ...defaultSettings, ...(stored || {}) };
}

export async function updateSettings(input: any) {
  const current: any = await get('settings', 'main');
  const next: any = { ...defaultSettings, ...(current || {}), id: 'main' };
  for (const key of Object.keys(limits) as (keyof Settings)[]) {
    if (input[key] === undefined || input[key] === '') continue;
    const value = Math.round(Number(input[key]));
    const [min, max] = limits[key];
    if (!Number.isFinite(value) || value < min || value > max)
      throw new Error(`Значение должно быть от ${min} до ${max} минут`);
    next[key] = value;
  }
  delete next.version;
  await save('settings', next, current ? current.version : undefined);
  return next as Settings;
}
