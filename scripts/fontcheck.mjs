import { chromium, devices } from 'playwright';
const BASE = process.env.SHOT_BASE ?? 'http://127.0.0.1:4302/kviz/';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
for (const [tag, ctxOpts] of [['десктоп', { viewport: { width: 1440, height: 900 } }], ['мобильная', { ...devices['iPhone 13'] }]]) {
  const ctx = await b.newContext({ ...ctxOpts, locale: 'ru-RU' });
  const page = await ctx.newPage();
  const failed = [];
  page.on('requestfailed', (r) => failed.push(r.url()));
  page.on('response', (r) => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(600);
  const r = await page.evaluate(() => {
    const h1 = document.querySelector('h1');
    const cs = getComputedStyle(h1);
    // Реально ли доехал файл: сравниваем ширину строки в Anticva и в подложке
    const cv = document.createElement('canvas').getContext('2d');
    const txt = h1.textContent.trim().toUpperCase();
    const w = (f) => { cv.font = `400 100px ${f}`; return cv.measureText(txt).width; };
    const loaded = [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family);
    return {
      объявленоВCSS: cs.fontFamily,
      шрифтЗагружен: loaded,
      'Anticva доступна браузеру': document.fonts.check('400 16px Anticva'),
      'ширина в Anticva': Math.round(w("'Anticva'")),
      'ширина в подложке': Math.round(w("'Anticva Fallback'")),
    };
  });
  console.log(tag, JSON.stringify(r, null, 1));
  if (failed.length) console.log('  НЕ ЗАГРУЗИЛОСЬ:', failed);
  await ctx.close();
}
await b.close();
