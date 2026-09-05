import type { Answers } from './quiz';

/**
 * Квиз намеренно НЕ помнит прохождение между загрузками страницы.
 *
 * Раньше ответы восстанавливались из localStorage, и это давало две беды.
 * Во-первых, человек, однажды заполнивший форму, при следующем заходе попадал
 * сразу на экран с вилкой, а не на оффер. Во-вторых, после отправки состояние
 * очищалось, но эффект сохранения тут же срабатывал на смену экрана и писал
 * его обратно — с отметкой «пройдено». В итоге сайт навсегда открывался
 * не с начала.
 *
 * Теперь при любой загрузке страница открывается с первого экрана.
 */

/** Ключ, под которым прохождение хранилось раньше. Чистим, чтобы не мешался. */
const LEGACY_KEY = 'aurea-kviz-v1';

export function clearLegacyState(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* приватный режим — и не надо */
  }
}

export type { Answers };

/** Метки Директа и источник перехода — уходят в заявку вместе с ответами. */
export type Source = Record<string, string>;

const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content'];
const SOURCE_KEY = 'aurea-kviz-source-v1';

export function captureSource(): void {
  if (typeof window === 'undefined') return;
  try {
    const params = new URLSearchParams(window.location.search);
    const found: Source = {};
    for (const key of UTM_KEYS) {
      const value = params.get(key);
      if (value) found[key] = value.slice(0, 120);
    }
    if (document.referrer && !document.referrer.includes(window.location.host)) {
      found.referrer = document.referrer.slice(0, 200);
    }
    found.page = window.location.href.split('#')[0].slice(0, 200);
    const existing = window.sessionStorage.getItem(SOURCE_KEY);
    // Первый заход в сессии решает: перезагрузка не должна затирать метки Директа.
    if (!existing || Object.keys(found).length > 1) {
      window.sessionStorage.setItem(SOURCE_KEY, JSON.stringify(found));
    }
  } catch {
    /* пусто */
  }
}

export function readSource(): Source {
  if (typeof window === 'undefined') return {};
  try {
    return JSON.parse(window.sessionStorage.getItem(SOURCE_KEY) ?? '{}') as Source;
  } catch {
    return {};
  }
}
