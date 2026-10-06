// Своя машина в виде из машины: литой корпус из граней, кабина со стёклами, круглые колёса.
// Камера всегда рядом, поэтому машина здесь подробнее, чем трафик: её видно крупно весь заезд.
// Каждая часть — выпуклое тело: рисуем только грани к камере, и они друг друга не перекрывают — сортировать не надо.
import { clipNear, type View } from './camera.ts';
import type { Palette } from '../render.ts';
import type { CarView } from '../car-draw.ts';
import { tint } from '../../core/paint.ts';
import { wheelAngle, CAR, WHEELBASE } from '../../world/car.ts';
import type { Point } from '../../world/track.ts';

type Ctx = CanvasRenderingContext2D;
type P3 = Point & { z: number };
/** Грань: точки в мире и цвет */
type Face = { pts: P3[]; color: string; glass?: boolean };

const L = CAR.length / 2, W = CAR.width / 2;
/** Колесо — как в виде сверху: радиус, ширина, где по бокам (чуть торчит из-под корпуса) */
const TYRE = { r: 4.6, w: 3.6, at: W + 0.2, sides: 16 };
const RUBBER = '#18191d', SIDEWALL = '#2c2e34', RIM = '#cdd2d9', HUB = '#6f7680';
const TRIM = 'rgb(30 32 37)', GLASS = 'rgb(34 44 58)';
/** Солнце сверху слева — как у теней трассы */
const SUN = norm({ x: -0.55, y: -0.83, z: 1.3 });

/**
 * Сечение корпуса поперёк хода: u — где вдоль машины, hw — полуширина, низ, пояс (где бок переходит в скос), верх.
 * Нос ниже и уже — машина «смотрит» вперёд; зад скруглён фаской.
 */
const BODY = [
  { u: -L, hw: W - 2.6, low: 3.4, belt: 8.4, top: 10, inset: 2.4 },
  { u: -L + 2.2, hw: W - 1, low: 2.6, belt: 9.4, top: 11.2, inset: 2.6 },
  { u: L - 9, hw: W - 1, low: 2.6, belt: 9, top: 10.8, inset: 2.6 },
  { u: L - 2.4, hw: W - 1.6, low: 2.8, belt: 6.6, top: 8, inset: 3 },
  { u: L, hw: W - 3.6, low: 3.2, belt: 5.4, top: 6.4, inset: 2.8 },
];
const SILL = 1.8; // тёмная полоска литья внизу боков
/** Кабина: низ на корпусе, верх — крыша; лобовое и заднее стекло наклонены */
const CABIN = { low: { u0: -L * 0.62, u1: L * 0.36, hw: W - 3.4, z: 10.6 }, top: { u0: -L * 0.4, u1: L * 0.06, hw: W - 5.2, z: 17.5 } };

/** Нарисовать свою машину (или призрака — с прозрачностью) */
export function drawCockpitCar(ctx: Ctx, v: View, car: CarView, color: string, p: Palette, alpha = 1): void {
  const paint = car.status === 'crashed' ? p.crashed : color;
  const at = (u: number, w: number, z: number): P3 => local(car, u, w, z);
  // где камера относительно машины: справа или слева от её боков — так решаем, какие колёса закрыты корпусом
  const camW = -(v.x - car.x) * Math.sin(car.angle) + (v.y - car.y) * Math.cos(car.angle);
  const steer = car.done ? 0 : wheelAngle(car.steer ?? 0, car.speed ?? 0);
  const spin = -(car.roll ?? 0) / TYRE.r; // колесо катится без проскальзывания
  const wheels = [-1, 1].map((side) => ({
    near: side * camW > W, // камера с этого боку — колёса поверх корпуса
    list: [1, -1].map((sign) => wheel(car, (sign * WHEELBASE) / 2, side, sign > 0 ? steer : 0, spin, Math.abs(car.speed ?? 0))),
  }));

  const was = ctx.globalAlpha;
  ctx.globalAlpha = was * alpha;
  shadow(ctx, v, car);
  for (const side of wheels) if (!side.near) for (const w of side.list) solid(ctx, v, w);
  solid(ctx, v, body(at, paint));
  solid(ctx, v, cabin(at, paint));
  lamps(ctx, v, at, p, (car.controls?.brake ?? 0) > 0);
  for (const side of wheels) if (side.near) for (const w of side.list) solid(ctx, v, w);
  ctx.globalAlpha = was;
}

/** Точка в осях машины (u — вперёд, w — вправо, z — вверх) → мир */
function local(car: CarView, u: number, w: number, z: number): P3 {
  const c = Math.cos(car.angle), s = Math.sin(car.angle);
  return { x: car.x + u * c - w * s, y: car.y + u * s + w * c, z };
}

/** Корпус: сечения BODY, соединённые гранями, и два торца */
function body(at: (u: number, w: number, z: number) => P3, paint: string): Face[] {
  // сечение — восьмиугольник по часовой, если смотреть сзади: низ, правый бок (литьё, бок, скос), верх, левый
  const ring = (s: typeof BODY[number]): P3[] => [
    at(s.u, -s.hw, s.low), at(s.u, s.hw, s.low), at(s.u, s.hw, s.low + SILL), at(s.u, s.hw, s.belt),
    at(s.u, s.hw - s.inset, s.top), at(s.u, -s.hw + s.inset, s.top), at(s.u, -s.hw, s.belt), at(s.u, -s.hw, s.low + SILL),
  ];
  const colors = [TRIM, TRIM, paint, paint, paint, paint, paint, TRIM]; // ребро k → цвет полосы
  const rings = BODY.map(ring), faces: Face[] = [];
  for (let i = 0; i + 1 < rings.length; i++) {
    const a = rings[i], b = rings[i + 1];
    for (let k = 0; k < a.length; k++) {
      const n = (k + 1) % a.length;
      faces.push({ pts: [a[k], a[n], b[n], b[k]], color: colors[k] });
    }
  }
  faces.push({ pts: rings[0], color: paint }, { pts: rings[rings.length - 1], color: paint });
  return faces;
}

/** Кабина — усечённая пирамида: крыша цвета машины, стёкла тёмные */
function cabin(at: (u: number, w: number, z: number) => P3, paint: string): Face[] {
  const { low, top } = CABIN;
  const b = [at(low.u1, -low.hw, low.z), at(low.u1, low.hw, low.z), at(low.u0, low.hw, low.z), at(low.u0, -low.hw, low.z)];
  const t = [at(top.u1, -top.hw, top.z), at(top.u1, top.hw, top.z), at(top.u0, top.hw, top.z), at(top.u0, -top.hw, top.z)];
  return [
    { pts: t, color: paint },
    { pts: [b[0], b[1], t[1], t[0]], color: GLASS, glass: true }, // лобовое
    { pts: [b[1], b[2], t[2], t[1]], color: GLASS, glass: true }, // правое
    { pts: [b[2], b[3], t[3], t[2]], color: GLASS, glass: true }, // заднее
    { pts: [b[3], b[0], t[0], t[3]], color: GLASS, glass: true }, // левое
    { pts: b, color: paint },
  ];
}

/**
 * Колесо — многогранный цилиндр: протектор полосками, боковины, светлый диск со спицами.
 * Полоски протектора и спицы крутятся по пробегу; на большой скорости спицы смазываются, как в виде сверху.
 */
function wheel(car: CarView, u: number, side: number, turn: number, spin: number, speed: number): Face[] {
  const c = local(car, u, side * TYRE.at, TYRE.r);
  const a = car.angle + turn;
  const fwd = { x: Math.cos(a), y: Math.sin(a) }, axle = { x: -Math.sin(a), y: Math.cos(a) };
  const half = TYRE.w / 2;
  /** точка на колесе: угол φ по ободу, радиус r, смещение вдоль оси o */
  const pt = (phi: number, r: number, o: number): P3 => ({
    x: c.x + fwd.x * Math.cos(phi) * r + axle.x * o,
    y: c.y + fwd.y * Math.cos(phi) * r + axle.y * o,
    z: c.z + Math.sin(phi) * r,
  });
  const n = TYRE.sides, faces: Face[] = [];
  const outer = side * half, inner = -side * half;
  for (let k = 0; k < n; k++) {
    const p0 = spin + (k / n) * Math.PI * 2, p1 = spin + ((k + 1) / n) * Math.PI * 2;
    faces.push({ pts: [pt(p0, TYRE.r, inner), pt(p1, TYRE.r, inner), pt(p1, TYRE.r, outer), pt(p0, TYRE.r, outer)], color: k % 2 ? RUBBER : SIDEWALL });
  }
  const disc = (r: number, o: number, color: string): Face => ({ pts: Array.from({ length: n }, (_, k) => pt((k / n) * Math.PI * 2, r, o)), color });
  faces.push(disc(TYRE.r, inner, SIDEWALL), disc(TYRE.r, outer, SIDEWALL));
  // диск и спицы — чуть снаружи боковины, на своей плоскости
  faces.push(disc(TYRE.r * 0.66, outer + side * 0.15, RIM));
  const sharp = Math.min(1, Math.max(0, (1 - speed / TYRE.r) / 0.45));
  if (sharp > 0.05) {
    const o = outer + side * 0.3, wide = 0.28;
    for (let k = 0; k < 3; k++) {
      const phi = spin + (k * 2 * Math.PI) / 3;
      faces.push({ pts: [pt(phi - wide, TYRE.r * 0.2, o), pt(phi - 0.1, TYRE.r * 0.62, o), pt(phi + 0.1, TYRE.r * 0.62, o), pt(phi + wide, TYRE.r * 0.2, o)], color: HUB });
    }
  }
  faces.push(disc(TYRE.r * 0.24, outer + side * 0.4, HUB));
  return faces;
}

/** Задние фонари и номер: горят, когда тормозишь */
function lamps(ctx: Ctx, v: View, at: (u: number, w: number, z: number) => P3, p: Palette, braking: boolean): void {
  const u = -L - 0.05, s = BODY[0];
  const quad = (w0: number, w1: number, z0: number, z1: number, color: string): void =>
    fill(ctx, v, [at(u, w0, z0), at(u, w1, z0), at(u, w1, z1), at(u, w0, z1)], color, 0);
  if (!facing(v, [at(u, -1, 0), at(u, 1, 0), at(u, 0, 1)], at(0, 0, 6))) return;
  for (const side of [-1, 1]) quad(side * 3.2, side * (s.hw - 0.6), s.belt - 2.6, s.belt - 0.4, braking ? p.kerb : p.lightOff);
  quad(-2.4, 2.4, s.low + 0.6, s.low + 2.6, '#e8e8e2');
}

/** Выпуклое тело: только грани к камере, со светом от солнца; стёкла с бликом */
function solid(ctx: Ctx, v: View, faces: Face[]): void {
  const centre = mid(faces.flatMap((f) => f.pts));
  for (const f of faces) {
    const n = normal(f.pts, centre);
    const m = mid(f.pts);
    if (n.x * (v.x - m.x) + n.y * (v.y - m.y) + n.z * (v.z - m.z) <= 0) continue; // грань смотрит от камеры
    const light = n.x * SUN.x + n.y * SUN.y + n.z * SUN.z;
    fill(ctx, v, f.pts, f.color, 0.4 * (1 - Math.max(0, light)), f.glass ? 0.1 + 0.14 * Math.max(0, light) : Math.max(0, light - 0.72) * 0.9);
  }
}

/** Видна ли плоскость (три точки) из камеры, если наружу — от точки inside */
function facing(v: View, pts: P3[], inside: P3): boolean {
  const n = normal(pts, inside), m = mid(pts);
  return n.x * (v.x - m.x) + n.y * (v.y - m.y) + n.z * (v.z - m.z) > 0;
}

/** Многоугольник → экран и заливка; dark и shine — тень и блик (как полупрозрачный чёрный и белый поверх), смешаны с цветом заранее */
function fill(ctx: Ctx, v: View, pts: P3[], color: string, dark: number, shine = 0): void {
  const s = clipNear(v, pts);
  if (s.length < 3) return;
  ctx.beginPath();
  ctx.moveTo(s[0].x, s[0].y);
  for (let i = 1; i < s.length; i++) ctx.lineTo(s[i].x, s[i].y);
  ctx.closePath();
  const mixed = tint(color, dark > 0.01 ? dark : 0, shine > 0.01 ? shine : 0);
  if (mixed) { ctx.fillStyle = mixed; ctx.fill(); } else { // цвет не разобрать — тень и блик слоями поверх
    ctx.fillStyle = color; ctx.fill();
    if (dark > 0.01) { ctx.fillStyle = `rgb(0 0 0 / ${dark.toFixed(3)})`; ctx.fill(); }
    if (shine > 0.01) { ctx.fillStyle = `rgb(255 255 255 / ${shine.toFixed(3)})`; ctx.fill(); }
  }
  // тонкий шов того же цвета закрывает щёлки между гранями, которые оставляет сглаживание
  ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 0.6; ctx.lineJoin = 'round'; ctx.stroke();
}

/** Мягкая тень на столе: два овала, край светлее середины, — как в виде сверху */
function shadow(ctx: Ctx, v: View, car: CarView): void {
  const c = { ...car, x: car.x + 2, y: car.y + 3 };
  for (const grow of [3, -1]) {
    const pts = Array.from({ length: 20 }, (_, k) => {
      const t = (k / 20) * Math.PI * 2;
      return local(c, Math.cos(t) * (L + grow), Math.sin(t) * (W + grow), 0);
    });
    fill(ctx, v, pts, 'rgb(0 0 0 / 0.16)', 0);
  }
}

/** Нормаль многоугольника (по Ньюэллу), повёрнутая наружу — от точки inside */
function normal(pts: P3[], inside: P3): P3 {
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    x += (a.y - b.y) * (a.z + b.z); y += (a.z - b.z) * (a.x + b.x); z += (a.x - b.x) * (a.y + b.y);
  }
  const n = norm({ x, y, z }), m = mid(pts);
  return n.x * (m.x - inside.x) + n.y * (m.y - inside.y) + n.z * (m.z - inside.z) < 0 ? { x: -n.x, y: -n.y, z: -n.z } : n;
}

function mid(pts: P3[]): P3 {
  let x = 0, y = 0, z = 0;
  for (const q of pts) { x += q.x; y += q.y; z += q.z; }
  return { x: x / pts.length, y: y / pts.length, z: z / pts.length };
}

function norm(p: P3): P3 {
  const l = Math.hypot(p.x, p.y, p.z) || 1;
  return { x: p.x / l, y: p.y / l, z: p.z / l };
}
