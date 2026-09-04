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

test('бюджет никогда не поднимает цену', () => {
  // Платить больше за ту же работу только потому, что человек может, — нельзя.
  for (const c of all()) {
    const base = price(c.task, c.pages, c.priority, 'discuss');
    for (const budget of BUDGETS) {
      const other = price(c.task, c.pages, c.priority, budget);
      assert.ok(
        other.low <= base.low,
        `бюджет ${budget} поднял низ для ${JSON.stringify(c)}: ${base.low} → ${other.low}`,
      );
      assert.ok(
        other.high <= base.high,
        `бюджет ${budget} поднял верх для ${JSON.stringify(c)}: ${base.high} → ${other.high}`,
      );
    }
  }
});

test('щедрый бюджет ничего не меняет', () => {
  // «Больше 300 000» и «обсуждается» ограничением не являются.
  for (const c of all()) {
    const base = price(c.task, c.pages, c.priority, 'discuss');
    for (const budget of ['gt300', 'discuss']) {
      const other = price(c.task, c.pages, c.priority, budget);
      assert.equal(other.low, base.low, `${budget} сдвинул низ для ${JSON.stringify(c)}`);
      assert.equal(other.high, base.high, `${budget} сдвинул верх для ${JSON.stringify(c)}`);
    }
  }
});

test('бюджет ниже вилки подтягивает её вниз', () => {
  // Хотя бы там, где ориентир студии оставляет место для движения.
  let moved = 0;
  for (const c of all()) {
    const base = price(c.task, c.pages, c.priority, 'discuss');
    const tight = price(c.task, c.pages, c.priority, 'lt50');
    if (tight.high < base.high) moved += 1;
  }
  assert.ok(moved > 30, `бюджет сдвинул вилку только в ${moved} комбинациях из 64`);
});

test('бюджет не опускает низ ниже ориентира студии', () => {
  const floors: Record<string, Record<string, number>> = {
    new: { one: 100_000, upto5: 150_000, more5: 250_000, unknown: 150_000 },
    shop: { one: 300_000, upto5: 300_000, more5: 300_000, unknown: 300_000 },
    redesign: { one: 80_000, upto5: 80_000, more5: 80_000, unknown: 80_000 },
    unsure: { one: 100_000, upto5: 150_000, more5: 250_000, unknown: 100_000 },
  };
  for (const c of all())
    for (const budget of BUDGETS) {
      const r = price(c.task, c.pages, c.priority, budget);
      const floor = floors[c.task][c.pages];
      assert.ok(
        r.low >= floor,
        `${JSON.stringify(c)} + бюджет ${budget}: низ ${r.low} ниже ориентира ${floor}`,
      );
    }
});

test('вилка сближается с бюджетом, а не подстраивается под него', () => {
  // Движение навстречу есть, но цифра не становится равной названной сумме.
  const base = price('shop', 'upto5', 'features', 'discuss');
  const tight = price('shop', 'upto5', 'features', 'lt50');
  assert.ok(tight.high < base.high, 'верх не сдвинулся навстречу бюджету');
  assert.ok(tight.low > 50_000, 'низ опустился до названной суммы — это подстройка, а не оценка');
});

test('когда вилка всё равно выше бюджета — об этом сказано', () => {
  for (const c of all()) {
    const r = price(c.task, c.pages, c.priority, 'lt50');
    if (r.low > 50_000 * 1.15) {
      assert.ok(
        r.caveat && r.caveat.includes('50 000'),
        `${JSON.stringify(c)}: вилка от ${r.low} при бюджете до 50 000, а оговорки нет`,
      );
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

test('вилка не уже 1.35 и не шире допустимого для своей неопределённости', () => {
  for (const c of all()) {
    const r = price(c.task, c.pages, c.priority);
    const spread = r.high / r.low;
    const limit = [2.21, 2.51, 2.81][r.uncertain.length];
    assert.ok(spread >= 1.349, `${JSON.stringify(c)}: вилка слишком узкая (${spread.toFixed(2)})`);
    assert.ok(spread <= limit, `${JSON.stringify(c)}: вилка ${spread.toFixed(2)} шире предела ${limit}`);
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

test('«не знаю» про страницы накрывает пол большого честного ответа', () => {
  // Главное свойство: человеку, которому нужно двенадцать страниц, не должно
  // быть выгодно ответить «не знаю» — иначе квиз учит не отвечать.
  for (const task of TASKS)
    for (const priority of PRIORITY) {
      const vague = price(task, 'unknown', priority);
      for (const pages of ['upto5', 'more5']) {
        const exact = price(task, pages, priority);
        assert.ok(
          vague.low <= exact.low && exact.low <= vague.high,
          `${task}/${priority}: пол честного «${pages}» (${exact.low}) не попадает в вилку «не знаю» (${vague.low}–${vague.high})`,
        );
      }
    }
});

test('«не знаю» уходит выше среднего честного ответа', () => {
  for (const task of ['new', 'redesign', 'shop'])
    for (const priority of PRIORITY) {
      const vague = price(task, 'unknown', priority);
      const middle = price(task, 'upto5', priority);
      assert.ok(
        vague.high > middle.high,
        `${task}/${priority}: потолок «не знаю» (${vague.high}) не выше потолка «до пяти» (${middle.high})`,
      );
    }
});

test('«пока не определился» не дешевле самого вероятного прочтения', () => {
  // Вилку строим по обычному сайту: это самый частый случай. Более дорогой
  // край (интернет-магазин) в неё не всегда влезает — тогда о нём говорится
  // словами в caveat, а не растягиванием вилки втрое.
  for (const pages of PAGES)
    for (const priority of PRIORITY) {
      const vague = price('unsure', pages, priority);
      const likely = price('new', pages, priority);
      assert.ok(vague.low <= likely.low, `${pages}/${priority}: «не определился» дороже по полу`);
      assert.ok(vague.high >= likely.high, `${pages}/${priority}: «не определился» ниже по потолку`);
    }
});

test('у неопределённых ответов всегда есть оговорка, у точных — нет', () => {
  for (const c of all()) {
    const r = price(c.task, c.pages, c.priority);
    if (r.uncertain.length === 0) {
      assert.equal(r.caveat, null, `${JSON.stringify(c)}: оговорка там, где всё определено`);
    } else {
      assert.ok(r.caveat && r.caveat.length > 20, `${JSON.stringify(c)}: нет оговорки`);
    }
  }
});

test('если магазин не влезает в вилку неопределённой задачи — об этом сказано', () => {
  for (const pages of PAGES)
    for (const priority of PRIORITY) {
      const vague = price('unsure', pages, priority);
      if (vague.high < 300_000) {
        assert.ok(
          vague.caveat?.includes('300 000'),
          `${pages}/${priority}: вилка до ${vague.high}, а про порог магазина не сказано`,
        );
      }
    }
});

test('список неопределённых ответов соответствует выбору', () => {
  assert.deepEqual(price('new', 'upto5', 'design').uncertain, []);
  assert.deepEqual(price('unsure', 'upto5', 'design').uncertain, ['задача']);
  assert.deepEqual(price('new', 'unknown', 'design').uncertain, ['объём']);
  assert.deepEqual(price('unsure', 'unknown', 'design').uncertain, ['задача', 'объём']);
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
