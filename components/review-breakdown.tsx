export function ReviewBreakdown({ check }: any) {
  if (!check?.checks?.length) return null;
  return (
    <div className="review-checks">
      {check.checks.map((c: any) => (
        <div key={c.id} className={'review-check ' + c.status}>
          <span aria-hidden="true">{c.status === 'pass' ? '✓' : c.status === 'fail' ? '×' : '!'}</span>
          <div>
            <strong>{c.label}</strong>
            <p>{c.detail}</p>
          </div>
        </div>
      ))}
      {check.confidence !== undefined && (
        <p className="muted small">
          Уверенность модели: {Math.round(check.confidence * 100)}%.{' '}
          {check.confidence < 0.7 ? 'Нужна проверка мастером.' : ''}
        </p>
      )}
    </div>
  );
}
