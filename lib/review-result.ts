/** Runtime validation is also required when a provider promises JSON-schema output. */
export type AiReview = {
  score: number;
  confidence: number;
  verdict: 'accepted' | 'remarks' | 'rework';
  worksMatchProblem: boolean;
  materialsReasonable: boolean;
  sameEquipment: 'yes' | 'no' | 'unclear';
  problemFixedOnPhoto: 'yes' | 'no' | 'unclear' | 'no_photos';
  photoScore: number;
  photoAssessment: string;
  strengths: string[];
  improvements: string[];
  issues: string[];
  summaryForWorker: string;
  summaryForMaster: string;
};
export function validateReview(value: unknown): AiReview {
  const a = value as AiReview;
  const enumValue = (v: unknown, allowed: string[]) => typeof v === 'string' && allowed.includes(v);
  if (
    !a ||
    !Number.isInteger(a.score) ||
    a.score < 1 ||
    a.score > 5 ||
    !Number.isFinite(a.confidence) ||
    a.confidence < 0 ||
    a.confidence > 1 ||
    !Number.isInteger(a.photoScore) ||
    a.photoScore < 0 ||
    a.photoScore > 5 ||
    !enumValue(a.verdict, ['accepted', 'remarks', 'rework']) ||
    !enumValue(a.sameEquipment, ['yes', 'no', 'unclear']) ||
    !enumValue(a.problemFixedOnPhoto, ['yes', 'no', 'unclear', 'no_photos']) ||
    typeof a.worksMatchProblem !== 'boolean' ||
    typeof a.materialsReasonable !== 'boolean' ||
    !['photoAssessment', 'summaryForWorker', 'summaryForMaster'].every(
      (k) => typeof (a as any)[k] === 'string',
    ) ||
    !['issues', 'strengths', 'improvements'].every(
      (k) => Array.isArray((a as any)[k]) && (a as any)[k].every((s: unknown) => typeof s === 'string'),
    )
  )
    throw new Error('Некорректный результат ИИ-проверки');
  return a;
}
/** A model cannot remove formal defects or make visual claims about unsent images. */
export function mergeReview(base: any, value: unknown, model: string, visualComplete = false) {
  const ai = validateReview(value);
  const low = ai.confidence < 0.7;
  const manual = low || !visualComplete;
  let verdict = ai.verdict;
  if (low) verdict = 'remarks';
  if (base.verdict === 'remarks' && verdict === 'accepted') verdict = 'remarks';
  if (!visualComplete && verdict === 'accepted') verdict = 'remarks';
  if (base.verdict === 'rework') verdict = 'rework';
  const issues = [...new Set([...(base.issues || []), ...ai.issues])].slice(0, 12);
  if (issues.length && verdict === 'accepted') verdict = 'remarks';
  if (low) issues.push('ИИ не уверен в оценке: нужна проверка мастером.');
  const visualDetail = visualComplete
    ? ai.photoAssessment
    : 'Полный комплект фото не передан модели. Визуальную проверку выполняет мастер.';
  const checks = (base.checks || []).map((c: any) =>
    c.id === 'visual'
      ? {
          ...c,
          status: visualComplete && ai.problemFixedOnPhoto === 'yes' ? 'pass' : 'review',
          detail: visualDetail,
        }
      : c,
  );
  checks.push({
    id: 'model',
    label: 'Проверка моделью',
    status: verdict === 'accepted' ? 'pass' : verdict === 'rework' ? 'fail' : 'review',
    detail: ai.summaryForMaster,
  });
  return {
    ...base,
    mode: 'ai',
    model,
    aiPending: false,
    confidence: ai.confidence,
    needsMasterCheck: manual,
    verdict,
    issues,
    checks,
    score: Math.max(
      1,
      Math.min(base.score + 1, ai.score, verdict === 'rework' ? 2 : verdict === 'remarks' ? 4 : 5),
    ),
    worksMatchProblem: ai.worksMatchProblem,
    materialsReasonable: ai.materialsReasonable,
    sameEquipment: visualComplete ? ai.sameEquipment : 'unclear',
    problemFixedOnPhoto: visualComplete ? ai.problemFixedOnPhoto : 'unclear',
    photoScore: visualComplete ? ai.photoScore : 0,
    photoAssessment: visualDetail,
    strengths: [...new Set([...(base.strengths || []), ...ai.strengths])].slice(0, 6),
    improvements: [...new Set([...(base.improvements || []), ...ai.improvements])].slice(0, 6),
    summaryForWorker: ai.summaryForWorker,
    summaryForMaster: ai.summaryForMaster,
    note: 'Проверка моделью и формальными правилами. Окончательное решение принимает мастер.',
  };
}
