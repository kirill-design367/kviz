import test from 'node:test';
import assert from 'node:assert/strict';
import { calculatePrice } from '../src/lib/pricing';
import { QUESTIONS, visibleQuestions } from '../src/lib/quiz';

const TASKS = ['new', 'redesign', 'shop', 'unsure'];
const STRUCTURES = ['landing', 'multi', 'shop', 'unknown'];
const PRIORITY = ['speed', 'design', 'features', 'price'];
const BUDGETS = ['lt50', '50-150', '150-300', 'gt300', 'discuss'];

const all = () => {
  const out: { task: string; structure: string; priority: string }[] = [];
  for (const task of TASKS)
    for (const structure of STRUCTURES)
      for (const priority of PRIORITY) out.push({ task, structure, priority });
  return out;
};

const price = (task: string, structure: string, priority: string, budget = 'discuss') =>
  calculatePrice({ task, structure, priority, budget, goal: 'sell', assets: 'idea', deadline: 'month' });

test('все 64 комбинации дают положительный диапазон', () => {
  for (const c of all()) {
    const r = price(c.task, c.structure, c.priority);
    assert.ok(r.low > 0, `low > 0 для ${JSON.stringify(c)}`);
    assert.ok(r.high > r.low, `high > low для ${JSON.stringify(c)}, получено ${r.low}–${r.high}`);
  }
});

/** Верхняя граница названного бюджета и вилка, которая из неё получается. */
const NAMED: Record<string, { cap: number; low: number; high: number }> = {
  lt50: { cap: 50_000, low: 45_000, high: 60_000 },
  '50-150': { cap: 150_000, low: 140_000, high: 175_000 },
  '150-300': { cap: 300_000, low: 285_000, high: 345_000 },
};

test('названный бюджет задаёт вилку целиком', () => {
  // Ни задача, ни структура, ни приоритет на число больше не влияют:
  // все 64 комбинации ответов дают один и тот же диапазон.
  for (const [budget, want] of Object.entries(NAMED)) {
    for (const c of all()) {
      const r = price(c.task, c.structure, c.priority, budget);
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
    assert.ok(r.low < want.cap, `${budget}: низ ${r.low} не ниже потолка ${want.cap}`);
    assert.ok(r.high > want.cap, `${budget}: верх ${r.high} не выше потолка ${want.cap}`);
  }
});

test('у названного бюджета нет оговорок про неопределённость', () => {
  // Ширина вилки взялась из бюджета, а не из того, чего человек не выбрал,
  // и говорить про «не знаю» здесь было бы неправдой.
  for (const budget of Object.keys(NAMED))
    for (const c of all()) {
      const r = price(c.task, c.structure, c.priority, budget);
      assert.equal(r.caveat, null, `${JSON.stringify(c)} + ${budget}: осталась оговорка`);
      assert.deepEqual(r.uncertain, [], `${JSON.stringify(c)} + ${budget}: остались неопределённые`);
    }
});

test('щедрый бюджет ничего не меняет', () => {
  // «Больше 300 000» и «обсуждается» ограничением не являются.
  for (const c of all()) {
    const base = price(c.task, c.structure, c.priority, 'discuss');
    for (const budget of ['gt300', 'discuss']) {
      const other = price(c.task, c.structure, c.priority, budget);
      assert.equal(other.low, base.low, `${budget} сдвинул низ для ${JSON.stringify(c)}`);
      assert.equal(other.high, base.high, `${budget} сдвинул верх для ${JSON.stringify(c)}`);
    }
  }
});

test('низ вилки не опускается ниже ориентиров студии', () => {
  const floors: Record<string, Record<string, number>> = {
    new: { landing: 50_000, multi: 95_000, shop: 150_000, unknown: 50_000 },
    shop: { landing: 150_000, multi: 150_000, shop: 150_000, unknown: 150_000 },
    redesign: { landing: 40_000, multi: 75_000, shop: 120_000, unknown: 40_000 },
    unsure: { landing: 50_000, multi: 95_000, shop: 150_000, unknown: 50_000 },
  };
  for (const c of all()) {
    const r = price(c.task, c.structure, c.priority);
    const floor = floors[c.task][c.structure];
    assert.ok(r.low >= floor, `${JSON.stringify(c)}: низ ${r.low} ниже ориентира ${floor}`);
  }
});

test('структура дороже по нарастающей: лендинг → многостраничник → магазин', () => {
  for (const task of TASKS)
    for (const priority of PRIORITY) {
      const landing = price(task, 'landing', priority);
      const multi = price(task, 'multi', priority);
      const shop = price(task, 'shop', priority);
      assert.ok(multi.low >= landing.low, `${task}/${priority}: многостраничник дешевле лендинга`);
      assert.ok(shop.low >= multi.low, `${task}/${priority}: магазин дешевле многостраничника`);
    }
});

test('магазин стоит одинаково, назван он в первом вопросе или в пятом', () => {
  // Иначе два пути к одному ответу давали бы разные деньги.
  for (const priority of PRIORITY) {
    const viaFirst = price('shop', 'unknown', priority);
    const viaFifth = price('new', 'shop', priority);
    assert.equal(viaFirst.low, viaFifth.low, `${priority}: низ разошёлся`);
    assert.equal(viaFirst.high, viaFifth.high, `${priority}: верх разошёлся`);
  }
});

test('магазину структуру не задают, и ответ на неё ничего не меняет', () => {
  for (const priority of PRIORITY) {
    const base = price('shop', 'unknown', priority);
    for (const structure of STRUCTURES) {
      const other = price('shop', structure, priority);
      assert.equal(other.low, base.low, `${priority}/${structure}: низ поехал`);
      assert.equal(other.high, base.high, `${priority}/${structure}: верх поехал`);
    }
  }
});

test('уникальный дизайн и функциональность дороже скорости запуска', () => {
  for (const task of TASKS)
    for (const structure of STRUCTURES) {
      const speed = price(task, structure, 'speed');
      const design = price(task, structure, 'design');
      const features = price(task, structure, 'features');
      assert.ok(design.low >= speed.low, `${task}/${structure}: дизайн не дороже скорости`);
      assert.ok(features.low >= design.low, `${task}/${structure}: функциональность дешевле дизайна`);
      assert.ok(speed.high <= design.high, `${task}/${structure}: верх скорости выше верха дизайна`);
    }
});

test('магазин не дешевле сайта с нуля, переделка не дороже сайта с нуля', () => {
  for (const structure of STRUCTURES)
    for (const priority of PRIORITY) {
      const fresh = price('new', structure, priority);
      const shop = price('shop', structure, priority);
      const redo = price('redesign', structure, priority);
      assert.ok(shop.low >= fresh.low, `${structure}/${priority}: магазин дешевле сайта с нуля`);
      assert.ok(redo.low <= fresh.low, `${structure}/${priority}: переделка дороже сайта с нуля`);
    }
});

test('вилка не уже 1.35 и не шире допустимого для своей неопределённости', () => {
  for (const c of all()) {
    const r = price(c.task, c.structure, c.priority);
    const spread = r.high / r.low;
    const limit = [2.21, 2.51, 2.81][r.uncertain.length];
    assert.ok(spread >= 1.349, `${JSON.stringify(c)}: вилка слишком узкая (${spread.toFixed(2)})`);
    assert.ok(spread <= limit, `${JSON.stringify(c)}: вилка ${spread.toFixed(2)} шире предела ${limit}`);
  }
});

test('неопределённость расширяет вилку', () => {
  for (const priority of PRIORITY) {
    const known = price('new', 'multi', priority);
    const unknownPages = price('new', 'unknown', priority);
    assert.ok(
      unknownPages.high / unknownPages.low >= known.high / known.low,
      `${priority}: «не знаю» про страницы не расширило вилку`,
    );
  }
});

test('«не знаю» про страницы накрывает пол большого честного ответа', () => {
  // Главное свойство: человеку с многостраничником не должно быть выгодно
  // ответить «не знаю» — иначе квиз учит не отвечать.
  for (const task of ['new', 'redesign'])
    for (const priority of PRIORITY) {
      const vague = price(task, 'unknown', priority);
      const exact = price(task, 'multi', priority);
      assert.ok(
        vague.low <= exact.low && exact.low <= vague.high,
        `${task}/${priority}: пол честного многостраничника (${exact.low}) не попадает в вилку «не знаю» (${vague.low}–${vague.high})`,
      );
    }
});

test('«не знаю» про структуру уходит выше лендинга', () => {
  // Дальше потолка многостраничника «не знаю» не тянем: минимальная ширина
  // и так поднимает верх у точного ответа, а containment проверяет тест выше.
  for (const task of ['new', 'redesign'])
    for (const priority of PRIORITY) {
      const vague = price(task, 'unknown', priority);
      const landing = price(task, 'landing', priority);
      assert.ok(
        vague.high > landing.high,
        `${task}/${priority}: потолок «не знаю» (${vague.high}) не выше потолка лендинга (${landing.high})`,
      );
    }
});

test('«пока не определился» не дешевле самого вероятного прочтения', () => {
  // Вилку строим по обычному сайту: это самый частый случай. Более дорогой
  // край (интернет-магазин) в неё не всегда влезает — тогда о нём говорится
  // словами в caveat, а не растягиванием вилки втрое.
  for (const structure of STRUCTURES)
    for (const priority of PRIORITY) {
      const vague = price('unsure', structure, priority);
      const likely = price('new', structure, priority);
      assert.ok(vague.low <= likely.low, `${structure}/${priority}: «не определился» дороже по полу`);
      assert.ok(vague.high >= likely.high, `${structure}/${priority}: «не определился» ниже по потолку`);
    }
});

test('текста про названный бюджет на экране нет ни при каких ответах', () => {
  for (const c of all())
    for (const budget of BUDGETS) {
      const r = price(c.task, c.structure, c.priority, budget);
      if (!r.caveat) continue;
      assert.ok(
        !/указали бюджет|не берусь/.test(r.caveat),
        `${JSON.stringify(c)} + ${budget}: в оговорке осталась речь о бюджете — «${r.caveat}»`,
      );
    }
});

test('ориентиры студии на месте', () => {
  assert.equal(price('new', 'landing', 'speed').low, 50_000);
  assert.equal(price('new', 'multi', 'speed').low, 95_000);
  assert.equal(price('new', 'shop', 'speed').low, 150_000);
  assert.equal(price('shop', 'unknown', 'speed').low, 150_000);
  assert.equal(price('redesign', 'landing', 'speed').low, 40_000);
  assert.equal(price('redesign', 'multi', 'speed').low, 75_000);
});

test('у неопределённых ответов всегда есть оговорка, у точных — нет', () => {
  for (const c of all()) {
    const r = price(c.task, c.structure, c.priority);
    if (r.uncertain.length === 0) {
      assert.equal(r.caveat, null, `${JSON.stringify(c)}: оговорка там, где всё определено`);
    } else {
      assert.ok(r.caveat && r.caveat.length > 20, `${JSON.stringify(c)}: нет оговорки`);
    }
  }
});

test('если магазин не влезает в вилку неопределённой задачи — об этом сказано', () => {
  for (const structure of STRUCTURES)
    for (const priority of PRIORITY) {
      const vague = price('unsure', structure, priority);
      if (vague.high < 150_000) {
        assert.ok(
          vague.caveat?.includes('150 000'),
          `${structure}/${priority}: вилка до ${vague.high}, а про порог магазина не сказано`,
        );
      }
    }
});

test('список неопределённых ответов соответствует выбору', () => {
  assert.deepEqual(price('new', 'upto5', 'design').uncertain, []);
  assert.deepEqual(price('unsure', 'upto5', 'design').uncertain, ['задача']);
  assert.deepEqual(price('new', 'unknown', 'design').uncertain, ['структура']);
  assert.deepEqual(price('unsure', 'unknown', 'design').uncertain, ['задача', 'структура']);
});

test('всё кратно 5 000 — цифра читается как оценка, а не как смета', () => {
  for (const c of all())
    for (const budget of BUDGETS) {
      const r = price(c.task, c.structure, c.priority, budget);
      assert.equal(r.low % 5_000, 0, `низ ${r.low} не кратен 5 000 (${budget})`);
      assert.equal(r.high % 5_000, 0, `верх ${r.high} не кратен 5 000 (${budget})`);
    }
});

test('неполные ответы не ломают расчёт', () => {
  const r = calculatePrice({});
  assert.ok(r.low > 0 && r.high > r.low);
  const partial = calculatePrice({ task: 'shop' });
  assert.ok(partial.low >= 150_000, 'магазин без остальных ответов должен быть от 150 000');
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
