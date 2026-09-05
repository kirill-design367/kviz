import { chromium, devices } from 'playwright';
const BASE = process.env.SHOT_BASE ?? 'http://127.0.0.1:4302/kviz/';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const out = [];

for (const v of [
  { tag: 'mobile 390×844', ctx: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } },
  { tag: 'mobile 375×667 (iPhone SE)', ctx: { viewport: { width: 375, height: 667 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: devices['iPhone 13'].userAgent } },
  { tag: 'mobile 360×640 (мелкий)', ctx: { viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: devices['iPhone 13'].userAgent } },
  { tag: 'desktop 1920×1080', ctx: { viewport: { width: 1920, height: 1080 } } },
]) {
  const ctx = await b.newContext({ ...v.ctx, locale: 'ru-RU' });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(900);

  const heroFont = await page.locator('h1').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { family: cs.fontFamily.split(',')[0], size: cs.fontSize, transform: cs.textTransform };
  });
  const heroBox = await page.locator('h1').boundingBox();
  const heroFit = await page.evaluate(() => ({
    высотаОкна: window.innerHeight,
    контент: document.documentElement.scrollHeight,
  }));

  await page.getByRole('button', { name: /Рассчитать стоимость/ }).click();
  await page.waitForTimeout(700);
  const persp = await page.locator('.stage').first().evaluate((el) => getComputedStyle(el).perspective);

  // Каждый вопрос обязан помещаться в экран целиком.
  const вопросы = [];
  for (let i = 0; i < 7; i++) {
    const шаг = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      const list = dlg.querySelector('ul[role="radiogroup"]');
      if (!list) return null;
      const last = list.querySelector('li:last-child button');
      return {
        вопрос: dlg.querySelector('h2')?.textContent?.trim(),
        низПоследнегоВарианта: Math.round(last.getBoundingClientRect().bottom),
        высотаОкна: window.innerHeight,
        контент: dlg.scrollHeight,
        видимо: dlg.clientHeight,
        прокруткаНужна: dlg.scrollHeight > dlg.clientHeight + 2,
        высотыВариантов: Array.from(list.querySelectorAll('button')).map((el) =>
          Math.round(el.getBoundingClientRect().height),
        ),
      };
    });
    if (шаг) вопросы.push(шаг);
    if (!(await page.locator('[role="dialog"] ul li button').count())) break;
    await page.locator('[role="dialog"] ul li button').nth(1).click();
    await page.waitForTimeout(780);
  }
  await page.waitForTimeout(900);

  // Вилка + форма в одном кадре
  const fit = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    const submit = Array.from(dlg.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Отправить');
    const phone = document.querySelector('#phone');
    const price = dlg.querySelector('.figure');
    const r = (el) => (el ? Math.round(el.getBoundingClientRect().bottom) : null);
    return {
      высотаОкна: window.innerHeight,
      контентВысота: dlg.scrollHeight,
      видимо: dlg.clientHeight,
      прокруткаНужна: dlg.scrollHeight > dlg.clientHeight + 2,
      низЦены: r(price),
      низПоляТелефона: r(phone),
      низКнопкиОтправить: r(submit),
    };
  });

  // Второй проход: тот же экран, но с ответом «Обсуждается» — вилки нет,
  // вместо неё строка. Строка длиннее цифры и на узком экране переносится
  // на несколько строк, поэтому этот случай меряется отдельно.
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Рассчитать стоимость/ }).click();
  await page.waitForTimeout(700);
  for (let i = 0; i < 7; i++) {
    // Только живая карточка: распорка — копия того же вопроса, она
    // aria-hidden и её кнопки выключены, кликать в неё нельзя.
    const кнопки = page.locator('[role="dialog"] ul li button:not([disabled])');
    const всего = await кнопки.count();
    if (!всего) break;
    // На вопросе о бюджете берём последний вариант — «Обсуждается».
    const вопрос = await page.locator('[role="dialog"] h2').first().textContent();
    await кнопки.nth(вопрос?.includes('Бюджет') ? всего - 1 : 1).click();
    await page.waitForTimeout(780);
  }
  await page.waitForTimeout(900);
  const безВилки = await page.evaluate(() => {
    const dlg = document.querySelector('[role="dialog"]');
    const submit = Array.from(dlg.querySelectorAll('button')).find((b) => b.textContent.trim() === 'Отправить');
    const r = (el) => (el ? Math.round(el.getBoundingClientRect().bottom) : null);
    return {
      строкаВместоЦены: dlg.querySelector('p')?.parentElement?.querySelectorAll('p')[1]?.textContent?.trim(),
      цифраНаЭкране: !!dlg.querySelector('.figure'),
      высотаОкна: window.innerHeight,
      контентВысота: dlg.scrollHeight,
      видимо: dlg.clientHeight,
      прокруткаНужна: dlg.scrollHeight > dlg.clientHeight + 2,
      низКнопкиОтправить: r(submit),
    };
  });

  out.push({
    вид: v.tag,
    шрифтЗаголовка: heroFont,
    высотаЗаголовка: Math.round(heroBox.height),
    первыйЭкран: heroFit,
    перспектива: persp,
    вопросы,
    вилкаИФорма: fit,
    безВилкиИФорма: безВилки,
  });
  await ctx.close();
}
console.log(JSON.stringify(out, null, 1));
await b.close();
