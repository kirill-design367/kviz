// Раскладка не дёргается при смене вопроса.
//
// Меряем верх карточки, её высоту и верх блока с подсказкой и стрелкой
// на каждом вопросе. Раньше карточка меняла высоту от вопроса к вопросу,
// а так как она отцентрована, половина разницы уезжала вверх — и вся
// страница прыгала. Теперь высота постоянна, значит и верх постоянен.
import { chromium, devices } from 'playwright';

const BASE = process.env.SHOT_BASE ?? 'http://127.0.0.1:4302/kviz/';
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const out = [];

for (const v of [
  { tag: 'мобильная 390×844', ctx: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } } },
  { tag: 'мелкая 360×640', ctx: { viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, userAgent: devices['iPhone 13'].userAgent } },
  { tag: 'десктоп 1920×1080', ctx: { viewport: { width: 1920, height: 1080 } } },
]) {
  const ctx = await browser.newContext({ ...v.ctx, locale: 'ru-RU' });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await page.getByRole('button', { name: /Рассчитать стоимость/ }).click();
  await page.waitForTimeout(800);

  const snaps = [];
  for (let i = 0; i < 7; i++) {
    const snap = await page.evaluate(() => {
      const card = document.querySelector('.card3d');
      const hint = document.getElementById('back-hint');
      const r = (el) => (el ? Math.round(el.getBoundingClientRect().top) : null);
      return {
        вопрос: document.querySelector('[role="dialog"] h2')?.textContent?.trim(),
        верхКарточки: r(card),
        высотаКарточки: card ? Math.round(card.getBoundingClientRect().height) : null,
        верхПодсказки: r(hint),
      };
    });
    if (!snap.верхКарточки) break;
    snaps.push(snap);
    if (!(await page.locator('[role="dialog"] ul li button').count())) break;
    await page.locator('[role="dialog"] ul li button').nth(1).click();
    await page.waitForTimeout(820);
  }

  const spread = (key) => {
    const values = snaps.map((s) => s[key]);
    return Math.max(...values) - Math.min(...values);
  };

  out.push({
    вид: v.tag,
    вопросов: snaps.length,
    'разброс верха карточки, px': spread('верхКарточки'),
    'разброс высоты карточки, px': spread('высотаКарточки'),
    'разброс верха подсказки, px': spread('верхПодсказки'),
    высоты: snaps.map((s) => s.высотаКарточки),
  });
  await ctx.close();
}

await browser.close();
console.log(JSON.stringify(out, null, 1));
const bad = out.filter((o) => o['разброс верха карточки, px'] > 0 || o['разброс верха подсказки, px'] > 0);
if (bad.length) process.exitCode = 1;
