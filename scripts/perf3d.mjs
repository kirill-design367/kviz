import { chromium, devices } from 'playwright';
const BASE = process.env.SHOT_BASE ?? 'http://127.0.0.1:4205';
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const out = [];

for (const v of [
  { tag: 'мобильная, замедление CPU ×4', ctx: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }, cpu: 4 },
  { tag: 'десктоп', ctx: { viewport: { width: 1920, height: 1080 } }, cpu: 1 },
]) {
  const ctx = await b.newContext({ ...v.ctx, locale: 'ru-RU' });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (v.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: v.cpu });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Рассчитать стоимость/ }).click();
  await page.waitForTimeout(800);

  // Считаем кадры во время шести переходов между вопросами
  await page.evaluate(() => {
    window.__f = [];
    let last = performance.now();
    const tick = (t) => { window.__f.push(t - last); last = t; if (window.__go) requestAnimationFrame(tick); };
    window.__go = true;
    requestAnimationFrame(tick);
  });
  for (let i = 0; i < 6; i++) {
    await page.locator('[role="dialog"] ul li button').nth(1).click();
    await page.waitForTimeout(560);
  }
  const frames = await page.evaluate(() => { window.__go = false; return window.__f.slice(2); });
  const sorted = [...frames].sort((a, z) => a - z);
  const p50 = sorted[Math.floor(sorted.length * 0.5)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];
  const long = frames.filter((f) => f > 33.4).length;

  // Проверяем, что переход реально идёт в глубину, а не просто гаснет.
  // Начинаем с чистого состояния: замер должен попасть на переход
  // МЕЖДУ вопросами, а не на выход к экрану с вилкой.
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'load' });
  await page.getByRole('button', { name: /Рассчитать стоимость/ }).click();
  await page.waitForTimeout(800);
  const zSeen = await page.evaluate(async () => {
    const seen = new Set();
    const stop = Date.now() + 900;
    document.querySelectorAll('[role="dialog"] ul li button')[1].click();
    while (Date.now() < stop) {
      const el = document.querySelector('.depth');
      if (el) {
        const m = new DOMMatrixReadOnly(getComputedStyle(el).transform);
        seen.add(Math.round(m.m43));
      }
      await new Promise((r) => requestAnimationFrame(r));
    }
    const vals = [...seen];
    return { значенийZ: vals.length, минZ: Math.min(...vals), максZ: Math.max(...vals) };
  });

  out.push({
    вид: v.tag,
    кадров: frames.length,
    'медиана кадра, мс': +p50.toFixed(1),
    'p95 кадра, мс': +p95.toFixed(1),
    'кадров длиннее 33 мс': long,
    'доля длинных, %': +((long / frames.length) * 100).toFixed(1),
    глубина: zSeen,
  });
  await ctx.close();
}
console.log(JSON.stringify(out, null, 1));
await b.close();
