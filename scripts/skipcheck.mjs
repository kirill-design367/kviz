import { chromium, devices } from 'playwright';
const BASE = process.env.SHOT_BASE ?? 'http://127.0.0.1:4302/kviz/';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ ...devices['iPhone 13'], locale: 'ru-RU' });
const page = await ctx.newPage();
const out = [];

async function run(firstPick, label) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Рассчитать стоимость/ }).click();
  await page.waitForTimeout(700);
  const seen = [];
  for (let i = 0; i < 8; i++) {
    const h = await page.locator('[role="dialog"] h2').innerText().catch(() => null);
    if (!h || h.startsWith('Точный расчёт')) break;
    const progress = await page.locator('[role="progressbar"]').getAttribute('aria-label').catch(() => '');
    seen.push(`${h}  [${progress}]`);
    await page.locator('[role="dialog"] ul li button').nth(i === 0 ? firstPick : 0).click();
    await page.waitForTimeout(780);
  }
  await page.waitForTimeout(700);
  const price = await page.locator('.figure').first().innerText().catch(() => '');
  out.push({ путь: label, 'задано вопросов': seen.length, вопросы: seen, вилка: price.replace(/\s+/g, ' ') });
}

await run(2, 'первый ответ — Интернет-магазин');
await run(0, 'первый ответ — Сайт с нуля');
console.log(JSON.stringify(out, null, 1));
await b.close();
