// Декор вокруг трассы: лес, домики, всё хозяйство гоночной трассы (огни, трибуны, шины, щиты) и сельская мелочь.
// Только картинка — сенсоры и физика его не видят (ADR 0005).
// Расставляется из seed трассы: у всех учеников на одной трассе один и тот же лес.
import { hashString, mulberry32, type Random } from './utils.ts';
import type { Track, Point, Road } from './track.ts';
import { local } from './tilt.ts';

/** Дерево: ёлка (ярусы конусов), круглое (пышная крона) или низкий куст. r — радиус кроны, px */
export type Tree = { x: number; y: number; r: number; kind: 'fir' | 'round' | 'bush' };
/** Домик: w — вдоль дороги, d — вглубь, angle — как дорога рядом (фасадом к ней) */
export type House = { x: number; y: number; w: number; d: number; angle: number };
/** Точка с номером цвета (0–3): голова зрителя на трибуне, цветок на клумбе */
export type Dot = { x: number; y: number; c: number };
/** Машинка на стоянке паддока: angle — куда смотрит нос, c — номер цвета */
export type Parked = { x: number; y: number; angle: number; c: number };

/**
 * Всё остальное вокруг трассы. x, y — середина предмета.
 * angle у предметов «лицом к дороге» (огни, трибуна, паддок) повёрнут так, что ось v в local() уходит от дороги:
 * тогда «ближний к дороге край» — всегда v < 0, с какой бы стороны предмет ни стоял.
 */
export type Prop =
  | { kind: 'lights'; x: number; y: number }   // стартовые огни: табло на двух столбиках у черты, всегда лицом к нам
  | { kind: 'stand'; x: number; y: number; angle: number; w: number; d: number; rows: Dot[][] } // трибуна: ряды голов по ступеням
  | { kind: 'paddock'; x: number; y: number; angle: number; w: number; d: number; cars: Parked[] }
  | { kind: 'tires'; x: number; y: number; r: number; rings: number } // стопка шин на вираже
  | { kind: 'chevron'; x: number; y: number; angle: number }   // щиток «>>>»: angle — куда едут, туда и стрелки
  | { kind: 'billboard'; x: number; y: number; angle: number } // щит «AI Race»
  | { kind: 'lamp'; x: number; y: number; angle: number }      // фонарь: angle — куда смотрит плафон (на дорогу)
  | { kind: 'windmill'; x: number; y: number; phase: number }
  | { kind: 'pond'; x: number; y: number; rx: number; ry: number; angle: number }
  | { kind: 'bed'; x: number; y: number; r: number; flowers: Dot[] }; // клумба

export type Scenery = { trees: Tree[]; houses: House[]; bushes: Tree[]; props: Prop[] };

/** Ближе к краю дороги декор не ставим: там бордюр, а в виде из машины — обзор */
export const SCENERY_GAP = 16;
/** Вокруг знака пусто: его должно быть видно издалека */
export const SIGN_CLEAR = 70;
const MARGIN = 160; // насколько декор выходит за края трассы
const CELL = 64;

/** Отрезки центральных линий всех дорог, разложенные по ячейкам: чтобы быстро найти ближние */
type Lines = { cells: Map<number, number[]>; segs: number[] };
const key = (cx: number, cy: number): number => (cx + 1000) * 4000 + (cy + 1000);

function linesOf(track: Track): Lines {
  const cells = new Map<number, number[]>();
  const segs: number[] = [];
  for (const road of track.roads) {
    const c = road.center;
    for (let i = 0; i < c.length - 1; i++) {
      const s = segs.length / 4;
      segs.push(c[i].x, c[i].y, c[i + 1].x, c[i + 1].y);
      const cx = Math.floor(Math.min(c[i].x, c[i + 1].x) / CELL), cx1 = Math.floor(Math.max(c[i].x, c[i + 1].x) / CELL);
      const cy = Math.floor(Math.min(c[i].y, c[i + 1].y) / CELL), cy1 = Math.floor(Math.max(c[i].y, c[i + 1].y) / CELL);
      for (let x = cx; x <= cx1; x++) for (let y = cy; y <= cy1; y++) {
        const k = key(x, y);
        let list = cells.get(k);
        if (!list) cells.set(k, (list = []));
        list.push(s);
      }
    }
  }
  return { cells, segs };
}

/** Расстояние от точки до ближайшей центральной линии — но смотрим только в радиусе reach */
function roadDistance(lines: Lines, x: number, y: number, reach: number): number {
  let best = Infinity;
  const c0 = Math.floor((x - reach) / CELL), c1 = Math.floor((x + reach) / CELL);
  const r0 = Math.floor((y - reach) / CELL), r1 = Math.floor((y + reach) / CELL);
  for (let cx = c0; cx <= c1; cx++) for (let cy = r0; cy <= r1; cy++) {
    for (const s of lines.cells.get(key(cx, cy)) ?? []) {
      const o = s * 4;
      best = Math.min(best, segmentDistance(x, y, lines.segs[o], lines.segs[o + 1], lines.segs[o + 2], lines.segs[o + 3]));
    }
  }
  return best;
}

/** Расстояние от точки P до отрезка AB */
export function segmentDistance(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}

/** Где стоит знак острова (справа от дороги) — у него пусто */
export function signSpots(track: Track): Point[] {
  return track.islands.map(({ sign }) => {
    const off = track.width / 2 + 60;
    return { x: sign.x - Math.sin(sign.angle) * off, y: sign.y + Math.cos(sign.angle) * off };
  });
}

/** Уже поставленные предметы — кругами, чтобы новые на них не налезали. maxR — самый большой круг: докуда искать соседей */
type Taken = { cells: Map<number, { x: number; y: number; r: number }[]>; maxR: number };
function isFree(taken: Taken, x: number, y: number, r: number): boolean {
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL), n = Math.ceil((r + taken.maxR) / CELL);
  for (let i = cx - n; i <= cx + n; i++) for (let j = cy - n; j <= cy + n; j++) {
    for (const o of taken.cells.get(key(i, j)) ?? []) if (Math.hypot(o.x - x, o.y - y) < o.r + r) return false;
  }
  return true;
}
function take(taken: Taken, x: number, y: number, r: number): void {
  const k = key(Math.floor(x / CELL), Math.floor(y / CELL));
  let list = taken.cells.get(k);
  if (!list) taken.cells.set(k, (list = []));
  list.push({ x, y, r });
  taken.maxR = Math.max(taken.maxR, r);
}

/** Радиус круга, в который влезает домик: им и проверяем, что он не налез на дорогу и соседей */
export const houseRadius = (h: House): number => Math.hypot(h.w, h.d) / 2;

/** Размеры предметов, px: их знают и расстановка, и рисунок */
export const SIZE = {
  lights: 44,                   // ширина табло огней
  board: { w: 48, d: 6 },       // щит «AI Race»
  chevron: { w: 34, d: 4 },
  tire: 6.5,                    // радиус шины
  lamp: 4,
  windmill: 28,                 // куда достают лопасти
};

/** Круг на земле: им проверяем, что предметы не налезают на дорогу и друг на друга */
export type Spot = { x: number; y: number; r: number };

/** Длинный прямоугольник — цепочкой кругов вдоль длинной стороны: один большой круг занял бы слишком много места */
function rectSpots(x: number, y: number, angle: number, w: number, d: number): Spot[] {
  const long = Math.max(w, d), h = Math.max(Math.min(w, d) / 2, 6);
  const n = Math.ceil(long / (2 * h)), step = long / n, r = Math.hypot(h, step / 2);
  const ux = w >= d ? Math.cos(angle) : -Math.sin(angle), uy = w >= d ? Math.sin(angle) : Math.cos(angle);
  return Array.from({ length: n }, (_, i) => {
    const t = -long / 2 + step * (i + 0.5);
    return { x: x + ux * t, y: y + uy * t, r };
  });
}

/** Где предмет стоит на земле — кругами */
export function spotsOf(o: Prop): Spot[] {
  switch (o.kind) {
    case 'lights': return [{ x: o.x, y: o.y, r: SIZE.lights / 2 }]; // табло повёрнуто к зрителю — как дорога ни иди
    case 'stand': case 'paddock': return rectSpots(o.x, o.y, o.angle, o.w, o.d);
    case 'billboard': return rectSpots(o.x, o.y, o.angle, SIZE.board.w, SIZE.board.d);
    case 'chevron': return rectSpots(o.x, o.y, o.angle, SIZE.chevron.w, SIZE.chevron.d);
    case 'pond': return rectSpots(o.x, o.y, o.angle, 2 * o.rx + 10, 2 * o.ry + 10); // с кромкой
    case 'tires': case 'bed': return [{ x: o.x, y: o.y, r: o.r }];
    case 'lamp': return [{ x: o.x, y: o.y, r: SIZE.lamp }];
    case 'windmill': return [{ x: o.x, y: o.y, r: SIZE.windmill }];
  }
}

const cache = new WeakMap<Track, Scenery>();

/** Декор трассы: считается один раз и запоминается. Чистая функция трассы — ни Math.random, ни DOM */
export function sceneryOf(track: Track): Scenery {
  let scenery = cache.get(track);
  if (!scenery) cache.set(track, (scenery = place(track)));
  return scenery;
}

function place(track: Track): Scenery {
  const rand = mulberry32(hashString(`${track.id}|scenery`));
  // у нового декора свой seed: домики и лес остались там же, где стояли до него
  const rand2 = mulberry32(hashString(`${track.id}|scenery2`));
  const lines = linesOf(track);
  const signs = signSpots(track);
  const taken: Taken = { cells: new Map(), maxR: 0 };
  const edge = track.width / 2 + SCENERY_GAP;
  const trees: Tree[] = [], houses: House[] = [], bushes: Tree[] = [], props: Prop[] = [];
  const ring = track.roads[0];
  const b = track.bbox;

  const fits = (x: number, y: number, r: number): boolean =>
    roadDistance(lines, x, y, edge + r + CELL) >= edge + r &&
    signs.every((s) => Math.hypot(s.x - x, s.y - y) >= SIGN_CLEAR + r) &&
    isFree(taken, x, y, r);
  /** Поставить предмет, если всё его место свободно */
  const put = (o: Prop): boolean => {
    const spots = spotsOf(o);
    if (!spots.every((q) => fits(q.x, q.y, q.r))) return false;
    props.push(o);
    for (const q of spots) take(taken, q.x, q.y, q.r);
    return true;
  };
  /** Точка сбоку от кольца: s — где на кольце, off — как далеко от середины дороги, side — справа (1) или слева (−1) */
  const beside = (s: number, off: number, side: number): Point & { angle: number; facing: number } => {
    const at = pointOn(ring.center, ring.cum, ((s % ring.total) + ring.total) % ring.total);
    return {
      x: at.x - Math.sin(at.angle) * off * side, y: at.y + Math.cos(at.angle) * off * side, angle: at.angle,
      facing: side > 0 ? at.angle : at.angle + Math.PI, // повёрнут так, что «от дороги» — это +v
    };
  };
  /** Случайная точка в стороне от дороги: на всей площади трассы с краями */
  const anywhere = (): Point => ({
    x: b.minX - MARGIN / 2 + rand2() * (b.maxX - b.minX + MARGIN),
    y: b.minY - MARGIN / 2 + rand2() * (b.maxY - b.minY + MARGIN),
  });
  const color = (): number => Math.floor(rand2() * 4);

  // 1. Черта старта — сердце трассы: огни сбоку, трибуна напротив, паддок со стоянкой. Ставим первыми — им важнее всех
  const first = rand2() < 0.5 ? 1 : -1;
  let near = first; // с какой стороны встали огни
  placeLights: for (const s of [-40, -80, 20, -130]) { // чуть до черты, а если там тесно — рядом
    for (const side of [first, -first]) {
      const at = beside(s, edge + SIZE.lights / 2, side);
      if (put({ kind: 'lights', x: at.x, y: at.y })) { near = side; break placeLights; }
    }
  }
  placeStand: for (const s of [0, 70, -70, 140, -140]) {
    for (const side of [-near, near]) {
      const w = 110 + rand2() * 30, d = 40;
      const at = beside(s, edge + d / 2 + 10, side);
      if (put({ kind: 'stand', x: at.x, y: at.y, angle: at.facing, w, d, rows: crowd(at.x, at.y, at.facing, w, d) })) break placeStand;
    }
  }
  placePaddock: for (const s of [190, -200, 280, -290, 380]) {
    for (const side of [near, -near]) {
      const count = 3 + Math.floor(rand2() * 4), w = count * 20 + 24, d = 56;
      const at = beside(s, edge + d / 2 + 10, side);
      // машинки носом к дороге, в ряд у дальнего края площадки
      const cars = Array.from({ length: count }, (_, i): Parked => {
        const q = local({ x: at.x, y: at.y, angle: at.facing }, (i - (count - 1) / 2) * 20, d / 2 - 17);
        return { x: q.x, y: q.y, angle: at.facing - Math.PI / 2, c: color() };
      });
      if (put({ kind: 'paddock', x: at.x, y: at.y, angle: at.facing, w, d, cars })) break placePaddock;
    }
  }

  // 2. Деревеньки: 2–4 домика подряд вдоль прямого куска дороги, фасадом к ней
  const villages = Math.max(2, Math.round(ring.total / 900));
  for (let v = 0; v < villages; v++) {
    const s0 = rand() * ring.total, side = rand() < 0.5 ? -1 : 1;
    const count = 2 + Math.floor(rand() * 3);
    let s = s0;
    for (let k = 0; k < count; k++) {
      const w = 34 + rand() * 22, d = 26 + rand() * 10;
      const at = pointOn(ring.center, ring.cum, s % ring.total);
      const off = edge + d / 2 + 8 + rand() * 14;
      const house = { x: at.x - Math.sin(at.angle) * off * side, y: at.y + Math.cos(at.angle) * off * side, w, d, angle: at.angle };
      const r = houseRadius(house);
      if (fits(house.x, house.y, r)) { houses.push(house); take(taken, house.x, house.y, r); }
      s += w + 14 + rand() * 18;
    }
  }

  // 3. Крутые повороты: снаружи щиток «>>>» и стопки шин по обе стороны от него — туда вылетают, если не успел затормозить
  for (const { apex, outer } of cornersOf(ring)) {
    const at = beside(apex - 20, edge + 10, outer);
    put({ kind: 'chevron', x: at.x, y: at.y, angle: at.angle });
    for (const shift of [-66, -48, -30, 30, 48, 66]) {
      const q = beside(apex - 20 + shift, edge + SIZE.tire + 2 + rand2() * 3, outer);
      put({ kind: 'tires', x: q.x, y: q.y, r: SIZE.tire, rings: rand2() < 0.5 ? 3 : 4 });
    }
  }

  // 4. Щиты «AI Race» — на кусках, что идут поперёк экрана: щит стоит вдоль дороги, и надпись так видно целиком
  const boards = 2 + Math.floor(rand2() * 3);
  for (let n = 0, tries = 0; n < boards && tries < 80; tries++) {
    const at = beside(rand2() * ring.total, edge + 12, rand2() < 0.5 ? -1 : 1);
    if (Math.abs(Math.cos(at.angle)) < 0.85) continue;
    if (put({ kind: 'billboard', x: at.x, y: at.y, angle: Math.cos(at.angle) < 0 ? at.angle + Math.PI : at.angle })) n++; // надпись читается слева направо
  }

  // 5. Фонари: вдоль прямой у старта с обеих сторон и ещё пара рядков где-нибудь на круге
  const lamp = (s: number, side: number): void => {
    const at = beside(s, edge + SIZE.lamp + 2, side);
    if (props.some((o) => o.kind === 'lamp' && Math.hypot(o.x - at.x, o.y - at.y) < 50)) return; // рядки не должны слипаться в частокол
    put({ kind: 'lamp', x: at.x, y: at.y, angle: at.facing - Math.PI / 2 }); // плафон — к дороге
  };
  for (let s = -320; s <= 320; s += 80) { lamp(s, near); lamp(s + 40, -near); }
  for (let k = 0; k < 2 && ring.total > 1600; k++) {
    const s0 = 450 + rand2() * (ring.total - 1600), side = rand2() < 0.5 ? -1 : 1; // подальше от старта: там фонари уже есть
    for (let i = 0; i < 5; i++) lamp(s0 + i * 72, side);
  }

  // 6. Ветряк, пруды, клумбы — в стороне, где свободно
  for (let n = 0, tries = 0; n < 1 && tries < 80; tries++) {
    const at = anywhere();
    if (put({ kind: 'windmill', x: at.x, y: at.y, phase: rand2() * Math.PI })) n++;
  }
  const ponds = 1 + Math.floor(rand2() * 2);
  for (let n = 0, tries = 0; n < ponds && tries < 80; tries++) {
    const at = anywhere();
    if (put({ kind: 'pond', x: at.x, y: at.y, rx: 36 + rand2() * 26, ry: 22 + rand2() * 12, angle: rand2() * Math.PI })) n++;
  }
  const beds = 3 + Math.floor(rand2() * 4);
  for (let n = 0, tries = 0; n < beds && tries < 80; tries++) {
    const r = 9 + rand2() * 5, side = rand2() < 0.5 ? -1 : 1;
    const at = beside(rand2() * ring.total, edge + r + 6 + rand2() * 40, side);
    const flowers = Array.from({ length: 7 + Math.floor(rand2() * 5) }, (): Dot => {
      const a = rand2() * Math.PI * 2, dist = Math.sqrt(rand2()) * (r - 3.5);
      return { x: at.x + Math.cos(a) * dist, y: at.y + Math.sin(a) * dist, c: color() };
    });
    if (put({ kind: 'bed', x: at.x, y: at.y, r, flowers })) n++;
  }

  // 7. Кусты у обочин — низкие, их ставим до деревьев: под ёлкой куст не видно
  for (let k = Math.round(ring.total / 55); k > 0; k--) {
    const r = 5 + rand2() * 3.5;
    const at = beside(rand2() * ring.total, edge + r + rand2() * 26, rand2() < 0.5 ? -1 : 1);
    if (fits(at.x, at.y, r)) { bushes.push({ x: at.x, y: at.y, r, kind: 'bush' }); take(taken, at.x, at.y, r * 0.85); }
  }

  /** Зрители на трибуне: ряд на каждой ступени, кое-где пустые места */
  function crowd(x: number, y: number, angle: number, w: number, d: number): Dot[][] {
    return [0, 1, 2].map((row) => {
      const v = -d / 2 + (row + 0.5) * (d / 3), heads: Dot[] = [];
      for (let u = -w / 2 + 5; u <= w / 2 - 5; u += 6.5) {
        if (rand2() < 0.22) continue;
        const q = local({ x, y, angle }, u + (rand2() - 0.5) * 2, v + (rand2() - 0.5) * 3);
        heads.push({ x: q.x, y: q.y, c: color() });
      }
      return heads;
    });
  }

  // 8. Рядок деревьев вдоль обочин — с прогалинами, чтобы не было забора
  for (const road of track.roads) {
    for (const side of [-1, 1]) {
      let s = rand() * 40;
      while (s < road.total) {
        if (rand() < 0.8) {
          const tree = pickTree(rand);
          const at = pointOn(road.center, road.cum, s);
          const off = edge + tree.r + rand() * 36;
          tree.x = at.x - Math.sin(at.angle) * off * side;
          tree.y = at.y + Math.cos(at.angle) * off * side;
          addTree(tree);
        }
        s += 28 + rand() * 34;
      }
    }
  }

  // 9. Рощи: кучки деревьев в стороне от дороги и внутри кольца
  const area = (b.maxX - b.minX + 2 * MARGIN) * (b.maxY - b.minY + 2 * MARGIN);
  const groves = Math.round(area / 50000);
  for (let g = 0; g < groves; g++) {
    const cx = b.minX - MARGIN + rand() * (b.maxX - b.minX + 2 * MARGIN);
    const cy = b.minY - MARGIN + rand() * (b.maxY - b.minY + 2 * MARGIN);
    const size = 4 + Math.floor(rand() * 9), spread = 34 + rand() * 70;
    const firs = rand(); // в одной роще — больше одного вида деревьев
    for (let k = 0; k < size; k++) {
      const a = rand() * Math.PI * 2, dist = Math.sqrt(rand()) * spread;
      const tree = pickTree(rand, firs);
      tree.x = cx + Math.cos(a) * dist;
      tree.y = cy + Math.sin(a) * dist;
      addTree(tree);
    }
  }
  return { trees, houses, bushes, props };

  function addTree(tree: Tree): void {
    if (!fits(tree.x, tree.y, tree.r)) return;
    trees.push(tree);
    take(taken, tree.x, tree.y, tree.r * 0.85); // кроны могут чуть касаться — так лес гуще
  }
}

const TURN_LOOK = 80;  // поворот меряем на отрезке ±80 px вокруг точки
const SHARP = 0.6;     // на столько радиан (≈35°) повернула дорога за 160 px — это крутой поворот

/** Крутые повороты кольца: apex — где круче всего, outer — внешняя сторона (1 — справа по ходу, −1 — слева) */
export function cornersOf(road: Road): { apex: number; outer: number }[] {
  const heading = (s: number): number => pointOn(road.center, road.cum, ((s % road.total) + road.total) % road.total).angle;
  const corners: { apex: number; outer: number; best: number; last: number }[] = [];
  for (let s = 0; s < road.total; s += 10) {
    const turn = Math.atan2(Math.sin(heading(s + TURN_LOOK) - heading(s - TURN_LOOK)), Math.cos(heading(s + TURN_LOOK) - heading(s - TURN_LOOK)));
    if (Math.abs(turn) < SHARP) continue;
    const outer = turn > 0 ? -1 : 1; // угол растёт — дорога уходит вправо, вылетают влево
    const last = corners[corners.length - 1];
    if (last && last.outer === outer && s - last.last <= 60) { // тот же поворот: на ломаной кривизна «дребезжит»
      last.last = s;
      if (Math.abs(turn) > last.best) { last.best = Math.abs(turn); last.apex = s; }
    } else corners.push({ apex: s, outer, best: Math.abs(turn), last: s });
  }
  return corners.map(({ apex, outer }) => ({ apex, outer }));
}

/** firs — доля ёлок (от 0 до 1) */
function pickTree(rand: Random, firs = 0.55): Tree {
  const kind = rand() < firs ? 'fir' : 'round';
  const r = kind === 'fir' ? 9 + rand() * 7 : 11 + rand() * 9;
  return { x: 0, y: 0, r, kind };
}

/** Точка и направление на центральной линии — как pointAt в track.ts, но без кольца по кругу */
function pointOn(center: Point[], cum: Float64Array, s: number): Point & { angle: number } {
  let lo = 0, hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid; else hi = mid;
  }
  const a = center[lo], b = center[hi];
  const t = cum[hi] > cum[lo] ? (s - cum[lo]) / (cum[hi] - cum[lo]) : 0;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x) };
}

/**
 * Декор вдоль бесконечной прямой — для стенда на титульной: дорога бежит под машиной по кругу длиной period.
 * Координаты свои: дорога идёт по x от 0 до period, её середина — y = 0. Деревья на стыке period → 0 не налезают друг на друга.
 */
export function stripScenery(period: number, width: number): Scenery {
  const rand = mulberry32(hashString('стенд|scenery'));
  const edge = width / 2 + SCENERY_GAP;
  const taken: Taken = { cells: new Map(), maxR: 0 };
  const trees: Tree[] = [], houses: House[] = [];
  // свободно ли место — и на самом деле, и «через стык»: копия предмета сдвинута на period
  const free = (x: number, y: number, r: number): boolean => [0, period, -period].every((d) => isFree(taken, x + d, y, r));
  for (const side of [-1, 1]) {
    // домик-другой у обочины: стенд — тоже место на трассе
    for (let x = rand() * 600; x < period - 120; x += 700 + rand() * 500) {
      const w = 34 + rand() * 22, d = 26 + rand() * 10;
      const house = { x, y: 0, w, d, angle: 0 };
      const r = houseRadius(house);
      house.y = side * (edge + r + rand() * 14);
      if (free(house.x, house.y, r)) { houses.push(house); take(taken, house.x, house.y, r); }
    }
    for (let x = rand() * 40; x < period; x += 22 + rand() * 30) {
      const tree = pickTree(rand);
      tree.x = x;
      tree.y = side * (edge + tree.r + rand() * 120); // не один рядок, а полоса леса: стенд крупный, видно глубину
      if (rand() < 0.85 && free(tree.x, tree.y, tree.r)) { trees.push(tree); take(taken, tree.x, tree.y, tree.r * 0.85); }
    }
  }
  return { trees, houses, bushes: [], props: [] };
}
