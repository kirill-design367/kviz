import type { Metadata, Viewport } from 'next';
import './globals.css';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
// Боевой адрес. Публикация на GitHub Pages снята: две копии одного сайта
// делят между собой поисковую выдачу, и та, что не приносит заявок, лишняя.
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://cenasaita.ru';
// Пока номера счётчика нет, пиксель не ставится: иначе каждый заход
// без JS дёргал бы https://mc.yandex.ru/watch/ и получал ошибку.
const YM_ID = process.env.NEXT_PUBLIC_YM_ID ?? '';

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: 'Стоимость сайта за минуту — AUREA',
  description:
    'Ответьте на семь коротких вопросов и увидите вилку цены на разработку сайта под свою задачу. Без звонков и ожидания.',
  applicationName: 'AUREA',
  openGraph: {
    type: 'website',
    locale: 'ru_RU',
    siteName: 'AUREA',
    title: 'Стоимость сайта под вашу задачу — за минуту',
    description:
      'Семь вопросов, и вилка цены появится прямо на экране. Без звонков и ожидания.',
  },
  robots: { index: true, follow: true },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: '#f3f0ea',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

/**
 * Объявления шрифтов собираются здесь, а не в таблице стилей.
 *
 * Сайт живёт по адресу с префиксом (`/kviz`), а `url()` внутри статического
 * CSS считается от корня домена — путь `/fonts/...` уводил в 404, шрифты
 * не приезжали и всё рисовалось подменными. Здесь префикс известен и
 * подставляется явно, поэтому адрес верен при любом basePath и на любой
 * странице.
 */
const FONT_FACES = `
@font-face {
  font-family: 'Onest';
  src: url('${BASE}/fonts/onest-var.woff2') format('woff2-variations');
  font-weight: 100 900;
  font-style: normal;
  font-display: swap;
  unicode-range: U+0000-00FF, U+0400-045F, U+0490-0491, U+2010-2026, U+2116, U+20BD, U+2212;
}
@font-face {
  font-family: 'Anticva';
  src: url('${BASE}/fonts/anticva.woff2') format('woff2');
  font-weight: 400;
  font-style: normal;
  font-display: swap;
  unicode-range: U+0000-00FF, U+0400-045F, U+0490-0491, U+2116;
}
@font-face {
  font-family: 'Cormorant';
  src: url('${BASE}/fonts/cormorant-var.woff2') format('woff2-variations');
  font-weight: 300 700;
  font-style: normal;
  font-display: swap;
  unicode-range: U+0000-00FF, U+0400-045F, U+0490-0491, U+2010-2026, U+2116, U+20BD, U+2212;
}
`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <style dangerouslySetInnerHTML={{ __html: FONT_FACES }} />
        <link
          rel="preload"
          href={`${BASE}/fonts/onest-var.woff2`}
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        {/* Anticva набирает заголовок первого экрана — это элемент LCP,
            поэтому файл запрашивается сразу, а не после разбора стилей. */}
        <link
          rel="preload"
          href={`${BASE}/fonts/anticva.woff2`}
          as="font"
          type="font/woff2"
          crossOrigin="anonymous"
        />
        {/* Заглушка Метрики ставится до гидратации: цели, вызванные раньше
            загрузки счётчика, копятся в очереди и уходят потом. */}
        <script
          dangerouslySetInnerHTML={{
            __html:
              'window.ym=window.ym||function(){(window.ym.a=window.ym.a||[]).push(arguments)};window.ym.l=+new Date();',
          }}
        />
      </head>
      <body>
        {children}
        {/* Место под счётчик Яндекс Метрики. Номер задаётся переменной
            NEXT_PUBLIC_YM_ID на сборке, скрипт грузится из src/lib/metrika.ts
            в простое браузера, чтобы не портить скорость первой отрисовки.
            noscript-пиксель нужен Метрике для учёта посетителей без JS. */}
        {YM_ID ? (
          <noscript>
            <div>
              <img
                src={`https://mc.yandex.ru/watch/${YM_ID}`}
                style={{ position: 'absolute', left: '-9999px' }}
                alt=""
              />
            </div>
          </noscript>
        ) : null}
      </body>
    </html>
  );
}
