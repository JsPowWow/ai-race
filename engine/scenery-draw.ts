// Декор под наклоном: пластиковые ёлки ярусами на стволе, пышные круглые деревья, домики со скатной крышей.
// Деревья рисуем слоями — все тени, потом все стволы, потом ярус за ярусом: несколько заливок за кадр вместо сотен.
import { sceneryOf, type Tree, type House } from './scenery.ts';
import { TILT, lift, local, prism } from './tilt.ts';
import type { Camera, Palette } from './render.ts';
import type { Track, Point } from './track.ts';

type Ctx = CanvasRenderingContext2D;

const SHADOW = { x: 3, y: 5 }; // тень падает туда же, куда у трассы: свет сверху слева
const WALL = 13, ROOF = 9;     // высота стен и конька над ними, px

/** tick — тик заезда: от него крутится то, что движется (ветряк); на заезд декор не влияет */
export function drawScenery(ctx: Ctx, track: Track, cam: Camera, p: Palette, tick = 0): void {
  void tick;
  const { trees, houses } = sceneryOf(track);
  // что попало в кадр — с запасом на крону, высоту и тень
  const halfW = ctx.canvas.width / 2 / cam.scale + 60, halfH = ctx.canvas.height / 2 / (cam.scale * TILT) + 80;
  const seen = (o: Point): boolean => Math.abs(o.x - cam.x) < halfW && Math.abs(o.y - cam.y) < halfH;
  drawDecor(ctx, trees.filter(seen), houses.filter(seen), p);
}

/** Нарисовать готовый список декора (уже отобранный по кадру). Списки сортирует на месте: дальние — первыми, ближние их загораживают */
export function drawDecor(ctx: Ctx, trees: Tree[], houses: House[], p: Palette): void {
  const byDepth = <T extends Point>(list: T[]): T[] => list.sort((a, b) => a.y - b.y);
  for (const h of byDepth(houses)) drawHouse(ctx, h, p);
  drawTrees(ctx, byDepth(trees), p);
}

function drawTrees(ctx: Ctx, trees: Tree[], p: Palette): void {
  const shadow = new Path2D(), core = new Path2D(), trunk = new Path2D(), base = new Path2D(), middle = new Path2D(), top = new Path2D(), round = new Path2D(), shine = new Path2D();
  for (const t of trees) {
    const h = t.r * 2.4; // высота дерева
    const turn = (t.x * 7 + t.y * 13) % 6.28; // каждая ёлка повёрнута по-своему — без Math.random, от места
    const outline = t.kind === 'fir' ? star : circle;
    // мягкая тень у ствола — две фигуры, одна чуть больше: размытие на сотне деревьев дорогое.
    // Крона поднята над землёй, поэтому тень меньше кроны и прячется под ней, а не лежит рядом пятном
    outline(shadow, t.x + SHADOW.x * 0.6, t.y + SHADOW.y * 0.4, t.r * 0.95, turn);
    outline(core, t.x + SHADOW.x * 0.4, t.y + SHADOW.y * 0.2, t.r * 0.7, turn);
    const at = (z: number): Point => lift(t.x, t.y, z);
    const foot = at(0), neck = at(h * (t.kind === 'fir' ? 0.25 : 0.45));
    trunk.rect(foot.x - 2, neck.y, 4, foot.y - neck.y);
    if (t.kind === 'fir') {
      // ёлка — три конуса друг на друге: чем выше ярус, тем он меньше
      const a = at(h * 0.25), b = at(h * 0.6), c = at(h * 0.9);
      star(base, a.x, a.y, t.r, turn);
      star(middle, b.x, b.y, t.r * 0.68, turn + 0.4);
      star(top, c.x, c.y, t.r * 0.36, turn + 0.8);
    } else {
      const c = at(h * 0.6);
      circle(round, c.x, c.y, t.r);
      circle(shine, c.x - t.r * 0.3, c.y - t.r * 0.3, t.r * 0.45); // блик сверху слева: пластик блестит
    }
  }
  ctx.fillStyle = 'rgb(0 0 0 / 0.06)'; ctx.fill(shadow);
  ctx.fillStyle = 'rgb(0 0 0 / 0.11)'; ctx.fill(core);
  ctx.fillStyle = '#6b4a2e'; ctx.fill(trunk);
  ctx.fillStyle = p.tree; ctx.fill(base);
  ctx.fillStyle = p.tree2; ctx.fill(round); ctx.fill(middle); // средний ярус ёлки светлее нижнего
  ctx.fillStyle = 'rgb(255 255 255 / 0.16)'; ctx.fill(shine); ctx.fill(top);
  ctx.fillStyle = 'rgb(255 255 255 / 0.12)'; ctx.fill(top); // верхушка — самая светлая: ближе всех к свету
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

/** Домик-кубик: белые стены, двускатная графитовая крыша — конёк вдоль дороги, труба */
function drawHouse(ctx: Ctx, h: House, p: Palette): void {
  const at = (u: number, v: number, z: number): Point => { const q = local(h, u, v); return lift(q.x, q.y, z); };
  const w = h.w / 2, d = h.d / 2;
  const corners = ([[w, -d], [w, d], [-w, d], [-w, -d]] as const).map(([u, v]) => local(h, u, v));
  ctx.fillStyle = 'rgb(0 0 0 / 0.2)';
  poly(ctx, corners.map((q) => ({ x: q.x + SHADOW.x, y: q.y + SHADOW.y }))); ctx.fill();
  prism(ctx, corners, 0, WALL, null, p.house);
  // скаты: тот, что смотрит на нас (вниз по экрану), рисуем последним; дальний — к свету, он светлее
  const slope = (v: number, color: string): void => {
    poly(ctx, [at(-w - 2, v * (d + 2), WALL - 1), at(w + 2, v * (d + 2), WALL - 1), at(w + 2, 0, WALL + ROOF), at(-w - 2, 0, WALL + ROOF)]);
    ctx.fillStyle = color; ctx.fill();
  };
  const front = Math.cos(h.angle) > 0 ? 1 : -1; // скат со стороны +v смотрит вниз по экрану, если дом не перевёрнут
  slope(-front, p.roof);
  for (const u of [-w, w]) { // фронтоны — треугольники стены под крышей, если смотрят на нас
    if (Math.sin(h.angle) * Math.sign(u) <= 0) continue;
    poly(ctx, [at(u, -d, WALL), at(u, d, WALL), at(u, 0, WALL + ROOF)]);
    ctx.fillStyle = p.house; ctx.fill();
    ctx.fillStyle = 'rgb(0 0 0 / 0.12)'; ctx.fill();
  }
  slope(front, p.roof2);
  const pipe = ([[3, 3], [3, -3], [-3, -3], [-3, 3]] as const).map(([u, v]) => local(h, w * 0.45 + u, -front * d * 0.4 + v));
  prism(ctx, pipe, WALL + ROOF * 0.4, WALL + ROOF + 4, p.roof2, p.house); // труба на дальнем скате
}

function poly(ctx: Ctx, pts: Point[]): void {
  ctx.beginPath();
  pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
  ctx.closePath();
}
