// Рисунок следов шин (где они — engine/world/skids.ts): один и тот же для вида сверху и из машины.
// След колеса — полоска шириной TYRE из четырёхугольников. Кусочки одной потёртости — одним путём:
// так на их стыках нет тёмных точек, а заливок на всю трассу — всего LEVELS.
import { skidsOf, TYRE } from '../world/skids.ts';
import type { Track, Point } from '../world/track.ts';
import type { Palette } from './render.ts';

type Ctx = CanvasRenderingContext2D;
/** Кусочек следа на асфальте и его середина (по ней вид из машины решает, виден ли он) */
export type SkidPiece = { pts: Point[]; x: number; y: number };

/** Сколько ступеней прозрачности: от «почти стёрся» до свежего */
export const LEVELS = 4;
const cache = new WeakMap<Track, SkidPiece[][]>();

/** Кусочки следов трассы по ступеням: [k] — с прозрачностью (k + 1) / LEVELS */
export function skidLevels(track: Track): SkidPiece[][] {
  let levels = cache.get(track);
  if (levels) return levels;
  levels = Array.from({ length: LEVELS }, (): SkidPiece[] => []);
  for (const { wheels: [left, right], wear } of skidsOf(track)) {
    for (const [i, w] of wear.entries()) {
      const level = Math.ceil(w * LEVELS) - 1;
      if (level < 0) continue; // тут стёрся совсем
      for (const pts of [tyre(left, right, i), tyre(right, left, i)]) {
        levels[level].push({ pts, x: (pts[0].x + pts[2].x) / 2, y: (pts[0].y + pts[2].y) / 2 });
      }
    }
  }
  cache.set(track, levels);
  return levels;
}

/** Четырёхугольник следа колеса wheel между точками i и i + 1; other — второе колесо той же оси, от него берём «поперёк» */
function tyre(wheel: Point[], other: Point[], i: number): Point[] {
  const side = (j: number): Point => {
    const dx = other[j].x - wheel[j].x, dy = other[j].y - wheel[j].y, len = Math.hypot(dx, dy) || 1;
    return { x: (dx / len) * (TYRE / 2), y: (dy / len) * (TYRE / 2) };
  };
  const a = wheel[i], b = wheel[i + 1], sa = side(i), sb = side(i + 1);
  return [{ x: a.x - sa.x, y: a.y - sa.y }, { x: b.x - sb.x, y: b.y - sb.y }, { x: b.x + sb.x, y: b.y + sb.y }, { x: a.x + sa.x, y: a.y + sa.y }];
}

/** Вид сверху: следы на асфальте — под разметкой и швами, они фон, а разметка должна читаться */
export function drawSkids(ctx: Ctx, track: Track, p: Palette): void {
  ctx.save();
  ctx.fillStyle = p.skid;
  skidLevels(track).forEach((pieces, k) => {
    ctx.globalAlpha = (k + 1) / LEVELS;
    ctx.beginPath();
    for (const { pts } of pieces) {
      ctx.moveTo(pts[0].x, pts[0].y);
      for (const q of pts.slice(1)) ctx.lineTo(q.x, q.y);
      ctx.closePath();
    }
    ctx.fill();
  });
  ctx.restore();
}
