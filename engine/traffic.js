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

/** Расписание трафика для трассы. level: 'none' | 'same' | 'all' */
export function makeTraffic(track, level) {
  if (!level || level === 'none') return null;
  const rng = mulberry32(hashString(`${track.id}|${level}`));
  const cars = [];
  const lanes = track.lanes;
  for (let lane = 1; lane < lanes; lane++) {
    const v = SAME_SPEEDS[(lane - 1) % SAME_SPEEDS.length];
    let s = track.startS + 320 + rng() * 300;
    while (s < track.finishS - 120) {
      cars.push({ s0: s, lane, v });
      s += 420 + rng() * 520;
    }
  }
  if (level === 'all' && lanes > 1) {
    // встречный поток: машины стоят «в очереди» и за финишем, чтобы поток не кончался
    let s = track.startS + 520 + rng() * 300;
    const end = track.total + 1.6 * 4000;
    while (s < end) {
      cars.push({ s0: s, lane: 0, v: ONCOMING_SPEED });
      s += 380 + rng() * 560;
    }
  }
  return { level, cars };
}

/** Где машины трафика на тике tick. Возвращает массив { x, y, angle, oncoming, poly }. */
export function trafficAt(track, traffic, tick) {
  if (!traffic) return null;
  const out = [];
  const lanes = track.lanes, w = track.width;
  for (const c of traffic.cars) {
    const s = c.s0 + c.v * tick;
    if (s < 10 || s > track.total - 10) continue;
    const p = pointAt(track, s);
    const off = -w / 2 + (w * (c.lane + 0.5)) / lanes;
    const nx = -Math.sin(p.angle), ny = Math.cos(p.angle);
    const x = p.x + nx * off, y = p.y + ny * off;
    const angle = c.v < 0 ? p.angle + Math.PI : p.angle;
    out.push({ x, y, angle, oncoming: c.v < 0, poly: rectPoly(x, y, angle) });
  }
  return out;
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
