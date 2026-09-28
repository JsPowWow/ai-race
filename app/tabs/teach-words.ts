// Слова по-русски для «Я учу»: «1 заезд», «2 заезда», «5 заездов».

/** Форма слова для числа n: plural(n, 'заезд', 'заезда', 'заездов') */
export function plural(n: number, one: string, few: string, many: string): string {
  const tens = n % 100, ones = n % 10;
  if (tens >= 11 && tens <= 14) return many;
  if (ones === 1) return one;
  return ones >= 2 && ones <= 4 ? few : many;
}
