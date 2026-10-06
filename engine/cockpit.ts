// Вид из машины: камера стоит позади машины и чуть выше, смотрит по ходу — как в гоночной игре.
// Здесь только счёт: где камера и куда на экране попадает точка трассы. Рисует engine/cockpit-draw.ts.
// Проекция — обычная «камера-обскура»: что дальше, то меньше и ближе к горизонту (так же у Раду, understanding_ai).
import type { Point } from './track.ts';

/** Камера: где стоит, куда смотрит, на какой высоте, px */
export const CHASE = {
  back: 84,     // насколько позади машины (машина длиной 44): видно свой корпус, дорогу перед ним и весь веер лучей
  height: 40,   // высота над столом
  fov: 90,      // обзор по ширине, градусы
  near: 4,      // ближе этого к камере ничего не рисуем — иначе точка «за спиной» попадёт на экран
  range: 760,   // дальше этого — туман: видно, куда едешь, а рисовать немного
  smooth: 0.15, // камера догоняет поворот машины за несколько кадров: так не укачивает
  calm: 0.07,   // то же, если в системе просили меньше движения
};

/** Где камера на столе и куда смотрит */
export type Pose = Point & { angle: number };
/**
 * Всё, что нужно для проекции: камера, её оси и экран.
 * focal — сколько пикселей экрана на «шаг вбок на шаг вперёд», cx — середина экрана, horizon — где горизонт
 */
export type View = Pose & { z: number; cos: number; sin: number; focal: number; cx: number; horizon: number; near: number; range: number };
/** Точка в осях камеры: f — вперёд, s — вправо, u — вверх от камеры */
export type CamPoint = { f: number; s: number; u: number };
/** Точка на экране и её глубина f (для сортировки: дальнее рисуем первым) */
export type ScreenPoint = Point & { f: number };

export function viewOf(pose: Pose, { width, height }: { width: number; height: number }): View {
  const focal = width / 2 / Math.tan((CHASE.fov * Math.PI) / 360);
  // Своя машина — у нижнего края, горизонт — где получится: на широком экране выше, на телефоне ниже середины
  const carY = height * 0.82, carDepth = CHASE.back;
  const horizon = Math.max(height * 0.2, Math.min(height * 0.5, carY - (CHASE.height / carDepth) * focal));
  return {
    ...pose, z: CHASE.height, cos: Math.cos(pose.angle), sin: Math.sin(pose.angle),
    focal, cx: width / 2, horizon, near: CHASE.near, range: CHASE.range,
  };
}

/** Точка трассы (x, y на столе, z — высота) → оси камеры. «Вправо» — по ходу машины: y трассы растёт вниз экрана */
export function toCamera(v: View, x: number, y: number, z: number): CamPoint {
  const dx = x - v.x, dy = y - v.y;
  return { f: dx * v.cos + dy * v.sin, s: -dx * v.sin + dy * v.cos, u: z - v.z };
}

/** Точка в осях камеры → экран. Только для точек перед камерой (f ≥ near) */
export const onScreen = (v: View, p: CamPoint): ScreenPoint => ({ x: v.cx + (p.s / p.f) * v.focal, y: v.horizon - (p.u / p.f) * v.focal, f: p.f });

/** Точка трассы → экран, или null, если она позади камеры */
export function project(v: View, x: number, y: number, z: number): ScreenPoint | null {
  const p = toCamera(v, x, y, z);
  return p.f < v.near ? null : onScreen(v, p);
}

/**
 * Многоугольник трассы → экран, обрезанный по ближней плоскости (Сазерленд — Ходжмен для одной плоскости).
 * Без обрезки угол, ушедший за спину камеры, вывернулся бы на экран через бесконечность.
 */
export function clipNear(v: View, pts: readonly (Point & { z: number })[]): ScreenPoint[] {
  const out: ScreenPoint[] = [];
  let prev = toCamera(v, pts[pts.length - 1].x, pts[pts.length - 1].y, pts[pts.length - 1].z);
  for (const q of pts) {
    const cur = toCamera(v, q.x, q.y, q.z);
    const curIn = cur.f >= v.near, prevIn = prev.f >= v.near;
    if (curIn !== prevIn) { // ребро пересекает плоскость — точка пересечения
      const t = (v.near - prev.f) / (cur.f - prev.f);
      out.push(onScreen(v, { f: v.near, s: prev.s + (cur.s - prev.s) * t, u: prev.u + (cur.u - prev.u) * t }));
    }
    if (curIn) out.push(onScreen(v, cur));
    prev = cur;
  }
  return out;
}

/** Угол a − b, приведённый к (−π, π]: поворот на 350° — это поворот на −10° */
const turn = (a: number, b: number): number => Math.atan2(Math.sin(a - b), Math.cos(a - b));

/**
 * Камера за машиной. Поворот машины догоняет плавно; позиция — всегда ровно позади по направлению камеры,
 * поэтому машина в кадре стоит на месте, а на повороте видно, как она «разворачивается» относительно дороги.
 */
export class Chase {
  x = 0; y = 0; angle = 0;
  private last: Point | null = null;

  /** Новый кадр. smooth — какую долю поворота догнать за кадр */
  follow(car: Pose, smooth = CHASE.smooth): void {
    const d = turn(car.angle, this.angle);
    const jumped = !this.last || Math.hypot(car.x - this.last.x, car.y - this.last.y) > 40 || Math.abs(d) > 1.6; // машину поставили на старт
    this.angle = jumped ? car.angle : this.angle + d * smooth;
    this.last = { x: car.x, y: car.y };
    this.x = car.x - Math.cos(this.angle) * CHASE.back;
    this.y = car.y - Math.sin(this.angle) * CHASE.back;
  }
}
