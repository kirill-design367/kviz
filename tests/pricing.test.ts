import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePrice } from '../src/lib/pricing';
import { QUESTIONS } from '../src/lib/quiz';

const TASKS = ['new', 'redesign', 'shop', 'unsure'];
const PAGES = ['one', 'upto5', 'more5', 'unknown'];
const PRIORITY = ['speed', 'design', 'features', 'price'];
const BUDGETS = ['lt50', '50-150', '150-300', 'gt300', 'discuss'];

const all = () => {
  const out: { task: string; pages: string; priority: string }[] = [];
  for (const task of TASKS)
    for (const pages of PAGES)
      for (const priority of PRIORITY) out.push({ task, pages, priority });
  return out;
};

const price = (task: string, pages: string, priority: string, budget = 'discuss') =>
  calculatePrice({ task, pages, priority, budget, goal: 'sell', assets: 'idea', deadline: 'month' });

test('все 64 комбинации дают положительный диапазон', () => {
  for (const c of all()) {
    const r = price(c.task, c.pages, c.priority);
    assert.ok(r.low > 0, `low > 0 для ${JSON.stringify(c)}`);
    assert.ok(r.high > r.low, `high > low для ${JSON.stringify(c)}, получено ${r.low}–${r.high}`);
  }
});

test('ответ про бюджет не влияет на расчёт', () => {
  for (const c of all()) {
    const base = price(c.task, c.pages, c.priority, 'discuss');
    for (const budget of BUDGETS) {
      const other = price(c.task, c.pages, c.priority, budget);
      assert.equal(other.low, base.low, `бюджет ${budget} сдвинул низ для ${JSON.stringify(c)}`);
      assert.equal(other.high, base.high, `бюджет ${budget} сдвинул верх для ${JSON.stringify(c)}`);
    }
  }
});

test('низ вилки не опускается ниже ориентиров студии', () => {
  const floors: Record<string, Record<string, number>> = {
    new: { one: 100_000, upto5: 150_000, more5: 250_000, unknown: 150_000 },
    shop: { one: 300_000, upto5: 300_000, more5: 300_000, unknown: 300_000 },
    redesign: { one: 80_000, upto5: 80_000, more5: 80_000, unknown: 80_000 },
    unsure: { one: 100_000, upto5: 150_000, more5: 250_000, unknown: 100_000 },
  };
  for (const c of all()) {
    const r = price(c.task, c.pages, c.priority);
    const floor = floors[c.task][c.pages];
    assert.ok(r.low >= floor, `${JSON.stringify(c)}: низ ${r.low} ниже ориентира ${floor}`);
  }
});

test('больше страниц — не дешевле', () => {
  for (const task of TASKS)
    for (const priority of PRIORITY) {
      const one = price(task, 'one', priority);
      const five = price(task, 'upto5', priority);
      const many = price(task, 'more5', priority);
      assert.ok(five.low >= one.low, `${task}/${priority}: до пяти дешевле одной`);
      assert.ok(many.low >= five.low, `${task}/${priority}: больше пяти дешевле пяти`);
    }
});

test('уникальный дизайн и функциональность дороже скорости запуска', () => {
  for (const task of TASKS)
    for (const pages of PAGES) {
      const speed = price(task, pages, 'speed');
      const design = price(task, pages, 'design');
      const features = price(task, pages, 'features');
      assert.ok(design.low >= speed.low, `${task}/${pages}: дизайн не дороже скорости`);
      assert.ok(features.low >= design.low, `${task}/${pages}: функциональность дешевле дизайна`);
      assert.ok(speed.high <= design.high, `${task}/${pages}: верх скорости выше верха дизайна`);
    }
});

test('магазин не дешевле сайта с нуля, переделка не дороже сайта с нуля', () => {
  for (const pages of PAGES)
    for (const priority of PRIORITY) {
      const fresh = price('new', pages, priority);
      const shop = price('shop', pages, priority);
      const redo = price('redesign', pages, priority);
      assert.ok(shop.low >= fresh.low, `${pages}/${priority}: магазин дешевле сайта с нуля`);
      assert.ok(redo.low <= fresh.low, `${pages}/${priority}: переделка дороже сайта с нуля`);
    }
});

test('вилка не уже 1.25 и не шире 2.2', () => {
  for (const c of all()) {
    const r = price(c.task, c.pages, c.priority);
    const spread = r.high / r.low;
    assert.ok(spread >= 1.249, `${JSON.stringify(c)}: вилка слишком узкая (${spread.toFixed(2)})`);
    assert.ok(spread <= 2.21, `${JSON.stringify(c)}: вилка слишком широкая (${spread.toFixed(2)})`);
  }
});

test('неопределённость расширяет вилку', () => {
  for (const priority of PRIORITY) {
    const known = price('new', 'upto5', priority);
    const unknownPages = price('new', 'unknown', priority);
    assert.ok(
      unknownPages.high / unknownPages.low >= known.high / known.low,
      `${priority}: «не знаю» про страницы не расширило вилку`,
    );
  }
});

test('всё кратно 10 000 — цифра читается как оценка, а не как смета', () => {
  for (const c of all()) {
    const r = price(c.task, c.pages, c.priority);
    assert.equal(r.low % 10_000, 0, `низ ${r.low} не кратен 10 000`);
    assert.equal(r.high % 10_000, 0, `верх ${r.high} не кратен 10 000`);
  }
});

test('неполные ответы не ломают расчёт', () => {
  const r = calculatePrice({});
  assert.ok(r.low > 0 && r.high > r.low);
  const partial = calculatePrice({ task: 'shop' });
  assert.ok(partial.low >= 300_000, 'магазин без остальных ответов должен быть от 300 000');
});

test('в квизе ровно семь вопросов и у каждого есть варианты', () => {
  assert.equal(QUESTIONS.length, 7);
  for (const q of QUESTIONS) assert.ok(q.options.length >= 4, `${q.id}: мало вариантов`);
});
