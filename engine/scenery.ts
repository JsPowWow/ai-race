// Декор вокруг трассы: ёлки, круглые деревья и игрушечные домики. Только картинка — сенсоры и физика его не видят (ADR 0005).
// Расставляется из seed трассы: у всех учеников на одной трассе один и тот же лес.
import { hashString, mulberry32, type Random } from './utils.ts';
import type { Track, Point } from './track.ts';

/** Дерево: ёлка (ярусы конусов) или круглое (пышная крона). r — радиус кроны, px */
export type Tree = { x: number; y: number; r: number; kind: 'fir' | 'round' };
/** Домик: w — вдоль дороги, d — вглубь, angle — как дорога рядом (фасадом к ней) */
export type House = { x: number; y: number; w: number; d: number; angle: number };
export type Scenery = { trees: Tree[]; houses: House[] };

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

/** Уже поставленные предметы — кругами, чтобы новые на них не налезали */
type Taken = { cells: Map<number, { x: number; y: number; r: number }[]> };
function isFree(taken: Taken, x: number, y: number, r: number): boolean {
  const cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
  for (let i = cx - 1; i <= cx + 1; i++) for (let j = cy - 1; j <= cy + 1; j++) {
    for (const o of taken.cells.get(key(i, j)) ?? []) if (Math.hypot(o.x - x, o.y - y) < o.r + r) return false;
  }
  return true;
}
function take(taken: Taken, x: number, y: number, r: number): void {
  const k = key(Math.floor(x / CELL), Math.floor(y / CELL));
  let list = taken.cells.get(k);
  if (!list) taken.cells.set(k, (list = []));
  list.push({ x, y, r });
}

/** Радиус круга, в который влезает домик: им и проверяем, что он не налез на дорогу и соседей */
export const houseRadius = (h: House): number => Math.hypot(h.w, h.d) / 2;

const cache = new WeakMap<Track, Scenery>();

/** Декор трассы: считается один раз и запоминается. Чистая функция трассы — ни Math.random, ни DOM */
export function sceneryOf(track: Track): Scenery {
  let scenery = cache.get(track);
  if (!scenery) cache.set(track, (scenery = place(track)));
  return scenery;
}

function place(track: Track): Scenery {
  const rand = mulberry32(hashString(`${track.id}|scenery`));
  const lines = linesOf(track);
  const signs = signSpots(track);
  const taken: Taken = { cells: new Map() };
  const edge = track.width / 2 + SCENERY_GAP;
  const trees: Tree[] = [], houses: House[] = [];

  const fits = (x: number, y: number, r: number): boolean =>
    roadDistance(lines, x, y, edge + r + CELL) >= edge + r &&
    signs.every((s) => Math.hypot(s.x - x, s.y - y) >= SIGN_CLEAR + r) &&
    isFree(taken, x, y, r);

  // 1. Деревеньки: 2–4 домика подряд вдоль прямого куска дороги, фасадом к ней
  const ring = track.roads[0];
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

  // 2. Рядок деревьев вдоль обочин — с прогалинами, чтобы не было забора
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

  // 3. Рощи: кучки деревьев в стороне от дороги и внутри кольца
  const b = track.bbox;
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
  return { trees, houses };

  function addTree(tree: Tree): void {
    if (!fits(tree.x, tree.y, tree.r)) return;
    trees.push(tree);
    take(taken, tree.x, tree.y, tree.r * 0.85); // кроны могут чуть касаться — так лес гуще
  }
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
  const taken: Taken = { cells: new Map() };
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
  return { trees, houses };
}
