// Рисование трассы и машин на canvas.
import { CAR, WHEELBASE, wheelAngle, rays, type Car } from './car.ts';
import { pointAt, freeSide, signShows, type Track, type Road, type Branch, type Island, type Point, type RoadPoint, type Side } from './track.ts';
import type { TrafficSpot } from './traffic.ts';
import { drawScenery } from './scenery-draw.ts';

type Ctx = CanvasRenderingContext2D;
/** Что нужно, чтобы нарисовать машину: где она и (если есть) что делает. Подходит и Car, и запись заезда */
export type CarView = Pick<Car, 'x' | 'y' | 'angle'> & Partial<Pick<Car, 'status' | 'done' | 'controls' | 'steer' | 'speed' | 'rayT' | 'sensors'>>;
/** Машина в стае финала: только место, цвет и прозрачность */
export type PackCar = { x: number; y: number; angle: number; color: string; alpha?: number };

/**
 * Цвет из CSS-переменной — готовый для canvas.
 * Сама переменная может быть «light-dark(светлый, тёмный)»: canvas такое не понимает,
 * поэтому просим браузер вычислить цвет на невидимом элементе — он учтёт текущую тему.
 */
let probe: HTMLElement | null = null;
export function cssColor(name: string): string {
  probe ??= document.documentElement.appendChild(Object.assign(document.createElement('i'), { hidden: true }));
  probe.style.color = `var(${name})`;
  return getComputedStyle(probe).color;
}

/** Цвета холста — из CSS-переменных, для текущей темы */
export type Palette = Record<'board' | 'road' | 'roadEdge' | 'seam' | 'slot' | 'rail' | 'kerb' | 'kerb2' | 'sign' | 'signOff' | 'slow' | 'checkLight' | 'checkDark' | 'you' | 'ray' | 'rayHit' | 'traffic' | 'trafficOncoming' | 'trafficEdge' | 'crashed' | 'tree' | 'tree2' | 'house' | 'roof' | 'roof2', string>;

let palette: Palette | null = null;
/** Перечитать цвета трассы — после смены темы */
export function readPalette(): Palette {
  const v = cssColor;
  palette = {
    board: v('--board'), road: v('--road'), roadEdge: v('--road-edge'), seam: v('--seam'), slot: v('--slot'), rail: v('--rail'),
    kerb: v('--kerb'), kerb2: v('--kerb-2'), sign: v('--sign'), signOff: v('--sign-off'), slow: v('--slow'), checkLight: v('--check-light'), checkDark: v('--check-dark'),
    you: v('--you'), ray: v('--ray'), rayHit: v('--ray-hit'),
    traffic: v('--traffic'), trafficOncoming: v('--traffic-oncoming'), trafficEdge: v('--traffic-edge'), crashed: v('--crashed'),
    tree: v('--tree'), tree2: v('--tree-2'), house: v('--house'), roof: v('--roof'), roof2: v('--roof-2'),
  };
  return palette;
}
export const getPalette = (): Palette => palette || readPalette();

/** Шрифт подписей на холсте — тот же, что у интерфейса */
export const UI_FONT = '"Rubik", system-ui, sans-serif';

/** Подогнать размер canvas под CSS-размер size = { width, height } с учётом плотности пикселей */
export function fitCanvas(canvas: HTMLCanvasElement, size: { width: number; height: number }): number {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(size.width * dpr), h = Math.round(size.height * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  return dpr;
}

export class Camera {
  x = 0; y = 0; scale = 1;
  /** 'fit' — вся трасса целиком, иначе ('follow') — крупно за машиной */
  mode = 'fit';
  ready = false;
  update(canvas: HTMLCanvasElement, track: Track, target: (Point & { angle?: number }) | null | undefined, dpr: number): void {
    const W = canvas.width, H = canvas.height;
    if (this.mode === 'fit' || !target) {
      const b = track.bbox, pad = 40;
      const s = Math.min(W / (b.maxX - b.minX + pad * 2), H / (b.maxY - b.minY + pad * 2));
      this.scale = s; this.x = (b.minX + b.maxX) / 2; this.y = (b.minY + b.maxY) / 2; this.ready = true;
    } else {
      const s = dpr * (W / dpr < 520 ? 0.95 : 1.4); // крупный план: секции трассы заполняют полотно
      // Смотрим вперёд по ходу: водителю важна дорога впереди, а не позади
      const lead = (0.25 * Math.min(W, H)) / s;
      const aim = { x: target.x + Math.cos(target.angle ?? 0) * lead, y: target.y + Math.sin(target.angle ?? 0) * lead };
      if (!this.ready || Math.abs(this.scale - s) > 0.5) { this.x = aim.x; this.y = aim.y; }
      this.scale = s;
      this.x += (aim.x - this.x) * 0.15;
      this.y += (aim.y - this.y) * 0.15;
      this.ready = true;
    }
  }
  apply(ctx: Ctx, canvas: HTMLCanvasElement): void {
    ctx.setTransform(this.scale, 0, 0, this.scale, canvas.width / 2 - this.x * this.scale, canvas.height / 2 - this.y * this.scale);
  }
  toWorld(canvas: HTMLCanvasElement, px: number, py: number): Point {
    return { x: (px - canvas.width / 2) / this.scale + this.x, y: (py - canvas.height / 2) / this.scale + this.y };
  }
}

function polyPath(ctx: Ctx, pts: Point[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
}

/** Центры полос: по ним идут прорези с рельсами (как у трассы для слот-каров) */
const laneCenters = new WeakMap<Road, Point[][]>();
function lanesOf(road: Road): Point[][] {
  let lanes = laneCenters.get(road);
  if (!lanes) {
    const edges = [road.left, ...road.dividers, road.right];
    lanes = [];
    for (let k = 0; k < edges.length - 1; k++) {
      lanes.push(edges[k].map((a, i) => ({ x: (a.x + edges[k + 1][i].x) / 2, y: (a.y + edges[k + 1][i].y) / 2 })));
    }
    laneCenters.set(road, lanes);
  }
  return lanes;
}

/** Контур дороги одним путём: левый край туда, правый обратно */
function roadPath(ctx: Ctx, { left, right }: Road): void {
  ctx.beginPath();
  ctx.moveTo(left[0].x, left[0].y);
  for (let i = 1; i < left.length; i++) ctx.lineTo(left[i].x, left[i].y);
  for (let i = right.length - 1; i >= 0; i--) ctx.lineTo(right[i].x, right[i].y);
  ctx.closePath();
}

const SECTION = 150; // длина одной секции игрушечной трассы, px — между швами

/**
 * Игрушечная трасса: серые секции со швами, прорези с медными рельсами, пластиковые бордюры.
 * tick — тик заезда: от него зависит, где на островах медленная зона и что горит на знаке.
 */
export function drawTrack(ctx: Ctx, track: Track, cam: Camera, tick = 0): void {
  const p = getPalette();
  const px = 1 / cam.scale;
  const roads = track.roads;
  // тень: трасса лежит на столе
  ctx.save();
  ctx.translate(0, 5);
  ctx.fillStyle = 'rgb(0 0 0 / 0.18)';
  for (const road of roads) { roadPath(ctx, road); ctx.fill(); }
  ctx.restore();
  ctx.fillStyle = p.road;
  for (const road of roads) { roadPath(ctx, road); ctx.fill(); }
  for (const road of roads) {
    // швы между секциями
    for (let s = SECTION; s < road.total; s += SECTION) line(ctx, pointAt(road, s), track.width, p.seam, Math.max(2, 1.5 * px));
    // прорези: медные рельсы, между ними тёмная щель
    for (const lane of lanesOf(road)) {
      polyPath(ctx, lane);
      ctx.lineWidth = Math.max(7, 3 * px); ctx.strokeStyle = p.rail; ctx.stroke();
      ctx.lineWidth = Math.max(3, 1.5 * px); ctx.strokeStyle = p.slot; ctx.stroke();
    }
  }
  // бордюры: красные и белые пластиковые блоки. На развилках и перекрёстках их нет — там проезд
  const kw = Math.max(9, 3 * px);
  for (const side of track.walls) {
    ctx.lineWidth = kw; ctx.strokeStyle = p.kerb; polyPath(ctx, side); ctx.stroke();
    ctx.setLineDash([16, 16]); ctx.strokeStyle = p.kerb2; ctx.stroke();
    ctx.setLineDash([]);
  }
  drawScenery(ctx, track, cam, p); // после бордюров: кроны у самой обочины чуть «заваливаются» на них, как настоящие
  track.islands.forEach((island, i) => {
    drawSlowZone(ctx, track, island, freeSide(track, i, tick), p);
    drawSign(ctx, track, island.sign, signShows(track, i, tick), Math.max(1, 0.9 * px), p);
  });
  checkered(ctx, pointAt(track, 0), track.width, p); // старт и финиш — одна черта: круг за кругом
}

/** Медленная зона — поперечные полосы на занятом пути острова, как на дорожных работах */
function drawSlowZone(ctx: Ctx, track: Track, island: Island, free: Side, p: Palette): void {
  const [from, to] = island.zone;
  const onMain = free !== island.side; // занят путь, по которому идёт само кольцо
  const branch = track.roads[island.road] as Branch; // island.road ≥ 1 — второй путь острова
  const at = (s: number): RoadPoint => (onMain ? pointAt(track, s) : pointAt(branch, ((s - branch.fromS) / (branch.toS - branch.fromS)) * branch.total));
  for (let s = from; s <= to; s += 22) line(ctx, at(s), track.width - 14, p.slow, 9);
}

/**
 * Дорожный знак у обочины: синий круг с белой стрелкой — «свободно направо» или «налево». dir 0 — знак погас.
 * size — во сколько раз крупнее: когда видна вся трасса, знак рисуем больше, иначе стрелку не разглядеть
 */
function drawSign(ctx: Ctx, track: Track, { x, y, angle }: RoadPoint, dir: Side | 0, size: number, p: Palette): void {
  const r = 17, off = track.width / 2 + 9 + r * size;
  const cx = x - Math.sin(angle) * off, cy = y + Math.cos(angle) * off; // справа по ходу, как у настоящей дороги
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(size, size);
  ctx.beginPath(); ctx.arc(0, 0, r + 2.5, 0, Math.PI * 2); ctx.fillStyle = p.kerb2; ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fillStyle = dir ? p.sign : p.signOff; ctx.fill();
  if (!dir) { ctx.restore(); return; }
  ctx.rotate(angle); // стрелка — относительно направления езды
  ctx.strokeStyle = p.kerb2; ctx.fillStyle = p.kerb2; ctx.lineWidth = 4; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(-9, 0); ctx.lineTo(2, 0); ctx.lineTo(2, dir * 7); ctx.stroke(); // прямо, потом поворот
  ctx.beginPath(); ctx.moveTo(-4, dir * 5); ctx.lineTo(8, dir * 5); ctx.lineTo(2, dir * 13); ctx.closePath(); ctx.fill();
  ctx.restore();
}

function line(ctx: Ctx, pt: RoadPoint, width: number, color: string, thick: number): void {
  const nx = -Math.sin(pt.angle), ny = Math.cos(pt.angle);
  ctx.beginPath();
  ctx.moveTo(pt.x - nx * width / 2, pt.y - ny * width / 2);
  ctx.lineTo(pt.x + nx * width / 2, pt.y + ny * width / 2);
  ctx.lineWidth = thick; ctx.strokeStyle = color; ctx.stroke();
}

function checkered(ctx: Ctx, pt: RoadPoint, width: number, p: Palette): void {
  ctx.save();
  ctx.translate(pt.x, pt.y);
  ctx.rotate(pt.angle);
  const sq = 10, rows = 2, cols = Math.round(width / sq);
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    ctx.fillStyle = (r + c) % 2 ? p.checkDark : p.checkLight;
    ctx.fillRect(r * sq - sq, -width / 2 + c * (width / cols), sq, width / cols);
  }
  ctx.restore();
}

/** Слот-кар: литой корпус, тёмное стекло, белый круг под номер на капоте. Разбитая — серая. */
/** Машинка сверху: колёса повёрнуты рулём, при тормозе горят стоп-сигналы — видно, что делает водитель */
/** Как рисовать машину: цвет, прозрачность, сенсоры, подпись, рамка выбора, номер на капоте, «призрак» роя */
export type CarLook = {
  color?: string | null; alpha?: number; sensors?: boolean; label?: string | null; highlight?: boolean;
  cam?: Camera | null; number?: number | string | null; ghost?: boolean;
};

export function drawCar(ctx: Ctx, car: CarView, { color = null, alpha = 1, sensors = false, label = null, highlight = false, cam = null, number = null, ghost = false }: CarLook = {}): void {
  const p = getPalette();
  if (ghost) return drawGhost(ctx, car, color ?? p.you, alpha, p);
  if (sensors && !car.done) drawSensors(ctx, car);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  const L = CAR.length, W = CAR.width;
  const body = car.status === 'crashed' ? p.crashed : (color ?? p.you);
  if (highlight) {
    ctx.lineWidth = 3 / (cam?.scale || 1) + 2;
    ctx.strokeStyle = p.you;
    roundRect(ctx, -L / 2 - 5, -W / 2 - 5, L + 10, W + 10, 8); ctx.stroke();
  }
  drawWheels(ctx, car, L, W);
  // тень под машинкой — она стоит на трассе
  ctx.shadowColor = 'rgb(0 0 0 / 0.35)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3;
  ctx.fillStyle = body;
  roundRect(ctx, -L / 2, -W / 2, L, W, 7); ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgb(0 0 0 / 0.35)'; ctx.stroke();
  ctx.fillStyle = 'rgb(0 0 0 / 0.55)';
  roundRect(ctx, L * 0.04, -W / 2 + 3, L * 0.22, W - 6, 3); ctx.fill(); // лобовое стекло
  ctx.fillStyle = p.kerb2;
  ctx.beginPath(); ctx.arc(-L * 0.2, 0, W * 0.3, 0, Math.PI * 2); ctx.fill(); // круг под номер
  const brake = car.controls?.brake ?? 0;
  if (brake > 0.05 && !car.done) { // стоп-сигналы: чем сильнее тормоз, тем ярче
    ctx.fillStyle = `rgb(255 40 40 / ${Math.min(1, 0.25 + brake)})`;
    ctx.shadowColor = 'rgb(255 40 40 / 0.8)'; ctx.shadowBlur = 8 * brake;
    roundRect(ctx, -L / 2 - 1, -W / 2 + 2, 4, 6, 1.5); ctx.fill();
    roundRect(ctx, -L / 2 - 1, W / 2 - 8, 4, 6, 1.5); ctx.fill();
    ctx.shadowColor = 'transparent';
  }
  if (number !== null) {
    ctx.translate(-L * 0.2, 0); // номер стоит ровно, когда машина едет вправо — как на старте
    ctx.fillStyle = p.checkDark;
    ctx.font = `800 ${Math.round(W * 0.42)}px ${UI_FONT}`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(String(number), 0, 1);
  }
  ctx.restore();
  if (label) {
    ctx.save();
    const s = 1 / (cam?.scale || 1);
    ctx.font = `600 ${Math.round(13 * s)}px ${UI_FONT}`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3 * s; ctx.strokeStyle = 'rgb(0 0 0 / 0.65)';
    ctx.strokeText(label, car.x, car.y - 30 * Math.max(1, s * 0.8));
    ctx.fillStyle = p.kerb2;
    ctx.fillText(label, car.x, car.y - 30 * Math.max(1, s * 0.8));
    ctx.restore();
  }
}

/**
 * Машина роя на заднем плане: только корпус и стекло, без теней, колёс и стоп-сигналов.
 * Размытая тень на холсте дорогая, а машин в рое сотня: с тенями кадр в начале поколения рисуется в разы дольше.
 */
function drawGhost(ctx: Ctx, car: CarView, color: string, alpha: number, p: Palette): void {
  const L = CAR.length, W = CAR.width;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(car.x, car.y);
  ctx.rotate(car.angle);
  ctx.fillStyle = car.status === 'crashed' ? p.crashed : color;
  roundRect(ctx, -L / 2, -W / 2, L, W, 7); ctx.fill();
  ctx.fillStyle = 'rgb(0 0 0 / 0.55)';
  ctx.fillRect(L * 0.04, -W / 2 + 3, L * 0.22, W - 6); // лобовое стекло: видно, куда смотрит
  ctx.restore();
}

/** Колёса торчат из-под корпуса; передние показывают, куда повёрнут руль */
function drawWheels(ctx: Ctx, car: CarView, L: number, W: number): void {
  const turn = car.done ? 0 : wheelAngle(car.steer ?? 0, car.speed ?? 0);
  ctx.fillStyle = '#16171a';
  const axles: [number, number][] = [[WHEELBASE / 2, turn], [-WHEELBASE / 2, 0]]; // передняя ось поворачивает, задняя нет
  for (const [x, a] of axles) {
    for (const y of [-W / 2 - 1, W / 2 + 1]) { // чуть наружу из-под корпуса — поворот видно
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      roundRect(ctx, -6, -3, 12, 6, 2); ctx.fill();
      ctx.restore();
    }
  }
}

/** Много машин сразу, попроще (для финала на сотни участников): [{ x, y, angle, color, alpha }] */
export function drawPack(ctx: Ctx, cars: PackCar[]): void {
  const L = CAR.length, W = CAR.width;
  const m = ctx.getTransform(); // камера: масштаб k и сдвиг, без поворота
  const k = m.a;
  for (const c of cars) {
    const cos = Math.cos(c.angle) * k, sin = Math.sin(c.angle) * k;
    ctx.globalAlpha = c.alpha ?? 1;
    ctx.fillStyle = c.color;
    ctx.setTransform(cos, sin, -sin, cos, k * c.x + m.e, k * c.y + m.f);
    ctx.fillRect(-L / 2, -W / 2, L, W);
  }
  ctx.globalAlpha = 1;
  ctx.setTransform(m);
}

export function drawSensors(ctx: Ctx, car: CarView, sensors = car.sensors): void {
  if (!sensors) return; // запись заезда без сенсоров — рисовать нечего
  const p = getPalette();
  const beams = rays(sensors);
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
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function clear(ctx: Ctx, canvas: HTMLCanvasElement): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = getPalette().board;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

/** Машины трафика — игрушечные: попутные серые со стоп-сигналами, встречные светлые с жёлтыми фарами */
export function drawTraffic(ctx: Ctx, traffic: TrafficSpot[] | null | undefined): void {
  if (!traffic) return;
  const p = getPalette();
  const L = CAR.length, W = CAR.width;
  for (const o of traffic) {
    ctx.save();
    ctx.translate(o.x, o.y);
    ctx.rotate(o.angle);
    ctx.shadowColor = 'rgb(0 0 0 / 0.3)'; ctx.shadowBlur = 5; ctx.shadowOffsetY = 3;
    ctx.fillStyle = o.oncoming ? p.trafficOncoming : p.traffic;
    roundRect(ctx, -L / 2, -W / 2, L, W, 6); ctx.fill();
    ctx.shadowColor = 'transparent';
    ctx.lineWidth = 2; ctx.strokeStyle = p.trafficEdge; ctx.stroke();
    ctx.fillStyle = 'rgb(0 0 0 / 0.5)';
    roundRect(ctx, L * 0.02, -W / 2 + 4, L * 0.22, W - 8, 3); ctx.fill();
    ctx.fillStyle = o.oncoming ? p.you : p.kerb; // фары у встречных, стоп-сигналы у попутных
    const fx = o.oncoming ? L / 2 - 3 : -L / 2 + 1;
    ctx.fillRect(fx, -W / 2 + 2, 3, 5); ctx.fillRect(fx, W / 2 - 7, 3, 5);
    ctx.restore();
  }
}
