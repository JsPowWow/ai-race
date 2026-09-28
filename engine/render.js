// Рисование трассы и машин на canvas.
import { CAR, WHEELBASE, wheelAngle, rays } from './car.js';
import { pointAt, freeSide, signShows } from './track.js';

/**
 * Цвет из CSS-переменной — готовый для canvas.
 * Сама переменная может быть «light-dark(светлый, тёмный)»: canvas такое не понимает,
 * поэтому просим браузер вычислить цвет на невидимом элементе — он учтёт текущую тему.
 */
let probe = null;
export function cssColor(name) {
  probe ??= document.documentElement.appendChild(Object.assign(document.createElement('i'), { hidden: true }));
  probe.style.color = `var(${name})`;
  return getComputedStyle(probe).color;
}

let palette = null;
/** Перечитать цвета трассы — после смены темы */
export function readPalette() {
  const v = cssColor;
  palette = {
    board: v('--board'), road: v('--road'), roadEdge: v('--road-edge'), seam: v('--seam'), slot: v('--slot'), rail: v('--rail'),
    kerb: v('--kerb'), kerb2: v('--kerb-2'), sign: v('--sign'), signOff: v('--sign-off'), slow: v('--slow'), checkLight: v('--check-light'), checkDark: v('--check-dark'),
    you: v('--you'), ray: v('--ray'), rayHit: v('--ray-hit'),
    traffic: v('--traffic'), trafficOncoming: v('--traffic-oncoming'), trafficEdge: v('--traffic-edge'), crashed: v('--crashed'),
  };
  return palette;
}
export const getPalette = () => palette || readPalette();

/** Шрифт подписей на холсте — тот же, что у интерфейса */
export const UI_FONT = '"Rubik", system-ui, sans-serif';

/** Подогнать размер canvas под CSS-размер size = { width, height } с учётом плотности пикселей */
export function fitCanvas(canvas, size) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.round(size.width * dpr), h = Math.round(size.height * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  return dpr;
}

export class Camera {
  constructor() { this.x = 0; this.y = 0; this.scale = 1; this.mode = 'fit'; this.ready = false; }
  update(canvas, track, target, dpr) {
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
  apply(ctx, canvas) {
    ctx.setTransform(this.scale, 0, 0, this.scale, canvas.width / 2 - this.x * this.scale, canvas.height / 2 - this.y * this.scale);
  }
  toWorld(canvas, px, py) {
    return { x: (px - canvas.width / 2) / this.scale + this.x, y: (py - canvas.height / 2) / this.scale + this.y };
  }
}

function polyPath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
}

/** Центры полос: по ним идут прорези с рельсами (как у трассы для слот-каров) */
const laneCenters = new WeakMap();
function lanesOf(track) {
  if (!laneCenters.has(track)) {
    const edges = [track.left, ...(track.dividers ?? []), track.right];
    const lanes = [];
    for (let k = 0; k < edges.length - 1; k++) {
      lanes.push(edges[k].map((a, i) => ({ x: (a.x + edges[k + 1][i].x) / 2, y: (a.y + edges[k + 1][i].y) / 2 })));
    }
    laneCenters.set(track, lanes);
  }
  return laneCenters.get(track);
}

/** Контур дороги одним путём: левый край туда, правый обратно */
function roadPath(ctx, { left, right }) {
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
export function drawTrack(ctx, track, cam, tick = 0) {
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
  track.islands.forEach((island, i) => {
    drawSlowZone(ctx, track, island, freeSide(track, i, tick), p);
    drawSign(ctx, track, island.sign, signShows(track, i, tick), Math.max(1, 0.9 * px), p);
  });
  checkered(ctx, pointAt(track, 0), track.width, p); // старт и финиш — одна черта: круг за кругом
}

/** Медленная зона — поперечные полосы на занятом пути острова, как на дорожных работах */
function drawSlowZone(ctx, track, island, free, p) {
  const [from, to] = island.zone;
  const onMain = free !== island.side; // занят путь, по которому идёт само кольцо
  const branch = track.roads[island.road];
  const at = (s) => (onMain ? pointAt(track, s) : pointAt(branch, ((s - branch.fromS) / (branch.toS - branch.fromS)) * branch.total));
  for (let s = from; s <= to; s += 22) line(ctx, at(s), track.width - 14, p.slow, 9);
}

/**
 * Дорожный знак у обочины: синий круг с белой стрелкой — «свободно направо» или «налево». dir 0 — знак погас.
 * size — во сколько раз крупнее: когда видна вся трасса, знак рисуем больше, иначе стрелку не разглядеть
 */
function drawSign(ctx, track, { x, y, angle }, dir, size, p) {
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

function line(ctx, pt, width, color, thick) {
  const nx = -Math.sin(pt.angle), ny = Math.cos(pt.angle);
  ctx.beginPath();
  ctx.moveTo(pt.x - nx * width / 2, pt.y - ny * width / 2);
  ctx.lineTo(pt.x + nx * width / 2, pt.y + ny * width / 2);
  ctx.lineWidth = thick; ctx.strokeStyle = color; ctx.stroke();
}

function checkered(ctx, pt, width, p) {
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
export function drawCar(ctx, car, { color = null, alpha = 1, sensors = false, label = null, highlight = false, cam = null, number = null, ghost = false } = {}) {
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
function drawGhost(ctx, car, color, alpha, p) {
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

/** Колёса торчат из-под корпуса; передние повёрнуты на угол, с которым машина правда описывает свою дугу */
function drawWheels(ctx, car, L, W) {
  const turn = car.done ? 0 : wheelAngle(car.curve ?? 0);
  ctx.fillStyle = '#16171a';
  for (const [x, a] of [[WHEELBASE / 2, turn], [-WHEELBASE / 2, 0]]) {
    for (const y of [-W / 2 - 1, W / 2 + 1]) { // чуть наружу из-под корпуса — поворот видно
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      roundRect(ctx, -6, -3, 12, 6, 2); ctx.fill();
      ctx.restore();
    }
  }
}

/** Много машин сразу, попроще (для финала на сотни участников): [{ x, y, angle, color, alpha }] */
export function drawPack(ctx, cars) {
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

export function drawSensors(ctx, car, sensors = car.sensors) {
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

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function clear(ctx, canvas) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = getPalette().board;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

/** Машины трафика — игрушечные: попутные серые со стоп-сигналами, встречные светлые с жёлтыми фарами */
export function drawTraffic(ctx, traffic) {
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
