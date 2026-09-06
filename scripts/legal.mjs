// Политика: открывается ли она, стоит ли ссылка там, где собираются контакты,
// и те ли реквизиты на странице.
//
// Проверка нужна не ради красоты: без работающей ссылки на политику и без
// реквизитов оператора модерация Яндекс Директа не пропустит объявления,
// а узнать об этом хочется до запуска рекламы, а не после отказа.
import { chromium, devices } from 'playwright';

const BASE = (process.env.SHOT_BASE ?? 'http://127.0.0.1:4302/kviz/').replace(/\/$/, '/');
const OUT = 'docs/screens';
const EXE = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

const ЖДЁМ = {
  оператор: 'Горовой Кирилл Николаевич',
  огрнип: '325619600032361',
  инн: '613805463472',
  почта: 'Kirill0061@mail.ru',
  счётчик: '112315785',
};

const browser = await chromium.launch({ executablePath: EXE });
const итог = {};

// ── 1. Сама страница ────────────────────────────────────────────────────
const desk = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: 'ru-RU' });
const page = await desk.newPage();
const ответ = await page.goto(`${BASE}privacy/`, { waitUntil: 'networkidle' });
const текст = await page.locator('body').innerText();

итог['страница политики'] = {
  код: ответ?.status(),
  заголовок: await page.locator('h1').first().innerText(),
  'разделов на странице': await page.locator('ol > li').count(),
  'реквизиты на месте': Object.fromEntries(
    Object.entries(ЖДЁМ).map(([что, значение]) => [что, текст.includes(значение)]),
  ),
  'ссылка на почту': await page.locator('a[href^="mailto:"]').first().getAttribute('href'),
  'заглушки про незаполненные реквизиты нет': !/не заполнен/i.test(текст),
  'вебвизор назван прямо': /Вебвизор/.test(текст) && /записывает/i.test(текст),
  'сказано про отзыв согласия': /отозв/i.test(текст),
  'сказано, кому передаются': /Telegram/.test(текст) && /Метрик/.test(текст),
};

await page.screenshot({ path: `${OUT}/11-политика-desktop.png`, fullPage: true });
await desk.close();

// ── 2. Ссылка там, где собираются контакты ──────────────────────────────
const mob = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU' });
const m = await mob.newPage();
await m.goto(BASE, { waitUntil: 'networkidle' });
await m.getByRole('button', { name: /Рассчитать стоимость/ }).click();
await m.waitForTimeout(700);
for (let i = 0; i < 7; i++) {
  const кнопки = m.locator('[role="dialog"] ul li button:not([disabled])');
  if (!(await кнопки.count())) break;
  await кнопки.nth(1).click();
  await m.waitForTimeout(780);
}
await m.waitForTimeout(900);

const ссылка = m.getByRole('link', { name: /обработку персональных данных/ });
const href = await ссылка.getAttribute('href');
const target = await ссылка.getAttribute('target');

// Открываем ровно так, как откроет человек: ссылка в новой вкладке.
const [вкладка] = await Promise.all([mob.waitForEvent('page'), ссылка.click()]);
await вкладка.waitForLoadState('domcontentloaded');
const заголовокВкладки = await вкладка.locator('h1').first().innerText();

итог['ссылка под формой'] = {
  'ссылка есть': Boolean(href),
  адрес: href,
  'открывается в новой вкладке': target === '_blank',
  'что открылось': заголовокВкладки,
  'реквизиты видны и там': (await вкладка.locator('body').innerText()).includes(ЖДЁМ.огрнип),
};

await вкладка.screenshot({ path: `${OUT}/11-политика-mobile.png`, fullPage: true });
await mob.close();

console.log(JSON.stringify(итог, null, 1));
await browser.close();
