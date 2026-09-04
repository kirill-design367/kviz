/**
 * Телефон: маска при вводе и проверка формата.
 * Российский номер, 11 цифр, +7 или 8 на входе — всегда +7 на выходе.
 */

export function digitsOf(value: string): string {
  return value.replace(/\D/g, '');
}

/** Приводит любые цифры к 10 значащим (без кода страны). */
function significant(raw: string): string {
  let digits = digitsOf(raw);
  if (digits.startsWith('8')) digits = digits.slice(1);
  else if (digits.startsWith('7')) digits = digits.slice(1);
  return digits.slice(0, 10);
}

/** «9991234567» → «+7 999 123-45-67». Маска дорисовывается по мере ввода. */
export function formatPhone(value: string): string {
  const d = significant(value);
  if (d.length === 0) return '';
  let out = '+7 ' + d.slice(0, 3);
  if (d.length > 3) out += ' ' + d.slice(3, 6);
  if (d.length > 6) out += '-' + d.slice(6, 8);
  if (d.length > 8) out += '-' + d.slice(8, 10);
  return out;
}

export function isValidPhone(value: string): boolean {
  const d = significant(value);
  // Мобильные и большинство новых кодов РФ начинаются с 9, 3, 4, 8.
  return d.length === 10 && /^[3489]/.test(d);
}

/** Нормализованный вид для отправки: +7XXXXXXXXXX */
export function normalizePhone(value: string): string {
  const d = significant(value);
  return d.length === 10 ? '+7' + d : '';
}
