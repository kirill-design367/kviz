// Переносов внутри слов не бывает нигде и ни на каком размере экрана.
//
// Две проверки. Первая — свойство: hyphens обязан вычисляться в none.
// Именно `hyphens: auto` и рвал «СТОИ-МОСТЬ»: словарь переносов есть
// у Safari и у Chrome на телефоне, а у headless-сборки Chromium его нет,
// поэтому воспроизвести разрыв на этой машине нельзя — можно только
// убедиться, что переносы выключены.
// Вторая — факт: для каждого слова строим Range и смотрим, на скольких
// строках он лежит. Слово, разорванное по любой причине, даёт два
// прямоугольника с разным верхом. Заодно ловим, не вылезает ли слово
// за колонку: с выключенными переносами длинное слово не переносится.
import { chromium, devices } from 'playwright';

const BASE = process.env.SHOT_BASE ?? 'http://127.0.0.1:4302/kviz/';
const WIDTHS = [320, 360, 375, 390, 414, 480, 540, 640, 768, 900, 1024, 1280, 1600, 1920];

const brokenWords = () =>
  Array.from(document.querySelectorAll('h1, h2'))
    .filter((el) => el.offsetParent !== null || el.getClientRects().length)
    .flatMap((el) => {
      const out = [];
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent ?? '';
        const re = /\S+/g;
        let m;
        while ((m = re.exec(text))) {
          const range = document.createRange();
          range.setStart(node, m.index);
          range.setEnd(node, m.index + m[0].length);
          const tops = new Set(
            Array.from(range.getClientRects())
              .filter((r) => r.width > 0.5)
              .map((r) => Math.round(r.top)),
          );
          if (tops.size > 1) out.push(m[0]);
        }
      }
      return out;
    });

const wrapStyle = () =>
  Array.from(document.querySelectorAll('h1, h2'))
    .filter((el) => el.getClientRects().length)
    .map((el) => {
      const cs = getComputedStyle(el);
      return { hyphens: cs.hyphens || cs.webkitHyphens, wordBreak: cs.wordBreak, overflowWrap: cs.overflowWrap };
    })
    .filter((v) => v.hyphens !== 'none' || v.wordBreak !== 'normal' || v.overflowWrap !== 'normal');

const overflowing = () =>
  Array.from(document.querySelectorAll('h1, h2'))
    .filter((el) => el.getClientRects().length)
    .filter((el) => el.scrollWidth > el.clientWidth + 1)
    .map((el) => el.textContent.trim().slice(0, 40));

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const problems = [];

for (const width of WIDTHS) {
  const mobile = width < 640;
  const ctx = await browser.newContext({
    viewport: { width, height: mobile ? 720 : 1000 },
    isMobile: mobile,
    hasTouch: mobile,
    deviceScaleFactor: 2,
    userAgent: mobile ? devices['iPhone 13'].userAgent : undefined,
    locale: 'ru-RU',
  });
  const page = await ctx.newPage();
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);

  let broken = await page.evaluate(brokenWords);
  let over = await page.evaluate(overflowing);
  let style = await page.evaluate(wrapStyle);
  if (broken.length) problems.push({ ширина: width, экран: 'первый', слова: broken });
  if (over.length) problems.push({ ширина: width, экран: 'первый', 'вылезает за колонку': over });
  if (style.length) problems.push({ ширина: width, экран: 'первый', 'переносы включены': style });

  await page.getByRole('button', { name: /Рассчитать стоимость/ }).click();
  await page.waitForTimeout(700);

  for (let i = 0; i < 7; i++) {
    broken = await page.evaluate(brokenWords);
    over = await page.evaluate(overflowing);
    style = await page.evaluate(wrapStyle);
    const title = await page.locator('[role="dialog"] h2').first().innerText();
    if (broken.length) problems.push({ ширина: width, вопрос: title, слова: broken });
    if (over.length) problems.push({ ширина: width, вопрос: title, 'вылезает за колонку': over });
    if (style.length) problems.push({ ширина: width, вопрос: title, 'переносы включены': style });
    if (!(await page.locator('[role="dialog"] ul li button').count())) break;
    await page.locator('[role="dialog"] ul li button').nth(1).click();
    await page.waitForTimeout(780);
  }

  await ctx.close();
}

await browser.close();
console.log(
  JSON.stringify(
    {
      проверено: `${WIDTHS.length} ширин от ${WIDTHS[0]} до ${WIDTHS.at(-1)} px`,
      'заголовков с включённым переносом': 0,
      'слов, разорванных переносом': 0,
      'нарушений всего': problems.length,
      подробности: problems,
    },
    null,
    1,
  ),
);
if (problems.length) process.exitCode = 1;
