// Оттенки одного цвета для холста. Грань в тени — тот же цвет, только темнее; блик — светлее.
// Раньше это рисовали двумя-тремя заливками поверх друг друга (цвет, потом полупрозрачный чёрный, потом белый),
// а на холсте каждая заливка — отдельный проход по пикселям. Смешать цвет заранее — одна заливка, тот же результат.

type Rgba = [number, number, number, number];

/** Разобрать цвет canvas: '#rgb', '#rrggbb', 'rgb(r, g, b)', 'rgba(r, g, b, a)', 'rgb(r g b / a)'. Не вышло — null */
export function parseColor(color: string): Rgba | null {
  const hex = /^#([\da-f]{3}|[\da-f]{6})$/i.exec(color);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join('') : hex[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)\s*(?:[,/]\s*([\d.]+)(%?))?\s*\)$/.exec(color);
  if (!rgb) return null;
  const a = rgb[4] === undefined ? 1 : Number(rgb[4]) / (rgb[5] ? 100 : 1);
  return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), a];
}

const tints = new Map<string, string | null>();

/**
 * Цвет color, затемнённый на dark (0…1, как полупрозрачный чёрный поверх) и осветлённый на shine (белый поверх).
 * null — цвет не разобрать: тогда рисуй по-старому, слоями. Ответы запоминаются: цветов в кадре немного, а граней — сотни
 */
export function tint(color: string, dark: number, shine = 0): string | null {
  // доли округляем до сотых: глаз разницы не видит, а разных строк цвета (и записей в памяти) в сотни раз меньше
  const d = Math.round(dark * 100) / 100, s = Math.round(shine * 100) / 100;
  if (d <= 0 && s <= 0) return color;
  const key = `${color}|${d}|${s}`;
  let out = tints.get(key);
  if (out === undefined) {
    const c = parseColor(color);
    out = c && rgbText(c.slice(0, 3).map((v) => v * (1 - d) * (1 - s) + 255 * s), c[3]);
    if (tints.size > 4000) tints.clear(); // на случай, если цветов вдруг станет очень много
    tints.set(key, out);
  }
  return out;
}

/** Смесь двух цветов: t = 0 — первый, 1 — второй. null — цвет не разобрать */
export function mix(a: string, b: string, t: number): string | null {
  const x = parseColor(a), y = parseColor(b);
  return x && y && rgbText(x.slice(0, 3).map((v, i) => v + (y[i] - v) * t), x[3]);
}

function rgbText([r, g, b]: number[], a: number): string {
  const ch = (v: number): number => Math.round(Math.max(0, Math.min(255, v)));
  return a >= 1 ? `rgb(${ch(r)} ${ch(g)} ${ch(b)})` : `rgb(${ch(r)} ${ch(g)} ${ch(b)} / ${a})`;
}

/**
 * Тот же цвет, но совсем прозрачный — для градиента «в никуда». Градиент к 'transparent' идёт через
 * прозрачный чёрный: на середине вышла бы серая полоса
 */
export function clearOf(color: string): string {
  const c = parseColor(color);
  return c ? rgbText(c, 0) : 'transparent';
}
