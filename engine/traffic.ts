// Трафик: машины, которые едут по своим полосам с постоянной скоростью.
// Положение каждой зависит только от тика, поэтому у всех участников гонки поток одинаковый.
import { mulberry32, hashString } from './utils.ts';
import { pointAt, type Track, type RoadPoint } from './track.ts';
import { CAR } from './car.ts';

/** Уровень трафика */
export type TrafficLevel = 'none' | 'same' | 'all';
/** Машина трафика в расписании: где стоит на старте (s0), полоса и скорость (минус — встречная) */
type TrafficCar = { s0: number; lane: number; v: number };
/** Расписание трафика трассы */
export type Traffic = { level: TrafficLevel; cars: TrafficCar[] };
/** Машина трафика на тике: где она, куда смотрит, скорость и углы корпуса (x0, y0, x1, y1, …) */
export type TrafficSpot = { x: number; y: number; angle: number; speed: number; oncoming: boolean; poly: number[] };

export const TRAFFIC_LEVELS: { id: TrafficLevel; title: string }[] = [
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
export function makeTraffic(track: Track, level: TrafficLevel | null | undefined): Traffic | null {
  if (!level || level === 'none') return null;
  const rng = mulberry32(hashString(`${track.id}|${level}`));
  const cars: TrafficCar[] = [];
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
export function trafficAt(track: Track, traffic: Traffic | null | undefined, tick: number): TrafficSpot[] | null {
  if (!traffic) return null;
  const out: TrafficSpot[] = [];
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
function lanePoint(track: Track, s: number, off: number): RoadPoint {
  const at = ((s % track.lap) + track.lap) % track.lap;
  for (const isl of track.islands) {
    if (at < isl.forkS || at > isl.mergeS || Math.sign(off) !== -isl.side) continue;
    const road = track.roads[isl.road];
    return pointAt(road, ((at - isl.forkS) / (isl.mergeS - isl.forkS)) * road.total);
  }
  return pointAt(track, s);
}

export function rectPoly(x: number, y: number, angle: number): number[] {
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const hl = CAR.length / 2, hw = CAR.width / 2;
  return [
    x + cos * hl - sin * hw, y + sin * hl + cos * hw,
    x + cos * hl + sin * hw, y + sin * hl - cos * hw,
    x - cos * hl + sin * hw, y - sin * hl - cos * hw,
    x - cos * hl - sin * hw, y - sin * hl + cos * hw,
  ];
}

const cache = new Map<string, Track>();
/** Та же трасса, но с трафиком нужного уровня */
export function withTraffic(track: Track, level: TrafficLevel | null | undefined): Track {
  if (!level || level === 'none') return track;
  const key = `${track.id}|${level}`;
  let t = cache.get(key);
  if (!t) {
    t = { ...track, trafficLevel: level, traffic: makeTraffic(track, level) };
    cache.set(key, t);
  }
  return t;
}
