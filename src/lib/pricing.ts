import { QUESTIONS, type Answers } from './quiz';

/**
 * Расчёт вилки стоимости.
 *
 * Считается ТОЛЬКО по трём ответам: что делаем (1), сколько страниц (5),
 * что важнее (6). Бюджет (вопрос 7) в расчёт не входит намеренно: иначе человек
 * увидел бы ровно ту цифру, которую сам и выбрал, и она перестала бы что-то значить.
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
 * на двенадцать страниц, но который честно выбрал «не знаю», увидел бы
 * потолок НИЖЕ, чем если бы ответил точно. Такая модель учит не отвечать.
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

/** Ориентиры «от» из брифа. Низ вилки никогда не опускается ниже. */
const FLOOR = {
  landing: 100_000,
  upto5: 150_000,
  more5: 250_000,
  shop: 300_000,
  redesign: 80_000,
} as const;

type Task = 'new' | 'redesign' | 'shop' | 'unsure';
type Pages = 'one' | 'upto5' | 'more5' | 'unknown';

/** База по паре «что делаем» × «сколько страниц». Только определённые ответы. */
const BASE: Record<Exclude<Task, 'unsure'>, Record<Exclude<Pages, 'unknown'>, number>> = {
  new: {
    one: FLOOR.landing,
    upto5: FLOOR.upto5,
    more5: FLOOR.more5,
  },
  shop: {
    // Магазин — это витрина, карточка, корзина, оплата и выгрузка товаров.
    // Число страниц тут почти ничего не решает, и дешевле ориентира он не бывает.
    one: FLOOR.shop,
    upto5: FLOOR.shop,
    more5: 380_000,
  },
  redesign: {
    one: FLOOR.redesign,
    upto5: 120_000,
    more5: 190_000,
  },
};

/**
 * Что «не знаю» и «пока не определился» означают на самом деле.
 * Низ — самый дешёвый правдоподобный вариант, верх — самый дорогой.
 */
const CHEAPEST_TASK: Exclude<Task, 'unsure'> = 'new';
const DEAREST_TASK: Exclude<Task, 'unsure'> = 'shop';
const CHEAPEST_PAGES: Exclude<Pages, 'unknown'> = 'upto5';
const DEAREST_PAGES: Exclude<Pages, 'unknown'> = 'more5';

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
const STEP = 10_000;

const TASK_LABEL: Record<string, string> = {
  new: 'Сайт с нуля',
  redesign: 'Переделка существующего',
  shop: 'Интернет-магазин',
  unsure: 'Задача пока не определена',
};
const PAGES_LABEL: Record<string, string> = {
  one: 'одна страница',
  upto5: 'до пяти страниц',
  more5: 'больше пяти страниц',
  unknown: 'количество страниц пока не ясно',
};

const roundTo = (value: number) => Math.round(value / STEP) * STEP;
const floorTo = (value: number) => Math.floor(value / STEP) * STEP;
const ceilTo = (value: number) => Math.ceil(value / STEP) * STEP;

function baseOf(task: Exclude<Task, 'unsure'>, pages: Exclude<Pages, 'unknown'>) {
  return BASE[task][pages];
}

/** Пара «самая дешёвая база — самая дорогая база» с учётом неопределённости. */
function baseRange(task: Task, pages: Pages): { low: number; high: number } {
  const tasksLow: Exclude<Task, 'unsure'> = task === 'unsure' ? CHEAPEST_TASK : task;
  const tasksHigh: Exclude<Task, 'unsure'> = task === 'unsure' ? DEAREST_TASK : task;
  const pagesLow: Exclude<Pages, 'unknown'> = pages === 'unknown' ? CHEAPEST_PAGES : pages;
  const pagesHigh: Exclude<Pages, 'unknown'> = pages === 'unknown' ? DEAREST_PAGES : pages;
  return {
    low: baseOf(tasksLow, pagesLow),
    high: baseOf(tasksHigh, pagesHigh),
  };
}

export function calculatePrice(answers: Answers): PriceRange {
  const task = (answers.task ?? 'unsure') as Task;
  const pages = (answers.pages ?? 'unknown') as Pages;
  const priority = answers.priority ?? 'price';

  const bases = BASE[(task === 'unsure' ? CHEAPEST_TASK : task) as Exclude<Task, 'unsure'>]
    ? baseRange(task, pages)
    : baseRange('unsure', 'unknown');
  const weight = PRIORITY[priority] ?? PRIORITY.price;

  const uncertain: string[] = [];
  if (task === 'unsure') uncertain.push('задача');
  if (pages === 'unknown') uncertain.push('объём');
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

  return {
    low,
    high,
    uncertain,
    caveat: caveatFor(task, pages, high),
    factors: [
      { label: 'Задача', value: TASK_LABEL[task] ?? '—' },
      { label: 'Объём', value: volumeLabel(task, pages) },
      { label: 'Приоритет', value: capitalize(weight.note) },
    ],
  };
}

/**
 * Что вилка не покрывает. Считаем самое вероятное прочтение неопределённого
 * ответа, а про менее вероятный, но заметно более дорогой край говорим прямо:
 * это честнее, чем растянуть вилку втрое и сделать её бессмысленной.
 */
function caveatFor(task: Task, pages: Pages, high: number): string | null {
  if (task === 'unsure' && high < FLOOR.shop) {
    return 'Считал по самому частому случаю — обычный сайт. Если задача окажется интернет-магазином, вилка начинается от 300 000 ₽.';
  }
  if (task === 'unsure') {
    return 'Задачу вы пока не выбрали, поэтому вилка широкая: она покрывает и обычный сайт, и интернет-магазин. Определитесь — и я назову диапазон уже.';
  }
  if (pages === 'unknown') {
    return 'Объём вы пока не знаете, поэтому вилка широкая: она покрывает и небольшой сайт, и большой. Как только объём прояснится, диапазон сузится.';
  }
  return null;
}

/**
 * Для магазина число страниц почти не двигает сумму: платят за витрину,
 * карточку, корзину и оплату. Показывать «Объём: одна страница» рядом
 * с тремястами тысячами — значит объяснять цифру тем, что на неё не влияет.
 */
function volumeLabel(task: Task, pages: Pages): string {
  if (task === 'shop' && (pages === 'one' || pages === 'upto5')) {
    return 'Витрина, карточка товара и корзина';
  }
  return capitalize(PAGES_LABEL[pages] ?? '—');
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** 250000 → «250 000». Неразрывные пробелы, чтобы число не рвалось по строкам. */
export function formatMoney(value: number): string {
  return value.toLocaleString('ru-RU').replace(/ |\s/g, ' ');
}

/** Ключи вопросов, которые действительно участвуют в расчёте. */
export const PRICING_INPUTS = ['task', 'pages', 'priority'] as const;

export const PRICING_IGNORED_LABEL =
  QUESTIONS.find((q) => q.id === 'budget')?.title ?? 'Бюджет на проект';
