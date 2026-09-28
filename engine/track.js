// Трассы: центральная линия, бордюры, прогресс вдоль трассы, генерация по seed.
import { mulberry32, hashString, clamp, segmentT } from './utils.js';
import { drawMaze } from './maze.js';

export const LANES = 3;          // сколько полос
export const LANE_WIDTH = 56;    // ширина полосы, px (машина — 24 px)
export const TRACK_WIDTH = LANES * LANE_WIDTH;
const SPACING = 14;          // шаг между точками центральной линии, px
const START_S = 60;          // где стоит машина на старте (px от начала)
const FINISH_MARGIN = 70;    // финишная черта за столько px до конца
const CELL = 64;             // размер ячейки сетки для быстрых проверок

function catmullRom(points, samples = 24) {
  const p = [points[0], ...points, points[points.length - 1]];
  const out = [];
  for (let i = 1; i < p.length - 2; i++) {
    const p0 = p[i - 1], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2];
    for (let k = 0; k < samples; k++) {
      const t = k / samples, t2 = t * t, t3 = t2 * t;
      const f = (a, b, c, d) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) });
    }
  }
  out.push({ ...points[points.length - 1] });
  return out;
}

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

/** Одна дорога из центральной линии: длина вдоль неё, края, разметка полос */
function makeRoad(center, width, lanes) {
  const n = center.length;
  const cum = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    cum[i] = cum[i - 1] + Math.hypot(center[i].x - center[i - 1].x, center[i].y - center[i - 1].y);
  }
  const hw = width / 2;
  const left = [], right = [];
  const dividers = Array.from({ length: lanes - 1 }, () => []); // разметка между полосами
  for (let i = 0; i < n; i++) {
    const a = center[Math.max(0, i - 1)], b = center[Math.min(n - 1, i + 1)];
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len; // нормаль «вправо по ходу»
    left.push({ x: center[i].x - nx * hw, y: center[i].y - ny * hw });
    right.push({ x: center[i].x + nx * hw, y: center[i].y + ny * hw });
    for (let k = 1; k < lanes; k++) {
      const off = -hw + (width * k) / lanes;
      dividers[k - 1].push({ x: center[i].x + nx * off, y: center[i].y + ny * off });
    }
  }
  return { center, cum, total: cum[n - 1], left, right, dividers };
}

/** Расстояние от точки до центральной линии дороги (квадрат) — на отрезках lo…hi */
function nearestOn(road, x, y, lo = 0, hi = road.center.length - 2) {
  const { center, cum } = road;
  lo = Math.max(0, lo); hi = Math.min(center.length - 2, hi);
  let best = Infinity, idx = lo, s = cum[lo];
  for (let i = lo; i <= hi; i++) {
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
  const lines = [];
  for (const r of roads) {
    const n = r.center.length;
    lines.push(r.left, r.right, [r.left[n - 1], r.right[n - 1]]);          // края и стенка в конце
    if (r === roads[0]) lines.push([r.left[0], r.right[0]]);              // стенка за стартом
  }
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
 * Собрать трассу из опорных точек.
 * branches — тупики: ветки, которые отходят от основной дороги (их центральная линия начинается на ней).
 * signs — дорожные знаки у основной дороги: { s, dir } — на расстоянии s от начала, dir = -1 налево, 1 направо.
 * smooth: false — точки уже плотные (лабиринт), сглаживать не нужно.
 */
export function buildTrack({ name, points, width = TRACK_WIDTH, lanes = LANES, id, branches = [], signs = [], smooth = true }) {
  const main = makeRoad(resample(smooth ? catmullRom(points) : points, SPACING), width, lanes);
  const roads = [main];
  for (const b of branches) {
    const road = makeRoad(resample(b.points, SPACING), width, lanes);
    const at = nearestOn(main, b.points[0].x, b.points[0].y);
    roads.push({ ...road, fromIdx: at.idx, fromS: at.s });
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
    id: id ?? name, name, width, lanes, ...main, roads, walls, segs,
    signs: signs.map((sg) => ({ ...sg, ...pointAt(main, sg.s) })),
    grid: buildGrid(segs),
    startS: START_S,
    finishS: main.total - FINISH_MARGIN,
    bbox: { minX, minY, maxX, maxY },
  };
}

/** Точка на центральной линии на расстоянии s от начала */
export function pointAt(track, s) {
  const { center, cum } = track;
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
 * Ищем только рядом: если на перекрёстке свернуть на дальний участок трассы, прогресс не прыгнет вперёд.
 * У развилки смотрим и на соседнюю дорогу — так машина переезжает с основной на тупик и обратно.
 * progress — сколько проехано к финишу: в тупике чем глубже, тем меньше (финиш-то в другой стороне).
 */
export function projectProgress(track, x, y, hint, road = 0) {
  const roads = track.roads ?? [track];
  let best = { ...nearestOn(roads[road], x, y, hint - 6, hint + 16), road };
  const tryRoad = (k, lo, hi) => {
    const p = nearestOn(roads[k], x, y, lo, hi);
    if (p.d2 < best.d2) best = { ...p, road: k };
  };
  if (road === 0) {
    for (let k = 1; k < roads.length; k++) if (Math.abs(roads[k].fromIdx - hint) <= 16) tryRoad(k, 0, 16);
  } else {
    tryRoad(0, roads[road].fromIdx - 6, roads[road].fromIdx + 16);
  }
  const progress = best.road === 0 ? best.s : roads[best.road].fromS - best.s;
  return { road: best.road, idx: best.idx, s: progress };
}

export const SIGN_VIEW = 100; // знак видно за столько px до него — пока проезжаешь рядом

/** Что показывает знак, мимо которого машина едет сейчас: -1 налево, 1 направо, 0 — знака рядом нет */
export function signAt(track, road, s) {
  if (road !== 0 || !track.signs) return 0;
  for (const sg of track.signs) if (s > sg.s - SIGN_VIEW && s <= sg.s) return sg.dir;
  return 0;
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

export const TRAINING_TRACKS = [
  {
    id: 'warmup', name: 'Разминка',
    points: [
      { x: 0, y: 600 }, { x: 400, y: 600 }, { x: 800, y: 590 }, { x: 1100, y: 480 }, { x: 1320, y: 310 },
      { x: 1600, y: 250 }, { x: 1880, y: 330 }, { x: 2080, y: 530 }, { x: 2320, y: 680 }, { x: 2700, y: 700 }, { x: 3000, y: 690 },
    ],
  },
  {
    id: 'snake', name: 'Змейка',
    points: [
      { x: 0, y: 420 }, { x: 300, y: 420 }, { x: 600, y: 280 }, { x: 900, y: 170 }, { x: 1180, y: 290 },
      { x: 1380, y: 540 }, { x: 1640, y: 700 }, { x: 1950, y: 620 }, { x: 2200, y: 380 }, { x: 2500, y: 250 },
      { x: 2800, y: 380 }, { x: 3000, y: 580 }, { x: 3300, y: 650 },
    ],
  },
  {
    id: 'hairpin', name: 'Шпилька',
    points: [
      { x: 0, y: 200 }, { x: 500, y: 200 }, { x: 1000, y: 200 }, { x: 1300, y: 230 }, { x: 1470, y: 360 },
      { x: 1490, y: 520 }, { x: 1360, y: 640 }, { x: 1100, y: 680 }, { x: 700, y: 680 }, { x: 440, y: 720 },
      { x: 320, y: 860 }, { x: 360, y: 1010 }, { x: 560, y: 1100 }, { x: 900, y: 1120 }, { x: 1400, y: 1120 }, { x: 1800, y: 1120 },
    ],
  },
  {
    // развилки: направо, налево, налево, направо — «всегда налево» не проедет. Перед каждой — знак,
    // но у самой развилки его уже не видно: куда повернуть, надо помнить
    id: 'maze', name: 'Лабиринт',
    maze: [
      ['line', 520], ['fork', 1],
      ['line', 260], ['arc', -60, 320], ['line', 400], ['fork', -1],
      ['line', 240], ['arc', 60, 320], ['line', 700], ['loop', 1], ['line', 900], ['arc', 90, 230],
      ['line', 440], ['fork', -1],
      ['line', 440], ['fork', 1],
      ['line', 420],
    ],
  },
];

/** Случайная трасса по seed (строка или число). Одинаковый seed — одинаковая трасса у всех. */
export function generateTrack(seedInput) {
  const seed = typeof seedInput === 'number' ? seedInput >>> 0 : hashString(seedInput);
  const minGap = TRACK_WIDTH * 2.2;
  for (let attempt = 0; attempt < 300; attempt++) {
    const rng = mulberry32(seed + attempt * 7919);
    const stepLen = 70;
    const steps = 52 + Math.floor(rng() * 14);
    const pts = [{ x: 0, y: 0 }, { x: stepLen, y: 0 }];
    let heading = 0, turn = 0, straight = 0, ok = true;
    for (let i = 2; i < steps && ok; i++) {
      if (straight > 0) { straight--; turn *= 0.5; }
      else {
        turn = turn * 0.8 + (rng() - 0.5) * 0.34;
        if (rng() < 0.08) straight = 2 + Math.floor(rng() * 4);
      }
      turn = clamp(turn, -0.38, 0.38);
      heading = clamp(heading + turn, -2.0, 2.0);
      if (Math.abs(heading) >= 2.0) turn = 0;
      const last = pts[pts.length - 1];
      const p = { x: last.x + Math.cos(heading) * stepLen, y: last.y + Math.sin(heading) * stepLen };
      for (let j = 0; j < pts.length - 7; j++) {
        if (Math.hypot(p.x - pts[j].x, p.y - pts[j].y) < minGap) { ok = false; break; }
      }
      pts.push(p);
    }
    if (!ok) continue;
    // поворачиваем так, чтобы трасса шла слева направо: удобнее смотреть на широком экране
    const end = pts[pts.length - 1];
    const a = -Math.atan2(end.y, end.x);
    const cos = Math.cos(a), sin = Math.sin(a);
    const rotated = pts.map((p) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }));
    return buildTrack({ name: `Трасса «${seedInput}»`, points: rotated, id: `seed:${seedInput}` });
  }
  throw new Error('Не удалось сгенерировать трассу');
}

const cache = new Map();
export function getTrainingTrack(id) {
  if (!cache.has(id)) {
    const def = TRAINING_TRACKS.find((t) => t.id === id);
    cache.set(id, def.maze ? buildTrack({ ...def, ...drawMaze(def.maze), smooth: false }) : buildTrack({ ...def, points: def.points }));
  }
  return cache.get(id);
}
