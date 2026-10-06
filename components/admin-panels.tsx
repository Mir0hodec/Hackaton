'use client';
// Административные блоки: демонстрационная история и пороги контроля сроков.
import { useState } from 'react';
import { Database, Timer } from 'lucide-react';

export function HistoryPanel({
  status,
  busy,
  onAction,
}: {
  status: any;
  busy: boolean;
  onAction: (body: any) => Promise<any>;
}) {
  const [result, setResult] = useState('');
  return (
    <section className="panel">
      <div className="section-title">
        <h2>
          <Database size={20} /> Демонстрационная история
        </h2>
      </div>
      <p className="muted">
        600+ синтетических нарядов за 90 дней с заложенными закономерностями для проверки аналитики: частые
        отказы конвейера, повторные поломки после ремонта, отказы после ППР, ночная смена, перерасход
        материалов, рост отказов. Справочники приводятся к демонстрационным, добавляются 13 исполнителей без
        права входа. Реальные наряды не затрагиваются.
      </p>
      {status ? (
        <p>
          Загружено {new Date(status.importedAt).toLocaleString('ru-RU')}: {status.orders} нарядов.
        </p>
      ) : (
        <p>История не загружена.</p>
      )}
      <div className="button-row">
        <button
          className="primary"
          disabled={busy}
          onClick={async () => {
            const r = await onAction({ action: 'history-import' });
            if (r) setResult(`Загружено ${r.orders} нарядов, добавлено сотрудников: ${r.createdUsers}.`);
          }}
        >
          {status ? 'Обновить историю' : 'Загрузить историю'}
        </button>
        {status && (
          <button
            disabled={busy}
            onClick={async () => {
              if (!window.confirm('Удалить все синтетические наряды истории? Реальные наряды останутся.'))
                return;
              const r = await onAction({ action: 'history-clear' });
              if (r) setResult(`Удалено нарядов: ${r.removed}.`);
            }}
          >
            Удалить историю
          </button>
        )}
      </div>
      {result && <p className="muted small">{result}</p>}
    </section>
  );
}

const fields: [string, string][] = [
  ['remindBeforeMin', 'Напоминание исполнителю до срока, мин'],
  ['acceptTimeoutMin', 'Эскалация мастеру, если наряд не принят, мин'],
  ['acceptTimeoutEmergencyMin', 'То же для аварийного наряда, мин'],
  ['repeatEveryMin', 'Повтор сообщения о просрочке, каждые N мин'],
  ['escalateManagerAfterMin', 'Уведомление руководителю при просрочке более, мин'],
];

export function SettingsPanel({
  settings,
  busy,
  onAction,
}: {
  settings: any;
  busy: boolean;
  onAction: (body: any) => Promise<any>;
}) {
  if (!settings) return null;
  return (
    <section className="panel">
      <h2>
        <Timer size={20} /> Контроль сроков
      </h2>
      <form
        key={JSON.stringify(settings)}
        className="form-grid"
        onSubmit={async (e) => {
          e.preventDefault();
          await onAction({ action: 'settings', data: Object.fromEntries(new FormData(e.currentTarget)) });
        }}
      >
        {fields.map(([key, label]) => (
          <label key={key}>
            {label}
            <input name={key} type="number" min="1" defaultValue={settings[key]} required />
          </label>
        ))}
        <button className="primary" disabled={busy}>
          Сохранить пороги
        </button>
      </form>
    </section>
  );
}
