import { calculatePrice } from '../.test-build/src/lib/pricing.js';

const T = { new: 'Сайт с нуля', redesign: 'Переделка', shop: 'Магазин', unsure: 'Не определился' };
const P = { landing: 'лендинг', multi: 'многостраничник', shop: 'магазин', unknown: 'не знаю' };
const R = { speed: 'скорость', design: 'дизайн', features: 'функции', price: 'цена' };

const m = (v) => v.toLocaleString('ru-RU');
console.log('РАСЧЁТ ВИЛКИ');
console.log('Назван бюджет числом — вилка считается ТОЛЬКО от него: низ минус 5 %,');
console.log('верх плюс 15 % от верхней границы названного диапазона.');
console.log('Не назван («больше 300 000», «обсуждается») — считаем по вопросам');
console.log('1 (что делаем), 5 (структура), 6 (что важнее).');
console.log('\nЧАСТЬ 1. ВСЕ 64 КОМБИНАЦИИ ПРИ НЕЙТРАЛЬНОМ БЮДЖЕТЕ («обсуждается»)\n');
console.log('задача'.padEnd(16), 'структура'.padEnd(14), 'важнее'.padEnd(10), 'вилка'.padStart(21), 'ширина');
console.log('─'.repeat(76));
for (const task of Object.keys(T))
  for (const pages of Object.keys(P)) {
    for (const priority of Object.keys(R)) {
      const r = calculatePrice({ task, structure: pages, priority });
      const range = `${m(r.low)} — ${m(r.high)} ₽`;
      console.log(
        T[task].padEnd(16),
        P[pages].padEnd(14),
        R[priority].padEnd(10),
        range.padStart(21),
        ' ×' + (r.high / r.low).toFixed(2),
      );
    }
    console.log('');
  }


const B = [
  ['discuss', 'обсуждается'],
  ['gt300', 'больше 300 000'],
  ['150-300', '150–300 000'],
  ['50-150', '50–150 000'],
  ['lt50', 'до 50 000'],
];

console.log('\nЧАСТЬ 2. КАК БЮДЖЕТ ДВИГАЕТ ВИЛКУ\n');
console.log('У трёх ответов с числом вилка не зависит больше ни от чего: она одна');
console.log('и та же при любых ответах на остальные вопросы. У двух оставшихся');
console.log('верхней границы нет, и всё считается по задаче, структуре и приоритету.\n');
const CASES = [
  ['new', 'landing', 'speed', 'Лендинг, скорость запуска'],
  ['new', 'multi', 'design', 'Многостраничник, уникальный дизайн'],
  ['new', 'shop', 'features', 'Магазин с нуля, функциональность'],
  ['shop', 'unknown', 'features', 'Магазин выбран в первом вопросе'],
  ['redesign', 'landing', 'price', 'Переделка лендинга, важна цена'],
];
for (const [task, pages, priority, title] of CASES) {
  console.log(title);
  for (const [budget, label] of B) {
    const r = calculatePrice({ task, structure: pages, priority, budget });
    const range = `${m(r.low)} — ${m(r.high)} ₽`;
    console.log('   бюджет ' + label.padEnd(16) + range.padStart(21) + (r.caveat ? '   ← есть оговорка' : ''));
  }
  console.log('');
}
