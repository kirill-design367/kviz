/**
 * Ник в Telegram.
 *
 * Логика та же, что у телефона: что человек напечатал, то и уходит в заявку.
 * Ничего не переписываем за него. Проверяем только, что это вообще похоже
 * на ник, и умеем достать из написанного сам ник — он нужен для ссылки
 * в сообщении владельцу.
 *
 * Пишут по-разному: «@name», «name», «t.me/name», «https://t.me/name».
 * Все четыре формы принимаем.
 */

/** Ник Telegram: 5–32 знака, латиница, цифры и подчёркивание, начинается с буквы. */
const NICK = /^[A-Za-z][A-Za-z0-9_]{4,31}$/;

/** Вытащить сам ник из того, что напечатали. Вернёт пустую строку, если не вышло. */
export function telegramNick(value: string): string {
  const raw = (value ?? '').trim();
  if (!raw) return '';
  const stripped = raw
    .replace(/^https?:\/\//i, '')
    .replace(/^(www\.)?t(elegram)?\.me\//i, '')
    .replace(/^@/, '')
    .replace(/[/?#].*$/, '')
    .trim();
  return NICK.test(stripped) ? stripped : '';
}

/** Похоже ли на ник в Telegram. */
export function looksLikeTelegram(value: string): boolean {
  return telegramNick(value) !== '';
}

/** Что уходит в заявку — ровно то, что человек напечатал. */
export function telegramAsTyped(value: string): string {
  return (value ?? '').trim();
}
