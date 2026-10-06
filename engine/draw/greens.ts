// Оттенки зелени для обоих видов: у каждого дерева и куста — свой из TONES, от базового цвета темы
// к тёплому (оливковый) и холодному (сизый), темнее и светлее. Лес растёт пятнами, как настоящий,
// но соседние деревья чаще разные — не сливаются в одно пятно. Оттенок — от места дерева: без Math.random
import { hashString } from '../core/utils.ts';
import { mix, tint } from '../core/paint.ts';
import type { Palette } from './render.ts';

/** Сколько оттенков у одной зелени */
export const TONES = 6;
/** Размер «пятна» леса одного оттенка, px */
const PATCH = 140;
/** Сдвиг оттенка у отдельного дерева относительно пятна: чаще свой, иногда как у пятна */
const OWN = [-1, 0, 1, 2, 3];

/** Номер оттенка дерева в точке (x, y): от 0 до TONES − 1 */
export function toneOf(x: number, y: number): number {
  const patch = hashString(`${Math.floor(x / PATCH)}|${Math.floor(y / PATCH)}`) % TONES;
  const own = OWN[hashString(`${Math.round(x)}|${Math.round(y)}`) % OWN.length];
  return (patch + own + TONES) % TONES;
}

const cache = new Map<string, string[]>();

/** TONES оттенков зелени base: тот же, теплее, холоднее, темнее, светлее, тёплый и светлый */
export function tonesOf(base: string, p: Palette): string[] {
  const key = `${base}|${p.treeWarm}|${p.treeCool}`;
  let tones = cache.get(key);
  if (!tones) {
    tones = [
      base,
      mix(base, p.treeWarm, 0.35),
      mix(base, p.treeCool, 0.4),
      tint(base, 0.16),
      tint(base, 0, 0.12),
      mix(tint(base, 0, 0.06) ?? base, p.treeWarm, 0.6),
    ].map((c) => c ?? base);
    if (cache.size > 40) cache.clear(); // смена темы — новые цвета; старые не нужны
    cache.set(key, tones);
  }
  return tones;
}
