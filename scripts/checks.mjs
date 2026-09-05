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
  const visible = await page.locator('[role="dialog"] h2').first().isVisible();
  out.push({ проверка: 'prefers-reduced-motion', анимация: anim, прозрачность: opacity, 'квиз открылся': visible });
  await ctx.close();
}

// 2. При любой загрузке страница открывается с первого экрана
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU' });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Рассчитать стоимость/ }).click();
  await page.waitForTimeout(700);
  for (let i = 0; i < 3; i++) {
    await page.locator('[role="dialog"] ul li button').nth(1).click();
    await page.waitForTimeout(780);
  }
  const before = await page.locator('[role="dialog"] h2').first().innerText();

  // Перезагрузка посреди квиза
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const dialogAfterReload = await page.locator('[role="dialog"]').count();
  const heroAfterReload = await page.getByRole('button', { name: /Рассчитать стоимость/ }).isVisible();

  // Полное прохождение с отправкой, затем новый заход
  await page.getByRole('button', { name: /Рассчитать стоимость/ }).click();
  await page.waitForTimeout(700);
  for (let i = 0; i < 7; i++) {
    await page.locator('[role="dialog"] ul li button').nth(0).click();
    await page.waitForTimeout(780);
  }
  await page.waitForTimeout(800);
  await page.fill('#name', 'Кирилл');
  await page.fill('#phone', '9995554433');
  await page.getByRole('button', { name: 'Отправить' }).click();
  await page.waitForTimeout(1800);
  const sent = await page.getByText('Спасибо, записал').isVisible().catch(() => false);

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(900);
  const dialogAfterSubmit = await page.locator('[role="dialog"]').count();
  const heroAfterSubmit = await page.getByRole('button', { name: /Рассчитать стоимость/ }).isVisible();
  const stored = await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('aurea-kviz-v')));

  // Возврат назад по стрелке
  await page.getByRole('button', { name: /Рассчитать стоимость/ }).click();
  await page.waitForTimeout(700);
  await page.locator('[role="dialog"] ul li button').nth(1).click();
  await page.waitForTimeout(780);
  const q2 = await page.locator('[role="dialog"] h2').first().innerText();
  await page.getByRole('button', { name: /Вернуться к предыдущему вопросу/ }).click();
  await page.waitForTimeout(780);
  const backTo = await page.locator('[role="dialog"] h2').first().innerText();
  const marked = await page.locator('[role="dialog"] button[aria-checked="true"]').count();

  out.push({
    проверка: 'загрузка всегда с первого экрана',
    'был на вопросе': before,
    'после перезагрузки квиз закрыт': dialogAfterReload === 0,
    'после перезагрузки виден первый экран': heroAfterReload,
    'форма отправилась': sent,
    'после отправки и нового захода квиз закрыт': dialogAfterSubmit === 0,
    'после отправки виден первый экран': heroAfterSubmit,
    'ключи прохождения в хранилище': stored,
    'стрелка вернула с': q2,
    'на': backTo,
    'ответ отмечен': marked,
  });
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
  const q = await page.locator('[role="dialog"] h2').first().innerText();
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
    await page.waitForTimeout(780);
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

// 6. Telegram вместо телефона: поле меняется, проверка меняется, заявка уходит
{
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'ru-RU' });
  const page = await ctx.newPage();
  let sent = null;
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/api/lead')) {
      try {
        sent = JSON.parse(r.postData() ?? '{}');
      } catch {
        sent = null;
      }
    }
  });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Рассчитать стоимость/ }).click();
  await page.waitForTimeout(500);
  for (let i = 0; i < 7; i++) {
    await page.locator('[role="dialog"] ul li button').nth(0).click();
    await page.waitForTimeout(780);
  }
  await page.waitForTimeout(700);

  const beforeSwitch = {
    'телефон есть': await page.locator('#phone').count(),
    'ник есть': await page.locator('#telegram').count(),
  };

  await page.getByRole('button', { name: 'Написать в Telegram' }).click();
  await page.waitForTimeout(400);
  const afterSwitch = {
    'телефон есть': await page.locator('#phone').count(),
    'ник есть': await page.locator('#telegram').count(),
    подпись: await page.locator('label[for="telegram"]').innerText(),
  };

  // Телефон в поле для ника — не ник: проверка обязана поймать.
  await page.fill('#name', 'Кирилл');
  await page.fill('#telegram', '+7 999 555 44 33');
  await page.getByRole('button', { name: 'Отправить' }).click();
  await page.waitForTimeout(400);
  const nickError = await page.locator('#telegram-error').innerText().catch(() => '');

  await page.fill('#telegram', '@kirill_design');
  await page.getByRole('button', { name: 'Отправить' }).click();
  await page.waitForTimeout(1800);
  const done = await page.getByText('Спасибо, записал').isVisible().catch(() => false);
  const confirmation = await page.locator('[role="status"]').innerText().catch(() => '');

  out.push({
    проверка: 'Telegram вместо телефона',
    'до переключения': beforeSwitch,
    'после переключения': afterSwitch,
    'ошибка на телефоне в поле ника': nickError,
    'ушло в заявке': sent ? { channel: sent.channel, telegram: sent.telegram, 'телефона нет': !('phone' in sent) } : null,
    'подтверждение показано': done,
    'в подтверждении сказано про Telegram': confirmation.includes('Telegram'),
  });
  await ctx.close();
}

console.log(JSON.stringify(out, null, 1));
await browser.close();
