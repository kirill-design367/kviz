import { chromium, devices } from 'playwright';
const BASE = process.env.SHOT_BASE ?? 'http://127.0.0.1:4302/kviz/';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await b.newContext({ ...devices['iPhone 13'], reducedMotion: 'reduce', locale: 'ru-RU' });
const page = await ctx.newPage();
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.clear());
await page.reload({ waitUntil: 'networkidle' });
await page.getByRole('button', { name: /Рассчитать стоимость/ }).click();
await page.waitForTimeout(500);
const flat = await page.evaluate(() => {
  const cs = (sel) => { const e = document.querySelector(sel); return e ? getComputedStyle(e) : null; };
  return {
    перспективаСцены: cs('.stage').perspective,
    трансформКарточки: cs('.card3d').transform,
    трансформГлубины: cs('.depth').transform,
    подложкаВидна: cs('.card3d__plate').display,
    теньВидна: cs('.card3d__shadow').display,
  };
});
// Смена вопроса при выключенном движении должна быть мгновенной и не ломаться
const before = await page.locator('[role="dialog"] h2').first().innerText();
await page.locator('[role="dialog"] ul li button').nth(0).click();
await page.waitForTimeout(350);
const after = await page.locator('[role="dialog"] h2').first().innerText();
console.log(JSON.stringify({ ...flat, 'вопрос до': before, 'вопрос после': after, 'переход сработал': before !== after }, null, 1));
await b.close();
