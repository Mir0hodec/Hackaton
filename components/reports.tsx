'use client';
// Отчёты и аналитика (ТЗ 6.5, 6.6, 7) и дашборд руководителя. Данные считает сервер (/api/analytics).
import { useEffect, useMemo, useState } from 'react';
import {
  Download,
  FileText,
  Sparkles,
  TriangleAlert,
  TrendingUp,
  Users,
  Factory,
  Clock,
  ClipboardCheck,
  Timer,
  RefreshCw,
} from 'lucide-react';
import { reportSheets } from '../lib/report-export';
import { createXlsxBook } from '../lib/xlsx';
import { shiftOf } from '../lib/shift';
import { t } from '../lib/i18n';

const DAY = 86400000;
export const periods: [string, string][] = [
  ['shift', 'Текущая смена'],
  ['day', 'Сутки'],
  ['week', 'Неделя'],
  ['month', 'Месяц'],
  ['quarter', '3 месяца'],
  ['custom', 'Свой период'],
];

export function periodRange(period: string, fromDate?: string, toDate?: string) {
  const now = Date.now();
  if (period === 'shift') {
    const s = shiftOf(now);
    return { from: s.start, to: s.end, label: s.name };
  }
  if (period === 'custom' && fromDate) {
    const from = Date.parse(fromDate + 'T00:00:00+05:00');
    const to = toDate ? Date.parse(toDate + 'T00:00:00+05:00') + DAY : now + 60000;
    return { from, to, label: `${fromDate} — ${toDate || 'сегодня'}` };
  }
  const days = { day: 1, week: 7, month: 30, quarter: 91 }[period as 'day'] || 30;
  return { from: now - days * DAY, to: now + 60000, label: periods.find(([k]) => k === period)?.[1] || '' };
}

export function useAnalytics(
  api: string,
  query: Record<string, string | number | undefined>,
  enabled = true,
) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const qs = new URLSearchParams(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== '') as [string, string][],
  ).toString();
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    setError('');
    fetch(`${api}?${qs}`, { cache: 'no-store' })
      .then(async (r) => {
        const d: any = await r.json();
        if (!r.ok) throw new Error(d.error || 'Ошибка отчёта');
        if (!cancelled) setData(d);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [api, qs, enabled, nonce]);
  return { data, loading, error, reload: () => setNonce((n) => n + 1) };
}

const pct = (x: number) => Math.round((x || 0) * 100) + '%';
const hours = (min: number) => (min >= 90 ? `${Math.round(min / 6) / 10} ч` : `${Math.round(min)} мин`);
const severityName = { high: 'Важно', medium: 'Внимание', low: 'Сведения' } as Record<string, string>;
const kindIcon = (kind: string) =>
  kind === 'trend' ? (
    <TrendingUp size={18} />
  ) : kind === 'worker' ? (
    <Users size={18} />
  ) : (
    <TriangleAlert size={18} />
  );

// Цвета составляющих рейтинга — проверенная палитра (CSS-переменные --series-1…4, светлая и тёмная).
const ratingParts: [string, string, string][] = [
  ['quality', 'Качество', 'var(--series-1)'],
  ['onTime', 'Сроки', 'var(--series-2)'],
  ['returns', 'Без доработок', 'var(--series-3)'],
  ['volume', 'Объём', 'var(--series-4)'],
];

function RatingBar({ parts, max = 100 }: { parts: any; max?: number }) {
  return (
    <div
      className="stack-bar"
      role="img"
      aria-label={ratingParts.map(([k, l]) => `${l} ${Math.round(parts[k])}`).join(', ')}
    >
      {ratingParts.map(([k, label, color]) => (
        <span
          key={k}
          className="seg"
          style={{ width: `${(Math.max(0, parts[k]) / max) * 100}%`, background: color }}
          data-tip={`${label}: ${Math.round(parts[k])} балл.`}
        />
      ))}
    </div>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="chart-legend">
      {items.map(([label, color]) => (
        <span key={label}>
          <i style={{ background: color }} />
          {label}
        </span>
      ))}
    </div>
  );
}

export function InsightList({
  insights,
  onPick,
  evidenceOrders = [],
  onOpenOrder,
}: {
  insights: any[];
  onPick?: (i: any) => void;
  evidenceOrders?: any[];
  onOpenOrder?: (id: string) => void;
}) {
  if (!insights?.length)
    return (
      <p className="muted">
        Устойчивых сигналов за период не выявлено. При небольшой истории выводы ограничены.
      </p>
    );
  return (
    <div className="insight-list">
      {insights.map((i) => (
        <article key={i.id} className={'insight-card sev-' + i.severity}>
          <header>
            {kindIcon(i.kind)}
            <span className="sev">{severityName[i.severity]}</span>
            <h3>{i.title}</h3>
          </header>
          <p>{i.detail}</p>
          <p className="recommendation">
            <b>Рекомендация:</b> {i.recommendation}
          </p>
          {!!i.orderIds?.length && onOpenOrder && (
            <details className="insight-evidence">
              <summary>Наряды в основе вывода ({i.orderIds.length})</summary>
              <div className="evidence-links">
                {i.orderIds.map((id: string) => (
                  <button key={id} className="text-button" onClick={() => onOpenOrder(id)}>
                    №{evidenceOrders.find((o) => o.id === id)?.number || id.slice(0, 8)}
                  </button>
                ))}
              </div>
            </details>
          )}
          {onPick && i.equipment && (
            <button className="text-button" onClick={() => onPick(i)}>
              Показать отчёт по оборудованию
            </button>
          )}
        </article>
      ))}
    </div>
  );
}

export function ReportsPage({
  api,
  data,
  workers,
  onOpenOrder,
}: {
  api: string;
  data: any;
  workers: any[];
  onOpenOrder?: (id: string) => void;
}) {
  const [period, setPeriod] = useState('month');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [area, setArea] = useState('');
  const [equipment, setEquipment] = useState('');
  const [worker, setWorker] = useState('');
  const [brigade, setBrigade] = useState('');
  const [wantAi, setWantAi] = useState(false);
  const [materialGroup, setMaterialGroup] = useState('materials');
  const [materialLimit, setMaterialLimit] = useState(24);
  const [openRating, setOpenRating] = useState<string | null>(null);
  const range = useMemo(() => periodRange(period, fromDate, toDate), [period, fromDate, toDate]);
  const {
    data: a,
    loading,
    error,
    reload,
  } = useAnalytics(api, {
    from: new Date(range.from).toISOString(),
    to: new Date(range.to).toISOString(),
    area,
    equipment,
    worker,
    brigade,
    ai: wantAi ? 1 : undefined,
  });
  const brigades = [...new Set<number>(workers.map((w: any) => Number(w.brigade) || 1))].sort(
    (x, y) => x - y,
  );
  const eqName = (id: string) => data.equipment.find((e: any) => e.id === id)?.name || id;

  function exportExcel() {
    if (!a) return;
    const s = a.summary;
    const book = createXlsxBook(reportSheets(a, range.label));
    const filename = `NaryadAI-отчёт-${new Date().toISOString().slice(0, 10)}.xlsx`;
    const native = (window as any).NaryadAndroid;
    if (native?.saveFile) {
      const reader = new FileReader();
      reader.onload = () => native.saveFile(filename, book.type, String(reader.result).split(',')[1]);
      reader.readAsDataURL(book);
      return;
    }
    const url = URL.createObjectURL(book);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  const s = a?.summary;
  const topEq = (a?.equipment || []).filter((e: any) => e.unplanned).slice(0, 5);
  const maxEq = Math.max(1, ...topEq.map((e: any) => e.unplanned));
  const downtimeEq = [...(a?.equipment || [])]
    .sort((x: any, y: any) => y.downtimeHours - x.downtimeHours)
    .slice(0, 8);
  const maxDown = Math.max(1, ...downtimeEq.map((e: any) => e.downtimeHours));

  return (
    <div className="reports viz-root">
      <div className="page-heading">
        <div>
          <div className="eyebrow">РЕЗУЛЬТАТЫ И ЗАКОНОМЕРНОСТИ</div>
          <h1>Отчёты</h1>
          <p className="muted print-only-visible">{range.label}</p>
        </div>
        <div className="button-row">
          <button onClick={exportExcel} disabled={!a}>
            <Download size={18} />
            Excel .xlsx
          </button>
          <button onClick={() => window.print()} disabled={!a}>
            <FileText size={18} />
            Печать / PDF
          </button>
        </div>
      </div>
      <div className="filters">
        <select aria-label="Период" value={period} onChange={(e) => setPeriod(e.target.value)}>
          {periods.map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        {period === 'custom' && (
          <>
            <label>
              С даты
              <input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </label>
            <label>
              По дату
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </label>
          </>
        )}
        <select
          aria-label="Участок"
          value={area}
          onChange={(e) => {
            setArea(e.target.value);
            setEquipment('');
          }}
        >
          <option value="">Все участки</option>
          {data.areas.map((x: any) => (
            <option key={x.id} value={x.id}>
              {x.name}
            </option>
          ))}
        </select>
        <details className="advanced-filters">
          <summary>Дополнительные фильтры{equipment || worker || brigade ? ' · применены' : ''}</summary>
          <div className="filters">
            <select
              aria-label="Оборудование"
              value={equipment}
              onChange={(e) => setEquipment(e.target.value)}
            >
              <option value="">Всё оборудование</option>
              {data.equipment
                .filter((x: any) => !area || x.area === area)
                .map((x: any) => (
                  <option key={x.id} value={x.id}>
                    {x.name}
                  </option>
                ))}
            </select>
            <select aria-label="Исполнитель" value={worker} onChange={(e) => setWorker(e.target.value)}>
              <option value="">Все исполнители</option>
              {workers.map((w: any) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
            <select aria-label="Бригада" value={brigade} onChange={(e) => setBrigade(e.target.value)}>
              <option value="">Все бригады</option>
              {brigades.map((b) => (
                <option key={b} value={b}>
                  Бригада {b}
                </option>
              ))}
            </select>
          </div>
        </details>
      </div>
      {error && (
        <div className="error" role="alert">
          {error}
          <button onClick={reload}>
            <RefreshCw size={16} />
            Повторить
          </button>
        </div>
      )}
      {!a && loading && <p className="muted">Считаем показатели…</p>}
      {a && s && (
        <>
          <div className="kpi-grid">
            <Kpi
              label="Выдано"
              value={s.issued}
              hint={`закрыто ${s.closed}`}
              icon={<ClipboardCheck size={16} />}
            />
            <Kpi
              label="Просрочено"
              value={s.overdue}
              hint={`отклонено ${s.rejected}`}
              icon={<Clock size={16} />}
              danger={s.overdue > 0}
            />
            <Kpi
              label="Реакция"
              value={hours(s.avgReactionMin)}
              hint="от выдачи до принятия"
              icon={<Timer size={16} />}
            />
            <Kpi
              label="Выполнение"
              value={hours(s.avgCompletionMin)}
              hint={`в срок ${pct(s.onTimeShare)}`}
              icon={<Timer size={16} />}
            />
            <Kpi
              label="Простой"
              value={`${s.downtimeHours} ч`}
              hint={`внеплановых ${s.unplanned} · плановых ${s.planned}`}
              icon={<Factory size={16} />}
            />
            <Kpi
              label="Средняя оценка"
              value={s.avgScore ?? '—'}
              hint="качество по 5-балльной шкале"
              icon={<Sparkles size={16} />}
            />
          </div>

          <section className="panel">
            <div className="section-title">
              <h2>{period === 'shift' ? 'Отчёт за смену' : 'Сводка за период'}</h2>
              {a.llm && !a.ai && (
                <button onClick={() => setWantAi(true)} disabled={loading}>
                  <Sparkles size={18} />
                  {loading && wantAi ? 'ИИ готовит сводку…' : 'Сводка ИИ'}
                </button>
              )}
            </div>
            {a.ai ? (
              <>
                <p className="description ai-summary">
                  <Sparkles size={18} />
                  {a.ai.summary}
                </p>
                {!!a.ai.recommendations?.length && (
                  <ul className="ai-recommendations">
                    {a.ai.recommendations.map((r: string) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                )}
                <small className="muted">
                  Сводка ИИ ({a.ai.model}) по обезличенной статистике. Решения принимает человек.
                </small>
              </>
            ) : (
              <>
                <p className="description">{a.narrative}</p>
                <small className="muted">
                  {a.llm
                    ? 'Нажмите «Сводка ИИ» для вывода простым языком.'
                    : 'Сводка рассчитана по данным; ИИ-модель не подключена.'}
                </small>
              </>
            )}
          </section>

          <section className="panel">
            <h2>Закономерности и рекомендации</h2>
            <p className="muted small">
              Статистические сигналы по истории нарядов. Требуют проверки специалистом.
            </p>
            <InsightList
              insights={a.insights}
              evidenceOrders={a.evidenceOrders}
              onOpenOrder={onOpenOrder}
              onPick={(i) => {
                setEquipment(i.equipment);
                setArea('');
              }}
            />
          </section>

          <div className="detail-grid">
            <section className="panel">
              <h2>Рейтинг исполнителей</h2>
              <p className="muted small">
                Качество — {a.ratings.weights.quality}, сроки — {a.ratings.weights.onTime}, без доработок и
                повторов — {a.ratings.weights.returns}, объём — {a.ratings.weights.volume}; отказ без
                уважительной причины −{a.ratings.weights.penaltyPerRejection} (не более −
                {a.ratings.weights.maxPenalty}).
              </p>
              <Legend items={ratingParts.map(([, l, c]) => [l, c])} />
              {a.ratings.workers.map((w: any, i: number) => (
                <div className="rating-row" key={w.id}>
                  <button
                    className="rating-head"
                    onClick={() => setOpenRating(openRating === w.id ? null : w.id)}
                    aria-expanded={openRating === w.id}
                  >
                    <span className="rank-number">{String(i + 1).padStart(2, '0')}</span>
                    <span className="rating-name">
                      <strong>{w.name}</strong>
                      <small>
                        {w.count} нар. · в срок {pct(w.onTime)} · качество {w.quality.toFixed(1)} · доработки{' '}
                        {pct(w.returns)}
                      </small>
                    </span>
                    <b className="rating-score">{w.score}</b>
                  </button>
                  <RatingBar parts={w.parts} />
                  {openRating === w.id && <p className="small rating-explain">{w.explanation}</p>}
                </div>
              ))}
              {!a.ratings.workers.length && <p className="muted">За период нет закрытых нарядов.</p>}
            </section>
            <section className="panel">
              <h2>Рейтинг бригад</h2>
              {a.ratings.brigades.map((b: any) => (
                <div className="rating-row" key={b.brigade}>
                  <div className="rating-head static">
                    <span className="rating-name">
                      <strong>Бригада {b.brigade}</strong>
                      <small>
                        {b.count} нар. · в срок {pct(b.onTime)} · доработки {pct(b.returns)}
                      </small>
                    </span>
                    <b className="rating-score">{b.score}</b>
                  </div>
                  <RatingBar parts={b.parts} />
                </div>
              ))}
              <h2 className="spaced">Загрузка людей</h2>
              <div className="table-scroll" role="region" aria-label="Таблица отчёта" tabIndex={0}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Исполнитель</th>
                      <th>Выдано</th>
                      <th>Закрыто</th>
                      <th>Акт. время</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.workload.slice(0, 15).map((w: any) => (
                      <tr key={w.id}>
                        <td>
                          {w.name}
                          <small className="muted"> · {w.spec}</small>
                        </td>
                        <td>{w.issued}</td>
                        <td>{w.closed}</td>
                        <td>{w.activeHours} ч</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>

          <div className="detail-grid">
            <section className="panel">
              <h2>Топ проблемного оборудования</h2>
              {topEq.map((e: any) => (
                <div className="equipment-report" key={e.id}>
                  <div className="section-title">
                    <strong>{e.name}</strong>
                    <span className="badge danger">{e.unplanned} внепл.</span>
                  </div>
                  <div className="bar" data-tip={`${e.unplanned} внеплановых нарядов`}>
                    <i style={{ width: (e.unplanned / maxEq) * 100 + '%' }} />
                  </div>
                  <p className="muted small">
                    Простой {e.downtimeUnplannedHours} ч
                    {e.topCode
                      ? ` · чаще всего ${e.topCode} (${String(e.topCodeName || '').toLowerCase()}) — ${e.topCodeCount}`
                      : ''}
                  </p>
                </div>
              ))}
              {!topEq.length && <p className="muted">Внеплановых нарядов за период нет.</p>}
            </section>
            <section className="panel">
              <h2>Простои оборудования</h2>
              <Legend
                items={[
                  ['Внеплановый', 'var(--series-2)'],
                  ['Плановый', 'var(--series-1)'],
                ]}
              />
              {downtimeEq.map((e: any) => (
                <div className="downtime-row" key={e.id}>
                  <span>{e.name}</span>
                  <div
                    className="stack-bar thin"
                    role="img"
                    aria-label={`${e.name}: внеплановый ${e.downtimeUnplannedHours} ч, плановый ${e.downtimePlannedHours} ч`}
                  >
                    <span
                      className="seg"
                      style={{
                        width: (e.downtimeUnplannedHours / maxDown) * 100 + '%',
                        background: 'var(--series-2)',
                      }}
                      data-tip={`Внеплановый: ${e.downtimeUnplannedHours} ч`}
                    />
                    <span
                      className="seg"
                      style={{
                        width: (e.downtimePlannedHours / maxDown) * 100 + '%',
                        background: 'var(--series-1)',
                      }}
                      data-tip={`Плановый: ${e.downtimePlannedHours} ч`}
                    />
                  </div>
                  <b>{e.downtimeHours} ч</b>
                </div>
              ))}
              <p className="muted small">
                Доля плановых нарядов: {s.issued ? pct(s.planned / s.issued) : '—'}. Причины по шифрам — в
                выгрузке Excel и в отчёте по оборудованию.
              </p>
            </section>
          </div>

          <div className="detail-grid">
            <section className="panel">
              <h2>Списанные материалы</h2>
              <label>
                Срез расхода
                <select
                  value={materialGroup}
                  onChange={(e) => {
                    setMaterialGroup(e.target.value);
                    setMaterialLimit(24);
                  }}
                >
                  <option value="materials">Все материалы</option>
                  <option value="byArea">По участкам</option>
                  <option value="byEquipment">По оборудованию</option>
                  <option value="byWorker">По исполнителям</option>
                </select>
              </label>
              <div className="table-scroll" role="region" aria-label="Таблица отчёта" tabIndex={0}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Материал</th>
                      <th>Списано</th>
                      <th>Нарядов</th>
                      <th>Выше нормы</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(a.materials[materialGroup] || []).slice(0, materialLimit).map((m: any) => (
                      <tr key={m.id} className={m.over ? 'warn' : ''}>
                        <td>
                          {m.groupName && (
                            <small className="muted">
                              {m.groupName}
                              <br />
                            </small>
                          )}
                          {m.name}
                        </td>
                        <td>
                          {m.qty} {m.unit}
                        </td>
                        <td>{m.orders}</td>
                        <td>{m.over || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="muted small">
                Показано {Math.min(materialLimit, (a.materials[materialGroup] || []).length)} из{' '}
                {(a.materials[materialGroup] || []).length} позиций. Все срезы включены в Excel.
              </p>
              {(a.materials[materialGroup] || []).length > materialLimit && (
                <button type="button" onClick={() => setMaterialLimit((n) => n + 24)}>
                  Показать ещё 24
                </button>
              )}
            </section>
            <section className="panel">
              <div className="section-title">
                <h2>Отклонения расхода</h2>
                <span className="count">{a.materials.deviations.length}</span>
              </div>
              <p className="muted small">
                Количество выше справочного ориентира — повод для проверки, а не доказательство нарушения.
              </p>
              {a.materials.deviations.slice(0, 10).map((d: any) => (
                <p className="deviation" key={d.order + d.material}>
                  <TriangleAlert size={15} /> №{d.number} · {d.material}: {d.qty} {d.unit} при ориентире{' '}
                  {d.norm} (×{d.ratio}) · {d.equipment} · {d.worker}
                </p>
              ))}
              <h3>Доля превышений по исполнителям</h3>
              {a.materials.workers
                .filter((w: any) => w.over)
                .slice(0, 6)
                .map((w: any) => (
                  <p key={w.id} className="small">
                    {w.name}: {w.over} из {w.lines} ({pct(w.over / w.lines)})
                  </p>
                ))}
            </section>
          </div>
          {equipment && (
            <p className="muted small">
              Отчёт отфильтрован по оборудованию «{eqName(equipment)}».{' '}
              <button className="text-button" onClick={() => setEquipment('')}>
                Сбросить
              </button>
            </p>
          )}
        </>
      )}
    </div>
  );
}

function Kpi({
  label,
  value,
  hint,
  icon,
  danger,
}: {
  label: string;
  value: any;
  hint?: string;
  icon?: any;
  danger?: boolean;
}) {
  return (
    <div className={'kpi' + (danger ? ' danger' : '')}>
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && (
        <small>
          {icon}
          {hint}
        </small>
      )}
    </div>
  );
}

/** Дашборд руководителя: ключевые показатели на одном экране (ТЗ 7). */
export function ManagerDashboard({
  api,
  live,
  onOpenReports,
}: {
  api: string;
  live: { active: number; late: number; downtime: number };
  onOpenReports: () => void;
}) {
  const range = useMemo(() => periodRange('week'), []);
  const month = useMemo(() => periodRange('month'), []);
  const week = useAnalytics(api, {
    from: new Date(range.from).toISOString(),
    to: new Date(range.to).toISOString(),
  });
  const m = useAnalytics(api, {
    from: new Date(month.from).toISOString(),
    to: new Date(month.to).toISOString(),
  });
  // Закономерности ищутся на длинной истории: на коротком окне выборка слишком мала.
  const quarter = useMemo(() => periodRange('quarter'), []);
  const q = useAnalytics(api, {
    from: new Date(quarter.from).toISOString(),
    to: new Date(quarter.to).toISOString(),
  });
  const s = week.data?.summary;
  return (
    <div className="viz-root manager-dashboard">
      <div className="kpi-grid">
        <Kpi
          label="В работе сейчас"
          value={live.active}
          hint="наряды в работе и очереди"
          icon={<ClipboardCheck size={16} />}
        />
        <Kpi
          label="Просрочено"
          value={live.late}
          danger={live.late > 0}
          hint="требуют внимания"
          icon={<Clock size={16} />}
        />
        <Kpi
          label="Оборудование в простое"
          value={live.downtime}
          hint="остановлено сейчас"
          icon={<Factory size={16} />}
        />
        <Kpi
          label="Реакция (неделя)"
          value={s ? hours(s.avgReactionMin) : '…'}
          hint="среднее время до принятия"
          icon={<Timer size={16} />}
        />
        <Kpi
          label="Выполнение (неделя)"
          value={s ? hours(s.avgCompletionMin) : '…'}
          hint={s ? `в срок ${pct(s.onTimeShare)}` : ''}
          icon={<Timer size={16} />}
        />
        <Kpi
          label="Простой (неделя)"
          value={s ? `${s.downtimeHours} ч` : '…'}
          hint={s ? `внеплановых нарядов ${s.unplanned}` : ''}
          icon={<Factory size={16} />}
        />
      </div>
      <div className="detail-grid">
        <section className="panel">
          <h2>Топ-5 проблемного оборудования · 30 дней</h2>
          {(m.data?.equipment || [])
            .filter((e: any) => e.unplanned)
            .slice(0, 5)
            .map((e: any, i: number) => (
              <div className="rank-row" key={e.id}>
                <span className="rank-number">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <strong>{e.name}</strong>
                  <small>
                    {e.unplanned} внеплановых · простой {e.downtimeHours} ч
                    {e.topCode ? ` · ${e.topCode}` : ''}
                  </small>
                </div>
              </div>
            ))}
          {!m.data && <p className="muted">Загрузка…</p>}
        </section>
        <section className="panel">
          <h2>Лучшие исполнители · 30 дней</h2>
          {(m.data?.ratings?.workers || [])
            .filter((w: any) => w.count >= 5)
            .slice(0, 5)
            .map((w: any, i: number) => (
              <div className="rank-row" key={w.id}>
                <span className="rank-number">{String(i + 1).padStart(2, '0')}</span>
                <div>
                  <strong>{w.name}</strong>
                  <small>
                    {w.count} нарядов · в срок {pct(w.onTime)} · качество {w.quality.toFixed(1)}
                  </small>
                </div>
                <b>{w.score}</b>
              </div>
            ))}
        </section>
      </div>
      <section className="panel">
        <div className="section-title">
          <h2>Главные сигналы ИИ-аналитики · 3 месяца</h2>
          <button className="text-button" onClick={onOpenReports}>
            Все отчёты
          </button>
        </div>
        <InsightList insights={(q.data?.insights || []).slice(0, 5)} />
      </section>
    </div>
  );
}

/** Рейтинг исполнителя для его собственного экрана (ТЗ 6.6: ИИ поясняет, из чего сложился рейтинг). */
export function MyRating({ api }: { api: string }) {
  const month = useMemo(() => periodRange('month'), []);
  const { data } = useAnalytics(api, {
    from: new Date(month.from).toISOString(),
    to: new Date(month.to).toISOString(),
  });
  const r = data?.self;
  if (!r) return null;
  return (
    <section className="panel viz-root">
      <div className="section-title">
        <h2>{t('Мой рейтинг · 30 дней')}</h2>
        <b className="rating-score">{r.count ? r.score : '—'}</b>
      </div>
      {r.count > 0 && (
        <>
          <Legend items={ratingParts.map(([, l, c]) => [l, c])} />
          <RatingBar parts={r.parts} />
        </>
      )}
      <p className="small rating-explain">{r.explanation}</p>
    </section>
  );
}
