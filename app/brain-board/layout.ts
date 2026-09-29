// Геометрия «Табло мозга»: где стоит каждый нейрон, где рамки групп и куда попал указатель. Чистые функции, без DOM.
//
// Входы мозга: s1…sn (сейчас), v, s1′…sn′ (мгновение назад), зн (дорожный знак), m1…m3 (заметки). Чтобы 19 входов
// не превратились в частокол, сенсор «сейчас» и он же «мгновение назад» стоят в одной строке:
// большой кружок и маленький слева от него. Знак — под скоростью, заметки — своей группой внизу.
// Выходы: 4 кнопки пульта и заметки.

/** Точка на табло, в CSS-пикселях холста */
export type Point = [x: number, y: number];

/** Рамка группы: вход, заметки на входе, скрытый слой, пульт, заметки на выходе */
export type Box = { id: string; x0: number; y0: number; x1: number; y1: number };

export type Layout = {
  /** нейронов в каждом слое, от входов к выходам */
  sizes: readonly number[];
  /** сенсоров, заметок и кнопок пульта */
  n: number; notes: number; buttons: number;
  /** pos[k][i] — центр нейрона i слоя k */
  pos: Point[][];
  /** радиус кружка, радиус маленького кружка «мгновение назад» и насколько он левее большого */
  r: number; rGhost: number; ghost: number;
  /** левый край рамок входов: левее — только подписи */
  inLeft: number;
  /** узкий экран (телефон): подписи короче, кнопки меньше */
  narrow: boolean;
  W: number; H: number; top: number; bottom: number;
  button: { w: number; h: number };
  /** рамки групп и две из них отдельно: между ними идёт петля заметок */
  boxes: Box[]; notesIn: Box; notesOut: Box;
};

/** Ширина плашки заметки на выходе */
export const NOTE_W = 64;

/**
 * @param sizes нейронов в каждом слое, от входов к выходам
 * @param sensorCount сколько сенсоров (n)
 * @param notes сколько заметок
 * @param W ширина холста в CSS-пикселях
 * @param H высота
 */
export function layout(sizes: readonly number[], sensorCount: number, notes: number, W: number, H: number): Layout {
  const n = sensorCount, last = sizes.length - 1;
  const narrow = W < 640; // телефон: всё компактнее
  const top = 36, bottom = 34; // сверху — подписи рамок, снизу — петля заметок
  const start = narrow ? 84 : 118, end = narrow ? 92 : 170;
  const gapUnits = 1.1; // промежуток между группами, в строках
  // строки входов: n пар «сейчас/мгновение назад», v и знак, потом заметки
  const inRows = n + 2 + notes;
  const step = Math.min(46, (H - top - bottom - 30) / (inRows + gapUnits));
  const r = Math.max(9, Math.min(17, step * 0.4));
  const colX = (k: number) => start + ((W - start - end) * k) / last;

  /** Столбец из групп: [сколько узлов в группе, …] → y каждого узла, группы разделены промежутком */
  const column = (groups: number[]): number[] => {
    const total = groups.reduce((s, g) => s + g, 0) + (groups.length - 1) * gapUnits;
    let y = top + 30 + (H - top - bottom - 30 - total * step) / 2 + step / 2;
    const ys: number[] = [];
    groups.forEach((g, gi) => {
      for (let i = 0; i < g; i++) { ys.push(y); y += step; }
      if (gi < groups.length - 1) y += gapUnits * step;
    });
    return ys;
  };

  const inY = column([n + 2, notes]);
  const rGhost = r * 0.45;
  const x0 = colX(0), ghost = r + 8 + rGhost; // маленький кружок «мгновение назад» — слева от большого
  const inLeft = x0 - ghost - rGhost - 17; // левый край рамок входов: над маленьким кружком влезает подпись «было»
  const inputs: Point[] = [
    ...Array.from({ length: n }, (_, i): Point => [x0, inY[i]]), // s1…sn
    [x0, inY[n]], // v
    ...Array.from({ length: n }, (_, i): Point => [x0 - ghost, inY[i]]), // s1′…sn′
    [x0, inY[n + 1]], // зн
    ...Array.from({ length: notes }, (_, i): Point => [x0, inY[n + 2 + i]]), // m1…m3
  ];
  const hidden = sizes.slice(1, last).map((size, k) => {
    const g = Math.min(52, (H - top - bottom - 40) / size);
    return Array.from({ length: size }, (_, i): Point => [colX(k + 1), (top + H - bottom) / 2 + 10 + (i - (size - 1) / 2) * g]);
  });
  // Кнопки — вровень со строками сенсоров (от s1 до знака), заметки на выходе — в тех же строках, что m1…m3 на входе:
  // что мозг записал справа, то в той же строке и прочитает слева
  const buttons = sizes[last] - notes;
  const span = inY[n + 1] - inY[0], gap = Math.min(96, span / Math.max(1, buttons - 1));
  const firstButton = inY[0] + (span - gap * (buttons - 1)) / 2;
  const outputs: Point[] = [
    ...Array.from({ length: buttons }, (_, i): Point => [colX(last), firstButton + i * gap]),
    ...Array.from({ length: notes }, (_, i): Point => [colX(last), inY[n + 2 + i]]),
  ];

  const button = { w: narrow ? 78 : 132, h: narrow ? 38 : 36 };
  const lay = { sizes, n, notes, buttons, pos: [inputs, ...hidden, outputs], r, rGhost, ghost, inLeft, narrow, W, H, button, top, bottom };
  return { ...lay, ...frameBoxes(lay) };
}

/**
 * Рамки групп: вход (сенсоры сейчас и мгновение назад, скорость, знак), заметки на входе, слои, пульт, заметки на выходе.
 * Рамки входов и выходов стоят парами на одной высоте: сенсоры ↔ пульт, заметки ↔ заметки.
 */
function frameBoxes(lay: Omit<Layout, 'boxes' | 'notesIn' | 'notesOut'>): Pick<Layout, 'boxes' | 'notesIn' | 'notesOut'> {
  const { n, pos, inLeft, button } = lay;
  const last = pos.length - 1, pad = lay.r + 7;
  const box = (points: Point[], id: string, top = 0): Box => {
    const xs = points.map((p) => p[0]), ys = points.map((p) => p[1]);
    return { id, x0: Math.min(...xs) - pad, y0: Math.min(...ys) - pad - top, x1: Math.max(...xs) + pad, y1: Math.max(...ys) + pad };
  };
  const ins = pos[0];
  const input = { ...box([...ins.slice(0, n + 1), ins[2 * n + 1]], 'input', 16), x0: inLeft }; // сверху — место для «было / сейчас»
  const notesIn = { ...box(ins.slice(2 * n + 2), 'notesIn'), x0: inLeft };
  const outs = pos[last], bx = outs[0][0];
  const buttons: Box = {
    id: 'buttons', x0: bx - 14, x1: bx - 6 + button.w + 8,
    y0: Math.min(input.y0, outs[0][1] - button.h / 2 - 9),
    y1: Math.max(input.y1, outs[lay.buttons - 1][1] + button.h / 2 + 9),
  };
  const notesOut = { ...notesIn, id: 'notesOut', x0: bx - 14, x1: bx - 6 + NOTE_W + 8 };
  const hidden = pos.slice(1, last).map((col, k) => box(col, `hidden${k}`));
  return { boxes: [input, notesIn, ...hidden, buttons, notesOut], notesIn, notesOut };
}

/** Центр кнопки пульта для выхода: кнопка стоит справа от точки, где сходятся связи */
export const buttonCenterX = (lay: Layout, x: number): number => x + lay.button.w / 2 - 6;

/**
 * Нейрон под точкой (в координатах табло): кружок слоя, кнопка пульта или плашка заметки.
 * Входы не считаются: формулы у них нет. Зоны у плотного слоя перекрываются — берём ближайший.
 */
export function neuronAt(lay: Layout, x: number, y: number): { k: number; i: number } | null {
  const last = lay.pos.length - 1;
  let hit: { k: number; i: number } | null = null, best = Infinity;
  for (let k = 1; k <= last; k++) {
    for (let i = 0; i < lay.pos[k].length; i++) {
      const [px, py] = lay.pos[k][i];
      const note = k === last && i >= lay.buttons;
      const cx = k < last ? px : note ? px - 6 + NOTE_W / 2 : buttonCenterX(lay, px);
      const reach = k < last ? lay.r + 12 : note ? NOTE_W / 2 : lay.button.w / 2;
      const d = Math.hypot(x - cx, y - py);
      if (d < reach && d < best) { hit = { k, i }; best = d; }
    }
  }
  return hit;
}

/** Сенсор «сейчас» под точкой (номер) или −1. Скорость, прошлое и заметки мозг считает сам — их не нажать */
export function sensorAt(lay: Layout, x: number, y: number): number {
  for (let i = 0; i < lay.n; i++) {
    const [px, py] = lay.pos[0][i];
    if (Math.hypot(x - px, y - py) < lay.r + 6) return i;
  }
  return -1;
}

/** Плавная связь — S-кривая слева направо. Добавляется к текущему пути: много связей рисуются одним stroke() */
export function addCurve(path: CanvasPath, [x1, y1]: Point, [x2, y2]: Point): void {
  path.moveTo(x1, y1);
  path.bezierCurveTo((x1 + x2) / 2, y1, (x1 + x2) / 2, y2, x2, y2);
}

/** Точка на той же кривой: t = 0 — начало, 1 — конец (по ней бегут импульсы). Пишет в out — без новых массивов на кадр */
export function bezierAt([x1, y1]: Point, [x2, y2]: Point, t: number, out: Point): Point {
  const cx = (x1 + x2) / 2, u = 1 - t;
  out[0] = u ** 3 * x1 + 3 * u * u * t * cx + 3 * u * t * t * cx + t ** 3 * x2;
  out[1] = u ** 3 * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t ** 3 * y2;
  return out;
}
