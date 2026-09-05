import { QUESTIONS, type Answers } from './quiz';

/**
 * Расчёт вилки стоимости.
 *
 * Основа — три ответа: что делаем (1), какая структура (5), что важнее (6).
 * Названный бюджет (7) двигает вилку ТОЛЬКО ВВЕРХ. Подробности — у BUDGET_BAND.
 *
 * Ориентиры студии — это НИЖНИЕ границы («от»), поэтому ни один множитель
 * не опускает низ вилки под соответствующий ориентир. «Скорость запуска»
 * двигает вилку вниз относительно других приоритетов тем, что прижимает верх:
 * меньше итераций и меньше объём — потолок ниже, а пол остаётся полом.
 *
 * Неопределённость («не знаю», «пока не определился») трактуется как
 * ОБЪЕДИНЕНИЕ правдоподобных вариантов: низ берётся от самого дешёвого
 * из них, верх — от самого дорогого. Если считать неопределённость просто
 * «средним случаем», получается ловушка: человек, которому нужен магазин
 * но который честно выбрал «не знаю», увидел бы потолок НИЖЕ, чем если бы
 * ответил точно. Такая модель учит не отвечать.
 */

export type PriceRange = {
  low: number;
  high: number;
  /** Что именно повлияло на число — показываем человеку, чтобы цифра не выглядела гаданием. */
  factors: { label: string; value: string }[];
  /** Ответы, которые человек оставил неопределёнными. Пусто — значит вилка узкая по делу. */
  uncertain: string[];
  /**
   * Оговорка для неопределённых ответов: что именно вилка НЕ покрывает.
   * Строго накрыть все варианты нельзя — от переделки лендинга до магазина
   * получается разброс больше чем втрое, а такая вилка уже ничего не значит.
   * Поэтому вилка строится по самому вероятному прочтению, а край,
   * который в неё не попал, называется словами.
   */
  caveat: string | null;
};

/**
 * Ориентиры «от». Низ вилки никогда не опускается ниже.
 * Уровень цен вдвое ниже прежнего — так решил заказчик.
 */
const FLOOR = {
  landing: 50_000,
  multi: 95_000,
  shop: 150_000,
} as const;

type Task = 'new' | 'redesign' | 'shop' | 'unsure';
type Structure = 'landing' | 'multi' | 'shop' | 'unknown';
type CertainTask = Exclude<Task, 'unsure'>;
type CertainStructure = Exclude<Structure, 'unknown'>;

/**
 * База по паре «что делаем» × «структура». Только определённые ответы.
 *
 * Переделка дешевле работы с нуля при той же структуре: часть решений,
 * контента и логики уже существует. Магазин стоит своего ориентира
 * независимо от того, назван он в первом вопросе или в пятом, — иначе
 * два пути к одному и тому же ответу давали бы разные деньги.
 */
const BASE: Record<CertainTask, Record<CertainStructure, number>> = {
  new: {
    landing: FLOOR.landing,
    multi: FLOOR.multi,
    shop: FLOOR.shop,
  },
  shop: {
    landing: FLOOR.shop,
    multi: FLOOR.shop,
    shop: FLOOR.shop,
  },
  redesign: {
    landing: 40_000,
    multi: 75_000,
    shop: 120_000,
  },
};

/**
 * Что «не знаю» и «пока не определился» означают на самом деле.
 * Низ — самый дешёвый правдоподобный вариант, верх — самый дорогой.
 *
 * Про структуру важная тонкость. Если человек в первом вопросе уже сказал,
 * что это не магазин, то «не знаю» про структуру означает выбор между
 * лендингом и многостраничником, а не «вплоть до магазина»: тянуть верх
 * до магазина значило бы не поверить его же ответу и раздуть вилку втрое.
 * Магазин попадает в верх только тогда, когда и задача не определена.
 */
const CHEAPEST_TASK: CertainTask = 'new';
const DEAREST_TASK: CertainTask = 'shop';
const CHEAPEST_STRUCTURE: CertainStructure = 'landing';

/**
 * Диапазон, который человек назвал в вопросе о бюджете.
 * null — числа нет: «больше 300 000» и «обсуждается» ничего не задают,
 * а отсутствие ответа тем более. Там считаем чисто по задаче.
 */
const BUDGET_BAND: Record<string, { low: number; high: number } | null> = {
  lt50: { low: 0, high: 50_000 },
  '50-150': { low: 50_000, high: 150_000 },
  '150-300': { low: 150_000, high: 300_000 },
  gt300: null,
  discuss: null,
};

/** Приоритет: [множитель низа, множитель верха]. Низ никогда не меньше 1. */
const PRIORITY: Record<string, { low: number; high: number; note: string }> = {
  design: { low: 1.15, high: 1.55, note: 'уникальный дизайн' },
  features: { low: 1.25, high: 1.7, note: 'функциональность' },
  speed: { low: 1.0, high: 1.25, note: 'скорость запуска' },
  price: { low: 1.0, high: 1.35, note: 'цена' },
};

/**
 * Ширина вилки. Уже 1.35 — читается как смета, а не как оценка по трём кликам,
 * и человек запомнит верх как обещание.
 *
 * Потолок ширины зависит от того, сколько ответов человек оставил
 * неопределёнными. Единый жёсткий потолок срезал бы верх именно у самых
 * неопределённых ответов — и получалось бы, что «не знаю» даёт потолок ниже,
 * чем честный дорогой ответ. Это ровно та ловушка, которой быть не должно.
 */
const MIN_SPREAD = 1.35;
const MAX_SPREAD_BY_UNCERTAINTY = [2.2, 2.5, 2.8];
/* Шаг округления. Вдвое мельче прежнего: суммы стали вдвое меньше,
   и десятитысячный шаг съедал бы разницу между вариантами. */
const STEP = 5_000;

const TASK_LABEL: Record<string, string> = {
  new: 'Сайт с нуля',
  redesign: 'Переделка существующего',
  shop: 'Интернет-магазин',
  unsure: 'Задача пока не определена',
};
const STRUCTURE_LABEL: Record<string, string> = {
  landing: 'лендинг',
  multi: 'многостраничник',
  shop: 'интернет-магазин',
  unknown: 'структура пока не выбрана',
};

const roundTo = (value: number) => Math.round(value / STEP) * STEP;
const floorTo = (value: number) => Math.floor(value / STEP) * STEP;
const ceilTo = (value: number) => Math.ceil(value / STEP) * STEP;

function baseOf(task: CertainTask, structure: CertainStructure) {
  return BASE[task][structure];
}

/** Пара «самая дешёвая база — самая дорогая база» с учётом неопределённости. */
function baseRange(task: Task, structure: Structure): { low: number; high: number } {
  const taskLow: CertainTask = task === 'unsure' ? CHEAPEST_TASK : task;
  const taskHigh: CertainTask = task === 'unsure' ? DEAREST_TASK : task;
  const structLow: CertainStructure =
    structure === 'unknown' ? CHEAPEST_STRUCTURE : structure;
  // Магазин уходит в верх, только если задача тоже не названа.
  const structHigh: CertainStructure =
    structure === 'unknown' ? (task === 'unsure' ? 'shop' : 'multi') : structure;
  return {
    low: baseOf(taskLow, structLow),
    high: baseOf(taskHigh, structHigh),
  };
}

export function calculatePrice(answers: Answers): PriceRange {
  const task = (answers.task ?? 'unsure') as Task;
  // Выбравшим магазин в первом вопросе вопрос про структуру не задаётся,
  // поэтому структура берётся из задачи, а не из пропущенного ответа.
  const structure: Structure =
    task === 'shop' ? 'shop' : ((answers.structure ?? 'unknown') as Structure);
  const priority = answers.priority ?? 'price';

  const bases = BASE[task === 'unsure' ? CHEAPEST_TASK : task]
    ? baseRange(task, structure)
    : baseRange('unsure', 'unknown');
  const weight = PRIORITY[priority] ?? PRIORITY.price;

  const uncertain: string[] = [];
  if (task === 'unsure') uncertain.push('задача');
  if (structure === 'unknown') uncertain.push('структура');
  const maxSpread = MAX_SPREAD_BY_UNCERTAINTY[uncertain.length] ?? 2.8;

  let low = roundTo(bases.low * weight.low);
  let high = ceilTo(bases.high * weight.high);

  // Пол — это обещание студии, ниже ориентира он не опускается никогда.
  if (low < bases.low) low = bases.low;

  // Диапазон должен читаться как диапазон, но не как «от забора до обеда».
  // Обе границы клампа считаются в свою сторону: иначе округление вверх
  // при понижающем ограничителе делает сам ограничитель недостижимым.
  if (high < low * MIN_SPREAD) high = ceilTo(low * MIN_SPREAD);
  if (high > low * maxSpread) high = floorTo(low * maxSpread);

  /*
   * Бюджет двигает вилку ТОЛЬКО ВВЕРХ и только когда он весь выше расчёта.
   *
   * Человек, назвавший 150–300 тысяч на задаче, которая считается в 80, —
   * это не повод показать ему 80: работа в его бюджет укладывается с запасом,
   * и разговор пойдёт о том, что в этот бюджет ещё можно уложить.
   *
   * Вниз бюджет не двигает НИЧЕГО и ни при каких ответах: за меньшие деньги
   * работа не делается, и обещать её нельзя. Назвал до 50 тысяч на задаче
   * в 150 — видит 150.
   */
  const band = BUDGET_BAND[answers.budget ?? ''] ?? null;
  if (band && band.high > high) {
    low = Math.max(low, band.low);
    high = band.high;
  }

  return {
    low,
    high,
    uncertain,
    caveat: caveatFor(task, structure, high),
    factors: [
      { label: 'Задача', value: TASK_LABEL[task] ?? '—' },
      { label: 'Структура', value: capitalize(STRUCTURE_LABEL[structure] ?? '—') },
      { label: 'Приоритет', value: capitalize(weight.note) },
    ],
  };
}

/**
 * Что вилка не покрывает. Считаем самое вероятное прочтение неопределённого
 * ответа, а про менее вероятный, но заметно более дорогой край говорим прямо:
 * это честнее, чем растянуть вилку втрое и сделать её бессмысленной.
 */
function caveatFor(task: Task, structure: Structure, high: number): string | null {
  if (task === 'unsure' && high < FLOOR.shop) {
    return 'Считал по самому частому случаю — обычный сайт. Если задача окажется интернет-магазином, вилка начинается от 150 000 ₽.';
  }
  if (task === 'unsure') {
    return 'Задачу вы пока не выбрали, поэтому вилка широкая: она покрывает и обычный сайт, и интернет-магазин. Определитесь — и я назову диапазон уже.';
  }
  if (structure === 'unknown') {
    return 'Структуру вы пока не выбрали, поэтому вилка широкая: она покрывает и лендинг, и многостраничник. Как только структура прояснится, диапазон сузится.';
  }
  return null;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** 250000 → «250 000». Неразрывные пробелы, чтобы число не рвалось по строкам. */
export function formatMoney(value: number): string {
  return value.toLocaleString('ru-RU').replace(/ |\s/g, ' ');
}

/** Ключи вопросов, которые участвуют в расчёте. */
export const PRICING_INPUTS = ['task', 'structure', 'priority', 'budget'] as const;

export const BUDGET_QUESTION_LABEL =
  QUESTIONS.find((q) => q.id === 'budget')?.title ?? 'Бюджет на проект';
