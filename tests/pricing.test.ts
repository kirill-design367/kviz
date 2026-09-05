import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePrice, BUDGETS_WITHOUT_RANGE } from '../src/lib/pricing';
import { QUESTIONS, visibleQuestions } from '../src/lib/quiz';

const TASKS = ['new', 'redesign', 'shop', 'unsure'];
const STRUCTURES = ['landing', 'multi', 'shop', 'unknown'];
const PRIORITY = ['speed', 'design', 'features', 'price'];

const all = () => {
  const out: { task: string; structure: string; priority: string }[] = [];
  for (const task of TASKS)
    for (const structure of STRUCTURES)
      for (const priority of PRIORITY) out.push({ task, structure, priority });
  return out;
};

const price = (task: string, structure: string, priority: string, budget: string) =>
  calculatePrice({ task, structure, priority, budget, goal: 'sell', assets: 'idea', deadline: 'month' });

/** Верхняя граница названного бюджета и вилка, которая из неё получается. */
const NAMED: Record<string, { cap: number; low: number; high: number }> = {
  lt50: { cap: 50_000, low: 45_000, high: 60_000 },
  '50-150': { cap: 150_000, low: 140_000, high: 175_000 },
  '150-300': { cap: 300_000, low: 285_000, high: 345_000 },
};

/** Ответы без верхней границы: числа на экране не будет вовсе. */
const UNNAMED = ['gt300', 'discuss'];

test('названный бюджет задаёт вилку целиком', () => {
  // Ни задача, ни структура, ни приоритет на число не влияют:
  // все 64 комбинации ответов дают один и тот же диапазон.
  for (const [budget, want] of Object.entries(NAMED)) {
    for (const c of all()) {
      const r = price(c.task, c.structure, c.priority, budget);
      assert.equal(r.kind, 'range', `${budget}: вилка должна быть`);
      if (r.kind !== 'range') continue;
      assert.deepEqual(
        [r.low, r.high],
        [want.low, want.high],
        `${JSON.stringify(c)} + ${budget}: получено ${r.low}—${r.high}`,
      );
    }
  }
});

test('вилка от бюджета — это минус 5 % и плюс 15 % от его потолка', () => {
  for (const [budget, want] of Object.entries(NAMED)) {
    const r = price('new', 'landing', 'price', budget);
    assert.equal(r.kind, 'range');
    if (r.kind !== 'range') return;
    const rawLow = want.cap * 0.95;
    const rawHigh = want.cap * 1.15;
    // Округление только расширяет вилку и не больше чем на шаг.
    assert.ok(r.low <= rawLow, `${budget}: низ ${r.low} выше расчётных ${rawLow}`);
    assert.ok(r.low > rawLow - 5_000, `${budget}: низ ${r.low} опущен больше чем на шаг`);
    assert.ok(r.high >= rawHigh, `${budget}: верх ${r.high} ниже расчётных ${rawHigh}`);
    assert.ok(r.high < rawHigh + 5_000, `${budget}: верх ${r.high} поднят больше чем на шаг`);
  }
});

test('низ вилки не выскакивает выше названного бюджета', () => {
  // Человек сказал «до 50 000» — он должен увидеть свою сумму внутри вилки,
  // а не диапазон, который весь начинается от его потолка.
  for (const [budget, want] of Object.entries(NAMED)) {
    const r = price('new', 'landing', 'price', budget);
    if (r.kind !== 'range') return assert.fail(`${budget}: нет вилки`);
    assert.ok(r.low < want.cap, `${budget}: низ ${r.low} не ниже потолка ${want.cap}`);
    assert.ok(r.high > want.cap, `${budget}: верх ${r.high} не выше потолка ${want.cap}`);
  }
});

test('всё кратно 5 000 — цифра читается как оценка, а не как смета', () => {
  for (const c of all())
    for (const budget of Object.keys(NAMED)) {
      const r = price(c.task, c.structure, c.priority, budget);
      if (r.kind !== 'range') return assert.fail(`${budget}: нет вилки`);
      assert.equal(r.low % 5_000, 0, `низ ${r.low} не кратен 5 000 (${budget})`);
      assert.equal(r.high % 5_000, 0, `верх ${r.high} не кратен 5 000 (${budget})`);
    }
});

test('без верхней границы бюджета вилки нет вовсе', () => {
  // Раньше здесь работал расчёт по задаче, и человек, назвавший
  // «больше 300 000», видел 55 000—80 000. Теперь числа нет.
  for (const budget of UNNAMED)
    for (const c of all()) {
      const r = price(c.task, c.structure, c.priority, budget);
      assert.equal(r.kind, 'discuss', `${JSON.stringify(c)} + ${budget}: показана вилка`);
      assert.ok(
        !('low' in r) && !('high' in r),
        `${JSON.stringify(c)} + ${budget}: в ответе остались числа`,
      );
    }
});

test('вместо вилки — строка про обсуждение', () => {
  for (const budget of UNNAMED) {
    const r = price('new', 'landing', 'price', budget);
    if (r.kind !== 'discuss') return assert.fail(`${budget}: вилка вместо строки`);
    assert.ok(r.note.length > 20, `${budget}: строка слишком короткая`);
    assert.ok(/обсужден|обсуди/i.test(r.note), `${budget}: в строке нет речи об обсуждении`);
    // Правила проекта: без восклицательных знаков и без латиницы.
    assert.ok(!r.note.includes('!'), `${budget}: восклицательный знак`);
    assert.ok(!/[A-Za-z]/.test(r.note), `${budget}: латиница в строке`);
    assert.ok(!/\d/.test(r.note), `${budget}: в строке появилось число, а его быть не должно`);
  }
});

test('ответы без числа перечислены там же, где вопрос', () => {
  // Список берётся из самого вопроса, а не из отдельной копии: добавят
  // вариант в quiz.ts — он попадёт в расчёт, а не забудется здесь.
  assert.deepEqual([...BUDGETS_WITHOUT_RANGE].sort(), [...UNNAMED].sort());
});

test('неполные ответы не превращаются в число', () => {
  // Бюджет не назван вообще — придумывать сумму не из чего.
  assert.equal(calculatePrice({}).kind, 'discuss');
  assert.equal(calculatePrice({ task: 'shop' }).kind, 'discuss');
  const withBudget = calculatePrice({ budget: 'lt50' });
  assert.equal(withBudget.kind, 'range', 'один только бюджет уже задаёт вилку');
});

test('в квизе семь вопросов, а магазину задаётся шесть', () => {
  assert.equal(QUESTIONS.length, 7);
  for (const q of QUESTIONS) assert.ok(q.options.length >= 4, `${q.id}: мало вариантов`);
  assert.equal(visibleQuestions({}).length, 7);
  assert.equal(visibleQuestions({ task: 'new' }).length, 7);
  assert.equal(visibleQuestions({ task: 'shop' }).length, 6);
  assert.ok(
    !visibleQuestions({ task: 'shop' }).some((q) => q.id === 'structure'),
    'магазину всё ещё показывают вопрос про структуру',
  );
});
