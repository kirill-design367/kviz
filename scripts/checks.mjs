import { chromium, devices } from 'playwright';

const BASE = process.env.SHOT_BASE ?? 'http://127.0.0.1:4180';
const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({ executablePath: CHROME });
const out = [];

// 1. prefers-reduced-motion: движения быть не должно
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce', locale: 'ru-RU' });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const h1 = page.locator('h1');
  const anim = await h1.evaluate((el) => getComputedStyle(el).animationName);
  const opacity = await h1.evaluate((el) => getComputedStyle(el).opacity);
  await page.getByRole('button', { name: /Рассчитать стоимость/ }).click();
  await page.waitForTimeout(300);
  const visible = await page.locator('[role="dialog"] h2').isVisible();
  out.push({ проверка: 'prefers-reduced-motion', анимация: anim, прозрачность: opacity, 'квиз открылся': visible });
  await ctx.close();
}

// 2. Ответы переживают обновление страницы
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU' });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Рассчитать стоимость/ }).click();
  await page.waitForTimeout(600);
  for (let i = 0; i < 3; i++) {
    await page.locator('[role="dialog"] ul li button').nth(1).click();
    await page.waitForTimeout(600);
  }
  const before = await page.locator('[role="dialog"] h2').innerText();
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const after = await page.locator('[role="dialog"] h2').innerText().catch(() => 'квиз не открылся');
  // возврат назад
  await page.getByRole('button', { name: 'Назад' }).click();
  await page.waitForTimeout(600);
  const back = await page.locator('[role="dialog"] h2').innerText();
  const marked = await page.locator('[role="dialog"] button[aria-checked="true"]').count();
  out.push({ проверка: 'состояние после reload', 'до перезагрузки': before, 'после': after, 'совпало': before === after, 'после Назад': back, 'ответ отмечен': marked });
  await ctx.close();
}

// 3. Двойной тап не проскакивает вопрос
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU' });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Рассчитать стоимость/ }).click();
  await page.waitForTimeout(600);
  const opt = page.locator('[role="dialog"] ul li button').nth(0);
  await opt.click({ clickCount: 2, delay: 20 }).catch(() => {});
  await page.waitForTimeout(900);
  const q = await page.locator('[role="dialog"] h2').innerText();
  out.push({ проверка: 'двойной тап', 'вопрос после двойного тапа': q, 'ожидался': 'Для чего сайт?' });
  await ctx.close();
}

// 4. Тапаемые зоны не меньше 44px
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU' });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  const cta = await page.getByRole('button', { name: /Рассчитать стоимость/ }).boundingBox();
  await page.getByRole('button', { name: /Рассчитать стоимость/ }).click();
  await page.waitForTimeout(600);
  const boxes = await page.locator('[role="dialog"] ul li button').evaluateAll((els) =>
    els.map((e) => Math.round(e.getBoundingClientRect().height)));
  out.push({ проверка: 'размер зон', 'кнопка CTA': `${Math.round(cta.width)}×${Math.round(cta.height)}`, 'высоты вариантов': boxes, 'все ≥44': boxes.every((b) => b >= 44) });
  await ctx.close();
}

// 5. Повторное нажатие «Отправить» не шлёт вторую заявку
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU' });
  const page = await ctx.newPage();
  let posts = 0;
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/api/lead')) posts++; });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Рассчитать стоимость/ }).click();
  await page.waitForTimeout(500);
  for (let i = 0; i < 7; i++) {
    await page.locator('[role="dialog"] ul li button').nth(0).click();
    await page.waitForTimeout(550);
  }
  await page.waitForTimeout(700);
  await page.fill('#name', 'Кирилл');
  await page.fill('#phone', '9995554433');
  const submit = page.getByRole('button', { name: 'Отправить' });
  await Promise.all([submit.click(), submit.click().catch(() => {}), submit.click().catch(() => {})]);
  await page.waitForTimeout(1800);
  const done = await page.getByText('Спасибо, записал').isVisible().catch(() => false);
  out.push({ проверка: 'двойная отправка', 'POST-запросов': posts, 'подтверждение показано': done });
  await ctx.close();
}

console.log(JSON.stringify(out, null, 1));
await browser.close();
