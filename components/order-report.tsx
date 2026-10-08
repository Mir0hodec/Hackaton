'use client';
// Отчёт по наряду (ТЗ 6.4): исполнитель видит оценку и подсказки, мастер — полный разбор проверки.
import { ReviewBreakdown } from './review-breakdown';
import type { ReactNode } from 'react';
import { ShieldCheck, TriangleAlert, Sparkles, ThumbsUp, Lightbulb, Loader } from 'lucide-react';
import { t } from '../lib/i18n';

const verdicts: Record<string, string> = {
  accepted: 'Принято',
  remarks: 'Принято с замечаниями',
  rework: 'Требует доработки',
};
const yesNo: Record<string, string> = { yes: 'да', no: 'нет', unclear: 'неясно', no_photos: 'нет фото' };

export function OrderReport({
  order,
  role,
  codeName,
  photos,
}: {
  order: any;
  role: string;
  codeName: (id: string) => string;
  photos: (ids: string[]) => ReactNode;
}) {
  const report = order.report;
  const check = order.check;
  const forWorker = role === 'worker';
  const score = order.masterScore ?? check?.score;
  return (
    <section className="panel order-report">
      <div className="section-title">
        <h2>{t('Отчёт о выполнении')}</h2>
        <span className="mono">
          {report.code ? `${report.code} · ${codeName(report.code)}` : 'Без шифра'}
        </span>
      </div>
      <p>{report.works || 'Описание не заполнено'}</p>
      {report.comment && <p className="muted">{report.comment}</p>}
      {!!report.materials?.length && (
        <div className="material-list">
          {report.materials.map((m: any) => (
            <span key={m.id} className={m.qty > m.norm ? 'over' : ''}>
              {m.name}{' '}
              <b>
                {m.qty} {m.unit}
              </b>
              {m.qty > m.norm && <small> · ориентир {m.norm}</small>}
            </span>
          ))}
        </div>
      )}
      <div className="before-after">
        <div>
          <h3>{t('Фото «до»')}</h3>
          {order.photos?.length ? photos(order.photos) : <p className="muted small">Не прикладывалось</p>}
        </div>
        <div>
          <h3>{t('Фото «после»')}</h3>
          {report.photos?.length ? photos(report.photos) : <p className="muted small">Нет фото</p>}
        </div>
      </div>
      {check && (
        <div className={'check-result verdict-' + check.verdict}>
          <div className="section-title">
            <h3>
              <ShieldCheck size={20} />
              {forWorker ? t('Ваша оценка') : 'Результат проверки'}
            </h3>
            <strong className="score">
              {score}
              <small>/5</small>
            </strong>
          </div>
          <p className="verdict-line">
            <b>{verdicts[check.verdict] || check.verdict}</b>
            {order.masterScore != null && check.score !== order.masterScore && (
              <span className="muted small">
                {' '}
                · оценка {check.mode === 'ai' ? 'ИИ' : 'по правилам'} {check.score}/5, мастер изменил на{' '}
                {order.masterScore}/5
              </span>
            )}
          </p>
          {check.aiPending && (
            <p className="ai-pending">
              <Loader size={16} className="spin" /> ИИ анализирует отчёт…
            </p>
          )}
          {(forWorker ? check.summaryForWorker : check.summaryForMaster || check.summaryForWorker) && (
            <p className="ai-summary">
              {check.mode === 'ai' && <Sparkles size={16} />}
              {forWorker ? check.summaryForWorker : check.summaryForMaster || check.summaryForWorker}
            </p>
          )}
          <p className="small">
            Время: {check.minutes ?? '—'} мин при нормативе {check.norm || order.norm} мин
            {order.downtime ? ` · простой оборудования ${order.downtime} мин` : ''}
          </p>
          <ReviewBreakdown check={check} />
          {check.mode === 'ai' && !forWorker && (
            <dl className="ai-facts">
              <div>
                <dt>Работы соответствуют проблеме</dt>
                <dd>{check.worksMatchProblem ? 'да' : 'нет'}</dd>
              </div>
              <div>
                <dt>Материалы логичны</dt>
                <dd>{check.materialsReasonable ? 'да' : 'нет'}</dd>
              </div>
              <div>
                <dt>То же оборудование на фото</dt>
                <dd>{yesNo[check.sameEquipment] || '—'}</dd>
              </div>
              <div>
                <dt>Проблема устранена по фото</dt>
                <dd>{yesNo[check.problemFixedOnPhoto] || '—'}</dd>
              </div>
              <div>
                <dt>Качество по фото</dt>
                <dd>{check.photoScore ? `${check.photoScore}/5` : '—'}</dd>
              </div>
              <div>
                <dt>Уверенность ИИ</dt>
                <dd>{check.confidence != null ? Math.round(check.confidence * 100) + '%' : '—'}</dd>
              </div>
            </dl>
          )}
          {check.mode === 'ai' && check.photoAssessment && !forWorker && (
            <p className="small">
              <b>Фото:</b> {check.photoAssessment}
            </p>
          )}
          {check.needsMasterCheck && (
            <p className="issue">
              <TriangleAlert size={16} /> Нужна проверка мастером
            </p>
          )}
          {!!check.strengths?.length && (
            <div className="feedback good">
              <h4>
                <ThumbsUp size={16} /> {t('Сделано хорошо')}
              </h4>
              <ul>
                {check.strengths.map((s: string) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {!!(forWorker ? check.improvements : check.issues)?.length && (
            <div className="feedback improve">
              <h4>
                {forWorker ? <Lightbulb size={16} /> : <TriangleAlert size={16} />}{' '}
                {forWorker ? t('Что улучшить') : 'Замечания'}
              </h4>
              <ul>
                {(forWorker ? check.improvements : check.issues).map((s: string) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          {forWorker && !!check.issues?.length && check.verdict === 'rework' && (
            <div className="feedback improve">
              <h4>
                <TriangleAlert size={16} /> {t('Почему возвращено')}
              </h4>
              <ul>
                {check.issues.map((s: string) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="muted small">
            <b>
              {check.aiPending
                ? 'Проверка по правилам, ИИ-анализ выполняется'
                : check.mode === 'ai'
                  ? `ИИ-анализ${check.model ? ' · ' + check.model : ''}`
                  : check.mode === 'rules_fallback'
                    ? 'Резервная проверка по правилам'
                    : check.mode === 'seed'
                      ? 'Историческая оценка'
                      : 'Проверка по правилам'}
            </b>{' '}
            · {check.note || 'Окончательное решение принимает мастер.'}
          </p>
          {order.masterComment && (
            <p>
              <b>Решение мастера:</b> {order.masterComment}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
