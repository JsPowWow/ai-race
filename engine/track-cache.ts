// Кэш неподвижной части трассы (#25, шаг 3). Асфальт, разметка, бордюры и декор от тика не зависят — незачем
// растеризовать их заново каждый кадр: на слабом ноутбуке это съедало больше половины кадра. Рисуем один раз и копируем.
//  • вся трасса в кадре — камера стоит: один слой во весь холст;
//  • камера за машиной — плитки: в кадре десяток-другой, по краю следующие дорисовываются заранее, по одной за кадр.
// Что меняется (лопасти ветряков, острова, машины) — рисует поверх drawTrack() в render.ts.
import { TILT } from './tilt.ts';
import type { Track } from './track.ts';

type Ctx = CanvasRenderingContext2D;
/** Камера, как её видит кэш: куда смотрит и в каком масштабе */
export type View = { mode: string; x: number; y: number; scale: number };
/** Нарисовать неподвижное на холсте g, у которого уже стоит преобразование камеры view */
export type DrawGround = (g: Ctx, view: View) => void;
/** От чего зависит картинка: сменилось хоть что-то — кэш рисуется заново */
export type Look = { track: Track; palette: object; lights: number };

/** Сторона плитки, пиксели экрана */
const TILE = 256;

type Layers = { look: Look; scale: number; still: (View & { canvas: OffscreenCanvas }) | null; tiles: Map<string, OffscreenCanvas> };
const byCanvas = new WeakMap<object, Layers>();

/**
 * Положить неподвижную часть трассы на ctx камерой view. false — кэш не завести (нет OffscreenCanvas,
 * холст спрятан): тогда рисуй как обычно, draw прямо на ctx.
 */
export function pasteGround(ctx: Ctx, view: View, look: Look, draw: DrawGround): boolean {
  const { width, height } = ctx.canvas;
  if (typeof OffscreenCanvas !== 'function' || !width || !height) return false;
  let layers = byCanvas.get(ctx.canvas);
  if (!layers || layers.scale !== view.scale || !sameLook(layers.look, look)) {
    layers = { look, scale: view.scale, still: null, tiles: new Map() };
    byCanvas.set(ctx.canvas, layers);
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (view.mode === 'fit') pasteStill(ctx, view, layers, draw);
  else pasteTiles(ctx, view, layers, draw);
  ctx.restore();
  return true;
}

const sameLook = (a: Look, b: Look): boolean => a.track === b.track && a.palette === b.palette && a.lights === b.lights;

/** Вся трасса: камера стоит — один слой во весь холст */
function pasteStill(ctx: Ctx, view: View, layers: Layers, draw: DrawGround): void {
  const { width, height } = ctx.canvas;
  const s = layers.still;
  if (!s || s.x !== view.x || s.y !== view.y || s.canvas.width !== width || s.canvas.height !== height) {
    const canvas = new OffscreenCanvas(width, height);
    const g = context(canvas);
    g.setTransform(view.scale, 0, 0, view.scale * TILT, width / 2 - view.x * view.scale, height / 2 - view.y * view.scale * TILT);
    draw(g, view);
    layers.still = { ...view, canvas };
  }
  ctx.drawImage(layers.still!.canvas, 0, 0);
}

/**
 * Камера за машиной: мир разрезан на плитки TILE×TILE пикселей экрана. Плитки лежат на целых пикселях —
 * поэтому соседние сходятся без шва, а трасса сдвинута от машин меньше чем на полпикселя: этого не видно
 */
function pasteTiles(ctx: Ctx, view: View, layers: Layers, draw: DrawGround): void {
  const { width, height } = ctx.canvas;
  const ox = Math.round(width / 2 - view.x * view.scale), oy = Math.round(height / 2 - view.y * view.scale * TILT);
  const cols = { from: Math.floor(-ox / TILE), to: Math.floor((width - 1 - ox) / TILE) };
  const rows = { from: Math.floor(-oy / TILE), to: Math.floor((height - 1 - oy) / TILE) };
  for (let j = rows.from; j <= rows.to; j++) {
    for (let i = cols.from; i <= cols.to; i++) ctx.drawImage(tile(layers, i, j, draw), i * TILE + ox, j * TILE + oy);
  }
  // запас в одну плитку по краю: машина туда вот-вот въедет. Одну за кадр — чтобы кадр не споткнулся
  const near = (i: number, j: number): boolean => i >= cols.from - 1 && i <= cols.to + 1 && j >= rows.from - 1 && j <= rows.to + 1;
  outer: for (let j = rows.from - 1; j <= rows.to + 1; j++) {
    for (let i = cols.from - 1; i <= cols.to + 1; i++) {
      if (!layers.tiles.has(`${i},${j}`)) { tile(layers, i, j, draw); break outer; }
    }
  }
  // уехавшие далеко — забыть: память не резиновая
  for (const key of layers.tiles.keys()) {
    const [i, j] = key.split(',').map(Number);
    if (!near(i, j)) layers.tiles.delete(key);
  }
}

/** Плитка (i, j) — из кэша или нарисовать */
function tile(layers: Layers, i: number, j: number, draw: DrawGround): OffscreenCanvas {
  const key = `${i},${j}`;
  let canvas = layers.tiles.get(key);
  if (!canvas) {
    canvas = new OffscreenCanvas(TILE, TILE);
    const k = layers.scale, ky = k * TILT;
    const g = context(canvas);
    g.setTransform(k, 0, 0, ky, -i * TILE, -j * TILE);
    draw(g, { mode: 'follow', x: ((i + 0.5) * TILE) / k, y: ((j + 0.5) * TILE) / ky, scale: k }); // середина плитки — для отбора декора
    layers.tiles.set(key, canvas);
  }
  return canvas;
}

function context(canvas: OffscreenCanvas): Ctx {
  const g = canvas.getContext('2d') as unknown as Ctx | null; // рисует так же, как обычный холст
  if (!g) throw new Error('слой трассы не рисует 2D');
  return g;
}
