// Главная кнопка в трёх состояниях: покой, наведение, нажатие.
// Инверсия должна читаться на снимках: чернильная панель становится
// бумажной, светлый текст — чернильным.
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const BASE = process.env.SHOT_BASE ?? 'http://127.0.0.1:4302/kviz/';
mkdirSync('docs/screens', { recursive: true });
const b = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const p = await b.newPage({ viewport: { width: 900, height: 500 }, deviceScaleFactor: 2 });
await p.goto(BASE, { waitUntil: 'networkidle' });
await p.waitForTimeout(1000);

const btn = p.locator('.btn-invert');
const box = await btn.boundingBox();
const clip = { x: box.x - 40, y: box.y - 30, width: box.width + 80, height: box.height + 60 };

const colors = async () =>
  btn.evaluate((el) => {
    const fill = el.querySelector('.btn-invert__fill');
    return {
      'цвет текста': getComputedStyle(el).color,
      'непрозрачность светлого слоя': Number(getComputedStyle(fill).opacity).toFixed(2),
    };
  });

await p.screenshot({ path: 'docs/screens/10-кнопка-покой.png', clip });
const rest = await colors();

await p.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await p.waitForTimeout(700);
await p.screenshot({ path: 'docs/screens/10-кнопка-наведение.png', clip });
const hover = await colors();

await p.mouse.down();
await p.waitForTimeout(250);
await p.screenshot({ path: 'docs/screens/10-кнопка-нажатие.png', clip });
const press = await colors();
await p.mouse.up();

console.log(JSON.stringify({ покой: rest, наведение: hover, нажатие: press }, null, 1));
await b.close();
