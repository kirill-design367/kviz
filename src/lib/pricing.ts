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
 */

export type PriceRange = {
  low: number;
  high: number;
  /** Что именно повлияло на число — показываем человеку, чтобы цифра не выглядела гаданием. */
  factors: { label: string; value: string }[];
};

/** Ориентиры «от» из брифа. Низ вилки никогда не опускается ниже. */
const FLOOR = {
  landing: 100_000,
  upto5: 150_000,
  more5: 250_000,
  shop: 300_000,
  redesign: 80_000,
} as const;

/** База по паре «что делаем» × «сколько страниц». */
const BASE: Record<string, Record<string, number>> = {
  new: {
    one: FLOOR.landing,
    upto5: FLOOR.upto5,
    more5: FLOOR.more5,
    unknown: FLOOR.upto5,
  },
  shop: {
    // Магазин — это витрина, карточка, корзина, оплата и выгрузка товаров.
    // Дешевле ориентира он не бывает даже «на одной странице».
    one: FLOOR.shop,
    upto5: FLOOR.shop,
    more5: 380_000,
    unknown: 320_000,
  },
  redesign: {
    one: FLOOR.redesign,
    upto5: 120_000,
    more5: 190_000,
    unknown: 120_000,
  },
  unsure: {
    one: FLOOR.landing,
    upto5: FLOOR.upto5,
    more5: FLOOR.more5,
    unknown: 140_000,
  },
};

/** Приоритет: [множитель низа, множитель верха]. Низ никогда не меньше 1. */
const PRIORITY: Record<string, { low: number; high: number; note: string }> = {
  design: { low: 1.15, high: 1.55, note: 'уникальный дизайн' },
  features: { low: 1.2, high: 1.65, note: 'функциональность' },
  speed: { low: 1.0, high: 1.25, note: 'скорость запуска' },
  price: { low: 1.0, high: 1.3, note: 'цена' },
};

/** Неопределённость расширяет вилку вверх: честнее широкий диапазон, чем выдуманная точность. */
const VAGUE_PAGES = 1.2;
const VAGUE_TASK = 1.15;

const MIN_SPREAD = 1.25;
const MAX_SPREAD = 2.2;
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

const floorTo = (value: number) => Math.floor(value / STEP) * STEP;
const ceilTo = (value: number) => Math.ceil(value / STEP) * STEP;

export function calculatePrice(answers: Answers): PriceRange {
  const task = answers.task ?? 'unsure';
  const pages = answers.pages ?? 'unknown';
  const priority = answers.priority ?? 'price';

  const base = BASE[task]?.[pages] ?? BASE.unsure.unknown;
  const weight = PRIORITY[priority] ?? PRIORITY.price;

  let low = base * weight.low;
  let high = base * weight.high;

  if (pages === 'unknown') high *= VAGUE_PAGES;
  if (task === 'unsure') high *= VAGUE_TASK;

  low = floorTo(low);
  high = ceilTo(high);

  // Диапазон должен читаться как диапазон, но не как «от забора до обеда».
  if (high < low * MIN_SPREAD) high = ceilTo(low * MIN_SPREAD);
  if (high > low * MAX_SPREAD) high = ceilTo(low * MAX_SPREAD);

  return {
    low,
    high,
    factors: [
      { label: 'Задача', value: TASK_LABEL[task] ?? '—' },
      { label: 'Объём', value: PAGES_LABEL[pages] ?? '—' },
      { label: 'Приоритет', value: capitalize(weight.note) },
    ],
  };
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** 250000 → «250 000». Неразрывные пробелы, чтобы число не рвалось по строкам. */
export function formatMoney(value: number): string {
  return value.toLocaleString('ru-RU').replace(/ |\s/g, ' ');
}

/** Ключи вопросов, которые действительно участвуют в расчёте. */
export const PRICING_INPUTS = ['task', 'pages', 'priority'] as const;

export const PRICING_IGNORED_LABEL =
  QUESTIONS.find((q) => q.id === 'budget')?.title ?? 'Бюджет на проект';
