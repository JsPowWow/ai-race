// Рисунок вида из машины: та же игрушечная трасса на столе, только смотрим с дороги, позади своей машины.
// Сначала всё плоское (асфальт одним путём — без швов между кусками, разметка, черта), потом туман у горизонта,
// потом всё, у чего есть высота (бордюры, лес, дома, машины), — от дальнего к ближнему, как художник. Последними — лучи и своя машина.
// Камера и проекция — engine/draw/cockpit/camera.ts. Что не видно (позади, дальше тумана, сбоку от обзора), не рисуем вовсе.
import { clipNear, project, toCamera, type View, type ScreenPoint } from './camera.ts';
import { getPalette, signFace, worksFace, UI_FONT, type Palette } from '../render.ts';
import type { CarView } from '../car-draw.ts';
import { pointAt, freeSide, signShows, worksSigns, type Track, type Branch, type Point, type RoadPoint, type Island } from '../../world/track.ts';
import { sceneryOf, wallsOf, roofOf, windowColumns, windowRows, blankEnds, FLOOR, SIZE, type Tree, type House, type Prop, type Dot, type Ad } from '../../world/scenery.ts';
import { paintBoard, paintMuralAd } from '../ads.ts';
import { startLights, sceneryMoves } from '../scenery-draw.ts';
import { skidLevels, LEVELS } from '../skids-draw.ts';
import { toneOf, tonesOf } from '../greens.ts';
import { local } from '../../core/tilt.ts';
import { drawCockpitCar } from './car.ts';
import { tint, clearOf } from '../../core/paint.ts';
import { rays, CAR } from '../../world/car.ts';
import type { TrafficSpot } from '../../world/traffic.ts';

type Ctx = CanvasRenderingContext2D;
type P3 = Point & { z: number };
/** Плоский кусок трассы: многоугольник на столе и его середина — по ней решаем, виден ли он */
type Flat = { pts: Point[]; x: number; y: number; dark?: boolean };
/** Блок бордюра: отрезок a–b по краю дороги, красный или белый; end — блок с краю бордюра, у него виден торец */
type Kerb = { a: Point; b: Point; red: boolean; end: { a: boolean; b: boolean } };
/** Несколько блоков бордюра подряд: рисуются одним куском — несколько заливок вместо сотни */
type KerbRun = { blocks: Kerb[]; x: number; y: number; reach: number };
/** Что рисовать по глубине: f — расстояние вперёд от камеры, haze — во сколько раз тоньше для него туман */
type Item = { f: number; haze: number; draw: () => void };

/** Машина в виде из машины: какая, каким цветом, прозрачность и подпись над ней («мозг», «ты») */
export type CockpitCar = { car: CarView; color: string; alpha?: number; label?: string | null };
/** Что на трассе в этом кадре */
export type CockpitScene = { me: CockpitCar; ghost?: CockpitCar | null; traffic?: TrafficSpot[] | null; tick?: number; dpr?: number };

const KERB = { h: 6, w: 7, dash: 16 }; // бордюр: высота, ширина, длина блока — как в виде сверху
const DASH = 20, GAP = 28, LINE = 2.6, EDGE_INSET = 12; // пунктир и сплошная — как в render.ts
const CAR_H = { floor: 2, body: 10, roof: 17 };
const LIGHT = { x: -0.55, y: -0.83 }; // свет сверху слева, как у теней трассы

// ── плоское: считается один раз на трассу ──

type Ground = { road: Flat[]; marks: Flat[]; checker: Flat[]; kerbs: KerbRun[] };
/** Блоков бордюра в одном куске: длиннее — меньше заливок, но кусок дольше спорит по глубине с деревом рядом */
const RUN = 6;
const grounds = new WeakMap<Track, Ground>();

/** Прямоугольник поперёк направления angle: середина (x, y), длина вдоль len, ширина поперёк wide */
function strip(x: number, y: number, angle: number, len: number, wide: number, dark?: boolean): Flat {
  const c = Math.cos(angle), s = Math.sin(angle), hl = len / 2, hw = wide / 2;
  const pts = [[-hl, -hw], [hl, -hw], [hl, hw], [-hl, hw]].map(([u, v]) => ({ x: x + u * c - v * s, y: y + u * s + v * c }));
  return { pts, x, y, dark };
}

/** Отрезок a–b толщиной wide — плоская полоска на асфальте */
function band(a: Point, b: Point, wide: number): Flat {
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return strip((a.x + b.x) / 2, (a.y + b.y) / 2, Math.atan2(b.y - a.y, b.x - a.x), len, wide);
}

/** Точка на ломаной pts на расстоянии s от начала (cum — длины до точек центральной линии; у разметки те же номера точек) */
function along(pts: Point[], cum: Float64Array, s: number, from: number): { p: Point; i: number } {
  let i = from;
  while (i < cum.length - 2 && cum[i + 1] < s) i++;
  const t = Math.max(0, Math.min(1, (s - cum[i]) / (cum[i + 1] - cum[i] || 1)));
  return { p: { x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t }, i };
}

function groundOf(track: Track): Ground {
  let g = grounds.get(track);
  if (g) return g;
  g = { road: [], marks: [], checker: [], kerbs: [] };
  for (const road of track.roads) {
    const { left, right } = road;
    for (let i = 0; i < left.length - 1; i++) {
      const pts = [left[i], left[i + 1], right[i + 1], right[i]];
      g.road.push({ pts, x: (left[i].x + right[i + 1].x) / 2, y: (left[i].y + right[i + 1].y) / 2 });
    }
    for (const divider of road.dividers) {
      let i = 0;
      for (let s = 0; s + DASH < road.total; s += DASH + GAP) {
        const a = along(divider, road.cum, s, i), b = along(divider, road.cum, s + DASH, a.i);
        i = a.i;
        g.marks.push(band(a.p, b.p, LINE));
      }
    }
    const t = EDGE_INSET / track.width;
    for (const [from, to] of [[left, right], [right, left]]) {
      for (let i = 0; i < from.length - 1; i++) {
        const a = { x: from[i].x + (to[i].x - from[i].x) * t, y: from[i].y + (to[i].y - from[i].y) * t };
        const b = { x: from[i + 1].x + (to[i + 1].x - from[i + 1].x) * t, y: from[i + 1].y + (to[i + 1].y - from[i + 1].y) * t };
        g.marks.push(band(a, b, LINE));
      }
    }
  }
  // черта старта и финиша — клетками, как в виде сверху
  const start = pointAt(track, 0), sq = 10, cols = Math.round(track.width / sq), cw = track.width / cols;
  for (let r = 0; r < 2; r++) for (let c = 0; c < cols; c++) {
    const u = r * sq - sq / 2, v = -track.width / 2 + (c + 0.5) * cw;
    const p = local(start, u, v);
    g.checker.push(strip(p.x, p.y, start.angle, sq, cw, (r + c) % 2 === 1));
  }
  // бордюры — блоками по 16 px: красный, белый, красный…
  for (const wall of track.walls) {
    const blocks: Kerb[] = [];
    let red = true, left = KERB.dash, a = wall[0];
    for (let i = 1; i < wall.length; i++) {
      const b = wall[i];
      let len = Math.hypot(b.x - a.x, b.y - a.y);
      while (len >= left) {
        const t = left / len, cut = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        blocks.push(kerbOf(a, cut, red));
        a = cut; red = !red; left = KERB.dash;
        len = Math.hypot(b.x - a.x, b.y - a.y);
      }
      left -= len; // блок продолжается на следующем отрезке бордюра
    }
    if (left < KERB.dash) blocks.push(kerbOf(a, wall[wall.length - 1], red));
    if (!blocks.length) continue;
    // торцы видны только у крайних блоков: между соседями торец спрятан внутри бордюра
    blocks[0].end.a = true; blocks[blocks.length - 1].end.b = true;
    for (let i = 0; i < blocks.length; i += RUN) g.kerbs.push(runOf(blocks.slice(i, i + RUN)));
  }
  grounds.set(track, g);
  return g;
}
const kerbOf = (a: Point, b: Point, red: boolean): Kerb => ({ a, b, red, end: { a: false, b: false } });

function runOf(blocks: Kerb[]): KerbRun {
  const first = blocks[0].a, last = blocks[blocks.length - 1].b;
  const x = (first.x + last.x) / 2, y = (first.y + last.y) / 2;
  return { blocks, x, y, reach: Math.hypot(last.x - first.x, last.y - first.y) / 2 + 10 };
}

// ── рисование ──

/** Что видно: перед камерой, ближе тумана, не дальше сбоку, чем позволяет обзор. pad — запас на размер предмета */
function visible(v: View, x: number, y: number, pad: number, haze = 1): number | null {
  const c = toCamera(v, x, y, 0);
  if (c.f < -pad || c.f > v.range * haze + pad || Math.abs(c.s) > c.f * 1.05 + pad + 20) return null;
  return c.f;
}

/** Туман: чем ближе к краю дальности, тем прозрачнее — дальнее не выскакивает из ниоткуда */
const fade = (v: View, f: number): number => Math.max(0, Math.min(1, (v.range - f) / (v.range * 0.3)));

function addPoly(path: Path2D | Ctx, pts: ScreenPoint[]): void {
  if (pts.length < 3) return;
  path.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) path.lineTo(pts[i].x, pts[i].y);
  path.closePath();
}

const flat = (pts: Point[], z = 0): P3[] => pts.map((p) => ({ x: p.x, y: p.y, z }));

/** Много плоских кусков одним путём и одной заливкой: на стыках кусков нет светлых швов */
function fillFlats(ctx: Ctx, v: View, list: readonly Flat[], color: string, z = 0, pad = 30): void {
  const path = new Path2D();
  for (const piece of list) if (visible(v, piece.x, piece.y, pad) !== null) addPoly(path, clipNear(v, flat(piece.pts, z)));
  ctx.fillStyle = color;
  ctx.fill(path);
}

/** Многоугольник в 3D → экран (с обрезкой по ближней плоскости) и заливка */
function face(ctx: Ctx, v: View, pts: P3[], color: string, shade = 0): void {
  const s = clipNear(v, pts);
  if (s.length < 3) return;
  ctx.beginPath(); addPoly(ctx, s);
  const mixed = shade > 0 ? tint(color, shade) : color;
  ctx.fillStyle = mixed ?? color; ctx.fill();
  if (!mixed) { ctx.fillStyle = `rgb(0 0 0 / ${shade.toFixed(3)})`; ctx.fill(); } // цвет не разобрать — тень слоем
}

/** Насколько затенить стенку с наружной нормалью (nx, ny): к свету — светлее */
const shadeOf = (nx: number, ny: number): number => 0.16 + 0.14 * (nx * -LIGHT.x + ny * -LIGHT.y);

/**
 * Брусок: выпуклое основание base, от высоты z0 до z1. Видны стенки, повёрнутые к камере, и верх.
 * side/top — цвета стенок и верха (top null — верх не рисовать)
 */
function block(ctx: Ctx, v: View, base: Point[], z0: number, z1: number, side: string, top: string | null): void {
  walls(v, base, z0, z1, () => true, (pts, shade) => face(ctx, v, pts, side, shade));
  if (top && v.z > z1) face(ctx, v, flat(base, z1), top);
}

/** Прямоугольник в осях предмета o: вдоль (u) от u0 до u1, вбок (w) от w0 до w1 */
const rect = (o: Point & { angle: number }, u0: number, u1: number, w0: number, w1: number): Point[] =>
  [local(o, u0, w0), local(o, u1, w0), local(o, u1, w1), local(o, u0, w1)];

/** Картонка, всегда повёрнутая к камере: точка на земле (x, y), draw рисует в пикселях вокруг неё; k — пикселей на 1 px трассы */
function billboard(v: View, x: number, y: number, z: number): (ScreenPoint & { k: number }) | null {
  const p = project(v, x, y, z);
  return p && { ...p, k: v.focal / p.f };
}

/** Небо и туман — столбики в пиксель шириной: холст растянет их на весь экран, а градиент заново не считается */
type Air = { sky: OffscreenCanvas; fog: OffscreenCanvas; key: string };
let air: Air | null = null;

/**
 * Небо (от верха до горизонта) и туман (от горизонта, где он густой до far, и до near, где тает).
 * Камера всегда на одной высоте — горизонт стоит на месте: рисуем один раз, перерисовываем при смене темы или размера
 */
function airOf(p: Palette, horizon: number, far: number, near: number): Air | null {
  if (typeof OffscreenCanvas !== 'function') return null;
  const key = `${p.sky}|${p.sky2}|${p.board}|${horizon}|${far}|${near}`;
  if (air?.key === key) return air;
  const column = (h: number, paint: (g: Ctx, h: number) => void): OffscreenCanvas => {
    const c = new OffscreenCanvas(1, Math.max(1, Math.ceil(h)));
    const g = c.getContext('2d') as unknown as Ctx | null;
    if (g) paint(g, c.height);
    return c;
  };
  const sky = column(horizon + 1, (g, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, p.sky); grad.addColorStop(1, p.sky2);
    g.fillStyle = grad; g.fillRect(0, 0, 1, h);
  });
  const fog = column(near - horizon + 1, (g, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, p.board);
    grad.addColorStop(Math.min(0.99, (far - horizon) / (near - horizon)), p.board);
    grad.addColorStop(1, clearOf(p.board));
    g.fillStyle = grad; g.fillRect(0, 0, 1, h);
  });
  air = { sky, fog, key };
  return air;
}

/** Нарисовать вид из машины. ctx — холст в пикселях экрана */
export function drawCockpit(ctx: Ctx, track: Track, v: View, scene: CockpitScene): void {
  const p = getPalette();
  const W = ctx.canvas.width, H = ctx.canvas.height, tick = scene.tick ?? 0, dpr = scene.dpr ?? 1;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  // фон фотостудии: стол уходит вдаль и сливается со стеной — игрушка на столе, а не небо над полем
  const y = (d: number): number => v.horizon + (v.z / d) * v.focal; // где на экране земля на расстоянии d
  const air = airOf(p, v.horizon, y(v.range * 0.85), y(v.range * 0.45));
  if (air) ctx.drawImage(air.sky, 0, 0, 1, air.sky.height, 0, 0, W, v.horizon + 1);
  ctx.fillStyle = p.board; ctx.fillRect(0, v.horizon, W, H - v.horizon);

  const g = groundOf(track);
  const { trees, houses, bushes, props } = sceneryOf(track);
  // плоское: пруды, площадки, клумбы — под дорогой их не бывает, порядок между ними не важен
  for (const o of props) drawFlatProp(ctx, v, o, p);
  fillFlats(ctx, v, g.road, p.road, 0, 40);
  skidLevels(track).forEach((pieces, k) => { // следы шин — как сверху: под разметкой
    ctx.globalAlpha = (k + 1) / LEVELS;
    fillFlats(ctx, v, pieces, p.skid, 0, 10);
  });
  ctx.globalAlpha = 1;
  track.islands.forEach((island, i) => zone(ctx, v, track, island, freeSide(track, i, tick), p));
  fillFlats(ctx, v, g.marks, p.marking, 0.2);
  fillFlats(ctx, v, g.checker.filter((c) => !c.dark), p.checkLight, 0.3);
  fillFlats(ctx, v, g.checker.filter((c) => c.dark), p.checkDark, 0.3);
  // туман у горизонта: дальняя дорога растворяется в столе
  if (air) ctx.drawImage(air.fog, 0, 0, 1, air.fog.height, 0, v.horizon - 1, W, air.fog.height);

  // всё, у чего есть высота, — по глубине
  const items: Item[] = [];
  const add = (x: number, y: number, pad: number, draw: () => void, haze = 1): void => {
    const f = visible(v, x, y, pad, haze);
    if (f !== null) items.push({ f, haze, draw });
  };
  for (const run of g.kerbs) add(run.x, run.y, run.reach, () => kerbs(ctx, v, run, p));
  for (const t of trees) add(t.x, t.y, t.r * 2, () => tree(ctx, v, t, p));
  for (const t of bushes) add(t.x, t.y, t.r, () => tree(ctx, v, t, p));
  // многоэтажки видно из-за тумана: окраина на горизонте. По глубине дом стоит ближней к камере точкой —
  // иначе длинный дом, чья середина дальше дерева у его края, нарисовался бы поверх этого дерева
  for (const h of houses) {
    const tall = h.style === 'panel' ? 1.8 : 1, at = nearestOf(v, h);
    add(at.x, at.y, Math.max(h.w, h.d), () => house(ctx, v, h, p), tall);
  }
  for (const o of props) if (o.kind !== 'pond' && o.kind !== 'bed') add(o.x, o.y, propSize(o), () => drawProp(ctx, v, o, p, tick));
  track.islands.forEach((island, i) => {
    cones(track, island, freeSide(track, i, tick), (x, y) => add(x, y, 6, () => cone(ctx, v, x, y, p)));
    const { x, y } = signSpot(track, island.sign);
    add(x, y, 20, () => sign(ctx, v, x, y, signShows(track, i, tick), p));
    const works = worksSigns(track, i)[freeSide(track, i, tick) !== island.side ? 0 : 1];
    add(works.x, works.y, 20, () => worksSign(ctx, v, works.x, works.y, p));
  });
  for (const o of scene.traffic ?? []) add(o.x, o.y, 30, () => box(ctx, v, o, o.oncoming ? p.trafficOncoming : p.traffic, p, o.oncoming ? 'front' : 'back'));
  const ghost = scene.ghost;
  if (ghost) add(ghost.car.x, ghost.car.y, 30, () => carShape(ctx, v, ghost, p, dpr));
  items.sort((a, b) => b.f - a.f);
  for (const item of items) {
    ctx.globalAlpha = fade(v, item.f / item.haze);
    item.draw();
  }
  ctx.globalAlpha = 1;
  beams(ctx, v, scene.me.car, p, dpr);
  carShape(ctx, v, scene.me, p, dpr);
}

/**
 * Кусок бордюра: сначала все стенки, повёрнутые к камере, потом все верхи. Одинаковые цвета — одним путём:
 * стенки соседних блоков не заходят друг на друга, поэтому порядок внутри цвета не важен
 */
function kerbs(ctx: Ctx, v: View, run: KerbRun, p: Palette): void {
  const sides = new Map<string, Path2D>(), tops = new Map<string, Path2D>();
  const put = (into: Map<string, Path2D>, color: string, pts: P3[]): void => {
    const s = clipNear(v, pts);
    if (s.length < 3) return;
    let path = into.get(color);
    if (!path) into.set(color, (path = new Path2D()));
    addPoly(path, s);
  };
  for (const k of run.blocks) {
    const len = Math.hypot(k.b.x - k.a.x, k.b.y - k.a.y) || 1;
    const nx = (-(k.b.y - k.a.y) / len) * (KERB.w / 2), ny = ((k.b.x - k.a.x) / len) * (KERB.w / 2);
    const base = [{ x: k.a.x + nx, y: k.a.y + ny }, { x: k.b.x + nx, y: k.b.y + ny }, { x: k.b.x - nx, y: k.b.y - ny }, { x: k.a.x - nx, y: k.a.y - ny }];
    const color = k.red ? p.kerb : p.kerb2;
    walls(v, base, 0, KERB.h, (i) => (i === 1 ? k.end.b : i === 3 ? k.end.a : true), (pts, shade) => put(sides, tint(color, shade) ?? color, pts));
    if (v.z > KERB.h) put(tops, color, flat(base, KERB.h));
  }
  for (const paths of [sides, tops]) for (const [color, path] of paths) { ctx.fillStyle = color; ctx.fill(path); }
}

/** Стенки бруска с основанием base от высоты z0 до z1, повёрнутые к камере: каждую — в out с её тенью. use(i) — нужна ли стенка i */
function walls(v: View, base: Point[], z0: number, z1: number, use: (i: number) => boolean, out: (pts: P3[], shade: number) => void): void {
  let area = 0;
  for (let i = 0; i < base.length; i++) { const a = base[i], b = base[(i + 1) % base.length]; area += a.x * b.y - b.x * a.y; }
  const turn = area > 0 ? 1 : -1;
  for (let i = 0; i < base.length; i++) {
    if (!use(i)) continue;
    const a = base[i], b = base[(i + 1) % base.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = ((b.y - a.y) / len) * turn, ny = (-(b.x - a.x) / len) * turn;
    if (nx * (v.x - (a.x + b.x) / 2) + ny * (v.y - (a.y + b.y) / 2) <= 0) continue; // стенка смотрит от камеры
    out([{ ...a, z: z0 }, { ...b, z: z0 }, { ...b, z: z1 }, { ...a, z: z1 }], shadeOf(nx, ny));
  }
}

/** Медленная зона: жёлтая подкраска занятого пути, на въезде и выезде — полосатая лента */
function zoneAt(track: Track, island: Island, free: number): (s: number) => RoadPoint {
  const onMain = free !== island.side;
  const branch = track.roads[island.road] as Branch;
  return (s) => (onMain ? pointAt(track, s) : pointAt(branch, ((s - branch.fromS) / (branch.toS - branch.fromS)) * branch.total));
}

function zone(ctx: Ctx, v: View, track: Track, island: Island, free: number, p: Palette): void {
  const [from, to] = island.zone, at = zoneAt(track, island, free);
  const tint: Flat[] = [];
  for (let s = from; s < to; s += 12) {
    const a = at(s), b = at(Math.min(to, s + 13));
    tint.push(strip((a.x + b.x) / 2, (a.y + b.y) / 2, Math.atan2(b.y - a.y, b.x - a.x), Math.hypot(b.x - a.x, b.y - a.y) + 1, track.width - 8));
  }
  ctx.globalAlpha = 0.22;
  fillFlats(ctx, v, tint, p.slow);
  ctx.globalAlpha = 1;
  const tape: Flat[] = [], stripes: Flat[] = [];
  for (const s of [from, to]) {
    const pt = at(s), n = 10, w = (track.width - 10) / n;
    tape.push(strip(pt.x, pt.y, pt.angle, 6, track.width - 10));
    for (let k = 0; k < n; k += 2) { const q = local(pt, 0, -(track.width - 10) / 2 + (k + 0.5) * w); stripes.push(strip(q.x, q.y, pt.angle, 6, w)); }
  }
  fillFlats(ctx, v, tape, p.slow, 0.3);
  fillFlats(ctx, v, stripes, p.checkDark, 0.4);
}

function cones(track: Track, island: Island, free: number, put: (x: number, y: number) => void): void {
  const [from, to] = island.zone, at = zoneAt(track, island, free), edge = track.width / 2 - 7;
  for (let s = from; s <= to; s += 36) {
    const pt = at(s), nx = -Math.sin(pt.angle), ny = Math.cos(pt.angle);
    for (const side of [-1, 1]) put(pt.x + nx * edge * side, pt.y + ny * edge * side);
  }
}

/** Конус: тёмное основание, жёлтый треугольник с белым пояском */
function cone(ctx: Ctx, v: View, x: number, y: number, p: Palette): void {
  const b = billboard(v, x, y, 0), t = billboard(v, x, y, 13);
  if (!b || !t) return;
  ctx.fillStyle = p.checkDark; ctx.fillRect(b.x - 5.5 * b.k, b.y - 1.5 * b.k, 11 * b.k, 2 * b.k);
  ctx.beginPath(); ctx.moveTo(b.x - 4.5 * b.k, b.y - b.k); ctx.lineTo(b.x + 4.5 * b.k, b.y - b.k); ctx.lineTo(t.x, t.y); ctx.closePath();
  ctx.fillStyle = p.slow; ctx.fill();
  ctx.fillStyle = p.kerb2; ctx.fillRect(b.x - 2.6 * b.k, (b.y + t.y) / 2 - b.k, 5.2 * b.k, 2 * b.k);
}

/** Где стоит знак: справа по ходу, за бордюром — как в виде сверху */
function signSpot(track: Track, { x, y, angle }: RoadPoint): Point {
  const off = track.width / 2 + 14; // там же, где в виде сверху (drawSign в render.ts)
  return { x: x - Math.sin(angle) * off, y: y + Math.cos(angle) * off };
}

/** Знак на столбике: синий круг, белая стрелка «прямо, потом направо / налево»; dir 0 — погас */
function sign(ctx: Ctx, v: View, x: number, y: number, dir: number, p: Palette): void {
  const foot = billboard(v, x, y, 0), c = billboard(v, x, y, 36); // как в виде сверху: столб 2,6 м, круг ≈ 2 м
  if (!foot || !c) return;
  const k = c.k * (10 / 15); // круг ≈ 2 м, signFace рисует его радиусом 15
  ctx.fillStyle = p.roof2; ctx.fillRect(foot.x - 1.5 * k, c.y, 3 * k, foot.y - c.y);
  ctx.save();
  ctx.translate(c.x, c.y); ctx.scale(k, k);
  signFace(ctx, dir === 1 || dir === -1 ? dir : 0, p);
  ctx.restore();
}

/** Знаки перед дорожными работами на столбе — как в виде сверху (worksFace) */
function worksSign(ctx: Ctx, v: View, x: number, y: number, p: Palette): void {
  const foot = billboard(v, x, y, 0), c = billboard(v, x, y, 24);
  if (!foot || !c) return;
  const k = c.k * (10 / 15);
  ctx.fillStyle = p.roof2; ctx.fillRect(foot.x - 1.5 * k, c.y, 3 * k, foot.y - c.y);
  ctx.save();
  ctx.translate(c.x, c.y); ctx.scale(k, k);
  worksFace(ctx, p);
  ctx.restore();
}

/**
 * Дерево — картонка лицом к камере, как у Раду: стопка неровных ярусов-«облачков», внизу темнее, к макушке светлее.
 * Ёлка сужается к верху, круглое — шар кроны на стволе, куст — низкая копна. Зубцы у каждого дерева свои — от его места
 */
function tree(ctx: Ctx, v: View, t: Tree, p: Palette): void {
  const b = billboard(v, t.x, t.y, 0);
  if (!b) return;
  const k = b.k, r = t.r * k, h = t.h * k, seed = t.x * 7.13 + t.y * 3.71;
  if (t.kind === 'bush') {
    const bush = new Path2D();
    blob(bush, b.x - r * 0.4, b.y - r * 0.45, r * 0.6, r * 0.5, seed);
    blob(bush, b.x + r * 0.4, b.y - r * 0.45, r * 0.6, r * 0.5, seed + 1);
    blob(bush, b.x, b.y - r * 0.75, r * 0.65, r * 0.55, seed + 2);
    ctx.fillStyle = tonesOf(p.bush, p)[toneOf(t.x, t.y)]; ctx.fill(bush);
    return;
  }
  const fir = t.kind === 'fir';
  ctx.fillStyle = p.roof2; // ствол
  const crown = fir ? r * 0.4 : h - r * 1.6; // где начинается крона
  ctx.fillRect(b.x - r * 0.12, b.y - crown - r * 0.3, r * 0.24, crown + r * 0.3);
  // ярусы снизу вверх, внахлёст: три цвета — три заливки на дерево, сколько бы ярусов ни было
  const n = fir ? Math.max(4, Math.min(7, Math.round(t.h / t.r / 0.8))) : 4;
  const shades = [new Path2D(), new Path2D(), new Path2D()];
  const span = h - crown - r * (fir ? 0 : 0.8), step = span / (fir ? n + 0.6 : n - 1);
  for (let i = 0; i < n; i++) {
    const q = i / (n - 1), into = shades[Math.min(2, Math.floor(q * 3))];
    if (fir) { // ярус ёлки — лапы: зубчатый низ и острый верх
      const y = b.y - crown - step * i, w = r * (1.15 - 0.75 * q);
      skirt(into, b.x, y, w, step * 1.9, seed + i);
    } else {
      const w = r * (0.75 + 0.35 * Math.sin(Math.PI * (0.25 + 0.6 * q)));
      blob(into, b.x + Math.sin(seed + i * 2.1) * r * 0.1, b.y - crown - step * i, w, w * 0.8, seed + i);
    }
  }
  const base = tonesOf(fir ? p.tree : p.tree2, p)[toneOf(t.x, t.y)]; // как в виде сверху: у каждого дерева свой оттенок
  ctx.fillStyle = tint(base, 0.18) ?? base; ctx.fill(shades[0]);
  ctx.fillStyle = base; ctx.fill(shades[1]);
  ctx.fillStyle = tint(base, 0, 0.14) ?? base; ctx.fill(shades[2]);
}

/** Ярус ёлки: низ — зубцами (кончики лап), от его краёв — к верхушке на высоте tall. Зубцы — от seed */
function skirt(path: Path2D, x: number, y: number, w: number, tall: number, seed: number): void {
  const N = 5;
  path.moveTo(x - w, y);
  for (let i = 0; i < N; i++) { // от лапы к лапе: между кончиками ветки чуть приподняты
    const u = x - w + ((i + 0.5) / N) * 2 * w, lift = tall * (0.1 + 0.06 * Math.abs(Math.sin(seed * 9.7 + i * 4.3)));
    path.lineTo(u, y - lift); path.lineTo(x - w + ((i + 1) / N) * 2 * w, y);
  }
  path.lineTo(x, y - tall);
  path.closePath();
}

/** Неровный круг: середина (x, y), полуоси rx, ry, зубцы — от seed. Без Math.random: в каждом кадре та же форма */
function blob(path: Path2D, x: number, y: number, rx: number, ry: number, seed: number): void {
  const N = 8;
  for (let i = 0; i <= N; i++) {
    const a = (i / N) * Math.PI * 2, jag = 0.84 + 0.16 * Math.abs(Math.sin(seed * 12.99 + (i % N) * 78.23));
    const px = x + Math.cos(a) * rx * jag, py = y + Math.sin(a) * ry * jag;
    if (i) path.lineTo(px, py); else path.moveTo(px, py);
  }
  path.closePath();
}

/** Ближняя к камере точка дома на земле: по ней дом встаёт в очередь по глубине */
function nearestOf(v: View, h: House): Point {
  const c = Math.cos(h.angle), s = Math.sin(h.angle), dx = v.x - h.x, dy = v.y - h.y;
  const u = Math.max(-h.w / 2, Math.min(h.w / 2, dx * c + dy * s)), w = Math.max(-h.d / 2, Math.min(h.d / 2, -dx * s + dy * c));
  return local(h, u, w);
}

/**
 * Дом по этажам. Стены, что смотрят на камеру, и на них окна. Сотня окошек — сотня крошечных фигур, а каждая
 * стоит холсту времени. Поэтому стекло — полосой на этаж, а поверх неё — простенки между окнами столбиками во всю
 * высоту: фигур «этажи + столбцы» вместо «этажи × столбцы», а выглядит так же. Окна мельче 3 px не различить —
 * тогда только полосы, а ещё дальше — без окон (как у Раду: дальнее рисуем проще)
 */
function house(ctx: Ctx, v: View, h: House, p: Palette): void {
  const w = h.w / 2, d = h.d / 2, top = wallsOf(h), roof = roofOf(h), panel = h.style === 'panel';
  const wall = panel ? p.panel : p.house;
  const near = toCamera(v, h.x, h.y, 0).f, px = v.focal / Math.max(near, v.near); // пикселей экрана на 1 px трассы у дома
  const detail = px * 7 >= 4 ? 'windows' : px * 10 >= 4 && near < v.range * 0.8 ? 'strips' : null;
  walls(v, rect(h, -w, w, -d, d), 0, top, () => true, (pts, shade) => {
    face(ctx, v, pts, wall, shade);
    const end = blankEnds(h) && Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) < h.w - 1; // глухой торец
    if (end) { if (h.mural && px * h.d >= 8) mural(ctx, v, pts, h.mural, shade, p); return; }
    if (detail) windowsOn(ctx, v, pts, h, detail === 'windows' ? tint(wall, shade) ?? wall : null, p.window);
  });
  if (panel) {
    walls(v, rect(h, -w, w, -d, d), top - 4, top, () => true, (pts, shade) => face(ctx, v, pts, p.roof2, shade)); // бортик крыши
    return;
  }
  // скаты и торцы — по удалённости от камеры: дальний первым
  const ridgeA = { ...local(h, -w, 0), z: top + roof }, ridgeB = { ...local(h, w, 0), z: top + roof };
  const corner = (u: number, s: number): P3 => ({ ...local(h, u, s), z: top });
  const parts: { at: Point; pts: P3[]; color: string }[] = [
    { at: local(h, 0, -d), pts: [corner(-w, -d), corner(w, -d), ridgeB, ridgeA], color: p.roof },
    { at: local(h, 0, d), pts: [corner(-w, d), corner(w, d), ridgeB, ridgeA], color: p.roof2 },
    { at: local(h, -w, 0), pts: [corner(-w, -d), corner(-w, d), ridgeA], color: p.house },
    { at: local(h, w, 0), pts: [corner(w, -d), corner(w, d), ridgeB], color: p.house },
  ];
  const depth = (q: Point): number => toCamera(v, q.x, q.y, 0).f;
  parts.sort((a, b) => depth(b.at) - depth(a.at));
  for (const part of parts) face(ctx, v, part.pts, part.color, part.color === p.house ? 0.08 : 0);
}

/** Роспись на торце pts (низ a, низ b, верх b, верх a) — в осях стены, с её тенью */
function mural(ctx: Ctx, v: View, pts: P3[], ad: Ad, shade: number, p: Palette): void {
  let [a, b] = pts;
  const top = pts[2].z, len = Math.hypot(b.x - a.x, b.y - a.y);
  let tl = project(v, a.x, a.y, top), tr = project(v, b.x, b.y, top);
  if (tl && tr && tr.x < tl.x) { [a, b] = [b, a]; [tl, tr] = [tr, tl]; } // слева направо, иначе выйдет зеркальной
  const bl = project(v, a.x, a.y, 0);
  if (!tl || !tr || !bl) return; // стена у самой камеры: роспись не рисуем, чтобы не вывернуло
  const pad = 3, w = len - 2 * pad, h = top - FLOOR * 1.2;
  ctx.save();
  ctx.transform((tr.x - tl.x) / len, (tr.y - tl.y) / len, (bl.x - tl.x) / top, (bl.y - tl.y) / top, tl.x, tl.y);
  ctx.translate(pad, FLOOR * 0.6);
  paintMuralAd(ctx, ad, w, h, p);
  ctx.fillStyle = `rgb(0 0 0 / ${shade.toFixed(3)})`; ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/** Окна на стене pts (углы: низ a, низ b, верх b, верх a): полосы стекла по этажам, а поверх — простенки цвета wall */
function windowsOn(ctx: Ctx, v: View, pts: P3[], h: House, wall: string | null, glassColor: string): void {
  const [a, b] = pts, len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
  const q = (u: number, z: number): P3 => ({ x: a.x + ((b.x - a.x) * u) / len, y: a.y + ((b.y - a.y) * u) / len, z });
  const quad = (path: Path2D, u0: number, u1: number, z0: number, z1: number): void => {
    const s = clipNear(v, [q(u0, z0), q(u1, z0), q(u1, z1), q(u0, z1)]);
    if (s.length >= 3) addPoly(path, s);
  };
  const cols = windowColumns(len, h), rows = windowRows(h);
  const from = cols[0][0], to = cols[cols.length - 1][1], low = rows[0][0], high = rows[rows.length - 1][1];
  const glass = new Path2D();
  for (const [z0, z1] of rows) quad(glass, from, to, z0, z1);
  ctx.fillStyle = glassColor; ctx.fill(glass);
  if (!wall) return;
  const piers = new Path2D();
  for (let i = 1; i < cols.length; i++) quad(piers, cols[i - 1][1], cols[i][0], low, high);
  ctx.fillStyle = wall; ctx.fill(piers);
}

const propSize = (o: Prop): number => ('w' in o ? Math.max(o.w, o.d) : o.kind === 'windmill' ? SIZE.windmill * 2 : 40);

/** Плоские предметы: пруд с песчаной кромкой, площадка паддока, клумба */
function drawFlatProp(ctx: Ctx, v: View, o: Prop, p: Palette): void {
  if (o.kind !== 'pond' && o.kind !== 'paddock' && o.kind !== 'bed') return;
  if (visible(v, o.x, o.y, propSize(o) + 60) === null) return;
  const ring = (rx: number, ry: number, angle: number): Point[] =>
    Array.from({ length: 20 }, (_, i) => local({ x: o.x, y: o.y, angle }, Math.cos((i / 20) * Math.PI * 2) * rx, Math.sin((i / 20) * Math.PI * 2) * ry));
  if (o.kind === 'pond') {
    face(ctx, v, flat(ring(o.rx + 5, o.ry + 5, o.angle)), p.waterEdge);
    face(ctx, v, flat(ring(o.rx, o.ry, o.angle), 0.1), p.water);
  } else if (o.kind === 'bed') {
    face(ctx, v, flat(ring(o.r, o.r, 0)), p.soil);
  } else face(ctx, v, flat(rect(o, -o.w / 2, o.w / 2, -o.d / 2, o.d / 2)), p.pad);
}

/** Всё высокое хозяйство трассы — простыми брусками и картонками */
function drawProp(ctx: Ctx, v: View, o: Prop, p: Palette, tick: number): void {
  switch (o.kind) {
    case 'stand': {
      const w = o.w / 2, d = o.d / 2, row = o.d / 3, crowd = [p.crowd1, p.crowd2, p.crowd3, p.crowd4];
      block(ctx, v, rect(o, -w, w, d, d + 3), 0, 30, p.roof2, p.roof2);
      for (let k = 2; k >= 0; k--) {
        const top = 6 + k * 7;
        block(ctx, v, rect(o, -w, w, -d + k * row, -d + (k + 1) * row), 0, top, p.stand, p.stand);
        heads(ctx, v, o.rows[k] ?? [], top + 2.4, crowd);
      }
      return;
    }
    case 'paddock': {
      const crowd = [p.crowd1, p.crowd2, p.crowd3, p.crowd4];
      for (const c of o.cars) {
        const base = rect(c, -9, 9, -5, 5);
        block(ctx, v, base, 0, 6, crowd[c.c] ?? p.house, crowd[c.c] ?? p.house);
      }
      return;
    }
    case 'tires': {
      const b = billboard(v, o.x, o.y, 0), t = billboard(v, o.x, o.y, o.rings * 3.4);
      if (!b || !t) return;
      ctx.fillStyle = p.tire;
      ctx.beginPath(); ctx.roundRect(b.x - o.r * b.k, t.y - o.r * 0.4 * b.k, o.r * 2 * b.k, b.y - t.y + o.r * 0.4 * b.k, o.r * 0.4 * b.k); ctx.fill();
      ctx.strokeStyle = 'rgb(255 255 255 / 0.12)'; ctx.lineWidth = Math.max(1, 0.6 * b.k);
      for (let k = 1; k < o.rings; k++) { const y = b.y - (b.y - t.y) * (k / o.rings); ctx.beginPath(); ctx.moveTo(b.x - o.r * b.k, y); ctx.lineTo(b.x + o.r * b.k, y); ctx.stroke(); }
      return;
    }
    case 'chevron': board(ctx, v, o, SIZE.chevron.w, 6, 18, p.kerb2, () => {
      ctx.fillStyle = p.kerb;
      for (const u of [-10, 0, 10]) { ctx.beginPath(); ctx.moveTo(u - 4, 2); ctx.lineTo(u + 2, 6); ctx.lineTo(u - 4, 10); ctx.lineTo(u, 10); ctx.lineTo(u + 6, 6); ctx.lineTo(u, 2); ctx.closePath(); ctx.fill(); }
    }); return;
    case 'billboard': {
      const { w, h, z } = SIZE.boards[o.size];
      board(ctx, v, o, w, z, z + h, p.bill, () => { ctx.translate(-w / 2, 0); paintBoard(ctx, o, w, h, p, tick, sceneryMoves()); }, true);
      return;
    }
    case 'lamp': {
      const b = billboard(v, o.x, o.y, 0), t = billboard(v, o.x, o.y, 40);
      if (!b || !t) return;
      ctx.strokeStyle = p.roof2; ctx.lineWidth = Math.max(1, 1.6 * b.k);
      ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(t.x, t.y); ctx.stroke();
      ctx.beginPath(); ctx.arc(t.x, t.y, 3.2 * t.k, 0, Math.PI * 2); ctx.fillStyle = p.lamp; ctx.fill();
      return;
    }
    case 'lights': {
      const b = billboard(v, o.x, o.y, 0), t = billboard(v, o.x, o.y, 34);
      if (!b || !t) return;
      const k = t.k, half = (SIZE.lights / 2) * k, on = startLights();
      ctx.fillStyle = p.roof2;
      for (const u of [-half + 6 * k, half - 6 * k]) ctx.fillRect(b.x + u - 1.2 * k, t.y, 2.4 * k, b.y - t.y);
      ctx.fillStyle = p.bill; ctx.beginPath(); ctx.roundRect(t.x - half, t.y - 6 * k, half * 2, 12 * k, 3 * k); ctx.fill();
      for (let i = 0; i < 5; i++) {
        ctx.beginPath(); ctx.arc(t.x - half + 5 * k + i * ((half * 2 - 10 * k) / 4), t.y, 3.4 * k, 0, Math.PI * 2);
        ctx.fillStyle = 5 - i <= on ? p.kerb : p.lightOff; ctx.fill();
      }
      return;
    }
    case 'windmill': {
      const b = billboard(v, o.x, o.y, 0), hub = billboard(v, o.x, o.y, 49);
      if (!b || !hub) return;
      const k = hub.k;
      ctx.beginPath(); ctx.moveTo(b.x - 9 * k, b.y); ctx.lineTo(b.x + 9 * k, b.y); ctx.lineTo(hub.x + 4 * k, hub.y); ctx.lineTo(hub.x - 4 * k, hub.y); ctx.closePath();
      ctx.fillStyle = p.house; ctx.fill(); ctx.fillStyle = 'rgb(0 0 0 / 0.1)'; ctx.fill();
      const turn = o.phase + (sceneryMoves() ? tick * 0.035 : 0), L = (SIZE.windmill - 2) * k;
      ctx.strokeStyle = p.roof2; ctx.lineWidth = Math.max(1, 3 * k); ctx.lineCap = 'round';
      for (let i = 0; i < 4; i++) {
        const a = turn + (i * Math.PI) / 2;
        ctx.beginPath(); ctx.moveTo(hub.x, hub.y); ctx.lineTo(hub.x + Math.cos(a) * L, hub.y + Math.sin(a) * L); ctx.stroke();
      }
      ctx.lineCap = 'butt';
      return;
    }
    default: return;
  }
}

/** Головы зрителей на ступени — цветные точки (только вблизи: издалека они сливаются) */
function heads(ctx: Ctx, v: View, row: readonly Dot[], z: number, colors: string[]): void {
  for (const d of row) {
    const b = billboard(v, d.x, d.y, z);
    if (!b || b.f > 420) continue;
    ctx.beginPath(); ctx.arc(b.x, b.y, 2.2 * b.k, 0, Math.PI * 2); ctx.fillStyle = colors[d.c] ?? colors[0]; ctx.fill();
  }
}

/**
 * Щит на двух ножках вдоль направления o.angle, от высоты z0 до z1. paint рисует надпись в осях щита
 * (u — вдоль, от середины; y — вниз от верхнего края, px трассы): щит в перспективе — почти параллелограмм, хватает аффинной картинки
 */
/** Доска на столбиках. twoSided — напечатано с обеих сторон (рекламный щит), иначе сзади пусто (шевроны) */
function board(ctx: Ctx, v: View, o: Point & { angle: number }, w: number, z0: number, z1: number, color: string, paint: () => void, twoSided = false): void {
  for (const u of [-w / 2 + 4, w / 2 - 4]) {
    const q = local(o, u, 0), a = project(v, q.x, q.y, 0), b = project(v, q.x, q.y, z0);
    if (a && b) { ctx.strokeStyle = 'rgb(60 62 68)'; ctx.lineWidth = Math.max(1, (1.6 * v.focal) / a.f); ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
  }
  let l = local(o, -w / 2, 0), r = local(o, w / 2, 0);
  let tl = project(v, l.x, l.y, z1), tr = project(v, r.x, r.y, z1);
  if (!tl || !tr) return;
  face(ctx, v, [{ ...l, z: z0 }, { ...r, z: z0 }, { ...r, z: z1 }, { ...l, z: z1 }], color);
  if (tr.x < tl.x) { // видим доску сзади
    if (!twoSided) return; // на шевронах сзади ничего нет
    [l, r, tl, tr] = [r, l, tr, tl]; // у щита та же картинка и сзади — читаем её слева направо
  }
  const bl = project(v, l.x, l.y, z0);
  if (!bl) return;
  ctx.save();
  const h = z1 - z0;
  ctx.transform((tr.x - tl.x) / w, (tr.y - tl.y) / w, (bl.x - tl.x) / h, (bl.y - tl.y) / h, (tl.x + tr.x) / 2, (tl.y + tr.y) / 2);
  paint();
  ctx.restore();
}

/** Машина трафика — коробка с кабиной: корпус, стёкла, фары спереди или стоп-сигналы сзади */
function box(ctx: Ctx, v: View, o: Point & { angle: number }, color: string, p: Palette, lamps: 'front' | 'back'): void {
  const L = CAR.length / 2, W = CAR.width / 2;
  block(ctx, v, rect(o, -L, L, -W + 1, W - 1), CAR_H.floor, CAR_H.body, color, color);
  block(ctx, v, rect(o, -L * 0.6, L * 0.28, -W * 0.72, W * 0.72), CAR_H.body, CAR_H.roof - 1, 'rgb(34 44 58)', color);
  const u = lamps === 'front' ? L + 0.3 : -L - 0.3;
  for (const s of [-W * 0.6, W * 0.6]) {
    const q = local(o, u, s);
    const c = billboard(v, q.x, q.y, CAR_H.body - 3);
    if (c) { ctx.fillStyle = lamps === 'front' ? p.you : p.kerb; ctx.fillRect(c.x - 2 * c.k, c.y - 1.3 * c.k, 4 * c.k, 2.6 * c.k); }
  }
}

/** Своя машина или призрак (полупрозрачный) и подпись над ним */
function carShape(ctx: Ctx, v: View, { car, color, alpha = 1, label = null }: CockpitCar, p: Palette, dpr: number): void {
  drawCockpitCar(ctx, v, car, color, p, alpha);
  if (!label) return;
  const top = billboard(v, car.x, car.y, CAR_H.roof + 10);
  if (!top) return;
  ctx.font = `600 ${Math.round(12 * dpr)}px ${UI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom';
  const w = ctx.measureText(label).width + 10 * dpr;
  ctx.fillStyle = 'rgb(17 18 20 / 0.85)'; ctx.beginPath(); ctx.roundRect(top.x - w / 2, top.y - 18 * dpr, w, 17 * dpr, 5 * dpr); ctx.fill();
  ctx.fillStyle = '#f3f4f6'; ctx.fillText(label, top.x, top.y - 3 * dpr);
}

const RAYS_Z = 4; // лучи идут от бампера, а не из-под асфальта

/** Лучи-сенсоры по асфальту: до удара — жёлтые, после — тёмные, точка удара — кружком */
function beams(ctx: Ctx, v: View, car: CarView, p: Palette, dpr: number): void {
  if (!car.sensors) return;
  const list = rays(car.sensors);
  ctx.lineWidth = 2.2 * dpr; ctx.lineCap = 'round';
  for (let i = 0; i < list.length; i++) {
    const a = car.angle + list[i].angle, len = list[i].length;
    const t = car.rayT && car.rayT.length === list.length ? car.rayT[i] : -1;
    const hit = t < 0 ? { x: car.x + Math.cos(a) * len, y: car.y + Math.sin(a) * len } : { x: car.x + Math.cos(a) * len * t, y: car.y + Math.sin(a) * len * t };
    segment(ctx, v, car, hit, p.ray);
    if (t < 0) continue; // за точкой удара луч не рисуем: в перспективе хвост уходит в стол и только путает
    const h = billboard(v, hit.x, hit.y, RAYS_Z);
    if (h) { ctx.beginPath(); ctx.arc(h.x, h.y, Math.min(7 * dpr, Math.max(3 * dpr, 4 * h.k)), 0, Math.PI * 2); ctx.fillStyle = p.rayHit; ctx.fill(); }
  }
  ctx.lineCap = 'butt';
}

/** Отрезок на высоте лучей, обрезанный по ближней плоскости */
function segment(ctx: Ctx, v: View, a: Point, b: Point, color: string): void {
  const s = clipNear(v, [{ ...a, z: RAYS_Z }, { ...b, z: RAYS_Z }]);
  if (s.length < 2) return;
  ctx.strokeStyle = color;
  ctx.beginPath(); ctx.moveTo(s[0].x, s[0].y); ctx.lineTo(s[1].x, s[1].y); ctx.stroke();
}

