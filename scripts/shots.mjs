import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.SHOT_BASE ?? 'http://127.0.0.1:4302/kviz/';
const OUT = 'docs/screens';
mkdirSync(OUT, { recursive: true });

const VIEWS = [
  { tag: 'desktop', viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, isMobile: false },
  { tag: 'mobile', ...devices['iPhone 13'], viewport: { width: 390, height: 844 } },
];

const ANSWERS = [1, 3, 2, 2, 2, 2, 3]; // индексы вариантов (с 1) для каждого вопроса

async function run(browser, view) {
  const context = await browser.newContext({ ...view, locale: 'ru-RU' });
  const page = await context.newPage();
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(1100);
  await page.screenshot({ path: `${OUT}/01-первый-экран-${view.tag}.png` });

  // Квиз
  await page.getByRole('button', { name: /Рассчитать стоимость/ }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/03-вопрос-1-${view.tag}.png` });

  // Наведение на вариант: видно, что карточка объёмная и вариант отзывается
  if (!view.isMobile) {
    const opt = page.locator('[role="dialog"] ul li button').nth(1);
    const box = await opt.boundingBox();
    // Ведём курсор внутрь варианта и оставляем там: нужен и наклон карточки,
    // и заливка кнопки под указателем.
    await page.mouse.move(box.x + box.width * 0.35, box.y + box.height / 2);
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${OUT}/03b-вопрос-наведение-${view.tag}.png` });
  }

  for (let i = 0; i < ANSWERS.length; i++) {
    const options = page.locator('[role="dialog"] ul li button');
    await options.nth(ANSWERS[i] - 1).click();
    await page.waitForTimeout(780);
    if (i === 3) await page.screenshot({ path: `${OUT}/04-вопрос-структура-${view.tag}.png` });
  }

  // Вилка и форма — один кадр
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/05-вилка-и-форма-${view.tag}.png` });
  const priceText = await page.locator('.figure').first().innerText().catch(() => '');

  // Тот же экран, но выбран Telegram: вместо телефона — поле для ника.
  await page.getByRole('button', { name: 'Написать в Telegram' }).click();
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/05b-вилка-и-форма-телеграм-${view.tag}.png` });
  const telegramField = await page.evaluate(() => {
    const input = document.querySelector('#telegram');
    const label = input ? document.querySelector('label[for="telegram"]') : null;
    return {
      'поле ника есть': Boolean(input),
      подпись: label?.textContent?.trim() ?? null,
      подсказка: input?.getAttribute('placeholder') ?? null,
      'поля телефона нет': !document.querySelector('#phone'),
    };
  });
  await page.getByRole('button', { name: 'Позвонить' }).click();
  await page.waitForTimeout(400);

  // Проверка валидации телефона
  await page.fill('#name', 'Кирилл');
  await page.fill('#phone', '123');
  await page.getByRole('button', { name: 'Отправить' }).click();
  await page.waitForTimeout(400);
  const phoneError = await page.locator('#phone-error').innerText().catch(() => '');
  await page.screenshot({ path: `${OUT}/06-ошибка-телефона-${view.tag}.png` });

  // Успешная отправка
  await page.fill('#phone', '9991234567');
  await page.waitForTimeout(200);
  const submit = page.getByRole('button', { name: 'Отправить' });
  await submit.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/07-подтверждение-${view.tag}.png` });
  const success = await page.getByText('Спасибо, записал').isVisible().catch(() => false);

  // Вилка при неопределённых ответах: должна появиться оговорка
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Рассчитать стоимость/ }).click();
  await page.waitForTimeout(600);
  const VAGUE = [4, 4, 1, 4, 4, 4, 5]; // «пока не определился», «не знаю»
  for (const pick of VAGUE) {
    await page.locator('[role="dialog"] ul li button').nth(pick - 1).click();
    await page.waitForTimeout(780);
  }
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/08-вилка-неопределённая-${view.tag}.png` });

  // Дешёвая задача при большом бюджете: видно, что вилка поднялась
  // к названной сумме, а не осталась внизу
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Рассчитать стоимость/ }).click();
  await page.waitForTimeout(600);
  // лендинг с нуля, важна скорость, бюджет 150–300 000: расчёт даёт 50–70 тысяч,
  // на экране должно быть 150 000—300 000
  const RICH = [1, 1, 1, 2, 1, 3, 3];
  for (const pick of RICH) {
    await page.locator('[role="dialog"] ul li button').nth(pick - 1).click();
    await page.waitForTimeout(780);
  }
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/08b-вилка-бюджет-выше-расчёта-${view.tag}.png` });
  const richPrice = await page.locator('.figure').first().innerText().catch(() => '');

  // 404
  await page.goto(`${BASE}/нет-такой-страницы`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/09-404-${view.tag}.png` });

  await context.close();
  return {
    view: view.tag,
    priceText: priceText.replace(/\s+/g, ' ').trim(),
    'вилка при бюджете выше расчёта': richPrice.replace(/\s+/g, ' ').trim(),
    'поле для Telegram': telegramField,
    phoneError,
    success,
    errors,
  };
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const view of VIEWS) {
  const r = await run(browser, view);
  console.log(JSON.stringify(r, null, 1));
}
await browser.close();
