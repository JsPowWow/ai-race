// Числа и слова для людей: десятичная запятая, секунды, размер файла, «1 заезд — 5 заездов».
// Без DOM — проверяется тестами в Node (test/app/format.test.mjs).

/** Число с запятой, как пишут по-русски: num(12.44) → «12,4» */
export const num = (x: number, digits = 1): string => x.toFixed(digits).replace('.', ',');

/** Тики → «12,4 с» (60 тиков = 1 секунда) */
export const secs = (ticks: number, digits = 1): string => `${num(ticks / 60, digits)} с`;
/** Доля в процентах, целым числом: 37.6 → «38%» */
export const pct = (value: number): string => `${Math.round(value)}%`;

/** Байты по-человечески: 319 Б, 1,5 КБ, 2,3 МБ, 1,1 ГБ */
export function bytes(n: number): string {
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) [n, i] = [n / 1024, i + 1];
  return `${i ? num(n) : n} ${units[i]}`;
}

/** Форма слова для числа n: plural(n, 'заезд', 'заезда', 'заездов') */
export function plural(n: number, one: string, few: string, many: string): string {
  const tens = n % 100, ones = n % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (ones === 1) return one;
  return ones >= 2 && ones <= 4 ? few : many;
}
