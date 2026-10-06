// Декор под наклоном: пластиковые ёлки ярусами на стволе, пышные круглые деревья, домики со скатной крышей
// и всё хозяйство трассы: огни старта, трибуна, паддок, шины, шевроны, щиты, фонари, ветряк, пруд и клумбы.
// Деревья, кусты и шины рисуем слоями — все тени, потом все стволы, потом ярус за ярусом: несколько заливок за кадр вместо сотен.
import { sceneryOf, houseRadius, wallsOf, roofOf, windowColumns, windowRows, blankEnds, FLOOR, SIZE, type Tree, type House, type Prop, type Ad, type BoardSize, type Dot, type Parked } from '../world/scenery.ts';
import { TILT, RISE, lift, local, prism, cap } from '../core/tilt.ts';
import { tint } from '../core/paint.ts';
import { paintAd, paintMuralAd } from './ads.ts';
import type { Palette } from './render.ts';
import type { View } from './track-cache.ts';
import type { Track, Point } from '../world/track.ts';

type Ctx = CanvasRenderingContext2D;
/** Низкое и многочисленное — рисуется пачкой, слоями */
type Soft = Tree | Extract<Prop, { kind: 'tires' }>;
/** Высокое и штучное — рисуется по одному, от дальних к ближним */
type Solid = House | Prop;

const SHADOW = { x: 3, y: 5 }; // тень падает туда же, куда у трассы: свет сверху слева
const RING = 3.4;              // высота одной шины в стопке, px
const LIGHTS = 5;              // огней на табло старта

let lightsOn = 0;
/**
 * Сколько стартовых огней горит: 0–5. Зовёт обратный отсчёт — огни гаснут один за другим.
 * 0 (так и по умолчанию) — все погасли: гонка идёт.
 */
export function setStartLights(n: number): void {
  lightsOn = Math.max(0, Math.min(LIGHTS, Math.round(n)));
}

/** Сколько огней горит сейчас — для вида из машины (engine/draw/cockpit/scene.ts) */
export const startLights = (): number => lightsOn;

let motion = true;
/** Можно ли декору двигаться (ветряк). false — человек попросил в системе меньше движения */
export function setSceneryMotion(on: boolean): void {
  motion = on;
}
/** Можно ли декору двигаться — для вида из машины */
export const sceneryMoves = (): boolean => motion;

/**
 * tick — тик заезда: от него крутится то, что движется (ветряк); на заезд декор не влияет.
 * tick = null — декор без лопастей ветряков: это неподвижный слой, лопасти докрутит drawBlades() поверх
 */
export function drawScenery(ctx: Ctx, track: Track, cam: View, p: Palette, tick: number | null = 0): void {
  const { trees, houses, bushes, props } = sceneryOf(track);
  const { seen, seenWide, seenTall } = inFrame(ctx, cam);
  // вся трасса целиком — предметы мелкие: мелочь (кабины машинок, стыки шин) не видна, её и не рисуем
  drawDecor(ctx, trees.filter(seen), houses.filter(seenTall), p, { bushes: bushes.filter(seen), props: props.filter(seenWide), tick: tick ?? 0, blades: tick !== null, fine: cam.scale >= 1 });
}

/** Лопасти ветряков на тике tick — поверх неподвижного слоя, нарисованного drawScenery(…, null) */
export function drawBlades(ctx: Ctx, track: Track, cam: View, p: Palette, tick: number): void {
  const { seenWide } = inFrame(ctx, cam);
  for (const o of sceneryOf(track).props) if (o.kind === 'windmill' && seenWide(o)) blades(ctx, o, p, turnAt(tick));
}

/**
 * Что попало в кадр — с запасом на крону, высоту и тень; большим предметам (трибуна, паддок) — запас побольше.
 * Дом стоит ниже кадра, а крыша в кадре: высокое растёт вверх по экрану — ему запас снизу по его росту
 */
function inFrame(ctx: Ctx, cam: View): { seen: (o: Point) => boolean; seenWide: (o: Point) => boolean; seenTall: (h: House) => boolean } {
  const halfW = ctx.canvas.width / 2 / cam.scale + 60, halfH = ctx.canvas.height / 2 / (cam.scale * TILT) + 80;
  return {
    seen: (o) => Math.abs(o.x - cam.x) < halfW && Math.abs(o.y - cam.y) < halfH,
    seenWide: (o) => Math.abs(o.x - cam.x) < halfW + 80 && Math.abs(o.y - cam.y) < halfH + 60,
    seenTall: (h) => {
      const r = houseRadius(h), dy = h.y - cam.y;
      return Math.abs(h.x - cam.x) < halfW + r && dy > -halfH - r && dy < halfH + r + (wallsOf(h) + roofOf(h)) * RISE;
    },
  };
}

/** На сколько повернулись лопасти к тику tick (рад) */
const turnAt = (tick: number): number => (motion ? tick * 0.035 : 0);

/**
 * Нарисовать готовый список декора (уже отобранный по кадру). Списки сортирует на месте: дальние — первыми, ближние их загораживают.
 * Сначала плоское (пруд, клумбы, площадка паддока), потом высокое вперемешку с лесом — по глубине.
 */
export function drawDecor(ctx: Ctx, trees: Tree[], houses: House[], p: Palette, more: { bushes?: Tree[]; props?: Prop[]; tick?: number; blades?: boolean; fine?: boolean } = {}): void {
  const props = more.props ?? [], fine = more.fine ?? true;
  drawGround(ctx, props, p);
  const soft: Soft[] = [...trees, ...(more.bushes ?? [])];
  const solid: Solid[] = [...houses];
  for (const o of props) {
    if (o.kind === 'tires') soft.push(o);
    else if (o.kind !== 'pond' && o.kind !== 'bed') solid.push(o);
  }
  soft.sort((a, b) => a.y - b.y);
  solid.sort((a, b) => a.y - b.y);
  // Лес рисуется пачками. Перед каждым высоким предметом дорисовываем ту часть леса, что стоит за ним и рядом по x;
  // дальние деревья в стороне подождут — с предметом они не пересекаются. Так пачек мало, а порядок честный
  let pending: Soft[] = [], i = 0;
  for (const o of solid) {
    while (i < soft.length && soft[i].y < o.y) pending.push(soft[i++]);
    const reach = reachOf(o);
    if (pending.some((t) => Math.abs(t.x - o.x) < reach + t.r)) { drawTrees(ctx, pending, p, fine); pending = []; }
    drawSolid(ctx, o, p, more.tick ?? 0, fine, more.blades ?? true);
  }
  while (i < soft.length) pending.push(soft[i++]);
  drawTrees(ctx, pending, p, fine);
}

/** Насколько предмет простирается в стороны по x — чтобы понять, может ли он загородить дерево */
function reachOf(o: Solid): number {
  if (!('kind' in o)) return houseRadius(o);
  switch (o.kind) {
    case 'stand': case 'paddock': return Math.hypot(o.w, o.d) / 2;
    case 'billboard': return SIZE.boards[o.size].w / 2;
    case 'windmill': return SIZE.windmill + 4;
    case 'lamp': return 10;
    default: return 22;
  }
}

function drawSolid(ctx: Ctx, o: Solid, p: Palette, tick: number, fine: boolean, withBlades: boolean): void {
  if (!('kind' in o)) { drawHouse(ctx, o, p, fine); return; }
  switch (o.kind) {
    case 'lights': drawLights(ctx, o, p); break;
    case 'stand': drawStand(ctx, o, p); break;
    case 'paddock': drawParked(ctx, o.cars, p, fine); break;
    case 'chevron': drawChevron(ctx, o, p); break;
    case 'billboard': drawBillboard(ctx, o, p); break;
    case 'lamp': drawLamp(ctx, o, p); break;
    case 'windmill': drawWindmill(ctx, o, p); if (withBlades) blades(ctx, o, p, turnAt(tick)); break;
    default: break;
  }
}

function drawTrees(ctx: Ctx, trees: Soft[], p: Palette, fine = true): void {
  if (!trees.length) return;
  const shadow = new Path2D(), core = new Path2D(), trunk = new Path2D(), base = new Path2D(), middle = new Path2D(), top = new Path2D(), round = new Path2D(), shine = new Path2D();
  const bush = new Path2D(), tire = new Path2D(), seam = new Path2D(), tireTop = new Path2D(), hole = new Path2D();
  for (const t of trees) {
    if (t.kind === 'tires') {
      // стопка шин — цилиндр: низ, бока и верх одним контуром, стыки шин — дужками, сверху дырка
      const a = lift(t.x, t.y, 0), b = lift(t.x, t.y, t.rings * RING);
      circle(shadow, t.x + SHADOW.x * 0.5, t.y + SHADOW.y * 0.3, t.r * 1.15);
      tire.moveTo(a.x + t.r, a.y); tire.arc(a.x, a.y, t.r, 0, Math.PI); tire.lineTo(b.x - t.r, b.y); tire.arc(b.x, b.y, t.r, Math.PI, 0); tire.closePath();
      for (let k = 1; fine && k < t.rings; k++) { const q = lift(t.x, t.y, k * RING); seam.moveTo(q.x + t.r, q.y); seam.arc(q.x, q.y, t.r, 0, Math.PI); }
      circle(tireTop, b.x, b.y, t.r);
      circle(hole, b.x, b.y, t.r * 0.45);
      continue;
    }
    if (t.kind === 'bush') {
      // куст — три шара у самой земли, без ствола
      circle(shadow, t.x + SHADOW.x * 0.6, t.y + SHADOW.y * 0.4, t.r * 1.1);
      const c = lift(t.x, t.y, t.r * 0.55);
      if (!fine) { circle(bush, c.x, c.y, t.r); continue; }
      circle(bush, c.x - t.r * 0.5, c.y + t.r * 0.1, t.r * 0.7);
      circle(bush, c.x + t.r * 0.5, c.y + t.r * 0.15, t.r * 0.65);
      circle(bush, c.x, c.y - t.r * 0.25, t.r * 0.75);
      circle(shine, c.x - t.r * 0.25, c.y - t.r * 0.5, t.r * 0.3);
      continue;
    }
    const h = t.h;
    const turn = (t.x * 7 + t.y * 13) % 6.28; // каждая ёлка повёрнута по-своему — без Math.random, от места
    const outline = t.kind === 'fir' ? star : circle;
    // мягкая тень у ствола — две фигуры, одна чуть больше: размытие на сотне деревьев дорогое.
    // Крона поднята над землёй, поэтому тень меньше кроны и прячется под ней, а не лежит рядом пятном
    outline(shadow, t.x + SHADOW.x * 0.6, t.y + SHADOW.y * 0.4, t.r * 0.95, turn);
    outline(core, t.x + SHADOW.x * 0.4, t.y + SHADOW.y * 0.2, t.r * 0.7, turn);
    const at = (z: number): Point => lift(t.x, t.y, z);
    const foot = at(0), neck = at(t.kind === 'fir' ? h * 0.25 : h - t.r * 1.3);
    trunk.rect(foot.x - 2, neck.y, 4, foot.y - neck.y);
    if (t.kind === 'fir') {
      // ёлка — ярусы друг на друге: чем выше, тем меньше. У высокой ярусов больше — иначе между ними просветы
      const n = Math.max(3, Math.min(6, Math.round(h / t.r / 0.9)));
      for (let k = 0; k < n; k++) {
        const q = at(h * (0.25 + (0.65 * k) / (n - 1))), part = k / (n - 1);
        star(part < 0.34 ? base : part < 0.99 ? middle : top, q.x, q.y, t.r * (1 - 0.64 * part), turn + k * 0.4);
      }
    } else {
      const c = at(h - t.r);
      circle(round, c.x, c.y, t.r);
      circle(shine, c.x - t.r * 0.3, c.y - t.r * 0.3, t.r * 0.45); // блик сверху слева: пластик блестит
    }
  }
  // пачек за кадр бывает несколько десятков: пустые слои не заливаем, каждая заливка стоит времени
  const has = (kind: Soft['kind']): boolean => trees.some((t) => t.kind === kind);
  const tires = has('tires'), bushes = has('bush'), firs = has('fir'), rounds = has('round');
  ctx.fillStyle = 'rgb(0 0 0 / 0.06)'; ctx.fill(shadow);
  ctx.fillStyle = 'rgb(0 0 0 / 0.11)'; ctx.fill(core);
  if (tires) {
    ctx.fillStyle = p.tire; ctx.fill(tire); ctx.fill(tireTop);
    ctx.strokeStyle = 'rgb(255 255 255 / 0.14)'; ctx.lineWidth = 0.8; ctx.stroke(seam);
    ctx.fillStyle = 'rgb(255 255 255 / 0.1)'; ctx.fill(tireTop); // верх к свету
    ctx.fillStyle = 'rgb(0 0 0 / 0.55)'; ctx.fill(hole);
  }
  if (bushes) { ctx.fillStyle = p.bush; ctx.fill(bush); }
  if (!firs && !rounds) {
    if (bushes) { ctx.fillStyle = 'rgb(255 255 255 / 0.16)'; ctx.fill(shine); }
    return;
  }
  ctx.fillStyle = '#6b4a2e'; ctx.fill(trunk);
  if (firs) { ctx.fillStyle = p.tree; ctx.fill(base); }
  ctx.fillStyle = p.tree2; ctx.fill(round); ctx.fill(middle); // средний ярус ёлки светлее нижнего
  if (firs) { ctx.fillStyle = tint(p.tree2, 0, 0.22) ?? p.tree2; ctx.fill(top); } // верхушка — самая светлая: ближе всех к свету
  ctx.fillStyle = 'rgb(255 255 255 / 0.16)'; ctx.fill(shine);
}

function circle(path: Path2D, x: number, y: number, r: number): void {
  path.moveTo(x + r, y);
  path.arc(x, y, r, 0, Math.PI * 2);
}

/** Хвоя сверху — зубчатая звёздочка: так ёлку не спутать с круглым деревом */
function star(path: Path2D, x: number, y: number, r: number, turn: number): void {
  const n = 9;
  for (let i = 0; i <= n * 2; i++) {
    const a = turn + (i * Math.PI) / n, k = i % 2 ? 0.7 : 1;
    const px = x + Math.cos(a) * r * k, py = y + Math.sin(a) * r * k;
    if (i) path.lineTo(px, py); else path.moveTo(px, py);
  }
  path.closePath();
}

/**
 * Дом по этажам, с окнами. Домик — белые стены, двускатная крыша, конёк вдоль дороги, труба;
 * многоэтажка — панельные стены и плоская крыша с бортиком и будкой лифта
 */
function drawHouse(ctx: Ctx, h: House, p: Palette, fine: boolean): void {
  const at = (u: number, v: number, z: number): Point => { const q = local(h, u, v); return lift(q.x, q.y, z); };
  const w = h.w / 2, d = h.d / 2, top = wallsOf(h), roof = roofOf(h), panel = h.style === 'panel';
  const corners = ([[w, -d], [w, d], [-w, d], [-w, -d]] as const).map(([u, v]) => local(h, u, v));
  // тень тем длиннее, чем выше дом: основание и оно же, сдвинутое по свету, со стенками между ними — одной заливкой
  const k = 0.4 + (top + roof) / 40, shadow = new Path2D();
  const moved = corners.map((q) => ({ x: q.x + SHADOW.x * k, y: q.y + SHADOW.y * k }));
  polyTo(shadow, corners); polyTo(shadow, moved);
  corners.forEach((q, i) => { const n = (i + 1) % 4; polyTo(shadow, [q, corners[n], moved[n], moved[i]]); });
  ctx.fillStyle = 'rgb(0 0 0 / 0.2)'; ctx.fill(shadow);
  prism(ctx, corners, 0, top, panel ? p.roof2 : null, panel ? p.panel : p.house);
  if (fine) { windows(ctx, corners, h, p); murals(ctx, corners, h, p); }
  if (panel) {
    const rim = 3; // бортик по краю крыши, внутри — крыша чуть темнее
    const inner = ([[w - rim, -d + rim], [w - rim, d - rim], [-w + rim, d - rim], [-w + rim, -d + rim]] as const).map(([u, v]) => local(h, u, v));
    cap(ctx, inner, top, p.roof);
    const box = ([[6, -7], [6, 7], [-6, 7], [-6, -7]] as const).map(([u, v]) => local(h, u - w * 0.3, v));
    prism(ctx, box, top, top + 10, p.roof2, p.panel); // будка лифта
    return;
  }
  // скаты: тот, что смотрит на нас (вниз по экрану), рисуем последним; дальний — к свету, он светлее
  const slope = (v: number, color: string): void => {
    poly(ctx, [at(-w - 2, v * (d + 2), top - 1), at(w + 2, v * (d + 2), top - 1), at(w + 2, 0, top + roof), at(-w - 2, 0, top + roof)]);
    ctx.fillStyle = color; ctx.fill();
  };
  const front = Math.cos(h.angle) > 0 ? 1 : -1; // скат со стороны +v смотрит вниз по экрану, если дом не перевёрнут
  slope(-front, p.roof);
  for (const u of [-w, w]) { // фронтоны — треугольники стены под крышей, если смотрят на нас
    if (Math.sin(h.angle) * Math.sign(u) <= 0) continue;
    poly(ctx, [at(u, -d, top), at(u, d, top), at(u, 0, top + roof)]);
    ctx.fillStyle = p.house; ctx.fill();
    ctx.fillStyle = 'rgb(0 0 0 / 0.12)'; ctx.fill();
  }
  slope(front, p.roof2);
  const pipe = ([[3, 3], [3, -3], [-3, -3], [-3, 3]] as const).map(([u, v]) => local(h, w * 0.45 + u, -front * d * 0.4 + v));
  prism(ctx, pipe, top + roof * 0.4, top + roof + 4, p.roof2, p.house); // труба на дальнем скате
}

/** Окна на стенах, что смотрят на нас (как в prism): ряд на этаж, все дома — одной заливкой */
function windows(ctx: Ctx, base: Point[], h: House, p: Palette): void {
  const glass = new Path2D();
  let area = 0;
  for (let i = 0; i < base.length; i++) { const a = base[i], b = base[(i + 1) % base.length]; area += a.x * b.y - b.x * a.y; }
  const turn = area > 0 ? 1 : -1;
  for (let i = 0; i < base.length; i++) {
    const a = base[i], b = base[(i + 1) % base.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    if ((-(b.x - a.x) / len) * turn <= 0.02) continue; // стенка смотрит от нас
    if (blankEnds(h) && len < h.w - 1) continue; // глухой торец многоэтажки — без окон
    const q = (u: number, z: number): Point => lift(a.x + ((b.x - a.x) * u) / len, a.y + ((b.y - a.y) * u) / len, z);
    for (const [z0, z1] of windowRows(h)) for (const [u0, u1] of windowColumns(len, h)) polyTo(glass, [q(u0, z0), q(u1, z0), q(u1, z1), q(u0, z1)]);
  }
  ctx.fillStyle = p.window; ctx.fill(glass);
}

/** Роспись на глухих торцах, что смотрят на нас: картинка в осях стены, тень — как у самой стены (prism) */
function murals(ctx: Ctx, base: Point[], h: House, p: Palette): void {
  if (!h.mural) return;
  const top = wallsOf(h);
  let area = 0;
  for (let i = 0; i < base.length; i++) { const a = base[i], b = base[(i + 1) % base.length]; area += a.x * b.y - b.x * a.y; }
  const turn = area > 0 ? 1 : -1;
  for (let i = 0; i < base.length; i++) {
    let a = base[i], b = base[(i + 1) % base.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    if (len > h.d + 1 || (-(b.x - a.x) / len) * turn <= 0.02) continue; // только торец, и только лицом к нам
    const nx = ((b.y - a.y) / len) * turn;
    if (b.x < a.x) [a, b] = [b, a]; // картинку рисуем слева направо, иначе выйдет зеркальной
    const at = lift(a.x, a.y, top), right = lift(b.x, b.y, top), down = lift(a.x, a.y, 0);
    ctx.save();
    ctx.transform((right.x - at.x) / len, (right.y - at.y) / len, (down.x - at.x) / top, (down.y - at.y) / top, at.x, at.y);
    const pad = 3; // по краю стены — полоска штукатурки
    ctx.translate(pad, FLOOR * 0.6);
    paintMuralAd(ctx, h.mural, len - 2 * pad, top - FLOOR * 1.2, p);
    ctx.fillStyle = `rgb(0 0 0 / ${(0.2 + 0.14 * nx).toFixed(3)})`; ctx.fillRect(0, 0, len - 2 * pad, top - FLOOR * 1.2);
    ctx.restore();
  }
}

function polyTo(path: Path2D, pts: Point[]): void {
  pts.forEach((q, i) => (i ? path.lineTo(q.x, q.y) : path.moveTo(q.x, q.y)));
  path.closePath();
}

function poly(ctx: Ctx, pts: Point[]): void {
  ctx.beginPath();
  pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
  ctx.closePath();
}

type Placed = { x: number; y: number; angle: number };

/** Брусок в осях предмета: u — вдоль, v — поперёк, z — высота */
function box(ctx: Ctx, o: Placed, u0: number, u1: number, v0: number, v1: number, z0: number, z1: number, top: string | null, side: string): void {
  prism(ctx, [local(o, u0, v0), local(o, u1, v0), local(o, u1, v1), local(o, u0, v1)], z0, z1, top, side);
}

/**
 * Рисовать на стоячей доске (щит, шевроны) прямо в её осях: u — вдоль доски, t — вниз от верхнего края.
 * Доска стоит вертикально над линией angle, верх — на высоте zTop. Видна с обеих сторон, как настоящий щит.
 */
function upright(ctx: Ctx, o: Placed, zTop: number, draw: () => void): void {
  ctx.save();
  ctx.transform(Math.cos(o.angle), Math.sin(o.angle), 0, RISE, o.x, o.y - zTop * RISE);
  draw();
  ctx.restore();
}

/** Столбик: вертикальная черта от земли до высоты z */
function post(ctx: Ctx, q: Point, z: number, color: string, width: number): void {
  const a = lift(q.x, q.y, 0), b = lift(q.x, q.y, z);
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.stroke();
}

const crowdColors = (p: Palette): string[] => [p.crowd1, p.crowd2, p.crowd3, p.crowd4];

/** Точки одного размера, по цвету — одной заливкой на цвет */
function dots(ctx: Ctx, list: Dot[], z: number, r: number, colors: string[]): void {
  const paths = colors.map(() => new Path2D());
  for (const d of list) { const q = lift(d.x, d.y, z); circle(paths[d.c], q.x, q.y, r); }
  paths.forEach((path, c) => { ctx.fillStyle = colors[c]; ctx.fill(path); });
}

/** Плоское на земле — до всего высокого: пруд, площадка паддока, клумбы */
function drawGround(ctx: Ctx, props: Prop[], p: Palette): void {
  const flowers: Dot[] = [];
  for (const o of props) {
    if (o.kind === 'pond') {
      ctx.beginPath(); ctx.ellipse(o.x, o.y, o.rx + 5, o.ry + 5, o.angle, 0, Math.PI * 2);
      ctx.fillStyle = p.waterEdge; ctx.fill();
      ctx.beginPath(); ctx.ellipse(o.x, o.y, o.rx, o.ry, o.angle, 0, Math.PI * 2);
      ctx.fillStyle = p.water; ctx.fill();
      // вода ниже берега: у дальнего края — тень от него
      ctx.beginPath(); ctx.ellipse(o.x, o.y - 2, o.rx - 1, o.ry - 3, o.angle, Math.PI, Math.PI * 2);
      ctx.fillStyle = 'rgb(0 0 0 / 0.1)'; ctx.fill();
      ctx.beginPath(); ctx.ellipse(o.x - o.rx * 0.25, o.y - o.ry * 0.3, o.rx * 0.3, o.ry * 0.12, o.angle * 0.3, 0, Math.PI * 2);
      ctx.ellipse(o.x + o.rx * 0.2, o.y + o.ry * 0.25, o.rx * 0.12, o.ry * 0.06, o.angle * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgb(255 255 255 / 0.4)'; ctx.fill(); // блик
    } else if (o.kind === 'paddock') {
      const w = o.w / 2, d = o.d / 2;
      poly(ctx, [local(o, -w, -d), local(o, w, -d), local(o, w, d), local(o, -w, d)]);
      ctx.fillStyle = p.pad; ctx.fill();
      ctx.strokeStyle = 'rgb(0 0 0 / 0.15)'; ctx.lineWidth = 1.5; ctx.stroke();
      // разметка стоянки: белые черты между машинками
      ctx.beginPath();
      for (let k = 0; k <= o.cars.length; k++) {
        const u = (k - o.cars.length / 2) * 20, a = local(o, u, d - 32), b = local(o, u, d - 3);
        ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y);
      }
      ctx.strokeStyle = p.kerb2; ctx.lineWidth = 1.2; ctx.stroke();
    } else if (o.kind === 'bed') {
      ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
      ctx.fillStyle = p.soil; ctx.fill();
      ctx.strokeStyle = p.stand; ctx.lineWidth = 2; ctx.stroke(); // бортик
      flowers.push(...o.flowers);
    }
  }
  if (flowers.length) dots(ctx, flowers, 1.5, 1.9, crowdColors(p));
}

/**
 * Стартовые огни: тёмное табло на двух столбиках у обочины, на нём пять огней. Гаснут слева направо.
 * Табло всегда повёрнуто к зрителю: вдоль дороги, что идёт сверху вниз, его было бы не видно
 */
function drawLights(ctx: Ctx, at: Point, p: Palette): void {
  const o = { x: at.x, y: at.y, angle: 0 }, half = SIZE.lights / 2, top = 34, tall = 12;
  for (const u of [-half + 6, half - 6]) post(ctx, local(o, u, 0), top - tall, p.roof2, 2.4);
  upright(ctx, o, top, () => {
    ctx.fillStyle = p.bill; ctx.fillRect(-half, 0, 2 * half, tall);
    const step = (2 * half - 10) / (LIGHTS - 1);
    for (let k = 0; k < LIGHTS; k++) {
      const u = -half + 5 + k * step, on = LIGHTS - k <= lightsOn; // первым гаснет левый
      if (on) { ctx.beginPath(); ctx.arc(u, tall / 2, 6.5, 0, Math.PI * 2); ctx.fillStyle = p.kerb; ctx.globalAlpha = 0.35; ctx.fill(); ctx.globalAlpha = 1; }
      ctx.beginPath(); ctx.arc(u, tall / 2, 3.6, 0, Math.PI * 2);
      ctx.fillStyle = on ? p.kerb : p.lightOff; ctx.fill();
      ctx.beginPath(); ctx.arc(u - 1, tall / 2 - 1, 1.1, 0, Math.PI * 2);
      ctx.fillStyle = on ? 'rgb(255 255 255 / 0.75)' : 'rgb(255 255 255 / 0.14)'; ctx.fill(); // блик стекла
    }
  });
}

/** Трибуна: три ступени от дороги вверх, на каждой — ряд зрителей, сзади стенка */
function drawStand(ctx: Ctx, o: Extract<Prop, { kind: 'stand' }>, p: Palette): void {
  const w = o.w / 2, d = o.d / 2, row = o.d / 3;
  poly(ctx, [local(o, -w, -d), local(o, w, -d), local(o, w, d + 3), local(o, -w, d + 3)].map((q) => ({ x: q.x + SHADOW.x * 2, y: q.y + SHADOW.y * 2 })));
  ctx.fillStyle = 'rgb(0 0 0 / 0.16)'; ctx.fill();
  // ступени и стенка — бруски; рисуем от дальнего к ближнему, зрителей — сразу на свою ступень
  const parts = [0, 1, 2, 3].map((k) => ({ k, y: local(o, 0, k < 3 ? -d + (k + 0.5) * row : d + 1.5).y }));
  parts.sort((a, b) => a.y - b.y);
  const colors = crowdColors(p);
  for (const { k } of parts) {
    if (k === 3) { box(ctx, o, -w, w, d, d + 3, 0, 30, p.roof2, p.roof2); continue; }
    const top = 6 + k * 7;
    box(ctx, o, -w, w, -d + k * row, -d + (k + 1) * row, 0, top, p.stand, p.stand);
    dots(ctx, o.rows[k] ?? [], top + 2.4, 2.2, colors);
  }
}

/** Машинки паддока: корпус и кабина, носом к дороге */
function drawParked(ctx: Ctx, cars: Parked[], p: Palette, fine: boolean): void {
  const colors = crowdColors(p);
  for (const car of [...cars].sort((a, b) => a.y - b.y)) {
    const color = colors[car.c] ?? p.house;
    if (fine) {
      poly(ctx, [local(car, -10, -5.5), local(car, 10, -5.5), local(car, 10, 5.5), local(car, -10, 5.5)].map((q) => ({ x: q.x + SHADOW.x * 0.6, y: q.y + SHADOW.y * 0.6 })));
      ctx.fillStyle = 'rgb(0 0 0 / 0.2)'; ctx.fill();
    }
    box(ctx, car, -10, 10, -5.5, 5.5, 1, 6, color, color);
    if (fine) box(ctx, car, -6, 3, -4.5, 4.5, 6, 9.5, p.roof2, color); // кабина с тёмным стеклом
  }
}

/** Щиток «>>>»: белая доска на двух столбиках, красные стрелки туда, куда уходит дорога */
function drawChevron(ctx: Ctx, o: Placed, p: Palette): void {
  const half = SIZE.chevron.w / 2, top = 21, tall = 12;
  for (const u of [-half + 5, half - 5]) post(ctx, local(o, u, 0), top - tall, p.roof2, 1.6);
  upright(ctx, o, top, () => {
    ctx.fillStyle = p.kerb2; ctx.fillRect(-half, 0, 2 * half, tall);
    ctx.beginPath();
    for (const c of [-10, 0, 10]) {
      ctx.moveTo(c - 5, 1.5); ctx.lineTo(c - 1, 1.5); ctx.lineTo(c + 4, tall / 2); ctx.lineTo(c - 1, tall - 1.5); ctx.lineTo(c - 5, tall - 1.5); ctx.lineTo(c, tall / 2); ctx.closePath();
    }
    ctx.fillStyle = p.kerb; ctx.fill();
    ctx.strokeStyle = 'rgb(0 0 0 / 0.3)'; ctx.lineWidth = 0.7; ctx.strokeRect(-half, 0, 2 * half, tall);
  });
}

/** Рекламный щит на ножках: что на нём напечатано — engine/draw/ads.ts */
function drawBillboard(ctx: Ctx, o: Placed & { ad: Ad; size: BoardSize }, p: Palette): void {
  const { w, h: tall, z } = SIZE.boards[o.size], half = w / 2, top = tall + z;
  const a = local(o, -half, 0), b = local(o, half, 0);
  ctx.beginPath(); ctx.moveTo(a.x + SHADOW.x * 3, a.y + SHADOW.y * 3); ctx.lineTo(b.x + SHADOW.x * 3, b.y + SHADOW.y * 3);
  ctx.strokeStyle = 'rgb(0 0 0 / 0.14)'; ctx.lineWidth = 4; ctx.stroke(); // тень щита на земле
  for (const u of [-half + 9, half - 9]) post(ctx, local(o, u, 0), z, p.roof2, o.size === 'big' ? 2.6 : 2);
  upright(ctx, o, top, () => {
    ctx.translate(-half, 0); paintAd(ctx, o.ad, o.size, w, tall, p); ctx.translate(half, 0);
    ctx.strokeStyle = 'rgb(255 255 255 / 0.16)'; ctx.lineWidth = 0.8; ctx.strokeRect(-half + 0.4, 0.4, 2 * half - 0.8, tall - 0.8);
  });
}

/** Фонарь: столбик, выгнутая к дороге рука, тёплый плафон */
function drawLamp(ctx: Ctx, o: Placed, p: Palette): void {
  const z = 30, head = local(o, 7, 0);
  post(ctx, o, z, p.roof2, 1.6);
  const a = lift(o.x, o.y, z), b = lift(head.x, head.y, z);
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
  ctx.beginPath(); ctx.arc(b.x, b.y + 1, 5, 0, Math.PI * 2);
  ctx.fillStyle = p.lamp; ctx.globalAlpha = 0.3; ctx.fill(); ctx.globalAlpha = 1; // свечение
  ctx.beginPath(); ctx.ellipse(b.x, b.y + 1, 3, 1.8, 0, 0, Math.PI * 2); ctx.fill();
}

/** Ветряк: белая башня, на ней гондола и четыре лопасти. turn — угол поворота лопастей */
type Windmill = Extract<Prop, { kind: 'windmill' }>;

function drawWindmill(ctx: Ctx, o: Windmill, p: Palette): void {
  const base = { x: o.x, y: o.y, angle: 0 };
  ctx.beginPath(); ctx.ellipse(o.x + SHADOW.x * 2, o.y + SHADOW.y * 1.5, 10, 6, 0, 0, Math.PI * 2);
  ctx.fillStyle = 'rgb(0 0 0 / 0.16)'; ctx.fill();
  box(ctx, base, -7, 7, -7, 7, 0, 24, null, p.house);
  box(ctx, base, -5, 5, -5, 5, 24, 46, p.roof, p.house);
  box(ctx, base, -3.5, 3.5, -4, 8, 46, 52, p.roof2, p.roof2);
}

/** Лопасти ветряка, повёрнутые на turn */
function blades(ctx: Ctx, o: Windmill, p: Palette, turn: number): void {
  // лопасти крутятся в плоскости лицом к нам: вбок — x, вверх — высота
  const hubZ = 49, y = o.y + 8, L = SIZE.windmill - 2;
  const at = (u: number, z: number): Point => lift(o.x + u, y, hubZ + z);
  ctx.beginPath();
  for (let k = 0; k < 4; k++) {
    const a = o.phase + turn + (k * Math.PI) / 2, cu = Math.cos(a), cz = Math.sin(a), nu = -cz, nz = cu;
    const pts = [at(nu * 1.2, nz * 1.2), at(cu * L + nu * 3.2, cz * L + nz * 3.2), at(cu * L - nu * 0.6, cz * L - nz * 0.6), at(-nu * 1.2, -nz * 1.2)];
    pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
  }
  ctx.fillStyle = p.house; ctx.fill();
  ctx.strokeStyle = 'rgb(0 0 0 / 0.3)'; ctx.lineWidth = 0.7; ctx.stroke();
  const hub = at(0, 0);
  ctx.beginPath(); ctx.arc(hub.x, hub.y, 2.4, 0, Math.PI * 2);
  ctx.fillStyle = p.roof2; ctx.fill();
}
