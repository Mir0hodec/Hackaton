// Генератор демонстрационных справочников и истории нарядов за 90 дней.
// Данные синтетические, детерминированные (seeded PRNG) и помечены synthetic: true.
// В историю специально заложены закономерности, которые должна находить аналитика:
//   1. Конвейер К-3 ломается примерно в 3 раза чаще среднего, в основном шифр М-02 (подшипник).
//   2. Исполнитель hw09 часто получает возвраты на доработку и повторные отказы в течение 7 дней.
//   3. Ночная смена на участке дробления даёт вдвое больше внеплановых нарядов.
//   4. Мельница МШЦ-3600 отказывает в течение недели после планового ремонта (ППР).
//   5. Бригада 3 систематически списывает материалы выше справочного ориентира.
//   6. Число отказов магистрального конвейера К-12 растёт от месяца к месяцу (прогноз отказа).

import { enterpriseMidnight, isNight } from './shift';

export const DAY = 86400000;
const MIN = 60000;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const areas = [
  { id: 'a0', name: 'Дробление' },
  { id: 'a1', name: 'Обогащение' },
  { id: 'a2', name: 'Ремонтно-механический цех' },
  { id: 'a3', name: 'Транспортный участок' },
];

type EquipmentType =
  | 'conveyor'
  | 'crusher'
  | 'feeder'
  | 'screen'
  | 'pump'
  | 'mill'
  | 'classifier'
  | 'separator'
  | 'fan'
  | 'compressor'
  | 'machine'
  | 'crane'
  | 'press'
  | 'welder'
  | 'motor'
  | 'tipper'
  | 'electrical';

export const equipmentTypes: Record<EquipmentType, string> = {
  conveyor: 'Конвейер',
  crusher: 'Дробилка',
  feeder: 'Питатель',
  screen: 'Грохот',
  pump: 'Насос',
  mill: 'Мельница',
  classifier: 'Классификатор',
  separator: 'Сепаратор',
  fan: 'Вентилятор',
  compressor: 'Компрессор',
  machine: 'Станок',
  crane: 'Кран',
  press: 'Пресс',
  welder: 'Сварочное оборудование',
  motor: 'Электродвигатель',
  tipper: 'Вагоноопрокидыватель',
  electrical: 'Электрооборудование',
};

const eq = (id: string, name: string, area: string, type: EquipmentType, critical = false) => ({
  id,
  name,
  area,
  type,
  critical,
  inventory: 'КМ-' + String(1000 + Number(id.slice(1))),
});

export const equipment = [
  eq('e0', 'Насос шламовый Н-12', 'a1', 'pump', true),
  eq('e1', 'Конвейер ленточный К-3', 'a0', 'conveyor', true),
  eq('e2', 'Дробилка конусная КМД-1750', 'a0', 'crusher', true),
  eq('e3', 'Дробилка щековая ЩДП-12×15', 'a0', 'crusher', true),
  eq('e4', 'Питатель пластинчатый ПП-2-12', 'a0', 'feeder'),
  eq('e5', 'Конвейер ленточный К-5', 'a0', 'conveyor'),
  eq('e6', 'Грохот инерционный ГИТ-51', 'a0', 'screen'),
  eq('e7', 'Дробилка конусная КСД-2200', 'a0', 'crusher'),
  eq('e8', 'Мельница шаровая МШЦ-3600', 'a1', 'mill', true),
  eq('e9', 'Насос грунтовый ГрАТ-1400', 'a1', 'pump'),
  eq('e10', 'Классификатор спиральный 2КСН-24', 'a1', 'classifier'),
  eq('e11', 'Сепаратор пневматический СП-2', 'a1', 'separator'),
  eq('e12', 'Вентилятор дутьевой ВДН-12,5', 'a1', 'fan'),
  eq('e13', 'Компрессор винтовой ВВ-32', 'a1', 'compressor'),
  eq('e14', 'Станок токарный 1М63', 'a2', 'machine'),
  eq('e15', 'Кран мостовой 10 т', 'a2', 'crane', true),
  eq('e16', 'Пресс гидравлический П-6326', 'a2', 'press'),
  eq('e17', 'Компрессор поршневой 4ВУ1-5/9', 'a2', 'compressor'),
  eq('e18', 'Сварочный выпрямитель ВДУ-506', 'a2', 'welder'),
  eq('e19', 'Конвейер магистральный К-12', 'a3', 'conveyor', true),
  eq('e20', 'Насосная станция водоотлива НС-2', 'a3', 'pump'),
  eq('e21', 'Электродвигатель АИР-315 привода К-12', 'a3', 'motor'),
  eq('e22', 'Вагоноопрокидыватель ВРС-125', 'a3', 'tipper', true),
  eq('e23', 'Трансформаторная подстанция КТП-1000', 'a3', 'electrical', true),
  eq('e24', 'Перегружатель П-4', 'a3', 'conveyor'),
];

// norm — норматив времени на устранение, минут.
export const codes = [
  { id: 'М-01', name: 'Износ или повреждение уплотнения', norm: 90 },
  { id: 'М-02', name: 'Повреждение подшипника', norm: 120 },
  { id: 'М-03', name: 'Ослабление крепления, вибрация', norm: 60 },
  { id: 'М-04', name: 'Износ ленты, футеровки или рабочих органов', norm: 180 },
  { id: 'Э-01', name: 'Повреждение кабеля или соединения', norm: 90 },
  { id: 'Э-02', name: 'Отказ электродвигателя', norm: 180 },
  { id: 'Э-03', name: 'Неисправность пускорегулирующей аппаратуры', norm: 60 },
  { id: 'Э-04', name: 'Отказ датчика или КИП', norm: 45 },
  { id: 'Г-01', name: 'Течь масла в гидросистеме или редукторе', norm: 90 },
  { id: 'Г-02', name: 'Отказ гидронасоса', norm: 150 },
  { id: 'Г-03', name: 'Повреждение рукава высокого давления', norm: 60 },
  { id: 'Г-04', name: 'Неисправность гидрораспределителя', norm: 120 },
  { id: 'П-01', name: 'Утечка сжатого воздуха', norm: 45 },
  { id: 'П-02', name: 'Отказ пневмоцилиндра', norm: 90 },
  { id: 'П-03', name: 'Неисправность пневмоклапана', norm: 60 },
  { id: 'П-04', name: 'Засорение фильтра или влагоотделителя', norm: 30 },
  { id: 'С-01', name: 'Недостаток смазки узла', norm: 30 },
  { id: 'С-02', name: 'Загрязнение или обводнение масла', norm: 60 },
  { id: 'С-03', name: 'Отказ системы централизованной смазки', norm: 90 },
  { id: 'С-04', name: 'Перегрев узла из-за смазки', norm: 60 },
];

// norm — справочный ориентир расхода на один наряд.
const material = (i: number, name: string, unit: string, norm: number) => ({
  id: 'mat' + i,
  name,
  unit,
  norm,
});
export const materials = [
  material(0, 'Подшипник 22320', 'шт.', 2),
  material(1, 'Подшипник 6312', 'шт.', 2),
  material(2, 'Подшипник 3626', 'шт.', 2),
  material(3, 'Манжета армированная 100×125', 'шт.', 2),
  material(4, 'Кольцо уплотнительное 080-090', 'шт.', 4),
  material(5, 'Набивка сальниковая АП-31', 'кг', 1),
  material(6, 'Смазка Литол-24', 'кг', 2),
  material(7, 'Смазка ЦИАТИМ-201', 'кг', 1),
  material(8, 'Масло индустриальное И-40А', 'л', 20),
  material(9, 'Масло гидравлическое ВМГЗ', 'л', 20),
  material(10, 'Болт М16×60', 'шт.', 12),
  material(11, 'Болт М20×80', 'шт.', 12),
  material(12, 'Гайка М16', 'шт.', 12),
  material(13, 'Шайба пружинная 16', 'шт.', 12),
  material(14, 'Кабель ВВГнг 3×2,5', 'м', 20),
  material(15, 'Кабель КГ 3×16+1×6', 'м', 30),
  material(16, 'Наконечник кабельный ТМЛ 16', 'шт.', 6),
  material(17, 'Изолента ПВХ', 'шт.', 2),
  material(18, 'Пускатель магнитный ПМЛ-2100', 'шт.', 1),
  material(19, 'Автоматический выключатель ВА47-63', 'шт.', 1),
  material(20, 'Датчик индуктивный ВБИ-М18', 'шт.', 1),
  material(21, 'Предохранитель ППН-35', 'шт.', 3),
  material(22, 'Рукав высокого давления 2SN-16', 'шт.', 2),
  material(23, 'Фильтр гидравлический', 'шт.', 1),
  material(24, 'Ремкомплект гидроцилиндра', 'компл.', 1),
  material(25, 'Фитинг гидравлический', 'шт.', 4),
  material(26, 'Пневмоцилиндр DNC-63', 'шт.', 1),
  material(27, 'Пневмораспределитель 5/2', 'шт.', 1),
  material(28, 'Фильтр-влагоотделитель', 'шт.', 1),
  material(29, 'Трубка пневматическая 10 мм', 'м', 10),
  material(30, 'Лента конвейерная, ремонтная вставка', 'м', 6),
  material(31, 'Ролик конвейерный 133×465', 'шт.', 4),
  material(32, 'Клей для стыковки ленты', 'кг', 2),
  material(33, 'Плита футеровочная', 'шт.', 4),
  material(34, 'Электроды МР-3 Ø4', 'кг', 3),
  material(35, 'Ремень клиновой С(В)-2240', 'шт.', 4),
  material(36, 'Муфта упругая МУВП', 'шт.', 1),
  material(37, 'Ветошь обтирочная', 'кг', 2),
  material(38, 'Очиститель-обезжириватель', 'л', 2),
  material(39, 'Герметик анаэробный', 'шт.', 1),
];

// Что списывают при каждом шифре.
const codeMaterials: Record<string, number[]> = {
  'М-01': [3, 4, 5],
  'М-02': [0, 1, 2, 6],
  'М-03': [10, 11, 12, 13],
  'М-04': [30, 31, 32, 33, 34],
  'Э-01': [14, 15, 16, 17],
  'Э-02': [1, 36, 6],
  'Э-03': [18, 19, 21],
  'Э-04': [20, 16],
  'Г-01': [9, 4, 39],
  'Г-02': [23, 9],
  'Г-03': [22, 25],
  'Г-04': [24, 9],
  'П-01': [29, 25],
  'П-02': [26],
  'П-03': [27],
  'П-04': [28],
  'С-01': [6, 7],
  'С-02': [8, 9],
  'С-03': [7, 29],
  'С-04': [6, 8],
};

// Типичные неисправности по типам оборудования (шифр: вес).
const typeFaults: Record<EquipmentType, Record<string, number>> = {
  conveyor: { 'М-02': 3, 'М-04': 3, 'М-03': 2, 'Э-02': 1, 'Э-01': 1, 'С-01': 1 },
  crusher: { 'М-02': 2, 'М-03': 2, 'С-01': 2, 'С-04': 1, 'Г-01': 2, 'М-04': 1 },
  feeder: { 'М-03': 2, 'М-04': 2, 'М-02': 1, 'Э-03': 1 },
  screen: { 'М-03': 3, 'М-02': 2, 'Э-02': 1 },
  pump: { 'М-01': 3, 'Г-01': 2, 'М-02': 2, 'Э-02': 1, 'Э-04': 1 },
  mill: { 'М-02': 2, 'С-03': 2, 'С-04': 2, 'М-04': 1, 'Э-02': 1 },
  classifier: { 'М-02': 2, 'М-03': 2, 'С-01': 1 },
  separator: { 'П-01': 2, 'П-04': 2, 'Э-04': 1, 'М-03': 1 },
  fan: { 'М-02': 2, 'М-03': 2, 'Э-02': 1 },
  compressor: { 'П-01': 2, 'П-04': 2, 'С-02': 2, 'Э-02': 1, 'П-03': 1 },
  machine: { 'Э-03': 2, 'С-01': 2, 'М-03': 1, 'Э-04': 1 },
  crane: { 'Э-03': 2, 'Э-01': 2, 'М-03': 1, 'С-01': 1 },
  press: { 'Г-01': 2, 'Г-03': 2, 'Г-04': 2, 'Г-02': 1 },
  welder: { 'Э-01': 2, 'Э-03': 2 },
  motor: { 'Э-02': 2, 'М-02': 2, 'Э-01': 1, 'С-04': 1 },
  tipper: { 'Г-01': 2, 'Г-03': 2, 'М-03': 1, 'Э-03': 1 },
  electrical: { 'Э-03': 3, 'Э-01': 2, 'Э-04': 1 },
};

const faultTexts: Record<string, { title: string; description: string; works: string }> = {
  'М-01': {
    title: 'Течь через уплотнение',
    description:
      'Подтекание по валу, мокрое пятно под агрегатом. Заменить уплотнение, проверить вал на износ.',
    works:
      'Разобран узел уплотнения, заменены манжета и кольца, вал проверен на биение. Выполнен пробный пуск, течи нет.',
  },
  'М-02': {
    title: 'Шум и нагрев подшипникового узла',
    description:
      'Посторонний шум, температура узла выше нормы. Заменить подшипник, проверить посадку и смазку.',
    works:
      'Заменён подшипник, посадочные места очищены и проверены, узел заполнен смазкой. Пробный пуск: шум и нагрев в норме.',
  },
  'М-03': {
    title: 'Повышенная вибрация',
    description: 'Вибрация при работе, ослаблены крепления. Протянуть крепёж, проверить фундаментные болты.',
    works:
      'Протянуты крепления и фундаментные болты, заменён повреждённый крепёж. Вибрация после пуска в пределах нормы.',
  },
  'М-04': {
    title: 'Износ рабочих органов',
    description: 'Износ ленты (футеровки), видимые повреждения. Заменить изношенный участок.',
    works:
      'Заменён изношенный участок, выполнена стыковка и наплавка, проверено центрирование. Работа без замечаний.',
  },
  'Э-01': {
    title: 'Повреждение силового кабеля',
    description: 'Агрегат отключается, повреждена изоляция кабеля. Найти место повреждения и восстановить.',
    works:
      'Найдено и вырезано повреждённое место, выполнена муфта, установлены наконечники, сопротивление изоляции в норме.',
  },
  'Э-02': {
    title: 'Отказ электродвигателя',
    description:
      'Двигатель не запускается или срабатывает защита. Проверить обмотки, заменить двигатель при необходимости.',
    works:
      'Проверены обмотки и подшипники двигателя, заменена муфта, выполнена центровка. Ток холостого хода в норме.',
  },
  'Э-03': {
    title: 'Не работает пуск агрегата',
    description: 'Не срабатывает пускатель, агрегат не запускается со щита. Проверить пусковую аппаратуру.',
    works:
      'Заменён пускатель и автоматический выключатель, проверены цепи управления. Пуск со щита работает.',
  },
  'Э-04': {
    title: 'Отказ датчика',
    description: 'Нет сигнала от датчика, агрегат в аварии. Проверить и заменить датчик.',
    works: 'Заменён датчик, переобжаты наконечники, проверена индикация на щите. Сигнал стабильный.',
  },
  'Г-01': {
    title: 'Течь масла',
    description:
      'Течь масла из гидросистемы (редуктора), падение уровня масла. Найти место течи и устранить.',
    works:
      'Заменены уплотнительные кольца, соединение обработано герметиком, масло долито до уровня. Течи после пуска нет.',
  },
  'Г-02': {
    title: 'Падение давления в гидросистеме',
    description: 'Не развивается рабочее давление, шум гидронасоса. Проверить насос и фильтр.',
    works: 'Заменён фильтр, промыт бак, проверена производительность насоса. Давление в норме.',
  },
  'Г-03': {
    title: 'Разрыв рукава высокого давления',
    description: 'Порыв РВД, выброс масла. Заменить рукав, убрать разлив.',
    works: 'Заменён рукав высокого давления и фитинги, разлив убран, масло долито. Проверено под давлением.',
  },
  'Г-04': {
    title: 'Не переключается гидрораспределитель',
    description: 'Рабочий орган не двигается или двигается рывками. Проверить распределитель.',
    works: 'Установлен ремкомплект распределителя, гидросистема прокачана. Движение плавное.',
  },
  'П-01': {
    title: 'Утечка сжатого воздуха',
    description: 'Слышен выход воздуха, компрессор работает без остановки. Найти и устранить утечку.',
    works: 'Найдена и устранена утечка, заменены трубка и фитинг. Давление в сети держится.',
  },
  'П-02': {
    title: 'Не работает пневмоцилиндр',
    description: 'Цилиндр не выдвигается или подклинивает. Заменить цилиндр.',
    works: 'Заменён пневмоцилиндр, отрегулированы дроссели. Ход полный, без рывков.',
  },
  'П-03': {
    title: 'Неисправен пневмоклапан',
    description: 'Клапан не переключается, травит воздух. Заменить распределитель.',
    works: 'Заменён пневмораспределитель, проверены сигналы управления. Работа нормальная.',
  },
  'П-04': {
    title: 'Засорён фильтр-влагоотделитель',
    description: 'Вода и масло в пневмосети, падение давления. Заменить фильтр.',
    works: 'Заменён фильтр-влагоотделитель, слит конденсат из сети. Давление в норме.',
  },
  'С-01': {
    title: 'Сухое трение в узле',
    description: 'Узел работает без смазки, слышен скрип. Смазать узел, проверить точки смазки.',
    works: 'Узел промыт, заложена свежая смазка, проверены все точки смазки. Скрип устранён.',
  },
  'С-02': {
    title: 'Загрязнение масла',
    description: 'Масло тёмное, с водой. Заменить масло, найти причину обводнения.',
    works: 'Масло слито, картер промыт, залито свежее масло. Проверены сапуны и уплотнения.',
  },
  'С-03': {
    title: 'Отказ централизованной смазки',
    description:
      'Не подаётся смазка к узлам, срабатывает сигнализация станции смазки. Проверить станцию и линии.',
    works: 'Прочищены линии и питатели станции смазки, заменена трубка, смазка подаётся во все точки.',
  },
  'С-04': {
    title: 'Перегрев узла',
    description: 'Температура узла выше допустимой. Проверить смазку и охлаждение.',
    works: 'Заменена смазка, очищены рёбра охлаждения, проверен режим работы. Температура в норме.',
  },
};

const planned = [
  {
    title: 'Плановый осмотр и обслуживание (ППР)',
    works:
      'Выполнен осмотр, протяжка креплений, смазка узлов по карте смазки, проверка защит. Замечаний нет.',
  },
  {
    title: 'Плановая замена расходных материалов',
    works: 'Заменены фильтры и смазка по графику, проверены уплотнения. Оборудование сдано в работу.',
  },
  {
    title: 'Плановый ремонт узла (ППР)',
    works:
      'Выполнен плановый ремонт узла по графику ППР, заменены изношенные детали, проведён контрольный пуск.',
  },
];

export type HistoryUser = {
  id: string;
  name: string;
  role: string;
  spec: string;
  grade?: number;
  brigade?: number;
  onShift?: boolean;
};

// worker1 и worker2 — реальные учётные записи смены; остальные — синтетические сотрудники
// без пароля (войти под ними нельзя), они нужны только для истории и рейтинга.
export const historyWorkers: HistoryUser[] = [
  { id: 'worker1', name: 'Иван Петров', spec: 'Слесарь', grade: 5, brigade: 1 },
  { id: 'worker2', name: 'Сергей Ким', spec: 'Электрик', grade: 5, brigade: 1 },
  { id: 'hw03', name: 'Андрей Волков', spec: 'Сварщик', grade: 4, brigade: 1 },
  { id: 'hw04', name: 'Марат Исаев', spec: 'Слесарь', grade: 4, brigade: 1 },
  { id: 'hw05', name: 'Олег Смирнов', spec: 'Электрик', grade: 6, brigade: 1 },
  { id: 'hw06', name: 'Руслан Омаров', spec: 'Слесарь', grade: 5, brigade: 2 },
  { id: 'hw07', name: 'Дмитрий Белов', spec: 'Электрик', grade: 4, brigade: 2 },
  { id: 'hw08', name: 'Николай Фёдоров', spec: 'Сварщик', grade: 5, brigade: 2 },
  { id: 'hw09', name: 'Арман Алиев', spec: 'Слесарь', grade: 3, brigade: 2 },
  { id: 'hw10', name: 'Павел Козлов', spec: 'Слесарь', grade: 5, brigade: 2 },
  { id: 'hw11', name: 'Вадим Титов', spec: 'Слесарь', grade: 4, brigade: 3 },
  { id: 'hw12', name: 'Данияр Сериков', spec: 'Электрик', grade: 5, brigade: 3 },
  { id: 'hw13', name: 'Игорь Морозов', spec: 'Сварщик', grade: 4, brigade: 3 },
  { id: 'hw14', name: 'Александр Егоров', spec: 'Слесарь', grade: 6, brigade: 3 },
  { id: 'hw15', name: 'Тимур Каримов', spec: 'Электрик', grade: 3, brigade: 3 },
].map((w) => ({ ...w, role: 'worker' }));

export const historyMasters: HistoryUser[] = [
  { id: 'master', name: 'Алексей Соколов', role: 'master', spec: 'Мастер смены' },
  { id: 'master2', name: 'Ерлан Ахметов', role: 'master', spec: 'Мастер смены' },
];

/** Специальность, которая обычно устраняет неисправность с данным шифром. */
export function specialtyForCode(code: string) {
  if (code.startsWith('Э')) return 'Электрик';
  if (code === 'М-04') return 'Сварщик';
  return 'Слесарь';
}

export function catalogs() {
  return { areas, equipment, codes, materials };
}

export function generateHistory(now = Date.now(), seed = 20261016) {
  const rnd = mulberry32(seed);
  const pick = <T>(items: T[]) => items[Math.floor(rnd() * items.length)];
  const weighted = (weights: Record<string, number>) => {
    const entries = Object.entries(weights);
    let r = rnd() * entries.reduce((s, [, w]) => s + w, 0);
    for (const [key, w] of entries) if ((r -= w) <= 0) return key;
    return entries[entries.length - 1][0];
  };
  const days = 90;
  const start = now - days * DAY;
  const orders: any[] = [];
  let number = 1001;

  const brigadeOf = (id: string) => historyWorkers.find((w) => w.id === id)!.brigade!;
  const workersFor = (spec: string) => historyWorkers.filter((w) => w.spec === spec);

  function makeOrder(o: {
    created: number;
    equipmentId: string;
    type: 'planned' | 'unplanned';
    code: string;
    worker?: string;
    priority?: string;
    forceRepeat?: boolean;
  }) {
    const e = equipment.find((x) => x.id === o.equipmentId)!;
    const code = codes.find((c) => c.id === o.code)!;
    const spec = specialtyForCode(code.id);
    const worker = o.worker || pick(workersFor(spec)).id;
    const brigade = brigadeOf(worker);
    const isNightShift = isNight(o.created);
    const priority =
      o.priority ||
      (o.type === 'planned'
        ? 'planned'
        : e.critical && rnd() < (isNightShift && e.area === 'a0' ? 0.45 : 0.2)
          ? 'emergency'
          : rnd() < 0.35
            ? 'high'
            : 'normal');
    const norm = o.type === 'planned' ? 120 : code.norm;
    const complexity = norm >= 150 ? 3 : norm >= 90 ? 2 : 1;
    const reaction = (priority === 'emergency' ? 2 + rnd() * 6 : 5 + rnd() * 25) * MIN;
    const accepted = o.created + reaction;
    const started = accepted + (priority === 'emergency' ? 1 : 5 + rnd() * 30) * MIN;
    // Слабый исполнитель hw09 работает дольше и чаще выходит за норматив.
    const slowness = worker === 'hw09' ? 1.1 + rnd() * 0.9 : 0.6 + rnd() * 0.75;
    const activeMinutes = Math.round(norm * slowness);
    const pause = rnd() < 0.15 ? Math.round(20 + rnd() * 120) : 0;
    const finished = started + (activeMinutes + pause) * MIN;
    const dueHours = priority === 'emergency' ? 2 : priority === 'high' ? 4 : priority === 'planned' ? 8 : 6;
    const due = o.created + dueHours * 3600000;
    const closedAt = finished + (10 + rnd() * 90) * MIN;
    const text = o.type === 'planned' ? pick(planned) : faultTexts[code.id];

    // Материалы: обычно в пределах ориентира; бригада 3 часто списывает больше.
    const overuse = brigade === 3 ? rnd() < 0.42 : rnd() < 0.04;
    const materialIds = codeMaterials[code.id].slice(0, o.type === 'planned' ? 1 : 1 + Math.floor(rnd() * 2));
    if (rnd() < 0.5) materialIds.push(37);
    const used = materialIds.map((idx, i) => {
      const m = materials[idx];
      const base = Math.max(1, Math.round(m.norm * (0.3 + rnd() * 0.6)));
      const qty = overuse && i === 0 ? Math.round(m.norm * (1.6 + rnd() * 1.4)) : base;
      return { ...m, qty };
    });

    const returned = worker === 'hw09' ? rnd() < 0.4 : rnd() < 0.05;
    const quality = worker === 'hw09' ? (rnd() < 0.5 ? 3 : 2) : rnd() < 0.55 ? 5 : rnd() < 0.85 ? 4 : 3;
    const masterId = isNightShift ? 'master2' : 'master';
    const downtime =
      o.type === 'planned'
        ? Math.round(activeMinutes * 0.8)
        : Math.round(((finished - o.created) / MIN) * (e.critical ? 1 : 0.7));
    const iso = (t: number) => new Date(t).toISOString();
    const history = [
      { at: iso(o.created), actor: masterId, text: 'Наряд выдан' },
      { at: iso(accepted), actor: worker, text: 'Наряд принят' },
      { at: iso(started), actor: worker, text: 'Начато исполнение' },
      ...(pause
        ? [
            {
              at: iso(started + (activeMinutes * MIN) / 2),
              actor: worker,
              text: 'Работа приостановлена: ожидание запчастей со склада',
            },
          ]
        : []),
      ...(returned
        ? [
            {
              at: iso(finished - 30 * MIN),
              actor: masterId,
              text: 'Мастер вернул на доработку: неполный отчёт, повторить проверку узла',
            },
          ]
        : []),
      { at: iso(finished), actor: worker, text: 'Отчёт направлен мастеру' },
      { at: iso(closedAt), actor: masterId, text: 'Наряд принят мастером' },
    ];
    const order = {
      id: 'hist-' + number,
      number: number++,
      synthetic: true,
      type: o.type,
      title: `${text.title}: ${e.name}`,
      description:
        o.type === 'planned'
          ? 'Работы по графику планово-предупредительного ремонта.'
          : (text as any).description,
      area: e.area,
      equipment: e.id,
      worker,
      members: [worker],
      brigade: null,
      master: masterId,
      priority,
      complexity,
      norm,
      created: iso(o.created),
      acceptedAt: iso(accepted),
      due: iso(due),
      started: iso(started),
      finished: iso(finished),
      closedAt: iso(closedAt),
      activeMs: activeMinutes * MIN,
      status: 'closed',
      returned,
      report: { works: text.works, code: code.id, materials: used, photos: [], comment: '' },
      check: {
        score: quality,
        verdict: returned ? 'remarks' : 'accepted',
        issues: [],
        mode: 'seed',
        minutes: activeMinutes,
      },
      masterScore: quality,
      photos: [],
      downtime,
      history,
    };
    orders.push(order);
    return order;
  }

  // Средняя интенсивность отказов на единицу оборудования в сутки.
  const baseRate = 1.4 / equipment.length;
  for (let d = 0; d < days; d++) {
    const dayStart = start + d * DAY;
    const midnight = enterpriseMidnight(dayStart);

    for (const e of equipment) {
      // Плановые ремонты: раз в ~14 дней на единицу, в дневную смену.
      // Плановые ремонты: раз в ~7 дней на единицу (мельница — чаще), в дневную смену.
      if (rnd() < (e.id === 'e8' ? 1 / 13 : 1 / 6)) {
        const created = midnight + (8 + rnd() * 8) * 3600000;
        if (created < now - DAY) {
          const code = weighted(typeFaults[e.type as EquipmentType]);
          makeOrder({ created, equipmentId: e.id, type: 'planned', code });
          // Закономерность 4: мельница МШЦ-3600 отказывает вскоре после ППР.
          if (e.id === 'e8' && rnd() < 0.8) {
            const failure = created + (0.3 + rnd() * 2.2) * DAY;
            if (failure < now - 3600000)
              makeOrder({
                created: failure,
                equipmentId: 'e8',
                type: 'unplanned',
                code: rnd() < 0.6 ? 'С-03' : 'М-02',
              });
          }
        }
      }

      // Внеплановые отказы.
      let rate = baseRate;
      if (e.id === 'e1') rate *= 3.5; // Закономерность 1: К-3 ломается примерно в 3 раза чаще остальных
      if (e.id === 'e19') rate = 0.02 + 0.4 * (d / days) ** 2; // Закономерность 6: растущий тренд К-12 (отказов в сутки)
      for (const night of [false, true]) {
        let shiftRate = rate / 2;
        if (night && e.area === 'a0') shiftRate *= 2.2; // Закономерность 3: ночная смена дробления
        if (rnd() < shiftRate) {
          const hour = night ? 20 + rnd() * 12 : 8 + rnd() * 12;
          const created = midnight + hour * 3600000;
          if (created > now - 3600000) continue;
          const code = e.id === 'e1' && rnd() < 0.65 ? 'М-02' : weighted(typeFaults[e.type as EquipmentType]);
          const order = makeOrder({ created, equipmentId: e.id, type: 'unplanned', code });
          // Закономерность 2: после ремонта hw09 неисправность часто повторяется в течение недели.
          if (order.worker === 'hw09' && rnd() < 0.45) {
            const repeat = Date.parse(order.closedAt) + (1 + rnd() * 5) * DAY;
            if (repeat < now - 3600000)
              makeOrder({ created: repeat, equipmentId: e.id, type: 'unplanned', code });
          }
        }
      }
    }
  }

  // Несколько отказов от нарядов: часть обоснованы, у hw09 — без уважительной причины.
  for (let i = 0; i < 14; i++) {
    const created = start + rnd() * (days - 1) * DAY;
    const e = pick(equipment);
    const unjustified = i % 3 === 0;
    const worker = unjustified ? 'hw09' : pick(historyWorkers).id;
    const iso = (t: number) => new Date(t).toISOString();
    const reason = unjustified
      ? 'Занят другими работами'
      : pick(['Нет допуска к работам на высоте', 'Нет материалов на складе', 'Занят аварийным нарядом']);
    orders.push({
      id: 'hist-' + number,
      number: number++,
      synthetic: true,
      type: 'unplanned',
      title: `${faultTexts['М-03'].title}: ${e.name}`,
      description: faultTexts['М-03'].description,
      area: e.area,
      equipment: e.id,
      worker,
      members: [worker],
      brigade: null,
      master: 'master',
      priority: 'normal',
      complexity: 1,
      norm: 60,
      created: iso(created),
      due: iso(created + 6 * 3600000),
      status: 'rejected',
      rejectionReason: reason,
      rejectionUnjustified: unjustified,
      photos: [],
      downtime: 0,
      history: [
        { at: iso(created), actor: 'master', text: 'Наряд выдан' },
        { at: iso(created + 12 * MIN), actor: worker, text: 'Наряд отклонён: ' + reason },
      ],
    });
  }

  // Номера выдаются по порядку создания, как в реальном журнале.
  orders.sort((a, b) => Date.parse(a.created) - Date.parse(b.created));
  orders.forEach((o, i) => {
    o.number = 1001 + i;
    o.id = 'hist-' + o.number;
  });
  return orders;
}
