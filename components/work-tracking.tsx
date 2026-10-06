'use client';
import { useEffect, useState } from 'react';
import { Clock, Play, CheckCheck, ChartNoAxesCombined, Bell, Star, X } from 'lucide-react';
const date = (s: string) =>
  new Date(s).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
const duration = (mins: number) => {
  const m = Math.max(0, Math.round(mins));
  return m >= 60 ? `${Math.floor(m / 60)} ч ${m % 60} мин` : `${m} мин`;
};
export function currentWork(logs: any[], worker: string) {
  return logs.find((x: any) => x.id === worker)?.entries?.find((x: any) => x.status === 'active');
}
export function workRating(logs: any[], worker: string) {
  const entries = logs.find((x: any) => x.id === worker)?.entries || [];
  const done = entries.filter((x: any) => x.status === 'completed');
  const rated = done.filter((x: any) => x.review);
  return {
    done: done.length,
    rated: rated.length,
    score: rated.length
      ? (rated.reduce((s: number, x: any) => s + x.review.score, 0) / rated.length).toFixed(1)
      : null,
    minutes: done.reduce((s: number, x: any) => s + x.workedMinutes, 0),
  };
}
export function WorkSummary({ card, serverTime }: any) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const offset = serverTime ? Date.parse(serverTime) - Date.now() : 0;
    setNow(Date.now() + offset);
    const id = setInterval(() => setNow(Date.now() + offset), 1000);
    return () => clearInterval(id);
  }, [serverTime]);
  if (!card) return null;
  const end = Date.parse(card.due),
    start = Date.parse(card.started),
    active = card.status === 'active';
  const at = active ? now : Date.parse(card.finished);
  const left = end - at;
  const remaining = Math.min(100, Math.max(0, ((end - at) / (end - start)) * 100));
  const label = active
    ? left > 0
      ? `Осталось ${duration(Math.ceil(left / 60000))}`
      : `Время истекло · +${duration(-left / 60000)}`
    : card.status === 'cancelled'
      ? 'Отменено'
      : card.early
        ? 'Завершено досрочно'
        : 'Завершено';
  return (
    <div className={'work-summary ' + (active && left <= 0 ? 'work-late' : '')}>
      <div className="section-title">
        <strong>{card.title}</strong>
        <Clock size={20} />
      </div>
      <div className="work-line-label">
        <span>{label}</span>
        <span>План {duration(card.plannedMinutes)}</span>
      </div>
      <div
        className="work-meter time-meter"
        role="progressbar"
        aria-label="Оставшееся время"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(remaining)}
        aria-valuetext={label}
      >
        <i style={{ width: remaining + '%' }} />
      </div>
      <div className="work-line-label">
        <b>Выполнено {card.progress}%</b>
        <span>Учтено {duration(card.workedMinutes)}</span>
      </div>
      <div
        className="work-meter"
        role="progressbar"
        aria-label="Прогресс работы"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={card.progress}
      >
        <i style={{ width: card.progress + '%' }} />
      </div>
      <small className="muted">
        Начало {date(card.started)} · Срок {date(card.due)}
      </small>
      {card.note && <p className="work-note">{card.note}</p>}
    </div>
  );
}
export function WorkProfile({ worker, user, logs, orders, serverTime, onAction, disabled = false }: any) {
  const [mode, setMode] = useState(''),
    [error, setError] = useState(''),
    [saving, setSaving] = useState(false),
    [review, setReview] = useState('');
  const entries = logs.find((x: any) => x.id === worker.id)?.entries || [],
    current = entries.find((x: any) => x.status === 'active');
  const editable = user.id === worker.id || ['master', 'admin'].includes(user.role),
    canReview = ['master', 'admin'].includes(user.role),
    rank = workRating(logs, worker.id);
  const jobs = orders.filter(
    (o: any) =>
      (o.worker === worker.id || o.members?.includes(worker.id)) &&
      !['closed', 'cancelled', 'rejected'].includes(o.status),
  );
  async function submit(e: any, action: string, id?: string) {
    e.preventDefault();
    setError('');
    setSaving(true);
    const form = e.currentTarget;
    const fields: any = Object.fromEntries(new FormData(form));
    try {
      const result = await onAction({ action, worker: worker.id, id, ...fields });
      if (result) {
        setMode('');
        setReview('');
      } else setError('Изменения не сохранены. Проверьте сообщение об ошибке и повторите.');
    } finally {
      setSaving(false);
    }
  }
  const blocked = saving || disabled;
  return (
    <section className="work-profile">
      <div className="section-title">
        <h3>
          <Clock size={22} />
          Занятость и прогресс
        </h3>
        {editable && !current && (
          <button
            className="primary"
            disabled={blocked}
            aria-pressed={mode === 'start'}
            onClick={() => setMode(mode === 'start' ? '' : 'start')}
          >
            <Play size={18} />
            Указать работу и время
          </button>
        )}
      </div>
      {current ? (
        <>
          <WorkSummary card={current} serverTime={serverTime} />
          {editable && (
            <div className="actions work-actions">
              {[
                ['progress', 'Обновить прогресс', ChartNoAxesCombined],
                ['plan', 'Время и напоминание', Bell],
                ['finish', 'Завершить работу', CheckCheck],
                ['cancel', 'Отменить', X],
              ].map(([key, label, Icon]: any) => (
                <button
                  key={key}
                  disabled={blocked}
                  aria-pressed={mode === key}
                  onClick={() => {
                    setMode(mode === key ? '' : key);
                    setError('');
                  }}
                >
                  <Icon size={20} />
                  {label}
                </button>
              ))}
            </div>
          )}
        </>
      ) : (
        <p className="muted">Личный таймер не запущен. Занятость по нарядам показана отдельно.</p>
      )}
      {editable && mode === 'start' && !current && (
        <form className="work-form" onSubmit={(e) => submit(e, 'work-start')}>
          <label>
            Какую работу выполняете
            <input name="title" required maxLength={180} placeholder="Например: замена подшипника" />
          </label>
          <label>
            Связанный наряд
            <select name="order" defaultValue="">
              <option value="">Работа без наряда</option>
              {jobs.map((o: any) => (
                <option key={o.id} value={o.id}>
                  №{o.number} · {o.title}
                </option>
              ))}
            </select>
          </label>
          <div className="form-grid">
            <label>
              Плановое время, минут
              <input name="minutes" type="number" min="1" max="525600" required defaultValue="60" />
            </label>
            <label>
              Напомнить за, минут
              <input name="remindMinutes" type="number" min="0" max="525600" required defaultValue="10" />
            </label>
          </div>
          <p className="muted small">
            60 минут — час, 480 — 8 часов. Для долгой работы задайте общее время. 0 отключает предварительное
            напоминание.
          </p>
          <label>
            Первый этап / комментарий
            <textarea name="note" maxLength={2000} />
          </label>
          <button className="primary" disabled={blocked}>
            Начать отсчёт
          </button>
        </form>
      )}
      {editable && current && mode === 'progress' && (
        <form className="work-form" onSubmit={(e) => submit(e, 'work-progress', current.id)}>
          <div className="form-grid">
            <label>
              Выполнено, %
              <input
                name="progress"
                type="number"
                min={current.progress}
                max="100"
                required
                defaultValue={current.progress}
              />
            </label>
            <label>
              Отработано всего, минут
              <input
                name="workedMinutes"
                type="number"
                min={current.workedMinutes}
                max="525600"
                required
                defaultValue={current.workedMinutes}
              />
            </label>
          </div>
          <label>
            Что сделано на этом этапе
            <textarea
              name="note"
              required
              maxLength={2000}
              placeholder="Например: разобран узел, подготовлены детали"
            />
          </label>
          <p className="muted small">
            Укажите накопленное время за все этапы. Показатель 100% сам по себе не закрывает работу.
          </p>
          <button className="primary" disabled={blocked}>
            Сохранить этап
          </button>
        </form>
      )}
      {editable && current && mode === 'plan' && (
        <form className="work-form" onSubmit={(e) => submit(e, 'work-plan', current.id)}>
          <label>
            Сколько минут нужно от текущего момента
            <input name="minutes" type="number" min="1" max="525600" required defaultValue="60" />
          </label>
          <label>
            Напомнить за, минут
            <input
              name="remindMinutes"
              type="number"
              min="0"
              max="525600"
              required
              defaultValue={current.remindMinutes}
            />
          </label>
          <label>
            Причина изменения
            <textarea name="note" required maxLength={2000} />
          </label>
          <button className="primary" disabled={blocked}>
            Изменить срок
          </button>
        </form>
      )}
      {editable && current && ['finish', 'cancel'].includes(mode) && (
        <form
          className="work-form"
          onSubmit={(e) => submit(e, mode === 'finish' ? 'work-finish' : 'work-cancel', current.id)}
        >
          {mode === 'finish' && (
            <label>
              Отработано всего, минут
              <input
                name="workedMinutes"
                type="number"
                min={current.workedMinutes}
                max="525600"
                required
                defaultValue={Math.max(
                  current.workedMinutes,
                  Math.round((Date.now() - Date.parse(current.started)) / 60000),
                )}
              />
            </label>
          )}
          <label>
            {mode === 'finish' ? 'Что выполнено — итог работы' : 'Причина отмены'}
            <textarea name="note" required maxLength={2000} />
          </label>
          <p className="muted small">
            Сотрудник, мастер и руководитель получат уведомление. Связанный наряд закрывается через отчёт и
            приёмку мастером.
          </p>
          <button className="primary" disabled={blocked}>
            {mode === 'finish' ? 'Подтвердить завершение' : 'Подтвердить отмену'}
          </button>
        </form>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="work-stats">
        <div>
          <span>Завершено работ</span>
          <b>{rank.done}</b>
        </div>
        <div>
          <span>Оценка мастера</span>
          <b>{rank.score ? `${rank.score}/5` : 'Пока нет'}</b>
        </div>
        <div>
          <span>Учтено времени</span>
          <b>{duration(rank.minutes)}</b>
        </div>
      </div>
      <p className="small muted">
        Оценено {rank.rated} из {rank.done} карточек. Рейтинг качества ставит мастер; проценты выполнения его
        не повышают.
      </p>
      <h3>Карточки и история работ</h3>
      {!entries.length && <p className="muted">Сотрудник ещё не заполнял карточки.</p>}
      {entries.map((c: any) => (
        <details className="work-history" key={c.id}>
          <summary>
            <span>
              <strong>{c.title}</strong>
              <small>
                {date(c.started)}
                {c.finished ? ' → ' + date(c.finished) : ''} ·{' '}
                {c.status === 'active' ? 'В работе' : c.status === 'completed' ? 'Завершено' : 'Отменено'}
              </small>
            </span>
            <b>{c.progress}%</b>
          </summary>
          <WorkSummary card={c} serverTime={serverTime} />
          {c.order && (
            <p className="small">Наряд №{orders.find((o: any) => o.id === c.order)?.number || '—'}</p>
          )}
          {c.review && (
            <p>
              <Star size={18} /> Оценка {c.review.score}/5 · {c.review.comment}
            </p>
          )}
          {canReview && c.status === 'completed' && (
            <button
              disabled={blocked}
              aria-pressed={review === c.id}
              onClick={() => setReview(review === c.id ? '' : c.id)}
            >
              {c.review ? 'Изменить оценку' : 'Оценить работу'}
            </button>
          )}
          {review === c.id && canReview && (
            <form className="work-form" onSubmit={(e) => submit(e, 'work-review', c.id)}>
              <label>
                Оценка
                <select name="score" defaultValue={c.review?.score || 5}>
                  {[5, 4, 3, 2, 1].map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Комментарий мастера
                <textarea name="comment" required maxLength={2000} defaultValue={c.review?.comment || ''} />
              </label>
              <button className="primary" disabled={blocked}>
                Сохранить оценку
              </button>
            </form>
          )}
          <ol className="work-events">
            {[...c.history].reverse().map((h: any, i: number) => (
              <li key={i}>
                <small>
                  {date(h.at)} · {h.actor}
                </small>
                <p>{h.text}</p>
              </li>
            ))}
          </ol>
        </details>
      ))}
    </section>
  );
}
