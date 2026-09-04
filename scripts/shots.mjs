import { chromium, devices } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.SHOT_BASE ?? 'http://127.0.0.1:4173';
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

  // Ниже первого экрана
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/02-как-устроено-${view.tag}.png` });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);

  // Квиз
  await page.getByRole('button', { name: /Рассчитать стоимость/ }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${OUT}/03-вопрос-1-${view.tag}.png` });

  for (let i = 0; i < ANSWERS.length; i++) {
    const options = page.locator('[role="dialog"] ul li button');
    await options.nth(ANSWERS[i] - 1).click();
    await page.waitForTimeout(650);
    if (i === 3) await page.screenshot({ path: `${OUT}/04-вопрос-5-${view.tag}.png` });
  }

  // Вилка
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/05-вилка-${view.tag}.png` });
  const priceText = await page.locator('.figure').first().innerText().catch(() => '');

  // Форма
  await page.locator('form').scrollIntoViewIfNeeded();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUT}/06-форма-${view.tag}.png` });

  // Проверка валидации телефона
  await page.fill('#name', 'Кирилл');
  await page.fill('#phone', '123');
  await page.getByRole('button', { name: 'Отправить' }).click();
  await page.waitForTimeout(400);
  const phoneError = await page.locator('#phone-error').innerText().catch(() => '');
  await page.screenshot({ path: `${OUT}/07-ошибка-телефона-${view.tag}.png` });

  // Успешная отправка
  await page.fill('#phone', '9991234567');
  await page.waitForTimeout(200);
  const submit = page.getByRole('button', { name: 'Отправить' });
  await submit.click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${OUT}/08-подтверждение-${view.tag}.png` });
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
    await page.waitForTimeout(600);
  }
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/10-вилка-неопределённая-${view.tag}.png` });

  // 404
  await page.goto(`${BASE}/нет-такой-страницы`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(700);
  await page.screenshot({ path: `${OUT}/09-404-${view.tag}.png` });

  await context.close();
  return { view: view.tag, priceText: priceText.replace(/\s+/g, ' ').trim(), phoneError, success, errors };
}

const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const view of VIEWS) {
  const r = await run(browser, view);
  console.log(JSON.stringify(r, null, 1));
}
await browser.close();
