import { calculatePrice } from '../.test-build/src/lib/pricing.js';

const T = { new: 'Сайт с нуля', redesign: 'Переделка', shop: 'Магазин', unsure: 'Не определился' };
const P = { one: 'одна', upto5: 'до пяти', more5: 'больше пяти', unknown: 'не знаю' };
const R = { speed: 'скорость', design: 'дизайн', features: 'функции', price: 'цена' };

const m = (v) => v.toLocaleString('ru-RU');
console.log('ВСЕ 64 КОМБИНАЦИИ РАСЧЁТА ВИЛКИ');
console.log('Считается только по вопросам 1 (что делаем), 5 (страниц), 6 (что важнее).');
console.log('Ответ про бюджет (вопрос 7) на результат не влияет.\n');
console.log('задача'.padEnd(16), 'страниц'.padEnd(14), 'важнее'.padEnd(10), 'вилка'.padStart(21), 'ширина');
console.log('─'.repeat(76));
for (const task of Object.keys(T))
  for (const pages of Object.keys(P)) {
    for (const priority of Object.keys(R)) {
      const r = calculatePrice({ task, pages, priority });
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
