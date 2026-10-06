// Машины в виде сверху (наклонный стол): игрушка с корпусом, кабиной, колёсами и тенью, трафик, стая финала, лучи сенсоров.
// Вид из машины рисует свою машину сам — engine/draw/cockpit/car.ts.
import { CAR, WHEELBASE, wheelAngle, rays, type Car } from '../world/car.ts';
import type { TrafficSpot } from '../world/traffic.ts';
import type { Point } from '../world/track.ts';
import { RISE, lift, local, prism, cap } from '../core/tilt.ts';
import { getPalette, UI_FONT, type Camera, type Palette } from './render.ts';

type Ctx = CanvasRenderingContext2D;
/** Что нужно, чтобы нарисовать машину: где она и (если есть) что делает. Подходит и Car, и запись заезда */
export type CarView = Pick<Car, 'x' | 'y' | 'angle'> & Partial<Pick<Car, 'status' | 'done' | 'controls' | 'steer' | 'speed' | 'rayT' | 'sensors' | 'roll'>>;
/** Машина в стае финала: только место, цвет и прозрачность */
export type PackCar = { x: number; y: number; angle: number; color: string; alpha?: number };

function polyPath(ctx: Ctx, pts: Point[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
}

/** Как рисовать машину: цвет, прозрачность, сенсоры, подпись, рамка выбора, номер на капоте, «призрак» роя */
export type CarLook = {
  color?: string | null; alpha?: number; sensors?: boolean; label?: string | null; highlight?: boolean;
  cam?: Camera | null; number?: number | string | null; ghost?: boolean;
};

const L = CAR.length, W = CAR.width;
/** Высоты деталей машины, px: днище над асфальтом, верх корпуса, крыша кабины */
const Z = { floor: 2, body: 9, roof: 15 };
const GLASS = 'rgb(34 44 58)'; // стекло чуть синее чёрного: видно, что это окно, а не дыра
type Shape = [number, number][];
/** Корпус снизу — восьмиугольник со срезанными углами: литая деталь, а не кирпич */
const BODY: Shape = [[L / 2 - 6, -W / 2], [L / 2, -W / 2 + 5], [L / 2, W / 2 - 5], [L / 2 - 6, W / 2], [-L / 2 + 4, W / 2], [-L / 2, W / 2 - 4], [-L / 2, -W / 2 + 4], [-L / 2 + 4, -W / 2]];
/** Верх корпуса уже низа: бока скошены, и свет ложится на них по-разному — так корпус кажется круглым */
const BODY_TOP: Shape = BODY.map(([x, y]) => [x * 0.95, y * 0.84]);
/** Середина верха — ещё чуть выше и светлее: выпуклый капот */
const CROWN: Shape = BODY.map(([x, y]) => [x * 0.82, y * 0.6]);
const CABIN: Shape = [[L * 0.14, -W * 0.36], [L * 0.14, W * 0.36], [-L * 0.3, W * 0.38], [-L * 0.3, -W * 0.38]];
/** Крыша кабины меньше её низа: лобовое и заднее стекло наклонены, их видно сверху */
const CABIN_TOP: Shape = [[L * 0.02, -W * 0.3], [L * 0.02, W * 0.3], [-L * 0.22, W * 0.32], [-L * 0.22, -W * 0.32]];
const BOX: Shape = [[L / 2, -W / 2], [L / 2, W / 2], [-L / 2, W / 2], [-L / 2, -W / 2]];
/** Колесо: радиус и сколько шины выглядывает из-под корпуса, px. Верх колеса — вровень с корпусом */
const TYRE = { r: 4.6, w: 3.6, y: W / 2 + 1 };
/** Быстрее этого (радиан за тик) спицы уже не видны по отдельности: у трёх спиц предел — шестая часть оборота */
const SPOKE_BLUR = 1.0;
const RUBBER = '#18191d', SIDEWALL = '#2c2e34', RIM = '#cdd2d9', HUB = '#6f7680';

const outline = (car: CarView, shape: Shape, k = 1): Point[] => shape.map(([x, y]) => local(car, x * k, y * k));
const lifted = (pts: Point[], z: number): Point[] => pts.map((q) => lift(q.x, q.y, z));

function area(pts: Point[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s;
}

function fillPoly(ctx: Ctx, pts: Point[], color: string | CanvasGradient): void {
  polyPath(ctx, pts);
  ctx.fillStyle = color; ctx.fill();
}

/** Свет — сверху слева, как у теней трассы. Сколько света ловит сторона с нормалью (nx, ny): от −1 (в тени) до 1 */
const light = (nx: number, ny: number): number => (-nx - ny) / Math.SQRT2;

/** Поверх заливки — белое или чёрное «стекло»: осветлить или затемнить любой цвет, хоть rgb, хоть hex */
function tone(ctx: Ctx, amount: number): void {
  if (Math.abs(amount) < 0.01) return;
  ctx.fillStyle = amount > 0 ? `rgb(255 255 255 / ${amount.toFixed(3)})` : `rgb(0 0 0 / ${(-amount).toFixed(3)})`;
  ctx.fill();
}

/**
 * Боковины «усечённой пирамиды»: низ base на высоте z0, верх top на z1 (те же вершины, верх поуже).
 * Рисуем только стенки, повёрнутые к зрителю — остальные всё равно закроет фигура.
 * Каждая стенка светлее или темнее — по тому, как она смотрит на свет. Возвращает, какие стенки видны.
 */
function shell(ctx: Ctx, base: Point[], top: Point[], z0: number, z1: number, color: string, gloss = 0.3): boolean[] {
  const b = lifted(base, z0), t = lifted(top, z1);
  const face = Math.sign(area(t)), out = Math.sign(area(base));
  const shown: boolean[] = [];
  for (let i = 0; i < base.length; i++) {
    const j = (i + 1) % base.length;
    const quad = [b[i], b[j], t[j], t[i]];
    shown.push(Math.sign(area(quad)) === face);
    if (!shown[i]) continue;
    const ex = base[j].x - base[i].x, ey = base[j].y - base[i].y, len = Math.hypot(ex, ey) || 1;
    const lit = light((ey / len) * out, (-ex / len) * out);
    fillPoly(ctx, quad, color);
    tone(ctx, lit > 0 ? gloss * lit - 0.05 : 0.38 * lit - 0.12); // бок к свету — светлее, от света — в тени
  }
  return shown;
}

/** Мягкая тень под машиной: два овала друг на друге — край светлее середины, без дорогого размытия */
function shadow(ctx: Ctx, car: CarView, k = 1): void {
  ctx.fillStyle = 'rgb(0 0 0 / 0.16)';
  for (const grow of [3, -1]) {
    ctx.beginPath();
    ctx.ellipse(car.x + 2, car.y + 3, L / 2 + grow * k, W / 2 + grow * k, car.angle, 0, Math.PI * 2);
    ctx.fill();
  }
}

/**
 * Колесо стоит ребром, поэтому сверху под наклоном оно — эллипс: круг, растянутый вдоль хода колеса и сжатый по высоте.
 * Путь эллипса строим, сдвинув холст так, что единичный круг ложится на колесо (вперёд — u, вверх — v).
 */
function disc(ctx: Ctx, at: Point, fx: number, fy: number, r: number): void {
  ctx.save();
  ctx.transform(fx * r, fy * r, 0, -RISE * r, at.x, at.y);
  ctx.moveTo(1, 0);
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.restore();
}

/**
 * Колесо целиком: шина-цилиндр (протектор), к зрителю — боковина, на ближних ещё и светлый диск.
 * side — с какого бока машины (−1 или 1), turn — поворот руля, у задних 0.
 */
function wheel(ctx: Ctx, car: CarView, x: number, side: number, turn: number, near: boolean): void {
  const a = car.angle + turn;
  let fx = Math.cos(a);
  const fy = Math.sin(a);
  if (Math.abs(fx) < 0.03) fx = fx < 0 ? -0.03 : 0.03; // колесо точно ребром к нам — почти отрезок; не даём эллипсу схлопнуться
  const nx = -fy, ny = fx; // ось колеса
  const s = ny >= 0 ? 1 : -1; // к зрителю (вниз по экрану) — эта боковина
  const r = TYRE.r, half = TYRE.w / 2;
  const c = local(car, x, side * TYRE.y);
  const front = lift(c.x + s * nx * half, c.y + s * ny * half, r);
  const back = lift(c.x - s * nx * half, c.y - s * ny * half, r);
  // Края протектора: точки эллипса, где его касательная идёт вдоль оси колеса
  const dx = front.x - back.x, dy = front.y - back.y;
  const det = -fx * RISE * r * r;
  const qx = (-RISE * r * dx) / det, qy = (-fy * r * dx + fx * r * dy) / det; // ось колеса в «круговых» координатах
  const ql = Math.hypot(qx, qy) || 1, tx = -qy / ql, ty = qx / ql;
  const ox = fx * r * tx, oy = fy * r * tx - RISE * r * ty;
  ctx.beginPath();
  ctx.moveTo(back.x + ox, back.y + oy); ctx.lineTo(front.x + ox, front.y + oy);
  ctx.lineTo(front.x - ox, front.y - oy); ctx.lineTo(back.x - ox, back.y - oy); ctx.closePath();
  ctx.fillStyle = RUBBER; ctx.fill();
  ctx.beginPath(); disc(ctx, back, fx, fy, r); ctx.fill();
  ctx.beginPath(); disc(ctx, front, fx, fy, r); ctx.fillStyle = SIDEWALL; ctx.fill();
  if (!near) return;
  ctx.beginPath(); disc(ctx, { x: front.x, y: front.y }, fx, fy, r * 0.66); ctx.fillStyle = RIM; ctx.fill();
  spokes(ctx, front, fx, fy, r * 0.66, car);
  ctx.beginPath(); disc(ctx, { x: front.x, y: front.y }, fx, fy, r * 0.24); ctx.fillStyle = HUB; ctx.fill();
}

/**
 * Три спицы диска. Колесо катится без проскальзывания: повернулось на пробег / радиус шины.
 * На большой скорости спицы за кадр поворачиваются почти на треть оборота — глаз видит, будто колесо
 * крутится назад (как в кино). Поэтому быстрые спицы «смазываются» в ровный диск — как у настоящего колеса.
 */
function spokes(ctx: Ctx, at: Point, fx: number, fy: number, r: number, car: CarView): void {
  const step = Math.abs(car.speed ?? 0) / TYRE.r; // на сколько радиан колесо поворачивается за тик
  const sharp = car.done ? 1 : Math.min(1, Math.max(0, (SPOKE_BLUR - step) / 0.45));
  if (sharp <= 0) return;
  const turn = -(car.roll ?? 0) / TYRE.r; // вперёд — верх колеса уходит вперёд
  // точка диска: u — вдоль хода колеса, v — вверх; так же, как в disc()
  const point = (u: number, v: number): Point => ({ x: at.x + fx * r * u, y: at.y + fy * r * u - RISE * r * v });
  ctx.beginPath();
  for (let k = 0; k < 3; k++) {
    const a = turn + (k * 2 * Math.PI) / 3;
    const p = point(Math.cos(a), Math.sin(a));
    ctx.moveTo(at.x, at.y); ctx.lineTo(p.x, p.y);
  }
  ctx.lineWidth = 1.6; ctx.lineCap = 'round';
  ctx.strokeStyle = `rgb(48 52 60 / ${sharp.toFixed(2)})`; ctx.stroke();
  ctx.lineCap = 'butt';
}

/** Колёса одного бока машины: дальние рисуем до корпуса, ближние — после его боков */
function drawWheels(ctx: Ctx, car: CarView, near: boolean): void {
  const turn = car.done ? 0 : wheelAngle(car.steer ?? 0, car.speed ?? 0);
  const lat = Math.cos(car.angle); // куда по экрану смотрит правый бок: вниз (к нам) или вверх
  for (const side of [-1, 1]) {
    if ((side * lat >= 0) !== near) continue;
    wheel(ctx, car, WHEELBASE / 2, side, turn, near); // передняя ось поворачивает
    wheel(ctx, car, -WHEELBASE / 2, side, 0, near);
  }
}

/** Блик сверху слева на плоскости: градиент из светлого в тень — один на машину, его же берёт крыша */
function sheen(ctx: Ctx, at: Point, size: number): CanvasGradient {
  const g = ctx.createLinearGradient(at.x - size, at.y - size, at.x + size, at.y + size);
  g.addColorStop(0, 'rgb(255 255 255 / 0.38)');
  g.addColorStop(0.45, 'rgb(255 255 255 / 0.04)');
  g.addColorStop(1, 'rgb(0 0 0 / 0.22)');
  return g;
}

/** Фара или фонарь — овал на верху корпуса */
function lamp(ctx: Ctx, car: CarView, x: number, y: number, rx: number, ry: number, z: number, color: string): void {
  const c = local(car, x, y), at = lift(c.x, c.y, z);
  ctx.beginPath(); ctx.ellipse(at.x, at.y, rx, ry, car.angle, 0, Math.PI * 2);
  ctx.fillStyle = color; ctx.fill();
}

/** Кабина: стекло по кругу (лобовое с бликом), крыша цвета корпуса, чуть светлее */
function cabin(ctx: Ctx, car: CarView, color: string, gloss: CanvasGradient, roofZ: number): void {
  const base = outline(car, CABIN), top = outline(car, CABIN_TOP);
  const shown = shell(ctx, base, top, Z.body, roofZ, GLASS, 0.45);
  const b = lifted(base, Z.body), t = lifted(top, roofZ);
  if (shown[0]) { // лобовое видно — по нему косая полоска отражения и светлый верхний край
    const at = (p: Point, q: Point, k: number): Point => ({ x: p.x + (q.x - p.x) * k, y: p.y + (q.y - p.y) * k });
    fillPoly(ctx, [at(b[0], b[1], 0.2), at(b[0], b[1], 0.36), at(t[0], t[1], 0.26), at(t[0], t[1], 0.1)], 'rgb(255 255 255 / 0.28)');
    ctx.beginPath(); ctx.moveTo(t[0].x, t[0].y); ctx.lineTo(t[1].x, t[1].y);
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgb(255 255 255 / 0.45)'; ctx.stroke();
  }
  fillPoly(ctx, t, color); tone(ctx, 0.14);
  ctx.fillStyle = gloss; ctx.fill();
}

/**
 * Слот-кар под наклоном: литой корпус с бликом сверху слева, круглые колёса, кабина со стеклом, белый круг под номер.
 * Разбитая — серая. Колёса повёрнуты рулём, при тормозе горят стоп-сигналы — видно, что делает водитель
 */
export function drawCar(ctx: Ctx, car: CarView, { color = null, alpha = 1, sensors = false, label = null, highlight = false, number = null, ghost = false }: CarLook = {}): void {
  const p = getPalette();
  if (ghost) return drawGhost(ctx, car, color ?? p.you, alpha, p);
  if (sensors && !car.done) drawSensors(ctx, car);
  ctx.save();
  ctx.globalAlpha = alpha;
  const body = car.status === 'crashed' ? p.crashed : (color ?? p.you);
  if (highlight) {
    polyPath(ctx, outline(car, BOX, 1.35)); ctx.closePath();
    ctx.lineWidth = 3; ctx.strokeStyle = p.you; ctx.stroke();
  }
  shadow(ctx, car);
  drawWheels(ctx, car, false);
  const base = outline(car, BODY), top = outline(car, BODY_TOP);
  shell(ctx, base, top, Z.floor, Z.body, body);
  // Тёмная кромка по низу: корпус «стоит» на дороге, а не висит над ней
  polyPath(ctx, lifted(base, Z.floor)); ctx.closePath();
  ctx.lineWidth = 1.2; ctx.strokeStyle = 'rgb(0 0 0 / 0.35)'; ctx.stroke();
  drawWheels(ctx, car, true);
  const roof = lifted(top, Z.body);
  fillPoly(ctx, roof, body);
  fillPoly(ctx, lifted(outline(car, CROWN), Z.body + 0.6), 'rgb(255 255 255 / 0.12)'); // выпуклая середина
  const mid = lift(car.x, car.y, Z.body), gloss = sheen(ctx, mid, L * 0.45);
  fillPoly(ctx, roof, gloss);
  const brake = car.done ? 0 : (car.controls?.brake ?? 0);
  for (const y of [-W * 0.29, W * 0.29]) {
    lamp(ctx, car, L * 0.47 - 2.5, y, 1.5, 2.1, Z.body, 'rgb(255 247 214)'); // фары
    lamp(ctx, car, -L * 0.47 + 1.6, y, 1.4, 2.6, Z.body, brake > 0.05 ? `rgb(255 50 40 / ${Math.min(1, 0.4 + brake)})` : 'rgb(120 20 24)'); // стоп-сигналы
    if (brake > 0.05) lamp(ctx, car, -L * 0.47, y, 3.4, 4.2, Z.body, `rgb(255 60 40 / ${(0.3 * Math.min(1, brake)).toFixed(3)})`); // ореол: тормоз видно издалека
  }
  cabin(ctx, car, body, gloss, Z.roof);
  const hood = local(car, L * 0.3, 0), at = lift(hood.x, hood.y, Z.body + 0.6);
  ctx.beginPath(); ctx.arc(at.x, at.y, W * 0.26, 0, Math.PI * 2); ctx.fillStyle = p.kerb2; ctx.fill(); // круг под номер
  ctx.lineWidth = 0.8; ctx.strokeStyle = 'rgb(0 0 0 / 0.25)'; ctx.stroke();
  if (number !== null) {
    ctx.fillStyle = p.checkDark;
    ctx.font = `800 ${Math.round(W * 0.36)}px ${UI_FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(number), at.x, at.y + 1);
  }
  ctx.restore();
  if (label) drawLabel(ctx, label, lift(car.x, car.y, Z.roof + 14), p);
}

/** Подпись над машиной — в пикселях экрана: наклон пола не должен сплющивать буквы */
function drawLabel(ctx: Ctx, label: string, at: Point, p: Palette): void {
  const m = ctx.getTransform();
  const x = m.a * at.x + m.c * at.y + m.e, y = m.b * at.x + m.d * at.y + m.f;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.font = `600 13px ${UI_FONT}`;
  ctx.textAlign = 'center';
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgb(0 0 0 / 0.65)';
  ctx.strokeText(label, x, y);
  ctx.fillStyle = p.kerb2;
  ctx.fillText(label, x, y);
  ctx.restore();
}

/**
 * Машина роя на заднем плане: коробка корпуса, стекло, блик и тёмные бока шин — без теней, дисков и стоп-сигналов.
 * Размытая тень на холсте дорогая, а машин в рое сотня: каждая лишняя заливка здесь умножается на сто.
 */
function drawGhost(ctx: Ctx, car: CarView, color: string, alpha: number, p: Palette): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  const body = car.status === 'crashed' ? p.crashed : color;
  ctx.beginPath(); // все четыре шины — одним путём и одной заливкой
  for (const x of [WHEELBASE / 2, -WHEELBASE / 2]) for (const y of [-TYRE.y, TYRE.y]) {
    const q = lifted(outline(car, [[x + TYRE.r, y - 2], [x + TYRE.r, y + 2], [x - TYRE.r, y + 2], [x - TYRE.r, y - 2]]), TYRE.r);
    q.forEach((v, i) => (i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y)));
    ctx.closePath();
  }
  ctx.fillStyle = RUBBER; ctx.fill();
  prism(ctx, outline(car, BOX), 0, Z.body, body, body);
  cap(ctx, outline(car, CROWN), Z.body, 'rgb(255 255 255 / 0.18)'); // блик на крыше: корпус выпуклый
  cap(ctx, outline(car, CABIN), Z.body, GLASS); // стекло на крыше: видно, куда смотрит
  ctx.restore();
}

/** Много машин сразу, попроще (для финала на сотни участников): [{ x, y, angle, color, alpha }] — бок и крыша, две заливки */
export function drawPack(ctx: Ctx, cars: PackCar[]): void {
  const m = ctx.getTransform(); // камера: масштаб по x (a) и по y (d — пол сжат наклоном), сдвиг, без поворота
  const up = Z.body * RISE * m.d;
  for (const c of cars) {
    const cos = Math.cos(c.angle), sin = Math.sin(c.angle);
    const e = m.a * c.x + m.e, f = m.d * c.y + m.f;
    ctx.globalAlpha = c.alpha ?? 1;
    ctx.setTransform(cos * m.a, sin * m.d, -sin * m.a, cos * m.d, e, f);
    ctx.fillStyle = c.color; ctx.fillRect(-L / 2, -W / 2, L, W);
    ctx.fillStyle = 'rgb(0 0 0 / 0.35)'; ctx.fillRect(-L / 2, -W / 2, L, W); // бок в тени
    ctx.setTransform(cos * m.a, sin * m.d, -sin * m.a, cos * m.d, e, f - up);
    ctx.fillStyle = c.color; ctx.fillRect(-L / 2, -W / 2, L, W);
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(m);
}

const RAYS_Z = 4; // лучи идут от бампера, а не из-под асфальта

export function drawSensors(ctx: Ctx, car: CarView, sensors = car.sensors): void {
  if (!sensors) return; // запись заезда без сенсоров — рисовать нечего
  const p = getPalette();
  const beams = rays(sensors);
  ctx.save();
  ctx.translate(0, -RAYS_Z * RISE);
  ctx.lineWidth = 2;
  for (let i = 0; i < beams.length; i++) {
    const a = car.angle + beams[i].angle, length = beams[i].length;
    const t = car.rayT && car.rayT.length === beams.length ? car.rayT[i] : -1;
    const ex = car.x + Math.cos(a) * length, ey = car.y + Math.sin(a) * length;
    const hx = t < 0 ? ex : car.x + Math.cos(a) * length * t, hy = t < 0 ? ey : car.y + Math.sin(a) * length * t;
    ctx.strokeStyle = p.ray;
    ctx.beginPath(); ctx.moveTo(car.x, car.y); ctx.lineTo(hx, hy); ctx.stroke();
    if (t >= 0) {
      ctx.strokeStyle = p.rayHit;
      ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(ex, ey); ctx.stroke();
      ctx.fillStyle = p.rayHit;
      ctx.beginPath(); ctx.arc(hx, hy, 4, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}


/** Машины трафика — те же игрушки, попроще: попутные серые со стоп-сигналами, встречные светлые с жёлтыми фарами */
export function drawTraffic(ctx: Ctx, traffic: TrafficSpot[] | null | undefined): void {
  if (!traffic) return;
  const p = getPalette();
  for (const o of traffic) {
    const color = o.oncoming ? p.trafficOncoming : p.traffic;
    shadow(ctx, o, 0.6);
    const base = outline(o, BOX), top = outline(o, BOX, 0.9);
    shell(ctx, base, top, 1, Z.body, color);
    // Ближние колёса — тёмные овалы шин: дальние всё равно спрятаны под корпусом
    const lat = Math.cos(o.angle), side = lat >= 0 ? 1 : -1;
    const fx = Math.abs(Math.cos(o.angle)) < 0.03 ? 0.03 : Math.cos(o.angle), fy = Math.sin(o.angle);
    ctx.beginPath();
    for (const x of [WHEELBASE / 2, -WHEELBASE / 2]) {
      const c = local(o, x, side * (W / 2 + 0.5));
      disc(ctx, lift(c.x, c.y, TYRE.r), fx, fy, TYRE.r);
    }
    ctx.fillStyle = SIDEWALL; ctx.fill();
    const roof = lifted(top, Z.body);
    fillPoly(ctx, roof, color);
    fillPoly(ctx, roof, sheen(ctx, lift(o.x, o.y, Z.body), L * 0.45));
    shell(ctx, outline(o, CABIN), outline(o, CABIN_TOP), Z.body, Z.roof - 2, GLASS, 0.45);
    fillPoly(ctx, lifted(outline(o, CABIN_TOP), Z.roof - 2), color); tone(ctx, 0.12);
    const fx2 = o.oncoming ? L * 0.45 - 2 : -L * 0.45 + 1.5; // фары у встречных, стоп-сигналы у попутных
    for (const y of [-W * 0.3, W * 0.3]) lamp(ctx, o, fx2, y, 1.6, 2.6, Z.body, o.oncoming ? p.you : p.kerb);
  }
}
