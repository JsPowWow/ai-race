// Декор на виде сверху: пластиковые ёлки ярусами, пышные круглые деревья, домики со скатной крышей.
// Рисуем слоями — все тени, потом все нижние ярусы, потом верхние: несколько заливок за кадр вместо сотен.
import { sceneryOf, type Tree, type House } from './scenery.ts';
import type { Camera, Palette } from './render.ts';
import type { Track, Point } from './track.ts';

type Ctx = CanvasRenderingContext2D;

const EYE = 640;   // на какой «высоте» висит камера крупного плана: чем ниже, тем сильнее заваливаются верхушки
const LEAN = 11;   // дальше верхушка не уходит — с зазора у дороги она на асфальт не залезет
const SHADOW = { x: 3, y: 5 }; // тень падает туда же, куда у трассы: свет сверху слева

/** Насколько сдвинута верхушка высотой h: от центра кадра наружу, как на фото сверху */
function leanOf(cam: Camera, x: number, y: number, h: number): Point {
  if (cam.mode === 'fit') return { x: 0, y: 0 }; // вся трасса мелко — плоско: так спокойнее и дешевле
  const dx = (x - cam.x) * h / EYE, dy = (y - cam.y) * h / EYE;
  const len = Math.hypot(dx, dy);
  return len > LEAN ? { x: dx * LEAN / len, y: dy * LEAN / len } : { x: dx, y: dy };
}

export function drawScenery(ctx: Ctx, track: Track, cam: Camera, p: Palette): void {
  const { trees, houses } = sceneryOf(track);
  // что попало в кадр — с запасом на крону и тень
  const halfW = ctx.canvas.width / 2 / cam.scale + 60, halfH = ctx.canvas.height / 2 / cam.scale + 60;
  const seen = (o: Point): boolean => Math.abs(o.x - cam.x) < halfW && Math.abs(o.y - cam.y) < halfH;
  drawHouses(ctx, houses.filter(seen), cam, p);
  drawTrees(ctx, trees.filter(seen), cam, p);
}

function drawTrees(ctx: Ctx, trees: Tree[], cam: Camera, p: Palette): void {
  const shadow = new Path2D(), core = new Path2D(), base = new Path2D(), middle = new Path2D(), top = new Path2D(), round = new Path2D(), shine = new Path2D();
  for (const t of trees) {
    const lean = leanOf(cam, t.x, t.y, t.r * 2.2);
    const turn = (t.x * 7 + t.y * 13) % 6.28; // каждая ёлка повёрнута по-своему — без Math.random, от места
    const outline = t.kind === 'fir' ? star : circle;
    // мягкая тень — две фигуры, одна чуть больше: размытие на сотне деревьев дорогое
    outline(shadow, t.x + SHADOW.x, t.y + SHADOW.y, t.r + 2, turn);
    outline(core, t.x + SHADOW.x, t.y + SHADOW.y, t.r, turn);
    if (t.kind === 'fir') {
      // ёлка сверху — три конуса друг на друге: чем выше ярус, тем он меньше и дальше «завален»
      star(base, t.x, t.y, t.r, turn);
      star(middle, t.x + lean.x * 0.5, t.y + lean.y * 0.5, t.r * 0.68, turn + 0.4);
      star(top, t.x + lean.x, t.y + lean.y, t.r * 0.36, turn + 0.8);
    } else {
      const cx = t.x + lean.x * 0.6, cy = t.y + lean.y * 0.6;
      circle(round, cx, cy, t.r);
      circle(shine, cx - t.r * 0.3, cy - t.r * 0.3, t.r * 0.45); // блик сверху слева: пластик блестит
    }
  }
  ctx.fillStyle = 'rgb(0 0 0 / 0.08)'; ctx.fill(shadow);
  ctx.fillStyle = 'rgb(0 0 0 / 0.12)'; ctx.fill(core);
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

function drawHouses(ctx: Ctx, houses: House[], cam: Camera, p: Palette): void {
  for (const h of houses) {
    const lean = leanOf(cam, h.x, h.y, 26);
    ctx.save();
    ctx.translate(h.x, h.y);
    ctx.rotate(h.angle);
    const lx = lean.x * Math.cos(h.angle) + lean.y * Math.sin(h.angle); // сдвиг крыши — в осях домика
    const ly = -lean.x * Math.sin(h.angle) + lean.y * Math.cos(h.angle);
    const w = h.w, d = h.d;
    ctx.fillStyle = 'rgb(0 0 0 / 0.2)';
    ctx.fillRect(-w / 2 + SHADOW.x, -d / 2 + SHADOW.y, w, d);
    // стены: видны, когда крышу «завалило» в сторону
    ctx.fillStyle = p.house;
    ctx.fillRect(-w / 2, -d / 2, w, d);
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgb(0 0 0 / 0.25)';
    ctx.strokeRect(-w / 2, -d / 2, w, d);
    // скатная крыша: конёк вдоль дороги, один скат светлее другого
    ctx.translate(lx, ly);
    // крыша чуть меньше стен: белый кант кубика виден и на плоском виде всей трассы
    ctx.fillStyle = p.roof; ctx.fillRect(-w / 2 + 3, -d / 2 + 3, w - 6, d / 2 - 3);
    ctx.fillStyle = p.roof2; ctx.fillRect(-w / 2 + 3, 0, w - 6, d / 2 - 3);
    ctx.fillStyle = p.house; ctx.fillRect(w * 0.18, -d * 0.3, 5, 5); // труба
    ctx.restore();
  }
}
