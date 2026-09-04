/**
 * Яндекс Метрика.
 *
 * Номер счётчика подставляется на сборке через NEXT_PUBLIC_YM_ID.
 * Пока номера нет, всё работает вхолостую: цели вызываются, но никуда не уходят,
 * а в разработке пишутся в консоль — видно, что схема живая.
 *
 * Счётчик грузится не сразу, а в простое браузера или по первому касанию:
 * сторонний скрипт не должен портить показатели загрузки, за которые платим кликами.
 */

export const YM_ID = process.env.NEXT_PUBLIC_YM_ID ?? '';

/** Все цели проекта. Одно место, где они перечислены. */
export const GOALS = {
  /** Нажата кнопка «Рассчитать стоимость» — квиз открыт. */
  quizStart: 'quiz_start',
  /** Пройден вопрос N. Отправляется один раз на вопрос. */
  quizStep: (n: number) => `quiz_step_${n}`,
  /** Человек вернулся назад — сигнал, что вопрос непонятен. */
  quizBack: 'quiz_back',
  /** Показана вилка стоимости. Ключевая цель воронки. */
  resultShown: 'result_shown',
  /** Человек начал заполнять форму. */
  formStart: 'form_start',
  /** Заявка ушла. Главная цель для Директа. */
  leadSent: 'lead_sent',
  /** Отправка не удалась — чтобы видеть потери не по своей вине. */
  leadFailed: 'lead_failed',
} as const;

/** Полный список целей для настройки в интерфейсе Метрики. */
export const GOAL_LIST: string[] = [
  GOALS.quizStart,
  ...[1, 2, 3, 4, 5, 6, 7].map(GOALS.quizStep),
  GOALS.quizBack,
  GOALS.resultShown,
  GOALS.formStart,
  GOALS.leadSent,
  GOALS.leadFailed,
];

type YmFunction = ((...args: unknown[]) => void) & { a?: unknown[][]; l?: number };

declare global {
  interface Window {
    ym?: YmFunction;
  }
}

let loading = false;
let loaded = false;

function injectTag() {
  if (loading || loaded || !YM_ID || typeof document === 'undefined') return;
  loading = true;
  const script = document.createElement('script');
  script.src = 'https://mc.yandex.ru/metrika/tag.js';
  script.async = true;
  script.onload = () => {
    loaded = true;
    window.ym?.(YM_ID, 'init', {
      clickmap: true,
      trackLinks: true,
      accurateTrackBounce: true,
      webvisor: false,
      defer: false,
    });
  };
  document.head.appendChild(script);
}

/**
 * Ставит заглушку (вызовы целей копятся в очереди) и планирует загрузку счётчика.
 * Вызывать один раз при монтировании страницы.
 */
export function initMetrika(): void {
  if (typeof window === 'undefined') return;

  if (!window.ym) {
    const stub: YmFunction = function stubbed(...args: unknown[]) {
      (stub.a = stub.a || []).push(args);
    } as YmFunction;
    stub.l = Date.now();
    window.ym = stub;
  }

  if (!YM_ID) return;

  const start = () => injectTag();
  const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: object) => void })
    .requestIdleCallback;

  if (typeof idle === 'function') idle(start, { timeout: 4000 });
  else window.setTimeout(start, 2500);

  // Если человек начал действовать раньше, чем браузер освободился — грузим сразу,
  // иначе первые цели повиснут в очереди дольше нужного.
  const once = { once: true, passive: true } as AddEventListenerOptions;
  window.addEventListener('pointerdown', start, once);
  window.addEventListener('keydown', start, once);
}

const fired = new Set<string>();

/** Отправить цель. Повторные вызовы одной и той же цели по умолчанию игнорируются. */
export function reachGoal(goal: string, params?: Record<string, unknown>, once = true): void {
  if (typeof window === 'undefined') return;
  if (once) {
    if (fired.has(goal)) return;
    fired.add(goal);
  }
  if (process.env.NODE_ENV !== 'production') {
    console.info('[метрика] цель:', goal, params ?? '');
  }
  if (!YM_ID) return;
  injectTag();
  window.ym?.(YM_ID, 'reachGoal', goal, params);
}

/** Сброс памяти об отправленных целях — нужен, когда человек начинает квиз заново. */
export function resetGoals(): void {
  fired.clear();
}
