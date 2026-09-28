// Геометрия «Табло мозга»: где стоит каждый нейрон и как идут связи. Чистые функции, без DOM.

/**
 * Раскладка слоёв: слева направо (широкий экран) или сверху вниз (узкий).
 * @param {number[]} sizes нейронов в каждом слое, от входов к выходам
 * @param {number} W ширина холста в CSS-пикселях
 * @param {number} H высота
 * @param {boolean} vertical сверху вниз
 * @param {number} [top] место сверху под подписи рамок слоёв
 */
export function layout(sizes, W, H, vertical, top = 34) {
  const narrow = !vertical && W < 640; // телефон, но слева направо: всё компактнее
  const along = vertical ? H : W, across = vertical ? W : H - top;
  // место под подписи входов (слева или сверху) и кнопки пульта (справа или снизу)
  const start = vertical ? 64 + top : narrow ? 60 : 110, end = vertical ? 58 : narrow ? 94 : 170;
  const maxN = Math.max(...sizes);
  const gap = Math.min(52, (across - 28) / maxN);
  const r = Math.max(10, Math.min(20, gap * 0.42));
  const last = sizes.length - 1;
  const pos = sizes.map((n, k) => {
    const a = start + ((along - start - end) * k) / last;
    // у кнопок пульта свой шаг, пошире: они крупнее нейронов
    const g = k < last ? gap : vertical ? (across - 24) / n : Math.min(88, (across - 60) / n);
    return Array.from({ length: n }, (_, i) => {
      const b = (vertical ? 0 : top) + across / 2 + (i - (n - 1) / 2) * g;
      return vertical ? [b, a] : [a, b];
    });
  });
  const button = { w: vertical ? (W - 24) / 4 - 6 : narrow ? 78 : 132, h: vertical || narrow ? 40 : 36 };
  return { sizes, pos, r, vertical, narrow, W, H, button };
}

/** Центр кнопки пульта для выхода i: кнопка стоит рядом с точкой, где сходятся связи */
export function buttonCenter(lay, [x, y]) {
  return lay.vertical ? [x, y + 24] : [x + lay.button.w / 2 - 6, y];
}

/** Плавная связь: S-кривая от нейрона к нейрону */
export function curve(ctx, [x1, y1], [x2, y2], vertical) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  if (vertical) ctx.bezierCurveTo(x1, (y1 + y2) / 2, x2, (y1 + y2) / 2, x2, y2);
  else ctx.bezierCurveTo((x1 + x2) / 2, y1, (x1 + x2) / 2, y2, x2, y2);
}

/** Точка на той же кривой: t = 0 — начало, 1 — конец (по ней бегут импульсы) */
export function bezierAt([x1, y1], [x2, y2], t, vertical) {
  const [c1, c2] = vertical ? [[x1, (y1 + y2) / 2], [x2, (y1 + y2) / 2]] : [[(x1 + x2) / 2, y1], [(x1 + x2) / 2, y2]];
  const u = 1 - t;
  return [
    u ** 3 * x1 + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * x2,
    u ** 3 * y1 + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * y2,
  ];
}

export function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
