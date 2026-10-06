// Декор вокруг трассы: лес, домики, всё хозяйство гоночной трассы (огни, трибуны, шины, щиты) и сельская мелочь.
// Только картинка — сенсоры и физика его не видят (ADR 0005).
// Расставляется из seed трассы: у всех учеников на одной трассе один и тот же лес.
import { hashString, mulberry32, type Random } from '../core/utils.ts';
import { worksSigns, type Track, type Point, type Road } from './track.ts';
import { local, RISE } from '../core/tilt.ts';

/** Дерево: ёлка (ярусы конусов), круглое (пышная крона) или низкий куст. r — радиус кроны, h — высота до макушки, px */
export type Tree = { x: number; y: number; r: number; h: number; kind: 'fir' | 'round' | 'bush' };
/**
 * Дом: w — вдоль дороги, d — вглубь, angle — как дорога рядом (фасадом к ней), floors — этажей.
 * cottage — домик со скатной крышей, panel — панельная многоэтажка с плоской крышей, как в спальном районе
 */
export type House = { x: number; y: number; w: number; d: number; angle: number; floors: number; style: 'cottage' | 'panel'; mural?: Ad };

/**
 * Реклама на щитах и росписи на домах: что нарисовано. Сам рисунок — engine/draw/ads.ts, общий для обоих видов.
 * npm — «экран терминала» с командой установки: на стене дома его не пишут, только на щитах.
 */
export const ADS = ['ai-race', 'rs-school', 'reely', 'dommy', 'signals', 'npm'] as const;
export type Ad = (typeof ADS)[number];
/** Щиты трёх размеров: низкий баннер вдоль бордюра, обычный щит на ножках, большой щит подальше от дороги */
export type BoardSize = 'banner' | 'board' | 'big';
const MURALS: Ad[] = ['ai-race', 'rs-school', 'reely', 'dommy', 'signals'];

/** Торцы без окон: у длинной многоэтажки они глухие, как в жизни, — на них и рисуют роспись */
export const blankEnds = (h: House): boolean => h.style === 'panel' && h.w > h.d;

/**
 * Высота этажа, px. Машина длиной 44 px — это примерно 4,4 м, значит метр — 10 px, а этаж — 2,6 м.
 * Так дома и ёлки рядом с машиной — в настоящий рост, а не по колено ей
 */
export const FLOOR = 26;
/** Высота стен дома, px */
export const wallsOf = (h: House): number => h.floors * FLOOR;
/** На сколько конёк скатной крыши выше стен; у многоэтажки крыша плоская */
export const roofOf = (h: House): number => (h.style === 'cottage' ? Math.min(h.d * 0.5, 18) : 0);
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
  | { kind: 'billboard'; x: number; y: number; angle: number; ad: Ad; size: BoardSize } // рекламный щит
  | { kind: 'lamp'; x: number; y: number; angle: number }      // фонарь: angle — куда смотрит плафон (на дорогу)
  | { kind: 'windmill'; x: number; y: number; phase: number }
  | { kind: 'pond'; x: number; y: number; rx: number; ry: number; angle: number }
  | { kind: 'bed'; x: number; y: number; r: number; flowers: Dot[] }; // клумба

export type Scenery = { trees: Tree[]; houses: House[]; bushes: Tree[]; props: Prop[] };

/** Ближе к краю дороги декор не ставим: там бордюр, а в виде из машины — обзор */
export const SCENERY_GAP = 16;
/** Вокруг знака пусто: его должно быть видно издалека */
export const SIGN_CLEAR = 70;
/** Вокруг знаков дорожных работ — поменьше: они у самой обочины */
export const WORKS_CLEAR = 24;
const MARGIN = 160; // насколько декор выходит за края трассы
const OUTSKIRTS = 300; // многоэтажки — ещё дальше: окраина видна из машины издалека
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

/** Окна на стене длиной len: столбцы окон [от, до] вдоль стены */
export function windowColumns(len: number, h: House): [number, number][] {
  const panel = h.style === 'panel', wide = panel ? 7 : 8, step = panel ? 12 : 16;
  const n = Math.max(1, Math.floor((len - 6) / step)), pad = (len - n * step) / 2 + (step - wide) / 2;
  return Array.from({ length: n }, (_, c) => [pad + c * step, pad + c * step + wide]);
}

/** Ряды окон по высоте: [низ, верх] — ряд на этаж */
export const windowRows = (h: House): [number, number][] =>
  Array.from({ length: h.floors }, (_, f) => [f * FLOOR + 9, f * FLOOR + 19]);

/** Радиус круга, в который влезает дом: докуда он простирается */
export const houseRadius = (h: House): number => Math.hypot(h.w, h.d) / 2;

/** Размеры предметов, px: их знают и расстановка, и рисунок */
export const SIZE = {
  lights: 44,                   // ширина табло огней
  // щиты: w — длина, d — толщина, h — высота доски, z — на какой высоте её низ, off — как далеко от обочины.
  // Большой щит стоит дальше: в виде сверху он «растёт» к дороге и не должен её закрыть
  boards: {
    banner: { w: 92, d: 3, h: 11, z: 2, off: 10 },  // баннер у бордюра: 9 × 1 м
    board: { w: 64, d: 6, h: 24, z: 12, off: 12 },  // щит: 6,4 × 2,4 м
    big: { w: 104, d: 8, h: 38, z: 20, off: 30 },   // большой щит: 10 × 4 м
  },
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

/** Где дом стоит на земле — кругами: домик — одним, длинная многоэтажка — цепочкой вдоль неё */
export const houseSpots = (h: House): Spot[] =>
  h.style === 'cottage' ? [{ x: h.x, y: h.y, r: houseRadius(h) }] : rectSpots(h.x, h.y, h.angle, h.w, h.d);

/**
 * Какой высоты (не выше want) можно поставить предмет на кругах spots, чтобы в виде сверху он не закрыл дорогу.
 * Под наклоном высокое «растёт» вверх по экрану (RISE) и заслоняет то, что за ним, — а дорогу должно быть видно всю.
 * far(x, y) — расстояние от точки до ближайшей дороги, clear — сколько от неё держаться
 */
function headroom(far: (x: number, y: number, need: number) => number, clear: number, spots: Spot[], want: number): number {
  const STEP = 6;
  for (let z = 0; z <= want; z += STEP) {
    for (const q of spots) if (far(q.x, q.y - z * RISE, clear + q.r) < clear + q.r) return Math.max(0, z - STEP);
  }
  return want;
}

/**
 * Рост деревьев и этажи домиков: свой seed — лес и деревни стоят там же, где стояли, только выросли.
 * Ёлки бывают разные: от молодой в два человеческих роста до высокой, как дом
 */
function grow(rand: Random, trees: Tree[], houses: House[], room: (spots: Spot[], want: number) => number): void {
  for (const t of trees) {
    const want = t.r * (t.kind === 'fir' ? 3.4 + rand() * 3.4 : 2.4 + rand() * 1.8);
    t.h = Math.max(t.r * 2.2, room([{ x: t.x, y: t.y, r: t.r * 0.8 }], want));
  }
  for (const h of houses) {
    if (h.style !== 'cottage') continue;
    const want = h.floors > 1 ? h.floors : rand() < 0.5 ? 1 : 2; // у обочины — больше одноэтажных
    h.floors = Math.max(1, Math.min(want, Math.floor((room(houseSpots(h), want * FLOOR + roofOf(h)) - roofOf(h)) / FLOOR)));
  }
}

/** Где предмет стоит на земле — кругами */
export function spotsOf(o: Prop): Spot[] {
  switch (o.kind) {
    case 'lights': return [{ x: o.x, y: o.y, r: SIZE.lights / 2 }]; // табло повёрнуто к зрителю — как дорога ни иди
    case 'stand': case 'paddock': return rectSpots(o.x, o.y, o.angle, o.w, o.d);
    case 'billboard': return rectSpots(o.x, o.y, o.angle, SIZE.boards[o.size].w, SIZE.boards[o.size].d);
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
  const rand3 = mulberry32(hashString(`${track.id}|scenery3`)); // многоэтажки и рост: прежний декор остался на месте
  // реклама — по кругу из перемешанного списка: соседние щиты разные, а на трассе — почти все
  const ads = mulberry32(hashString(`${track.id}|ads`));
  let nextAd = Math.floor(ads() * ADS.length);
  const ad = (from: readonly Ad[]): Ad => from[nextAd++ % from.length];
  const lines = linesOf(track);
  const signs = signSpots(track);
  const works = track.islands.flatMap((_, i) => worksSigns(track, i)); // у знаков дорожных работ тоже пусто
  const taken: Taken = { cells: new Map(), maxR: 0 };
  const edge = track.width / 2 + SCENERY_GAP;
  const trees: Tree[] = [], houses: House[] = [], bushes: Tree[] = [], props: Prop[] = [];
  const ring = track.roads[0];
  const b = track.bbox;

  const fits = (x: number, y: number, r: number): boolean =>
    roadDistance(lines, x, y, edge + r + CELL) >= edge + r &&
    signs.every((s) => Math.hypot(s.x - x, s.y - y) >= SIGN_CLEAR + r) &&
    works.every((s) => Math.hypot(s.x - x, s.y - y) >= WORKS_CLEAR + r) &&
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
      const house = { x: at.x - Math.sin(at.angle) * off * side, y: at.y + Math.cos(at.angle) * off * side, w, d, angle: at.angle, floors: 1, style: 'cottage' as const };
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

  // 4. Рекламные щиты — на кусках, что идут поперёк экрана: щит стоит вдоль дороги, и надпись так видно целиком
  // Щиты трёх размеров, баннеры у бордюра — по два-три подряд, как на настоящих трассах.
  // Свой seed (ads): лес и домики после щитов остались на своих местах
  const boards = Math.round(ring.total / 200);
  for (let n = 0, tries = 0; n < boards && tries < 800; tries++) {
    const pick = ads(), size: BoardSize = pick < 0.45 ? 'banner' : pick < 0.8 ? 'board' : 'big';
    const { w, off } = SIZE.boards[size];
    const s0 = ads() * ring.total, side = ads() < 0.5 ? -1 : 1;
    const row = size === 'banner' ? 2 + Math.floor(ads() * 2) : 1;
    for (let k = 0; k < row; k++) {
      const at = beside(s0 + k * (w + 6), edge + off, side);
      if (Math.abs(Math.cos(at.angle)) < 0.7) break;
      if (!put({ kind: 'billboard', x: at.x, y: at.y, angle: Math.cos(at.angle) < 0 ? at.angle + Math.PI : at.angle, ad: ad(ADS), size })) break; // надпись читается слева направо
      n++;
    }
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

  // 7. Спальные районы: панельные многоэтажки рядами, дворы между ними. Им нужен простор — ставим подальше от дороги:
  // на окраине и внутри кольца. Этажей — сколько позволяет место: в виде сверху дом не должен закрыть дорогу
  const room = (spots: Spot[], want: number): number =>
    headroom((x, y, need) => roadDistance(lines, x, y, need + CELL), track.width / 2 + 10, spots, want);
  // и ещё деревеньки — подальше от обочины, дома в два-три этажа
  for (let k = Math.max(2, Math.round(ring.total / 900)); k > 0; k--) {
    const side = rand3() < 0.5 ? -1 : 1, count = 2 + Math.floor(rand3() * 3);
    let s = rand3() * ring.total;
    for (let n = 0; n < count; n++) {
      const w = 40 + rand3() * 24, d = 30 + rand3() * 12;
      const at = beside(s, edge + d / 2 + 40 + rand3() * 50, side);
      const house: House = { x: at.x, y: at.y, w, d, angle: at.angle, floors: 2 + Math.floor(rand3() * 2), style: 'cottage' };
      const r = houseRadius(house);
      if (fits(house.x, house.y, r)) { houses.push(house); take(taken, house.x, house.y, r); }
      s += w + 16 + rand3() * 20;
    }
  }
  const districts = Math.max(1, Math.round(ring.total / 1400));
  for (let n = 0, tries = 0; n < districts && tries < 120; tries++) {
    const c = {
      x: b.minX - OUTSKIRTS + rand3() * (b.maxX - b.minX + 2 * OUTSKIRTS),
      y: b.minY - OUTSKIRTS + rand3() * (b.maxY - b.minY + 2 * OUTSKIRTS),
      angle: (rand3() < 0.3 ? Math.PI / 2 : 0) + (rand3() - 0.5) * 0.4, // дома района стоят ровными рядами
    };
    if (roadDistance(lines, c.x, c.y, edge + 120 + CELL) < edge + 120) continue;
    const rows = 2 + Math.floor(rand3() * 2), long = 120 + rand3() * 50, deep = 48; // 12 м вглубь, как у настоящей панельки
    let built = 0;
    for (let i = 0; i < 2; i++) for (let j = 0; j < rows; j++) {
      const tower = rand3() < 0.25; // точечная башня вместо длинного дома
      const w = tower ? 46 : long, d = tower ? 46 : deep;
      const at = local(c, (i - 0.5) * (long + 40), (j - (rows - 1) / 2) * (deep + 70));
      const house: House = { x: at.x, y: at.y, w, d, angle: c.angle, floors: 0, style: 'panel' };
      const spots = houseSpots(house);
      if (!spots.every((q) => fits(q.x, q.y, q.r))) continue;
      const want = tower ? 10 + Math.floor(rand3() * 4) : 5 + Math.floor(rand3() * 5);
      house.floors = Math.min(want, Math.floor(room(spots, want * FLOOR) / FLOOR));
      if (house.floors < 4) continue; // на четыре этажа места нет — тут не город
      if (blankEnds(house) && ads() < 0.6) house.mural = ad(MURALS);
      houses.push(house);
      for (const q of spots) take(taken, q.x, q.y, q.r);
      built++;
    }
    if (built >= 2) n++;
  }

  // 8. Кусты у обочин — низкие, их ставим до деревьев: под ёлкой куст не видно
  for (let k = Math.round(ring.total / 55); k > 0; k--) {
    const r = 5 + rand2() * 3.5;
    const at = beside(rand2() * ring.total, edge + r + rand2() * 26, rand2() < 0.5 ? -1 : 1);
    if (fits(at.x, at.y, r)) { bushes.push({ x: at.x, y: at.y, r, h: r * 1.1, kind: 'bush' }); take(taken, at.x, at.y, r * 0.85); }
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

  // 9. Рядок деревьев вдоль обочин — с прогалинами, чтобы не было забора
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

  // 10. Рощи: кучки деревьев в стороне от дороги и внутри кольца
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
  grow(rand3, trees, houses, room);
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
  return { x: 0, y: 0, r, h: r * 2.4, kind }; // рост задаст grow()
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
      const house: House = { x, y: 0, w, d, angle: 0, floors: 1, style: 'cottage' };
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
  const room = (spots: Spot[], want: number): number => headroom((_x, y) => Math.abs(y), width / 2 + 10, spots, want);
  grow(mulberry32(hashString('стенд|scenery3')), trees, houses, room);
  return { trees, houses, bushes: [], props: [] };
}
