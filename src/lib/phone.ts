/**
 * Телефон.
 *
 * Маски нет: человек пишет как ему удобно, и что вписал — то и уходит.
 * Ничего не переставляем, не дописываем код страны и не «исправляем»
 * за него. Проверяем только, что введённое вообще похоже на номер:
 * маска, которая переставляет цифры под курсором, ломает ввод чаще,
 * чем спасает, а исправленный за человека номер он потом не узнаёт.
 */

const ALLOWED = /^[\d\s+()\-.]+$/;

export function digitsOf(value: string): string {
  return (value ?? '').replace(/\D/g, '');
}

/** Похоже ли на телефонный номер. Без привязки к российскому формату. */
export function looksLikePhone(value: string): boolean {
  const raw = (value ?? '').trim();
  if (!raw) return false;
  // Буквы и прочий мусор — не номер.
  if (!ALLOWED.test(raw)) return false;
  const digits = digitsOf(raw);
  // Десять цифр — короткий российский номер без кода страны,
  // пятнадцать — предел, который допускает международный стандарт E.164.
  return digits.length >= 10 && digits.length <= 15;
}

/** Что уходит в заявку — ровно то, что человек напечатал. */
export function phoneAsTyped(value: string): string {
  return (value ?? '').trim();
}
