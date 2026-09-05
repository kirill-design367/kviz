// Проверка счётчика Яндекс Метрики: грузится ли он и уходят ли цели.
//
// Настоящий mc.yandex.ru здесь не нужен и вреден: проверять надо СВОЙ код —
// что счётчик запрашивается, что init уходит с нужными ключами и что каждая
// цель вызывается там, где должна. Поэтому запрос к mc.yandex.ru
// перехватывается и подменяется заглушкой, которая ведёт себя как настоящий
// tag.js: разбирает накопленную очередь window.ym.a и записывает всё, что
// пришло дальше. Так видно и то, что было отправлено ДО загрузки счётчика, —
// а это как раз первая и самая важная цель, «квиз открыт».
import { chromium, devices } from 'playwright';

const BASE = process.env.SHOT_BASE ?? 'http://127.0.0.1:4302/kviz/';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const browser = await chromium.launch({ executablePath: EXE });
const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU' });
const page = await ctx.newPage();

const запросы = [];
const пиксели = [];

// ОДИН обработчик на все адреса Метрики. Двумя обработчиками сделать нельзя:
// Playwright примеряет их в обратном порядке добавления, и общее правило,
// добавленное вторым, перехватывало бы и сам tag.js — проверка показывала бы
// «счётчик не запрошен» на исправном сайте. Проверено на себе.
await page.route(/https:\/\/mc\.yandex\.(ru|com)\/.*/, async (route) => {
  const url = route.request().url();
  if (url.includes('/metrika/tag.js')) {
    запросы.push('tag.js');
    // Заглушка ведёт себя как настоящий tag.js: разбирает накопленную
    // очередь и дальше записывает всё, что приходит.
    await route.fulfill({
      status: 200,
      contentType: 'application/javascript',
      body: `
        (function () {
          var очередь = (window.ym && window.ym.a) || [];
          window.__ym = [];
          window.ym = function () { window.__ym.push([].slice.call(arguments)); };
          for (var i = 0; i < очередь.length; i++) window.ym.apply(null, очередь[i]);
        })();
      `,
    });
    return;
  }
  пиксели.push(url);
  await route.fulfill({ status: 200, contentType: 'image/gif', body: '' });
});

await page.goto(BASE, { waitUntil: 'networkidle' });

// Счётчик грузится в простое браузера или по первому касанию. Ждём немного,
// чтобы поймать именно тот путь, которым он поедет у посетителя.
await page.waitForTimeout(1500);

const до = await page.evaluate(() => ({
  очередь: (window.ym && window.ym.a ? window.ym.a : []).map((a) => [...a]),
  разобрано: window.__ym ? window.__ym.map((a) => [...a]) : null,
}));

// Проходим квиз целиком: оффер → семь вопросов → вилка → форма → отправка.
await page.getByRole('button', { name: /Рассчитать стоимость/ }).click();
await page.waitForTimeout(700);
for (let i = 0; i < 7; i++) {
  const кнопки = page.locator('[role="dialog"] ul li button:not([disabled])');
  if (!(await кнопки.count())) break;
  await кнопки.nth(1).click();
  await page.waitForTimeout(780);
}
await page.waitForTimeout(900);

await page.locator('#name').fill('Кирилл');
await page.locator('#phone').fill('+7 900 123 45 67');
await page.getByRole('button', { name: 'Отправить' }).click();
await page.waitForTimeout(1800);

const итог = await page.evaluate(() => ({
  вызовы: (window.__ym || []).map((a) => [...a]),
  очередьОсталась: (window.ym && window.ym.a ? window.ym.a : []).map((a) => [...a]),
}));

const вызовы = итог.вызовы;
const init = вызовы.find((v) => v[1] === 'init');
const цели = вызовы.filter((v) => v[1] === 'reachGoal').map((v) => v[2]);
const счётчик = init ? String(init[0]) : null;

const ожидаем = [
  'quiz_start',
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => `quiz_step_${n}`),
  'result_shown',
  'form_start',
  'lead_sent',
];

const пиксельВРазметке = await page
  .locator('noscript')
  .evaluateAll((els) => els.map((el) => el.textContent || '').join(' '))
  .catch(() => '');

console.log(
  JSON.stringify(
    {
      'счётчик запрошен': запросы.includes('tag.js'),
      'номер счётчика': счётчик,
      'параметры init': init ? init[2] : null,
      'вебвизор включён': Boolean(init && init[2] && init[2].webvisor),
      'карта кликов включена': Boolean(init && init[2] && init[2].clickmap),
      'точный показатель отказов': Boolean(init && init[2] && init[2].accurateTrackBounce),
      'init пришёл первым': вызовы.length > 0 && вызовы[0][1] === 'init',
      'ждало в очереди до загрузки счётчика': до.очередь.length,
      'цели, которые ушли': цели,
      'ожидались': ожидаем,
      'не хватает': ожидаем.filter((g) => !цели.includes(g)),
      'лишние': цели.filter((g) => !ожидаем.includes(g)),
      'в очереди осталось': итог.очередьОсталась.length,
      'пиксель без JS в разметке': /mc\.yandex\.ru\/watch\//.test(пиксельВРазметке),
    },
    null,
    1,
  ),
);

// ── Второй проход: счётчик приезжает МЕДЛЕННО ────────────────────────────
// Самый частый способ потерять первую цель: человек нажал кнопку раньше,
// чем догрузился tag.js. Тогда вызов лежит в очереди, и всё зависит от того,
// стоит ли перед ним init. Здесь загрузка счётчика намеренно задерживается
// на три секунды, а кнопка нажимается сразу.
const page2 = await ctx.newPage();
await page2.route(/https:\/\/mc\.yandex\.(ru|com)\/.*/, async (route) => {
  const url = route.request().url();
  if (!url.includes('/metrika/tag.js')) return route.fulfill({ status: 200, contentType: 'image/gif', body: '' });
  await new Promise((r) => setTimeout(r, 3000));
  await route.fulfill({
    status: 200,
    contentType: 'application/javascript',
    body: `
      (function () {
        var очередь = (window.ym && window.ym.a) || [];
        window.__ym = [];
        window.ym = function () { window.__ym.push([].slice.call(arguments)); };
        for (var i = 0; i < очередь.length; i++) window.ym.apply(null, очередь[i]);
      })();
    `,
  });
});
await page2.goto(BASE, { waitUntil: 'domcontentloaded' });
// Жмём, пока квиз не откроется: до гидратации обработчика ещё нет, и первый
// клик просто пропадает. Это свойство любой страницы на React, а не нашей
// разметки, но без повторов проверка меряла бы гидратацию, а не Метрику.
for (let i = 0; i < 15; i++) {
  if (await page2.locator('[role="dialog"]').count()) break;
  await page2.getByRole('button', { name: /Рассчитать стоимость/ }).click({ timeout: 5000 }).catch(() => {});
  await page2.waitForTimeout(300);
}
await page2.waitForTimeout(5000);
const поздний = await page2.evaluate(() => (window.__ym || []).map((a) => [...a]));
const порядок = поздний.map((v) => (v[1] === 'reachGoal' ? v[2] : v[1]));
console.log(
  JSON.stringify(
    {
      'проверка при медленной загрузке счётчика': {
        'что пришло по порядку': порядок,
        'init раньше цели': порядок.indexOf('init') === 0 && порядок.includes('quiz_start'),
        'цель quiz_start не потерялась': порядок.includes('quiz_start'),
      },
    },
    null,
    1,
  ),
);

await browser.close();
