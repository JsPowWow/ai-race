// Трассы: кольцо дороги, бордюры, прогресс по кругам, развилки-острова, генерация по seed.
import { hashString, clamp, segmentT, mulberry32 } from './utils.js';
import { drawRing, randomRing, SIGN_GAP, ZONE } from './turtle.js';

export const LANES = 3;          // сколько полос
export const LANE_WIDTH = 56;    // ширина полосы, px (машина — 24 px)
export const TRACK_WIDTH = LANES * LANE_WIDTH;
export const LAPS = 3;           // сколько кругов в заезде
const SPACING = 14;          // шаг между точками центральной линии, px
const START_S = -30;         // машина стоит чуть позади стартовой черты (черта — в начале кольца, s = 0)
const CELL = 64;             // размер ячейки сетки для быстрых проверок

function resample(poly, spacing) {
  const out = [{ ...poly[0] }];
  let prev = poly[0];
  let carry = 0;
  for (let i = 1; i < poly.length; i++) {
    const cur = poly[i];
    let seg = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    while (carry + seg >= spacing && seg > 0) {
      const t = (spacing - carry) / seg;
      const np = { x: prev.x + (cur.x - prev.x) * t, y: prev.y + (cur.y - prev.y) * t };
      out.push(np);
      prev = np;
      seg = Math.hypot(cur.x - prev.x, cur.y - prev.y);
      carry = 0;
    }
    carry += seg;
    prev = cur;
  }
  if (carry > spacing * 0.4) out.push({ ...poly[poly.length - 1] });
  return out;
}

/** Замкнуть кольцо: последняя точка — ровно первая, без коротенького хвостика перед ней */
function closeUp(points) {
  const first = points[0];
  while (points.length > 2 && Math.hypot(points.at(-1).x - first.x, points.at(-1).y - first.y) < SPACING * 0.6) points.pop();
  points.push({ ...first });
  return points;
}

function buildGrid(segs) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i < segs.length; i += 4) {
    minX = Math.min(minX, segs[i], segs[i + 2]); maxX = Math.max(maxX, segs[i], segs[i + 2]);
    minY = Math.min(minY, segs[i + 1], segs[i + 3]); maxY = Math.max(maxY, segs[i + 1], segs[i + 3]);
  }
  minX -= CELL; minY -= CELL;
  const cols = Math.ceil((maxX - minX) / CELL) + 2;
  const rows = Math.ceil((maxY - minY) / CELL) + 2;
  const cells = Array.from({ length: cols * rows }, () => []);
  for (let s = 0; s < segs.length / 4; s++) {
    const o = s * 4;
    const c0 = Math.floor((Math.min(segs[o], segs[o + 2]) - minX) / CELL);
    const c1 = Math.floor((Math.max(segs[o], segs[o + 2]) - minX) / CELL);
    const r0 = Math.floor((Math.min(segs[o + 1], segs[o + 3]) - minY) / CELL);
    const r1 = Math.floor((Math.max(segs[o + 1], segs[o + 3]) - minY) / CELL);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) cells[r * cols + c].push(s);
  }
  return { minX, minY, cols, rows, cells, stamp: new Uint32Array(segs.length / 4), tick: 1 };
}

/**
 * Одна дорога из центральной линии: длина вдоль неё, края, разметка полос.
 * closed — кольцо: последняя точка совпадает с первой, а соседи первой точки — вторая и предпоследняя.
 */
function makeRoad(center, width, lanes, closed = false) {
  const n = center.length;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + Math.hypot(center[i].x - center[i - 1].x, center[i].y - center[i - 1].y);
  }
  const hw = width / 2;
  const left = [], right = [];
  const dividers = Array.from({ length: lanes - 1 }, () => []); // разметка между полосами
  for (let i = 0; i < n; i++) {
    const a = i > 0 ? center[i - 1] : closed ? center[n - 2] : center[0];
    const b = i < n - 1 ? center[i + 1] : closed ? center[1] : center[n - 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len; // нормаль «вправо по ходу»
    left.push({ x: center[i].x - nx * hw, y: center[i].y - ny * hw });
    right.push({ x: center[i].x + nx * hw, y: center[i].y + ny * hw });
    for (let k = 1; k < lanes; k++) {
      const off = -hw + (width * k) / lanes;
      dividers[k - 1].push({ x: center[i].x + nx * off, y: center[i].y + ny * off });
    }
  }
  return { center, cum, total: cum[n - 1], left, right, dividers, closed };
}

/** Номер отрезка на кольце: после последнего снова идёт первый */
const wrap = (i, m) => ((i % m) + m) % m;

/** Расстояние от точки до центральной линии дороги (квадрат) — на отрезках lo…hi. На кольце lo и hi могут выходить за края */
function nearestOn(road, x, y, lo = 0, hi = road.center.length - 2) {
  const { center, cum } = road;
  const m = center.length - 1; // сколько отрезков
  if (!road.closed) { lo = Math.max(0, lo); hi = Math.min(m - 1, hi); }
  else if (hi - lo >= m) { lo = 0; hi = m - 1; }
  let best = Infinity, idx = 0, s = 0;
  for (let k = lo; k <= hi; k++) {
    const i = road.closed ? wrap(k, m) : k;
    const a = center[i], b = center[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / l2, 0, 1);
    const px = a.x + dx * t - x, py = a.y + dy * t - y;
    const d = px * px + py * py;
    if (d < best) { best = d; idx = i; s = cum[i] + Math.sqrt(l2) * t; }
  }
  return { d2: best, idx, s };
}

/**
 * Бордюры всех дорог. Где одна дорога заходит на другую (развилка, перекрёсток, трасса пересекает саму себя),
 * бордюр убираем: там асфальт, проехать можно.
 */
function makeWalls(roads, hw) {
  const limit = (hw - 1) ** 2;
  const onRoad = (p) => roads.some((r) => nearestOn(r, p.x, p.y).d2 < limit);
  const lerpPt = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
  /** Где на отрезке a→b кончается асфальт: a снаружи, b на дороге (или наоборот) */
  const edge = (a, b) => {
    let lo = 0, hi = 1;
    for (let k = 0; k < 12; k++) {
      const mid = (lo + hi) / 2;
      if (onRoad(lerpPt(a, b, mid)) === onRoad(a)) lo = mid; else hi = mid;
    }
    return lerpPt(a, b, (lo + hi) / 2);
  };
  const lines = roads.flatMap((r) => [r.left, r.right]); // все дороги кончаются на других: торцевых стенок нет
  const walls = [];
  for (const pts of lines) {
    const inside = pts.map(onRoad);
    let cur = inside[0] ? null : [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      if (!inside[i - 1] && !inside[i]) cur.push(pts[i]);
      else if (inside[i - 1] && !inside[i]) cur = [edge(pts[i - 1], pts[i]), pts[i]];
      else if (!inside[i - 1] && inside[i]) { cur.push(edge(pts[i - 1], pts[i])); walls.push(cur); cur = null; }
    }
    if (cur && cur.length > 1) walls.push(cur);
  }
  return walls;
}

/**
 * Собрать трассу-кольцо из точек, которые нарисовала черепашка (drawRing).
 * points — центральная линия кольца, последняя точка совпадает с первой.
 * branches — вторые пути островов: начинаются и кончаются на кольце. side — куда от развилки уходит само кольцо.
 */
export function buildTrack({ name, id, points, branches = [], laps = LAPS, width = TRACK_WIDTH, lanes = LANES }) {
  const main = makeRoad(closeUp(resample(points, SPACING)), width, lanes, true);
  const roads = [main];
  const islands = [];
  for (const b of branches) {
    const road = makeRoad(resample(b.points, SPACING), width, lanes);
    const from = nearestOn(main, b.points[0].x, b.points[0].y);
    const to = nearestOn(main, b.points.at(-1).x, b.points.at(-1).y);
    roads.push({ ...road, fromIdx: from.idx, fromS: from.s, toIdx: to.idx, toS: to.s });
    const seed = hashString(`${id ?? name}|${islands.length}`);
    const signS = from.s - SIGN_GAP;
    islands.push({
      road: roads.length - 1, side: b.side, forkS: from.s, mergeS: to.s,
      zone: [from.s + ZONE.from, from.s + ZONE.to],
      sign: { s: signS, ...pointAt(main, signS) },
      seed, phase: seed % SWITCH_EVERY,
    });
  }
  const walls = makeWalls(roads, width / 2);
  const segList = [];
  for (const w of walls) for (let i = 0; i < w.length - 1; i++) segList.push(w[i].x, w[i].y, w[i + 1].x, w[i + 1].y);
  const segs = new Float64Array(segList);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of roads) {
    for (const p of [...r.left, ...r.right]) {
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    }
  }
  return {
    id: id ?? name, name, width, lanes, ...main, roads, walls, segs, islands,
    grid: buildGrid(segs),
    lap: main.total, laps,
    startS: START_S,
    finishS: laps * main.total, // финиш — та же черта, что и старт, после последнего круга
    bbox: { minX, minY, maxX, maxY },
  };
}

/** Точка на центральной линии на расстоянии s от начала. На кольце s может быть любым: круг за кругом */
export function pointAt(track, s) {
  const { center, cum } = track;
  if (track.closed) s = ((s % track.total) + track.total) % track.total;
  let lo = 0, hi = center.length - 2;
  while (lo < hi) { // бинарный поиск отрезка, где лежит s
    const mid = (lo + hi + 1) >> 1;
    if (cum[mid] <= s) lo = mid; else hi = mid - 1;
  }
  const i = lo;
  const a = center[i], b = center[i + 1];
  const t = clamp((s - cum[i]) / (cum[i + 1] - cum[i] || 1), 0, 1);
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: Math.atan2(b.y - a.y, b.x - a.x), idx: i };
}

/**
 * Где машина на трассе: ближайшая точка центральной линии рядом с прошлой (road — номер дороги, hint — отрезок).
 * Ищем только рядом — на пару отрезков вокруг: за тик машина проезжает меньше одного.
 * Тогда на перекрёстке, где бордюров нет, прогресс не «перескочит» на другой участок трассы и не «поползёт» за ним.
 * У развилки смотрим и на соседнюю дорогу — так машина переезжает с кольца на второй путь острова и обратно.
 * s — сколько проехано с начала заезда, круг за кругом: из точек на кольце берём ту, что ближе к прошлому s (near).
 * along — сколько проехано по своей дороге: так машина понимает, что едет, а не стоит (см. Car.step).
 */
export function projectProgress(track, x, y, hint, road = 0, near = track.startS) {
  const roads = track.roads, m = track.center.length - 1;
  let best = { ...nearestOn(roads[road], x, y, hint - 2, hint + 3), road };
  const tryRoad = (k, lo, hi) => {
    const p = nearestOn(roads[k], x, y, lo, hi);
    if (p.d2 < best.d2) best = { ...p, road: k };
  };
  if (road === 0) {
    for (let k = 1; k < roads.length; k++) {
      const gap = Math.abs(roads[k].fromIdx - hint);
      if (Math.min(gap, m - gap) <= 16) tryRoad(k, 0, 16);
    }
  } else {
    const r = roads[road];
    if (hint < 20) tryRoad(0, r.fromIdx - 6, r.fromIdx + 16);
    if (hint > r.center.length - 20) tryRoad(0, r.toIdx - 16, r.toIdx + 6);
  }
  // Дальше края дороги — значит, машина съехала на другой участок (на перекрёстке): прогресс стоит, где был
  if (best.d2 > (track.width / 2 + 10) ** 2) best = { road, idx: hint, s: roads[road].cum[hint], d2: best.d2 };
  const local = progressOn(roads[best.road], best.s);
  const s = local + track.lap * Math.round((near - local) / track.lap);
  return { road: best.road, idx: best.idx, s, along: best.road === 0 ? s : best.s };
}

/** Прогресс на круге для точки на дороге road в along px от её начала */
function progressOn(road, along) {
  if (road.fromIdx === undefined) return along; // само кольцо
  return road.fromS + (road.toS - road.fromS) * (along / road.total); // второй путь острова: идёт рядом с кольцом
}

/** Какой сейчас круг: 1…laps */
export const lapOf = (track, s) => clamp(Math.floor(s / track.lap) + 1, 1, track.laps);

// ── Развилки-острова ──────────────────────────────────────────
// На одном из двух путей острова — медленная зона. Судьи переключают её по ходу гонки: раз в SWITCH_EVERY тиков
// «бросают монетку». Монетка — от seed трассы и номера броска, поэтому у всех участников одно и то же в один и тот же тик.

const SWITCH_EVERY = 600;  // 10 с
const DARK = 180;          // за 3 с до переключения знак гаснет: «сейчас поменяется»
export const SIGN_VIEW = 100; // знак видно за столько px до него — пока проезжаешь рядом
export const SLOW_SPEED = 0.8; // быстрее в медленной зоне не поедешь: свернул не туда — минус 3 с

/** Монетка для броска n */
const coin = (seed, n) => mulberry32((seed + Math.imul(n + 1, 0x9e3779b9)) >>> 0)() < 0.5;

/** Какой путь острова свободен на тике tick: 1 — правый, -1 — левый */
export function freeSide(track, i, tick) {
  const isl = track.islands[i];
  return coin(isl.seed, Math.floor((tick + isl.phase) / SWITCH_EVERY)) ? isl.side : -isl.side;
}

/**
 * Та же трасса, но судьи бросают монетку по-другому: серия бросков номер series.
 * Рой каждое поколение едет с новой серией — иначе заучит «на первом круге налево, на втором направо» и знак ему не нужен.
 * Серия — просто число, поэтому всё по-прежнему можно пересчитать. Серия 0 — сама трасса.
 */
export function withCoins(track, series) {
  if (!series || !track.islands.length) return track;
  return { ...track, islands: track.islands.map((isl) => ({ ...isl, seed: hashString(`${isl.seed}|${series}`) })) };
}

/** Где мы на круге: s от стартовой черты */
const onLap = (track, s) => ((s % track.lap) + track.lap) % track.lap;

/** Что горит на знаке острова i: куда свободно (-1 налево, 1 направо) или 0 — знак погас, скоро переключат */
export function signShows(track, i, tick) {
  const now = freeSide(track, i, tick);
  return now === freeSide(track, i, tick + DARK) ? now : 0;
}

/** Что показывает знак, мимо которого машина едет сейчас. 0 — знака рядом нет или он погас */
export function signAt(track, road, s, tick) {
  if (road !== 0) return 0;
  const at = onLap(track, s);
  for (let i = 0; i < track.islands.length; i++) {
    const { sign } = track.islands[i];
    if (at > sign.s - SIGN_VIEW && at <= sign.s) return signShows(track, i, tick);
  }
  return 0;
}

/** В медленной зоне какого острова машина: { island, side } — side, по какому пути она едет. Или null */
export function zoneAt(track, road, s) {
  const at = onLap(track, s);
  for (let i = 0; i < track.islands.length; i++) {
    const isl = track.islands[i];
    if (at < isl.zone[0] || at > isl.zone[1]) continue;
    if (road === 0) return { island: i, side: isl.side };
    if (road === isl.road) return { island: i, side: -isl.side };
  }
  return null;
}

/** Сколько раз машина проехала развилки: каждый остров на каждом круге — отдельный раз */
export function forksPassed(track, s) {
  return track.islands.reduce((sum, isl) => sum + clamp(Math.floor((s - isl.mergeS) / track.lap) + 1, 0, track.laps), 0);
}

/** Луч или отрезок против бордюров: минимальная доля пути до столкновения, или -1 */
export function castSegment(track, x1, y1, x2, y2) {
  const g = track.grid, segs = track.segs;
  const stamp = ++g.tick;
  const c0 = Math.max(0, Math.floor((Math.min(x1, x2) - g.minX) / CELL));
  const c1 = Math.min(g.cols - 1, Math.floor((Math.max(x1, x2) - g.minX) / CELL));
  const r0 = Math.max(0, Math.floor((Math.min(y1, y2) - g.minY) / CELL));
  const r1 = Math.min(g.rows - 1, Math.floor((Math.max(y1, y2) - g.minY) / CELL));
  let best = -1;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const cell = g.cells[r * g.cols + c];
      for (let k = 0; k < cell.length; k++) {
        const s = cell[k];
        if (g.stamp[s] === stamp) continue;
        g.stamp[s] = stamp;
        const o = s * 4;
        const t = segmentT(x1, y1, x2, y2, segs[o], segs[o + 1], segs[o + 2], segs[o + 3]);
        if (t >= 0 && (best < 0 || t < best)) best = t;
      }
    }
  }
  return best;
}

// ── Готовые тренировочные трассы ──────────────────────────────
// Программы для черепашки (см. drawRing в turtle.js). Прямые 'fit' черепашка подгоняет сама, чтобы кольцо замкнулось.

export const TRAINING_TRACKS = [
  {
    id: 'warmup', name: 'Разминка',
    program: [
      ['fit', 200], ['arc', 90, 220], ['fit', 100], ['arc', 90, 220],
      ['line', 400], ['arc', 90, 220], ['line', 100], ['arc', 90, 220], ['line', 200],
    ],
  },
  {
    id: 'snake', name: 'Змейка',
    program: [
      ['fit', 150], ['arc', 70, 220], ['fit', 40], ['arc', -70, 220], ['arc', 180, 200],
      ['line', 250], ['arc', 80, 220], ['arc', -80, 220], ['arc', 180, 200], ['line', 100],
    ],
  },
  {
    id: 'hairpin', name: 'Шпилька',
    program: [
      // первая прямая длинная: шпильки не должны подходить к дальней стороне кольца
      ['fit', 300], ['arc', 90, 200], ['fit', 150], ['arc', 90, 200], ['line', 480],
      ['arc', 180, 140], ['line', 150], ['arc', -180, 140], ['line', 150], ['arc', 180, 200],
    ],
  },
  {
    // развилка-остров: какой путь свободен, меняется по ходу заезда — смотри на знак
    id: 'maze', name: 'Развилка', maze: true,
    program: [
      ['fit', 200], ['arc', 90, 220], ['fit', 100], ['arc', 90, 220], ['line', 220], ['fork', 1], ['line', 60],
      ['arc', 90, 220], ['line', 100], ['arc', 90, 220], ['line', 150],
    ],
  },
];

/** Случайная трасса по seed (строка или число). Одинаковый seed — одинаковая трасса у всех. На ней развилка-остров. */
export function generateTrack(seedInput) {
  const seed = typeof seedInput === 'number' ? seedInput >>> 0 : hashString(seedInput);
  return buildTrack({ name: `Трасса «${seedInput}»`, id: `seed:${seedInput}`, ...randomRing(seed, TRACK_WIDTH) });
}

const cache = new Map();
export function getTrainingTrack(id) {
  if (!cache.has(id)) {
    const def = TRAINING_TRACKS.find((t) => t.id === id);
    const drawn = drawRing(def.program);
    if (!drawn) throw new Error(`Трасса «${def.name}» не замыкается: поправь её программу`);
    cache.set(id, buildTrack({ ...def, ...drawn }));
  }
  return cache.get(id);
}
