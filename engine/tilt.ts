// Наклонный вид: смотрим на стол с трассой не прямо сверху, а чуть спереди — под углом.
// Пол сжат по высоте экрана (TILT), а всё, у чего есть высота, «растёт» вверх по экрану (RISE).
// Это то же преобразование, что у камеры, без поворота: лучи, клики и запись заезда живут в тех же координатах.
import type { Point } from './track.ts';

type Ctx = CanvasRenderingContext2D;

const VIEW = (55 * Math.PI) / 180; // камера смотрит на стол под 55° к нему (90° — прямо сверху)
/** Во сколько раз пол сжат по высоте экрана */
export const TILT = Math.sin(VIEW);
/** На сколько px по y трассы сдвигается вверх точка на высоте 1 px: вертикаль сжата сильнее пола */
export const RISE = Math.cos(VIEW) / TILT;

/** Точка (x, y) на высоте z — где она на полу трассы (так её и рисуем: камера сожмёт пол сама) */
export const lift = (x: number, y: number, z: number): Point => ({ x, y: y - z * RISE });

/** Точка машины в её осях (вперёд lx, вбок ly) → точка трассы */
export function local(car: { x: number; y: number; angle: number }, lx: number, ly: number): Point {
  const c = Math.cos(car.angle), s = Math.sin(car.angle);
  return { x: car.x + lx * c - ly * s, y: car.y + lx * s + ly * c };
}

function path(ctx: Ctx, pts: Point[], z: number): void {
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const p = lift(pts[i].x, pts[i].y, z);
    if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y);
  }
  ctx.closePath();
}

/**
 * Призма: многоугольник основания pts (выпуклый), поднятый от высоты z0 до z1.
 * Видны только стенки, которые смотрят на зрителя (вниз по экрану), и крыша. Свет — сверху слева, как у теней трассы.
 * top/side — цвета крыши и стенок; стенки ещё и темнеют, чем дальше они отвернулись от света.
 */
export function prism(ctx: Ctx, pts: Point[], z0: number, z1: number, top: string | null, side: string): void {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
  }
  const turn = area > 0 ? 1 : -1; // в какую сторону обходим основание — от этого зависит, где «наружу»
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = ((b.y - a.y) / len) * turn, ny = (-(b.x - a.x) / len) * turn;
    if (ny <= 0.02) continue; // стенка смотрит от нас — её закрывает сама призма
    const a0 = lift(a.x, a.y, z0), b0 = lift(b.x, b.y, z0), a1 = lift(a.x, a.y, z1), b1 = lift(b.x, b.y, z1);
    ctx.beginPath();
    ctx.moveTo(a0.x, a0.y); ctx.lineTo(b0.x, b0.y); ctx.lineTo(b1.x, b1.y); ctx.lineTo(a1.x, a1.y); ctx.closePath();
    ctx.fillStyle = side; ctx.fill();
    ctx.fillStyle = `rgb(0 0 0 / ${(0.2 + 0.14 * nx).toFixed(3)})`; ctx.fill(); // левая стенка к свету — светлее
  }
  if (top) {
    path(ctx, pts, z1);
    ctx.fillStyle = top; ctx.fill();
  }
}

/** Крыша призмы — тот же многоугольник на высоте z: для деталей поверх (стекло, круг под номер) */
export function cap(ctx: Ctx, pts: Point[], z: number, color: string): void {
  path(ctx, pts, z);
  ctx.fillStyle = color; ctx.fill();
}
