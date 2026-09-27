// Трассы: центральная линия, бордюры, прогресс вдоль трассы, генерация по seed.
import { mulberry32, hashString, clamp, segmentT } from './utils.js';

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

/** Собрать трассу из опорных точек */
export function buildTrack({ name, points, width = TRACK_WIDTH, lanes = LANES, id }) {
  const center = resample(catmullRom(points), SPACING);
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
  const segList = [];
  for (let i = 0; i < n - 1; i++) {
    segList.push(left[i].x, left[i].y, left[i + 1].x, left[i + 1].y);
    segList.push(right[i].x, right[i].y, right[i + 1].x, right[i + 1].y);
  }
  segList.push(left[0].x, left[0].y, right[0].x, right[0].y);                 // стенка за стартом
  segList.push(left[n - 1].x, left[n - 1].y, right[n - 1].x, right[n - 1].y); // стенка в конце
  const segs = new Float64Array(segList);

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of [...left, ...right]) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
  }
  return {
    id: id ?? name, name, width, lanes, dividers, center, cum, total: cum[n - 1], left, right, segs,
    grid: buildGrid(segs),
    startS: START_S,
    finishS: cum[n - 1] - FINISH_MARGIN,
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

/** Где машина на трассе: ищем ближайший отрезок центральной линии рядом с прошлым */
export function projectProgress(track, x, y, hint) {
  const { center, cum } = track;
  const lo = Math.max(0, hint - 6), hi = Math.min(center.length - 2, hint + 16);
  let best = Infinity, bestIdx = hint, bestS = cum[hint];
  for (let i = lo; i <= hi; i++) {
    const a = center[i], b = center[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy || 1;
    const t = clamp(((x - a.x) * dx + (y - a.y) * dy) / l2, 0, 1);
    const px = a.x + dx * t - x, py = a.y + dy * t - y;
    const d = px * px + py * py;
    if (d < best) { best = d; bestIdx = i; bestS = cum[i] + Math.sqrt(l2) * t; }
  }
  return { idx: bestIdx, s: bestS };
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
    cache.set(id, buildTrack(def));
  }
  return cache.get(id);
}
