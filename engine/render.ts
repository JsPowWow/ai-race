// Рисование трассы на canvas: цвета темы, камера, асфальт, бордюры, острова, старт. Машины — engine/car-draw.ts.
import { pointAt, freeSide, signShows, worksSigns, SLOW_SPEED, LANE_WIDTH, type Track, type Road, type Branch, type Island, type Point, type RoadPoint, type Side } from './track.ts';
import { drawScenery, drawBlades, startLights } from './scenery-draw.ts';
import { pasteGround, type View } from './track-cache.ts';
import { TILT, RISE, lift } from './tilt.ts';
import { mulberry32 } from './utils.ts';

type Ctx = CanvasRenderingContext2D;

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
export type Palette = Record<'board' | 'road' | 'roadEdge' | 'seam' | 'marking' | 'kerb' | 'kerb2' | 'sign' | 'signOff' | 'slow' | 'checkLight' | 'checkDark' | 'you' | 'ray' | 'rayHit' | 'traffic' | 'trafficOncoming' | 'trafficEdge' | 'crashed' | 'tree' | 'tree2' | 'house' | 'roof' | 'roof2' | 'panel' | 'window' | 'sky' | 'sky2', string> & DecorPalette;
/** Цвета остального декора: паддок, трибуны, зрители и цветы, шины, щиты, вода, кусты, фонари */
type DecorPalette = Record<'pad' | 'stand' | 'crowd1' | 'crowd2' | 'crowd3' | 'crowd4' | 'tire' | 'bill' | 'billInk' | 'lightOff' | 'water' | 'waterEdge' | 'bush' | 'soil' | 'lamp', string>;

let palette: Palette | null = null;
/** Перечитать цвета трассы — после смены темы */
export function readPalette(): Palette {
  const v = cssColor;
  palette = {
    board: v('--board'), road: v('--road'), roadEdge: v('--road-edge'), seam: v('--seam'), marking: v('--marking'),
    kerb: v('--kerb'), kerb2: v('--kerb-2'), sign: v('--sign'), signOff: v('--sign-off'), slow: v('--slow'), checkLight: v('--check-light'), checkDark: v('--check-dark'),
    you: v('--you'), ray: v('--ray'), rayHit: v('--ray-hit'),
    traffic: v('--traffic'), trafficOncoming: v('--traffic-oncoming'), trafficEdge: v('--traffic-edge'), crashed: v('--crashed'),
    tree: v('--tree'), tree2: v('--tree-2'), house: v('--house'), roof: v('--roof'), roof2: v('--roof-2'), panel: v('--panel'), window: v('--window'), sky: v('--sky'), sky2: v('--sky-2'),
    pad: v('--pad'), stand: v('--stand'), crowd1: v('--crowd-1'), crowd2: v('--crowd-2'), crowd3: v('--crowd-3'), crowd4: v('--crowd-4'), tire: v('--tire'), bill: v('--bill'), billInk: v('--bill-ink'),
    lightOff: v('--light-off'), water: v('--water'), waterEdge: v('--water-edge'), bush: v('--bush'), soil: v('--soil'), lamp: v('--lamp'),
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
  apply(ctx: Ctx, canvas: { width: number; height: number }): void {
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

/** Сплошные линии края: чуть внутри от обочины, как на настоящей дороге */
const EDGE_INSET = 12;
const edgeLines = new WeakMap<Road, Point[][]>();
function edgesOf(road: Road, width: number): Point[][] {
  let edges = edgeLines.get(road);
  if (!edges) {
    const t = EDGE_INSET / width;
    const towards = (from: Point[], to: Point[]): Point[] => from.map((a, i) => ({ x: a.x + (to[i].x - a.x) * t, y: a.y + (to[i].y - a.y) * t }));
    edges = [towards(road.left, road.right), towards(road.right, road.left)];
    edgeLines.set(road, edges);
  }
  return edges;
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
const DASH = [20, 28]; // пунктир между полосами: штрих и просвет, px. Вместе 48 — делит круг стенда (2400), стыка не видно

/**
 * Игрушечная трасса: серые секции со швами, разметка на три полосы, пластиковые бордюры.
 * tick — тик заезда: от него зависит, где на островах медленная зона и что горит на знаке.
 */
export function drawTrack(ctx: Ctx, track: Track, cam: Camera, tick = 0): void {
  const p = getPalette();
  // неподвижное — из кэша (лопасти ветряков тогда отдельно, поверх); нет кэша — всё сразу
  const look = { track, palette: p, lights: startLights() };
  if (pasteGround(ctx, cam, look, (g, view) => drawGround(g, track, view, p, null))) drawBlades(ctx, track, cam, p, tick);
  else drawGround(ctx, track, cam, p, tick);
  const px = 1 / cam.scale;
  track.islands.forEach((island, i) => {
    drawSlowZone(ctx, track, island, freeSide(track, i, tick), p);
    const size = Math.min(1.8, Math.max(1, 0.9 * px));
    drawSign(ctx, track, island.sign, signShows(track, i, tick), size, p);
    drawWorksSign(ctx, worksSigns(track, i)[freeSide(track, i, tick) !== island.side ? 0 : 1], size, p);
  });
  checkered(ctx, pointAt(track, 0), track.width, p); // старт и финиш — одна черта: круг за кругом
}

/** Всё, что от тика не зависит: асфальт, разметка, бордюры, декор. tick = null — декор без лопастей ветряков */
function drawGround(ctx: Ctx, track: Track, cam: View, p: Palette, tick: number | null): void {
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
  const grain = asphalt(ctx, cam.scale);
  if (grain) {
    grain.setTransform(new DOMMatrix()); // зерно лежит на трассе и едет вместе с ней
    ctx.fillStyle = grain;
    for (const road of roads) { roadPath(ctx, road); ctx.fill(); }
    ctx.globalAlpha = 1;
  }
  for (const road of roads) {
    // швы между секциями
    for (let s = SECTION; s < road.total; s += SECTION) line(ctx, pointAt(road, s), track.width, p.seam, Math.max(2, 1.5 * px));
    // разметка: пунктир между полосами, сплошные у края. Боты едут посередине полос
    ctx.strokeStyle = p.marking;
    ctx.lineWidth = Math.max(2.5, 1.2 * px);
    ctx.setLineDash(DASH);
    for (const divider of road.dividers) { polyPath(ctx, divider); ctx.stroke(); }
    ctx.setLineDash([]);
    for (const edge of edgesOf(road, track.width)) { polyPath(ctx, edge); ctx.stroke(); }
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
  drawScenery(ctx, track, cam, p, tick); // после бордюров: кроны у самой обочины чуть «заваливаются» на них, как настоящие
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
  const grain = asphalt(ctx, cam.scale);
  if (grain) {
    grain.setTransform(new DOMMatrix().translateSelf(-mod(run, GRAIN), 0)); // зерно бежит вместе с дорогой: так видно, что едем
    ctx.fillStyle = grain; ctx.fillRect(-half, -width / 2, half * 2, width);
    ctx.globalAlpha = 1;
  }
  for (let x = -half + mod(half - run, SECTION); x < half; x += SECTION) line(ctx, { x, y: 0, angle: 0 }, width, p.seam, Math.max(2, 1.5 * px));
  // разметка как в drawTrack: пунктир едет вместе с дорогой, сплошные у края
  ctx.strokeStyle = p.marking;
  ctx.lineWidth = Math.max(2.5, 1.2 * px);
  ctx.setLineDash(DASH);
  ctx.lineDashOffset = mod(run - half, DASH[0] + DASH[1]);
  const lanes = Math.round(width / LANE_WIDTH);
  for (let k = 1; k < lanes; k++) {
    const y = -width / 2 + LANE_WIDTH * k;
    polyPath(ctx, [{ x: -half, y }, { x: half, y }]); ctx.stroke();
  }
  ctx.setLineDash([]); ctx.lineDashOffset = 0;
  for (const y of [-width / 2 + EDGE_INSET, width / 2 - EDGE_INSET]) { polyPath(ctx, [{ x: -half, y }, { x: half, y }]); ctx.stroke(); }
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

/** Сторона плитки зерна асфальта, px. 2400 (повтор стенда) делится на неё нацело */
const GRAIN = 96;
let grainTile: CanvasImageSource | null = null;
const grainPatterns = new WeakMap<Ctx, CanvasPattern>(); // узор привязан к своему холсту

/**
 * Зерно асфальта: светлые и тёмные крапинки и редкие камешки поверх серого — на нём видно, что машина едет, а не парит.
 * Плитка рисуется один раз (из seed — на всех компьютерах одинаково), дальше холст повторяет её сам.
 * Возвращает узор и ставит прозрачность; издалека (вся трасса в кадре) зерно сливается в рябь — тогда null.
 */
function asphalt(ctx: Ctx, scale: number): CanvasPattern | null {
  const strength = Math.min(1, (scale - 0.5) / 0.5);
  if (strength <= 0 || !ctx.canvas.width || !ctx.canvas.height) return null; // спрятанный холст нулевой: узор на нём не создать
  grainTile ??= grainCanvas();
  let pattern = grainPatterns.get(ctx);
  if (!pattern) {
    pattern = ctx.createPattern(grainTile, 'repeat') ?? undefined;
    if (!pattern) return null;
    grainPatterns.set(ctx, pattern);
  }
  ctx.globalAlpha = strength;
  return pattern;
}

function grainCanvas(): CanvasImageSource {
  const canvas = typeof OffscreenCanvas === 'function' ? new OffscreenCanvas(GRAIN, GRAIN) : Object.assign(document.createElement('canvas'), { width: GRAIN, height: GRAIN });
  const g = canvas.getContext('2d') as Ctx | null;
  if (!g) return canvas;
  const rand = mulberry32(20261006);
  // крапинка у края плитки дорисовывается и с другой стороны: на стыке плиток шва нет
  const dot = (x: number, y: number, r: number): void => {
    for (const dx of [-GRAIN, 0, GRAIN]) for (const dy of [-GRAIN, 0, GRAIN]) {
      g.moveTo(x + dx + r, y + dy);
      g.arc(x + dx, y + dy, r, 0, Math.PI * 2);
    }
  };
  for (const [count, size, color] of [[520, 0.55, 'rgb(255 255 255 / 0.10)'], [520, 0.6, 'rgb(0 0 0 / 0.16)'], [40, 1.2, 'rgb(255 255 255 / 0.09)'], [30, 1.4, 'rgb(0 0 0 / 0.12)']] as const) {
    g.beginPath();
    for (let i = 0; i < count; i++) dot(rand() * GRAIN, rand() * GRAIN, size * (0.6 + rand() * 0.8));
    g.fillStyle = color; g.fill();
  }
  return canvas;
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
 * Дорожный знак у обочины: синий круг с белой стрелкой на столбе — «свободно направо» или «налево». dir 0 — знак погас.
 * Стоит, а не лежит: столб растёт вверх (lift), круг повёрнут к нам. size — во сколько раз крупнее: когда видна
 * вся трасса, знак чуть больше, иначе стрелку не разглядеть
 */
function drawSign(ctx: Ctx, track: Track, { x, y, angle }: RoadPoint, dir: Side | 0, size: number, p: Palette): void {
  const r = 10, pole = 26; // круг ≈ 2 м, столб ≈ 2,6 м — машине по крышу и выше
  const off = track.width / 2 + 14;
  const cx = x - Math.sin(angle) * off, cy = y + Math.cos(angle) * off; // справа по ходу, как у настоящей дороги
  ctx.fillStyle = 'rgb(0 0 0 / 0.2)';
  ctx.beginPath(); ctx.ellipse(cx + 3, cy + 2, 3 * size, 2 * size, 0, 0, Math.PI * 2); ctx.fill();
  const top = lift(cx, cy, (pole + r) * size);
  ctx.strokeStyle = p.roof2; ctx.lineWidth = 2 * size; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(top.x, top.y); ctx.stroke();
  ctx.save();
  ctx.translate(top.x, top.y);
  ctx.scale((size * r) / 15, (size * r) / 15 / TILT); // камера сожмёт пол по высоте — круг заранее растянут, чтобы на экране был кругом
  signFace(ctx, dir, p);
  ctx.restore();
}

/**
 * Лицо знака: белая кайма, синий круг радиусом 15 с центром в (0, 0) и стрелка «прямо, потом поворот» — как читает
 * водитель: dir 1 — направо, −1 — налево, 0 — знак погас. Общая для вида сверху и из машины
 */
export function signFace(ctx: Ctx, dir: Side | 0, p: Palette): void {
  ctx.beginPath(); ctx.arc(0, 0, 17.5, 0, Math.PI * 2); ctx.fillStyle = p.kerb2; ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fillStyle = dir ? p.sign : p.signOff; ctx.fill();
  if (!dir) return;
  ctx.strokeStyle = p.kerb2; ctx.fillStyle = p.kerb2; ctx.lineWidth = 3.6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.beginPath(); ctx.moveTo(-dir * 3, 9); ctx.lineTo(-dir * 3, -2); ctx.lineTo(dir * 3, -2); ctx.stroke(); // прямо, потом поворот
  ctx.beginPath(); ctx.moveTo(dir * 2, -8); ctx.lineTo(dir * 2, 4); ctx.lineTo(dir * 10, -2); ctx.closePath(); ctx.fill();
}

/** Знаки перед дорожными работами на одном столбе — у закрытого пути, лицом к нам, как синий знак */
function drawWorksSign(ctx: Ctx, at: Point, size: number, p: Palette): void {
  const k = (size * 10) / 15, top = lift(at.x, at.y, 24 * size); // середина круглого знака на высоте 2,4 м
  ctx.fillStyle = 'rgb(0 0 0 / 0.2)';
  ctx.beginPath(); ctx.ellipse(at.x + 3, at.y + 2, 3 * size, 2 * size, 0, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = p.roof2; ctx.lineWidth = 2 * size; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(at.x, at.y); ctx.lineTo(top.x, top.y); ctx.stroke();
  ctx.save();
  ctx.translate(top.x, top.y);
  ctx.scale(k, k / TILT);
  worksFace(ctx, p);
  ctx.restore();
}

/**
 * Лицо знаков перед дорожными работами: сверху треугольник «Дорожные работы» (человечек с лопатой),
 * под ним — «Ограничение скорости» с SLOW_SPEED, как на табло. Круг радиусом 15 — в (0, 0), треугольник над ним
 */
export function worksFace(ctx: Ctx, p: Palette): void {
  // треугольник: красная кайма, белое поле, чёрный рабочий у кучи земли
  ctx.save();
  ctx.translate(0, -34);
  ctx.beginPath(); ctx.moveTo(0, -17); ctx.lineTo(17, 12); ctx.lineTo(-17, 12); ctx.closePath();
  ctx.fillStyle = p.kerb; ctx.fill();
  ctx.beginPath(); ctx.moveTo(0, -10); ctx.lineTo(11, 8.5); ctx.lineTo(-11, 8.5); ctx.closePath();
  ctx.fillStyle = p.checkLight; ctx.fill();
  ctx.fillStyle = p.checkDark; ctx.strokeStyle = p.checkDark; ctx.lineCap = 'round'; ctx.lineWidth = 1.8;
  ctx.beginPath(); ctx.arc(-2.5, -2.5, 1.7, 0, Math.PI * 2); ctx.fill(); // голова
  ctx.beginPath(); ctx.moveTo(-2.5, -0.5); ctx.lineTo(-4, 4); ctx.lineTo(-6, 7.5); ctx.moveTo(-4, 4); ctx.lineTo(-2, 7.5); // туловище и ноги
  ctx.moveTo(-3, 1); ctx.lineTo(2, 3.5); ctx.stroke(); // руки к лопате
  ctx.beginPath(); ctx.moveTo(0.5, 1.5); ctx.lineTo(4, 6.5); ctx.lineWidth = 1.2; ctx.stroke(); // лопата
  ctx.beginPath(); ctx.moveTo(2.5, 8); ctx.quadraticCurveTo(6, 3, 9, 8); ctx.closePath(); ctx.fill(); // куча земли
  ctx.restore();
  // круг: белое поле в красном кольце, число — как скорость на табло
  ctx.beginPath(); ctx.arc(0, 0, 15, 0, Math.PI * 2); ctx.fillStyle = p.kerb; ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, 11.5, 0, Math.PI * 2); ctx.fillStyle = p.checkLight; ctx.fill();
  ctx.fillStyle = p.checkDark; ctx.font = `700 10px ${UI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(SLOW_SPEED.toFixed(1), 0, 0.5);
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

export function clear(ctx: Ctx, canvas: HTMLCanvasElement): void {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = getPalette().board;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}
