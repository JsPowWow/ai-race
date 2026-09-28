// Геометрия «Табло мозга»: где стоит каждый нейрон и как идут связи. Чистые функции, без DOM.
//
// Входы мозга: s1…sn (сейчас), v, s1′…sn′ (мгновение назад), m1…m3 (заметки). Чтобы 18 входов
// не превратились в частокол, сенсор «сейчас» и он же «мгновение назад» стоят в одной строке:
// большой кружок и маленький слева от него. Заметки — своей группой внизу. Выходы: 4 кнопки пульта и заметки.

/**
 * @param {number[]} sizes нейронов в каждом слое, от входов к выходам
 * @param {number} sensorCount сколько сенсоров (n)
 * @param {number} notes сколько заметок
 * @param {number} W ширина холста в CSS-пикселях
 * @param {number} H высота
 */
export function layout(sizes, sensorCount, notes, W, H) {
  const n = sensorCount, last = sizes.length - 1;
  const narrow = W < 640; // телефон: всё компактнее
  const top = 36, bottom = 34; // сверху — подписи рамок, снизу — петля заметок
  const start = narrow ? 70 : 118, end = narrow ? 92 : 170;
  const gapUnits = 1.1; // промежуток между группами, в строках
  // строки входов: n пар «сейчас/мгновение назад» и v, потом заметки
  const inRows = n + 1 + notes;
  const step = Math.min(46, (H - top - bottom - 30) / (inRows + gapUnits));
  const r = Math.max(9, Math.min(17, step * 0.4));
  const colX = (k) => start + ((W - start - end) * k) / last;

  /** Координаты столбца с группами: [[сколько, …]] → y каждого узла, группы разделены промежутком */
  const column = (groups, gap = step) => {
    const total = groups.reduce((s, g) => s + g, 0) + (groups.length - 1) * gapUnits;
    let y = top + 30 + (H - top - bottom - 30 - total * gap) / 2 + gap / 2;
    const ys = [];
    groups.forEach((g, gi) => {
      for (let i = 0; i < g; i++) { ys.push(y); y += gap; }
      if (gi < groups.length - 1) y += gapUnits * gap;
    });
    return ys;
  };

  const inY = column([n + 1, notes]);
  const x0 = colX(0), ghost = r + 8 + r * 0.45; // маленький кружок «мгновение назад» — слева от большого
  const inputs = [
    ...Array.from({ length: n }, (_, i) => [x0, inY[i]]), // s1…sn
    [x0, inY[n]], // v
    ...Array.from({ length: n }, (_, i) => [x0 - ghost, inY[i]]), // s1′…sn′
    ...Array.from({ length: notes }, (_, i) => [x0, inY[n + 1 + i]]), // m1…m3
  ];
  const hidden = sizes.slice(1, last).map((size, k) => {
    const g = Math.min(52, (H - top - bottom - 40) / size);
    return Array.from({ length: size }, (_, i) => [colX(k + 1), (top + H - bottom) / 2 + 10 + (i - (size - 1) / 2) * g]);
  });
  const buttons = sizes[last] - notes;
  const outY = column([buttons, notes], Math.min(narrow ? 64 : 80, (H - top - bottom - 40) / (buttons + notes * 0.6 + gapUnits)));
  const outputs = outY.map((y) => [colX(last), y]);
  // заметки на выходе — маленькие плашки, их ставим плотнее под кнопками
  const firstNote = outputs[buttons][1];
  for (let i = 0; i < notes; i++) outputs[buttons + i][1] = firstNote + i * Math.max(28, step);

  const button = { w: narrow ? 78 : 132, h: narrow ? 38 : 36 };
  return { sizes, n, notes, buttons, pos: [inputs, ...hidden, outputs], r, rGhost: r * 0.45, narrow, W, H, button, top, bottom };
}

/** Центр кнопки пульта для выхода: кнопка стоит справа от точки, где сходятся связи */
export const buttonCenter = (lay, [x, y]) => [x + lay.button.w / 2 - 6, y];

/** Плавная связь: S-кривая слева направо */
export function curve(ctx, [x1, y1], [x2, y2]) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.bezierCurveTo((x1 + x2) / 2, y1, (x1 + x2) / 2, y2, x2, y2);
}

/** Точка на той же кривой: t = 0 — начало, 1 — конец (по ней бегут импульсы) */
export function bezierAt([x1, y1], [x2, y2], t) {
  const cx = (x1 + x2) / 2, u = 1 - t;
  return [
    u ** 3 * x1 + 3 * u * u * t * cx + 3 * u * t * t * cx + t ** 3 * x2,
    u ** 3 * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y2,
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
