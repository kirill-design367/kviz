import { calculatePrice } from '../.test-build/src/lib/pricing.js';

const T = { new: 'Сайт с нуля', redesign: 'Переделка', shop: 'Магазин', unsure: 'Не определился' };
const P = { landing: 'лендинг', multi: 'многостраничник', shop: 'магазин', unknown: 'не знаю' };
const R = { speed: 'скорость', design: 'дизайн', features: 'функции', price: 'цена' };
const B = [
  ['lt50', 'до 50 000'],
  ['50-150', '50–150 000'],
  ['150-300', '150–300 000'],
  ['gt300', 'больше 300 000'],
  ['discuss', 'обсуждается'],
];

const m = (v) => v.toLocaleString('ru-RU');
const show = (r) => (r.kind === 'range' ? `${m(r.low)} — ${m(r.high)} ₽` : 'вилки нет');

console.log('РАСЧЁТ СТОИМОСТИ');
console.log('Вилка считается ТОЛЬКО от названного бюджета: низ минус 5 %, верх');
console.log('плюс 15 % от верхней границы названного диапазона.');
console.log('«Больше 300 000» и «обсуждается» верхней границы не задают — при них');
console.log('вилка не показывается вовсе, а на её месте строка про обсуждение.\n');

console.log('ЧАСТЬ 1. ЧТО ВИДИТ ЧЕЛОВЕК ПРИ КАЖДОМ ОТВЕТЕ О БЮДЖЕТЕ\n');
console.log('ответ'.padEnd(18), 'потолок'.padStart(9), 'на экране'.padStart(22));
console.log('─'.repeat(52));
for (const [budget, label] of B) {
  const r = calculatePrice({ task: 'new', structure: 'landing', priority: 'price', budget });
  const cap = { lt50: 50_000, '50-150': 150_000, '150-300': 300_000 }[budget];
  console.log(label.padEnd(18), (cap ? m(cap) : '—').padStart(9), show(r).padStart(22));
}

console.log('\nЧАСТЬ 2. ОСТАЛЬНЫЕ ОТВЕТЫ НА ЧИСЛО НЕ ВЛИЯЮТ\n');
console.log('Перебор всех 64 комбинаций «задача × структура × приоритет» на каждый');
console.log('ответ о бюджете. Если бы хоть одна комбинация дала другой результат,');
console.log('здесь стояло бы несколько строк вместо одной.\n');
for (const [budget, label] of B) {
  const seen = new Set();
  for (const task of Object.keys(T))
    for (const structure of Object.keys(P))
      for (const priority of Object.keys(R))
        seen.add(show(calculatePrice({ task, structure, priority, budget })));
  console.log('бюджет ' + label.padEnd(18) + [...seen].join(' | '));
}

console.log('\nЧАСТЬ 3. СТРОКА ВМЕСТО ВИЛКИ\n');
const noRange = calculatePrice({ budget: 'gt300' });
if (noRange.kind === 'discuss') console.log('   ' + noRange.note);
