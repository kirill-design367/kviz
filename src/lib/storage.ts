import type { Answers } from './quiz';

/**
 * Ответы переживают обновление страницы. Схема версионируется:
 * если вопросы поменяются, старое состояние молча отбрасывается,
 * а не подсовывает несуществующие варианты.
 */

const KEY = 'aurea-kviz-v1';
const SCHEMA = 1;

export type SavedState = {
  schema: number;
  step: number;
  answers: Answers;
  /** Дошёл ли человек до экрана с вилкой. */
  finished: boolean;
  updatedAt: number;
};

const EMPTY: SavedState = { schema: SCHEMA, step: 0, answers: {}, finished: false, updatedAt: 0 };

export function loadState(): SavedState {
  if (typeof window === 'undefined') return EMPTY;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<SavedState>;
    if (parsed.schema !== SCHEMA || typeof parsed.answers !== 'object' || !parsed.answers) return EMPTY;
    return {
      schema: SCHEMA,
      step: typeof parsed.step === 'number' ? parsed.step : 0,
      answers: parsed.answers as Answers,
      finished: Boolean(parsed.finished),
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : 0,
    };
  } catch {
    // Приватный режим, переполненное хранилище, битый JSON — ведём себя как будто пусто.
    return EMPTY;
  }
}

export function saveState(state: Omit<SavedState, 'schema' | 'updatedAt'>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      KEY,
      JSON.stringify({ ...state, schema: SCHEMA, updatedAt: Date.now() }),
    );
  } catch {
    // Не смогли сохранить — не повод ломать квиз.
  }
}

export function clearState(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    /* пусто */
  }
}

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
