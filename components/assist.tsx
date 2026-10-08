'use client';
// Подсказки мастеру при выдаче наряда: рекомендуемый исполнитель и шифр неисправности.
import { useEffect, useState } from 'react';
import { Sparkles } from 'lucide-react';

export type RecommendResult = {
  code: { id: string; name: string; norm: number } | null;
  specialty: string | null;
  ranked: {
    id: string;
    name: string;
    spec: string;
    score: number;
    free: boolean;
    matching: boolean;
    eligible: boolean;
    available: string;
    reasons: string[];
  }[];
};

/** Запрашивает рекомендацию у сервера, когда выбрано оборудование (с задержкой на ввод текста). */
export function useRecommendation(api: string, equipmentId: string, text: string, enabled: boolean) {
  const [result, setResult] = useState<RecommendResult | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled || !equipmentId) {
      setResult(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await fetch(api, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'recommend', equipment: equipmentId, text }),
        });
        const d = (await r.json()) as RecommendResult;
        if (!cancelled && r.ok) setResult(d);
      } catch {
        if (!cancelled) setResult(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 450);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [api, equipmentId, text, enabled]);
  return { result, loading };
}

export function AssigneeHint({
  result,
  loading,
  selected,
  onPick,
}: {
  result: RecommendResult | null;
  loading: boolean;
  selected: string;
  onPick: (id: string) => void;
}) {
  if (loading && !result) return <p className="ai-hint muted small">Подбираем исполнителя…</p>;
  if (!result?.ranked?.length) return null;
  const [best, ...others] = result.ranked;
  return (
    <div className="ai-hint" aria-live="polite">
      <div className="ai-hint-title">
        <Sparkles size={18} /> {best.eligible ? 'Рекомендация системы' : 'Кандидаты для ручного назначения'}
      </div>
      {!best.eligible && (
        <p className="issue small">
          Нет свободного исполнителя нужной специальности. Проверьте загрузку и выберите сотрудника вручную.
        </p>
      )}
      <button
        type="button"
        className={'ai-candidate ' + (selected === best.id ? 'selected' : '')}
        onClick={() => onPick(best.id)}
        aria-pressed={selected === best.id}
      >
        <strong>
          {best.name} · {best.spec}
        </strong>
        <small>{best.reasons.join(' · ')}</small>
      </button>
      {others.slice(0, 2).map((w) => (
        <button
          type="button"
          key={w.id}
          className={'ai-candidate alt ' + (selected === w.id ? 'selected' : '')}
          onClick={() => onPick(w.id)}
          aria-pressed={selected === w.id}
        >
          <span>
            {w.name} · {w.available}
          </span>
          <small>{w.reasons.slice(0, 3).join(' · ')}</small>
        </button>
      ))}
      <p className="muted small">
        Учитываются загрузка, специальность
        {result.specialty ? ` (нужен ${result.specialty.toLowerCase()})` : ''}, опыт на этом оборудовании и
        рейтинг. Решение за мастером.
      </p>
    </div>
  );
}

export function CodeHint({
  result,
  onApplyNorm,
}: {
  result: RecommendResult | null;
  onApplyNorm: (minutes: number) => void;
}) {
  if (!result?.code) return null;
  return (
    <div className="ai-hint code-hint">
      <Sparkles size={16} />
      <span>
        Вероятный шифр: <b>{result.code.id}</b> — {result.code.name}. Норматив {result.code.norm} мин.
      </span>
      <button type="button" className="text-button" onClick={() => onApplyNorm(result.code!.norm)}>
        Применить норматив
      </button>
    </div>
  );
}
