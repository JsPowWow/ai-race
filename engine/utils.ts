// Мелкие математические помощники. Студентам тут менять ничего не нужно.

/** Линейная интерполяция: t = 0 → a, t = 1 → b */
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

export const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** Случайное число от min до max */
export const randomBetween = (min: number, max: number): number => min + Math.random() * (max - min);

/** Случайное число «колоколом»: чаще около 0, реже дальше; примерно две трети — от -1 до 1 */
export function randomGauss(): number {
  const u = 1 - Math.random(), v = Math.random(); // u > 0: логарифм нуля не бывает
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Плавная «ступенька»: большое отрицательное → 0, большое положительное → 1 */
export const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));

/** Детерминированный генератор случайных чисел: один seed — одна и та же последовательность */
/** Генератор случайных чисел от 0 до 1 — как Math.random, но предсказуемый */
export type Random = () => number;

export function mulberry32(seed: number): Random {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Строка → число (для seed вида "финал-2026") */
export function hashString(str: string | number): number {
  let h = 2166136261;
  for (const ch of String(str)) {
    h ^= ch.codePointAt(0) ?? 0;
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Пересечение отрезков AB и CD.
 * Возвращает долю пути вдоль AB (0..1), где отрезки пересеклись, или -1.
 */
export function segmentT(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): number {
  const rx = bx - ax, ry = by - ay;
  const sx = dx - cx, sy = dy - cy;
  const den = rx * sy - ry * sx;
  if (den === 0) return -1;
  const qx = cx - ax, qy = cy - ay;
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1;
}
