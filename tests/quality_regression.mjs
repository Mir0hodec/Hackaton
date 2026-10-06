import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { evaluate, rating, brigadeRating } from '../lib/domain.ts';
import { queueHead } from '../lib/queue.ts';
import { recommendWorkers } from '../lib/recommend.ts';
import { validateReview, mergeReview } from '../lib/review-result.ts';
import { analyze, findInsights } from '../lib/analytics.ts';
import { materialUsage } from '../lib/material-usage.ts';
import { reportSheets } from '../lib/report-export.ts';
import { createXlsxBook } from '../lib/xlsx.ts';
const iso = (n) => new Date(Date.now() + n * 60000).toISOString();
const workers = [
  { id: 'w1', name: 'Занятый слесарь', role: 'worker', spec: 'Слесарь', onShift: true, brigade: 1, grade: 6 },
  { id: 'w2', name: 'Свободный слесарь', role: 'worker', spec: 'Слесарь', onShift: true, brigade: 1 },
  { id: 'w3', name: 'Электрик', role: 'worker', spec: 'Электрик', onShift: true, brigade: 2 },
];
const order = {
  id: 'o',
  number: 1,
  title: 'Течь масла',
  description: 'Течь в районе уплотнения',
  worker: 'w1',
  members: ['w1', 'w2'],
  brigade: 1,
  area: 'a',
  equipment: 'e',
  type: 'unplanned',
  created: iso(-120),
  due: iso(60),
  activeMs: 600000,
  norm: 30,
  status: 'closed',
  finished: iso(-10),
  closedAt: iso(-10),
  masterScore: 5,
  acceptedAt: iso(-100),
};
const incomplete = evaluate(order, { works: '', code: '', photos: [], materials: [] });
assert.equal(incomplete.verdict, 'rework');
assert.equal(incomplete.checks.filter((c) => c.status === 'fail').length, 3);
const valid = evaluate(order, {
  works: 'Заменено уплотнение, проверена герметичность',
  code: 'Г-01',
  photos: ['p'],
  materials: [],
});
assert.equal(valid.verdict, 'accepted');
assert.equal(valid.minutes, 10);
assert.ok(valid.checks.find((c) => c.id === 'time').detail.includes('33%'));
const mismatch = evaluate(order, {
  works: 'Заменена электрическая лампа, восстановлено напряжение',
  code: 'Э-01',
  photos: ['p'],
  materials: [],
});
assert.equal(mismatch.verdict, 'remarks');
assert.ok(mismatch.issues.some((s) => s.includes('ключевым словам')));
const queued = [
  { ...order, id: 'late', status: 'accepted', queuedAt: iso(-1) },
  { ...order, id: 'first', status: 'queued', queuedAt: iso(-3) },
];
assert.equal(queueHead(queued, 'w1').id, 'first');
assert.equal(
  queueHead(
    [
      { ...order, id: 'legacy', status: 'accepted', history: [{ at: iso(-4), text: 'Поставлен в очередь' }] },
      ...queued,
    ],
    'w1',
  ).id,
  'legacy',
);
assert.equal(queueHead(queued, 'unknown'), null);
const input = {
  orders: [{ ...order, status: 'working', members: ['w1'] }],
  users: workers,
  equipment: [{ id: 'e', name: 'Насос' }],
  codes: [{ id: 'Г-01', name: 'Течь', norm: 45 }],
  equipmentId: 'e',
  text: 'течь масла',
};
const rec = recommendWorkers(input);
assert.equal(rec.ranked[0].id, 'w2');
assert.ok(rec.ranked[0].eligible);
const blocked = recommendWorkers({ ...input, worklogs: [{ id: 'w2', entries: [{ status: 'active' }] }] });
assert.equal(blocked.ranked.filter((w) => w.eligible).length, 0);
const ai = {
  score: 5,
  confidence: 0.95,
  verdict: 'accepted',
  worksMatchProblem: true,
  materialsReasonable: true,
  sameEquipment: 'yes',
  problemFixedOnPhoto: 'yes',
  photoScore: 5,
  photoAssessment: 'Видимый результат',
  strengths: [],
  improvements: [],
  issues: [],
  summaryForWorker: 'Работы описаны',
  summaryForMaster: 'Проверьте результат',
};
assert.equal(mergeReview(incomplete, ai, 'test', true).verdict, 'rework');
assert.equal(mergeReview(valid, { ...ai, confidence: 0.3 }, 'test', true).verdict, 'remarks');
assert.equal(mergeReview(mismatch, ai, 'test', true).verdict, 'remarks');
const unshown = mergeReview(valid, ai, 'test', false);
assert.equal(unshown.photoScore, 0);
assert.equal(unshown.sameEquipment, 'unclear');
assert.ok(unshown.needsMasterCheck);
assert.equal(unshown.verdict, 'remarks');
for (const bad of [
  { score: 5.5 },
  { confidence: NaN },
  { photoScore: 8 },
  { issues: [5] },
  { worksMatchProblem: 'yes' },
  { verdict: 'closed' },
])
  assert.throws(() => validateReview({ ...ai, ...bad }));
const m = { id: 'm', name: 'Смазка', unit: 'кг', norm: 1 };
const orders = [
  { ...order, report: { code: 'Г-01', materials: [{ ...m, qty: 0.1 }] } },
  {
    ...order,
    id: 'o2',
    number: 2,
    worker: 'w2',
    members: ['w2'],
    report: { code: 'Г-01', materials: [{ ...m, qty: 0.2 }] },
  },
  { ...order, id: 'cancel', status: 'cancelled', report: { code: 'Г-01', materials: [{ ...m, qty: 20 }] } },
];
assert.equal(materialUsage(orders)[0].qty, 0.3);
assert.equal(materialUsage(orders, 'worker').length, 2);
assert.equal(
  materialUsage([...orders, { ...order, id: 'unit', report: { materials: [{ ...m, unit: 'шт.', qty: 2 }] } }])
    .length,
  2,
);
assert.equal(rating([orders[0], orders[2]], 'w1').repeatCount, 0);
assert.equal(brigadeRating(orders, workers, 1).count, 2);
const data = {
  orders,
  users: workers,
  areas: [{ id: 'a', name: 'Участок' }],
  equipment: [
    { id: 'e', name: 'Насос', area: 'a' },
    { id: 'other', name: 'Другой', area: 'a' },
  ],
  codes: [],
};
const filter = { from: Date.now() - 86400000, to: Date.now() + 86400000 };
const a = analyze(data, filter);
assert.equal(a.summary.avgReactionMin, 20);
assert.equal(a.summary.avgActiveMin, 10);
assert.equal(a.materials.materials[0].qty, 0.3);
assert.equal(a.materials.byEquipment[0].groupName, 'Насос');
assert.equal(analyze(data, { ...filter, brigade: 2 }).summary.issued, 0);
const faults = Array.from({ length: 8 }, (_, i) => ({
  ...order,
  id: 'fault' + i,
  number: 10 + i,
  status: 'issued',
}));
assert.ok(findInsights(data, faults, filter).some((i) => i.kind === 'frequent' && i.orderIds.length === 8));
assert.ok(!findInsights(data, faults, { ...filter, equipment: 'e' }).some((i) => i.kind === 'frequent'));
assert.equal(
  findInsights(
    data,
    orders.filter((o) => o.status === 'cancelled'),
    filter,
  ).length,
  0,
);
const sheets = reportSheets(a, 'Тестовый период');
assert.equal(sheets.length, 8);
assert.equal(sheets[0].rows.find((r) => r[0] === 'Выдано нарядов')[1], 3);
writeFileSync(process.env.QUALITY_XLSX, new Uint8Array(await createXlsxBook(sheets).arrayBuffer()));
writeFileSync(
  process.env.QUALITY_LITERAL,
  new Uint8Array(
    await createXlsxBook([{ name: 'Литералы', rows: [['Текст'], ['=HYPERLINK("example")']] }]).arrayBuffer(),
  ),
);
console.log(
  'PASS: FIFO, qualification/availability, strict AI schema, conservative visual fallback, structured checks, unit-safe decimal materials, brigade deduplication, scoped evidence-backed analytics, actual eight-sheet export.',
);
