// Рисование трассы и машин на canvas.
import { CAR, WHEELBASE, wheelAngle, rays, type Car } from './car.ts';
import { pointAt, freeSide, signShows, LANE_WIDTH, type Track, type Road, type Branch, type Island, type Point, type RoadPoint, type Side } from './track.ts';
import type { TrafficSpot } from './traffic.ts';
import { drawScenery } from './scenery-draw.ts';
import { TILT, RISE, lift, local, prism, cap } from './tilt.ts';

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
      const s = Math.min(W / (b.maxX - b.minX + pad * 2), H / ((b.maxY - b.minY + pad * 2) * TILT)); // пол сжат наклоном
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
  /** Наклонный вид: по высоте экрана пол сжат в TILT раз (engine/tilt.ts) */
  apply(ctx: Ctx, canvas: HTMLCanvasElement): void {
    const k = this.scale, ky = this.scale * TILT;
    ctx.setTransform(k, 0, 0, ky, canvas.width / 2 - this.x * k, canvas.height / 2 - this.y * ky);
  }
  /** Пиксель экрана → точка на полу трассы */
  toWorld(canvas: HTMLCanvasElement, px: number, py: number): Point {
    return { x: (px - canvas.width / 2) / this.scale + this.x, y: (py - canvas.height / 2) / (this.scale * TILT) + this.y };
  }
  /** Точка на полу трассы → пиксель экрана */
  toScreen(canvas: HTMLCanvasElement, x: number, y: number): Point {
    return { x: (x - this.x) * this.scale + canvas.width / 2, y: (y - this.y) * this.scale * TILT + canvas.height / 2 };
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

const KERB = 5;     // высота бордюра, px
const SECTION = 150; // длина одной секции игрушечной трассы, px — между швами
const KERB_DASH = 16; // длина красного и белого блока бордюра, px

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
  // Бордюр — низкая стенка: сначала её бок (темнее), потом верх, поднятый на KERB px
  const kw = Math.max(9, 3 * px);
  for (const side of track.walls) {
    polyPath(ctx, side);
    ctx.lineWidth = kw; ctx.strokeStyle = p.kerb; ctx.stroke();
    ctx.setLineDash([KERB_DASH, KERB_DASH]); ctx.strokeStyle = p.kerb2; ctx.stroke();
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgb(0 0 0 / 0.28)'; ctx.stroke();
    ctx.save();
    ctx.translate(0, -KERB * RISE);
    ctx.lineWidth = kw * 0.8; ctx.strokeStyle = p.kerb; ctx.stroke();
    ctx.setLineDash([KERB_DASH, KERB_DASH]); ctx.strokeStyle = p.kerb2; ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }
  drawScenery(ctx, track, cam, p); // после бордюров: кроны у самой обочины чуть «заваливаются» на них, как настоящие
  track.islands.forEach((island, i) => {
    drawSlowZone(ctx, track, island, freeSide(track, i, tick), p);
    drawSign(ctx, track, island.sign, signShows(track, i, tick), Math.max(1, 0.9 * px), p);
  });
  checkered(ctx, pointAt(track, 0), track.width, p); // старт и финиш — одна черта: круг за кругом
}

/**
 * Бесконечная прямая для стенда: дорога «бежит» под стоящей машиной. Своя система координат: дорога вдоль x, середина — y = 0.
 * run — сколько проехали; всё, что повторяется (швы, полоски бордюра), сдвинуто на run, поэтому стыка не видно.
 * half — сколько дороги рисовать в обе стороны от машины, px
 */
export function drawStraight(ctx: Ctx, run: number, half: number, width: number, cam: Camera): void {
  const p = getPalette();
  const px = 1 / cam.scale;
  ctx.fillStyle = 'rgb(0 0 0 / 0.18)'; ctx.fillRect(-half, -width / 2 + 5, half * 2, width); // тень: трасса лежит на столе
  ctx.fillStyle = p.road; ctx.fillRect(-half, -width / 2, half * 2, width);
  for (let x = -half + mod(half - run, SECTION); x < half; x += SECTION) line(ctx, { x, y: 0, angle: 0 }, width, p.seam, Math.max(2, 1.5 * px));
  const lanes = Math.round(width / LANE_WIDTH);
  for (let k = 0; k < lanes; k++) {
    const y = -width / 2 + LANE_WIDTH * (k + 0.5);
    polyPath(ctx, [{ x: -half, y }, { x: half, y }]);
    ctx.lineWidth = Math.max(7, 3 * px); ctx.strokeStyle = p.rail; ctx.stroke();
    ctx.lineWidth = Math.max(3, 1.5 * px); ctx.strokeStyle = p.slot; ctx.stroke();
  }
  const kw = Math.max(9, 3 * px);
  ctx.lineDashOffset = mod(run - half, KERB_DASH * 2); // полоски бордюра едут вместе с дорогой
  for (const y of [-width / 2, width / 2]) {
    // бордюр — низкая стенка: бок (темнее), потом верх, поднятый на KERB px — как в drawTrack
    for (const [up, w, shade] of [[0, kw, true], [KERB * RISE, kw * 0.8, false]] as const) {
      ctx.save();
      ctx.translate(0, -up);
      polyPath(ctx, [{ x: -half, y }, { x: half, y }]);
      ctx.lineWidth = w; ctx.strokeStyle = p.kerb; ctx.stroke();
      ctx.setLineDash([KERB_DASH, KERB_DASH]); ctx.strokeStyle = p.kerb2; ctx.stroke(); ctx.setLineDash([]);
      if (shade) { ctx.strokeStyle = 'rgb(0 0 0 / 0.28)'; ctx.stroke(); }
      ctx.restore();
    }
  }
  ctx.lineDashOffset = 0;
}

/** Остаток от деления, всегда ≥ 0 — для повторяющихся узоров */
const mod = (a: number, n: number): number => ((a % n) + n) % n;

/**
 * Медленная зона — дорожные работы на занятом пути острова: асфальт подкрашен жёлтым, по краям конусы,
 * на въезде и выезде — полосатая лента. Проехать можно, только медленно: поэтому не шлагбаум, а конусы
 */
function drawSlowZone(ctx: Ctx, track: Track, island: Island, free: Side, p: Palette): void {
  const [from, to] = island.zone;
  const onMain = free !== island.side; // занят путь, по которому идёт само кольцо
  const branch = track.roads[island.road] as Branch; // island.road ≥ 1 — второй путь острова
  const at = (s: number): RoadPoint => (onMain ? pointAt(track, s) : pointAt(branch, ((s - branch.fromS) / (branch.toS - branch.fromS)) * branch.total));
  const lane: Point[] = [];
  for (let s = from; s < to; s += 8) lane.push(at(s));
  lane.push(at(to));
  ctx.save();
  ctx.globalAlpha = 0.22;
  polyPath(ctx, lane);
  ctx.lineWidth = track.width - 8; ctx.lineCap = 'butt'; ctx.strokeStyle = p.slow; ctx.stroke();
  ctx.restore();
  for (const s of [from, to]) { // лента: жёлтое с чёрным, как на стройке
    line(ctx, at(s), track.width - 10, p.slow, 6);
    ctx.setLineDash([7, 7]); line(ctx, at(s), track.width - 10, p.checkDark, 6); ctx.setLineDash([]);
  }
  const edge = track.width / 2 - 7;
  for (let s = from; s <= to; s += 36) {
    const pt = at(s), nx = -Math.sin(pt.angle), ny = Math.cos(pt.angle);
    for (const side of [-1, 1]) cone(ctx, pt.x + nx * edge * side, pt.y + ny * edge * side, p);
  }
}

/** Дорожный конус: тень, тёмное основание, жёлтый конус с белым пояском — стоит, а не нарисован */
function cone(ctx: Ctx, x: number, y: number, p: Palette): void {
  ctx.fillStyle = 'rgb(0 0 0 / 0.25)';
  ctx.beginPath(); ctx.arc(x + 2, y + 2, 5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = p.checkDark; ctx.fillRect(x - 5, y - 2, 10, 4);
  const top = lift(x, y, 12);
  ctx.beginPath(); ctx.moveTo(x - 4, y); ctx.lineTo(x + 4, y); ctx.lineTo(top.x, top.y); ctx.closePath();
  ctx.fillStyle = p.slow; ctx.fill();
  const band = lift(x, y, 6);
  ctx.fillStyle = p.kerb2; ctx.fillRect(band.x - 2.4, band.y - 1, 4.8, 2.2);
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

function line(ctx: Ctx, pt: Point & { angle: number }, width: number, color: string, thick: number): void {
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

/** Как рисовать машину: цвет, прозрачность, сенсоры, подпись, рамка выбора, номер на капоте, «призрак» роя */
export type CarLook = {
  color?: string | null; alpha?: number; sensors?: boolean; label?: string | null; highlight?: boolean;
  cam?: Camera | null; number?: number | string | null; ghost?: boolean;
};

const L = CAR.length, W = CAR.width;
/** Высоты деталей машины, px: днище над асфальтом, верх корпуса, крыша кабины, колесо */
const Z = { floor: 2, body: 9, roof: 15, wheel: 8 };
const GLASS = 'rgb(34 44 58)'; // стекло чуть синее чёрного: видно, что это окно, а не дыра
/** Корпус сверху — восьмиугольник со срезанными углами: литая деталь, а не кирпич */
const BODY: [number, number][] = [[L / 2 - 6, -W / 2], [L / 2, -W / 2 + 5], [L / 2, W / 2 - 5], [L / 2 - 6, W / 2], [-L / 2 + 4, W / 2], [-L / 2, W / 2 - 4], [-L / 2, -W / 2 + 4], [-L / 2 + 4, -W / 2]];
const CABIN: [number, number][] = [[L * 0.14, -W * 0.36], [L * 0.14, W * 0.36], [-L * 0.3, W * 0.38], [-L * 0.3, -W * 0.38]];
const BOX: [number, number][] = [[L / 2, -W / 2], [L / 2, W / 2], [-L / 2, W / 2], [-L / 2, -W / 2]];

const outline = (car: CarView, shape: [number, number][], k = 1): Point[] => shape.map(([x, y]) => local(car, x * k, y * k));

/**
 * Слот-кар под наклоном: литой корпус, кабина с тёмным стеклом, белый круг под номер на капоте. Разбитая — серая.
 * Колёса повёрнуты рулём, при тормозе горят стоп-сигналы — видно, что делает водитель
 */
export function drawCar(ctx: Ctx, car: CarView, { color = null, alpha = 1, sensors = false, label = null, highlight = false, number = null, ghost = false }: CarLook = {}): void {
  const p = getPalette();
  if (ghost) return drawGhost(ctx, car, color ?? p.you, alpha, p);
  if (sensors && !car.done) drawSensors(ctx, car);
  ctx.save();
  ctx.globalAlpha = alpha;
  const body = car.status === 'crashed' ? p.crashed : (color ?? p.you);
  if (highlight) {
    ctx.beginPath();
    outline(car, BOX, 1.35).forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
    ctx.closePath();
    ctx.lineWidth = 3; ctx.strokeStyle = p.you; ctx.stroke();
  }
  cap(ctx, outline(car, BODY).map((q) => ({ x: q.x + 2, y: q.y + 3 })), 0, 'rgb(0 0 0 / 0.3)'); // тень на асфальте
  drawWheels(ctx, car);
  prism(ctx, outline(car, BODY), Z.floor, Z.body, body, body);
  const brake = car.controls?.brake ?? 0;
  if (brake > 0.05 && !car.done) { // стоп-сигналы на корме: чем сильнее тормоз, тем ярче
    ctx.fillStyle = `rgb(255 40 40 / ${Math.min(1, 0.25 + brake)})`;
    for (const y of [-W / 2 + 5, W / 2 - 5]) cap(ctx, outline(car, [[-L / 2 + 0.5, y - 3], [-L / 2 + 0.5, y + 3], [-L / 2 + 4, y + 3], [-L / 2 + 4, y - 3]]), Z.body, ctx.fillStyle);
  }
  prism(ctx, outline(car, CABIN), Z.body, Z.roof, body, GLASS); // кабина: стекло по кругу, крыша цвета корпуса
  const hood = local(car, L * 0.3, 0), at = lift(hood.x, hood.y, Z.body);
  ctx.beginPath(); ctx.arc(at.x, at.y, W * 0.26, 0, Math.PI * 2); ctx.fillStyle = p.kerb2; ctx.fill(); // круг под номер
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
 * Машина роя на заднем плане: коробка корпуса и стекло, без теней, колёс и стоп-сигналов.
 * Размытая тень на холсте дорогая, а машин в рое сотня: с тенями кадр в начале поколения рисуется в разы дольше.
 */
function drawGhost(ctx: Ctx, car: CarView, color: string, alpha: number, p: Palette): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  const body = car.status === 'crashed' ? p.crashed : color;
  prism(ctx, outline(car, BOX), 0, Z.body, body, body);
  cap(ctx, outline(car, CABIN), Z.body, GLASS); // стекло на крыше: видно, куда смотрит
  ctx.restore();
}

/** Колёса торчат из-под корпуса; передние показывают, куда повёрнут руль */
function drawWheels(ctx: Ctx, car: CarView): void {
  const turn = car.done ? 0 : wheelAngle(car.steer ?? 0, car.speed ?? 0);
  const axles: [number, number][] = [[WHEELBASE / 2, turn], [-WHEELBASE / 2, 0]]; // передняя ось поворачивает, задняя нет
  for (const [x, a] of axles) {
    for (const y of [-W / 2 + 1, W / 2 - 1]) { // чуть наружу из-под корпуса — поворот видно
      const c = Math.cos(a), s = Math.sin(a);
      const tyre = ([[6, -3.5], [6, 3.5], [-6, 3.5], [-6, -3.5]] as const).map(([u, v]) => local(car, x + u * c - v * s, y + u * s + v * c));
      prism(ctx, tyre, 0, Z.wheel, '#2a2b2f', '#16171a');
    }
  }
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

export function clear(ctx: Ctx, canvas: HTMLCanvasElement): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = getPalette().board;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

/** Машины трафика — игрушечные коробочки: попутные серые со стоп-сигналами, встречные светлые с жёлтыми фарами */
export function drawTraffic(ctx: Ctx, traffic: TrafficSpot[] | null | undefined): void {
  if (!traffic) return;
  const p = getPalette();
  for (const o of traffic) {
    const color = o.oncoming ? p.trafficOncoming : p.traffic;
    cap(ctx, outline(o, BOX).map((q) => ({ x: q.x + 2, y: q.y + 3 })), 0, 'rgb(0 0 0 / 0.25)');
    prism(ctx, outline(o, BOX), 1, Z.body, color, color);
    prism(ctx, outline(o, CABIN), Z.body, Z.roof - 2, color, GLASS);
    const fx = o.oncoming ? L / 2 - 3 : -L / 2 + 0.5; // фары у встречных, стоп-сигналы у попутных
    for (const y of [-W / 2 + 2, W / 2 - 7]) cap(ctx, outline(o, [[fx, y], [fx, y + 5], [fx + 3, y + 5], [fx + 3, y]]), Z.body, o.oncoming ? p.you : p.kerb);
  }
}
