// Трафик: машины, которые едут по своим полосам с постоянной скоростью.
// Положение каждой зависит только от тика, поэтому у всех участников гонки поток одинаковый.
import { mulberry32, hashString } from './utils.js';
import { pointAt } from './track.js';
import { CAR } from './car.js';

export const TRAFFIC_LEVELS = [
  { id: 'none', title: 'Без машин' },
  { id: 'same', title: 'Попутные' },
  { id: 'all', title: 'Попутные и встречные' },
];

// Полоса 0 (левая) — встречная, остальные — попутные: чем правее, тем медленнее.
const ONCOMING_SPEED = -1.6;
const SAME_SPEEDS = [2.3, 1.5, 1.1];
// Промежуток между машинами одной полосы, px. На кольце одних и тех же обгоняешь каждый круг — поэтому редко
const GAP = { min: 800, spread: 700 };

/** Расписание трафика для трассы-кольца: машины стоят по кругу и едут круг за кругом. level: 'none' | 'same' | 'all' */
export function makeTraffic(track, level) {
  if (!level || level === 'none') return null;
  const rng = mulberry32(hashString(`${track.id}|${level}`));
  const cars = [];
  const lanes = track.lanes, end = track.startS + track.lap;
  for (let lane = 1; lane < lanes; lane++) {
    const v = SAME_SPEEDS[(lane - 1) % SAME_SPEEDS.length];
    // впереди старта — с запасом, позади — тоже: машины трафика не должны стоять на стартовой черте
    for (let s = track.startS + 320 + rng() * 300; s < end - 250; s += GAP.min + rng() * GAP.spread) cars.push({ s0: s, lane, v });
  }
  if (level === 'all' && lanes > 1) {
    for (let s = track.startS + 520 + rng() * 300; s < end - 150; s += GAP.min + rng() * GAP.spread) cars.push({ s0: s, lane: 0, v: ONCOMING_SPEED });
  }
  return { level, cars };
}

/** Где машины трафика на тике tick. Возвращает массив { x, y, angle, speed, oncoming, poly }. */
export function trafficAt(track, traffic, tick) {
  if (!traffic) return null;
  const out = [];
  const lanes = track.lanes, w = track.width;
  for (const c of traffic.cars) {
    const off = -w / 2 + (w * (c.lane + 0.5)) / lanes;
    const p = lanePoint(track, c.s0 + c.v * tick, off);
    const nx = -Math.sin(p.angle), ny = Math.cos(p.angle);
    const x = p.x + nx * off, y = p.y + ny * off;
    const angle = c.v < 0 ? p.angle + Math.PI : p.angle;
    out.push({ x, y, angle, speed: Math.abs(c.v), oncoming: c.v < 0, poly: rectPoly(x, y, angle) });
  }
  return out;
}

/**
 * Точка на центральной линии, вдоль которой едет машина трафика в полосе со сдвигом off.
 * На острове поток расходится, как вода: полоса со стороны второго пути уходит на него, остальные — по кольцу.
 */
function lanePoint(track, s, off) {
  const at = ((s % track.lap) + track.lap) % track.lap;
  for (const isl of track.islands) {
    if (at < isl.forkS || at > isl.mergeS || Math.sign(off) !== -isl.side) continue;
    const road = track.roads[isl.road];
    return pointAt(road, ((at - isl.forkS) / (isl.mergeS - isl.forkS)) * road.total);
  }
  return pointAt(track, s);
}

export function rectPoly(x, y, angle) {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const hl = CAR.length / 2, hw = CAR.width / 2;
  return [
    x + cos * hl - sin * hw, y + sin * hl + cos * hw,
    x + cos * hl + sin * hw, y + sin * hl - cos * hw,
    x - cos * hl + sin * hw, y - sin * hl - cos * hw,
    x - cos * hl - sin * hw, y - sin * hl + cos * hw,
  ];
}

const cache = new Map();
/** Та же трасса, но с трафиком нужного уровня */
export function withTraffic(track, level) {
  if (!level || level === 'none') return track;
  const key = `${track.id}|${level}`;
  if (!cache.has(key)) {
    const t = { ...track, trafficLevel: level };
    t.traffic = makeTraffic(track, level);
    cache.set(key, t);
  }
  return cache.get(key);
}
