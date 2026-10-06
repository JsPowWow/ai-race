// Следы шин на асфальте: полустёртые чёрные полосы там, где тормозят и газуют, — трасса «объезжена».
// Только картинка, как декор (ADR 0005): машины и сенсоры их не видят.
// Из seed трассы — у всех учеников на одной трассе одни и те же следы.
import { hashString, mulberry32, clamp, type Random } from '../core/utils.ts';
import { pointAt, type Track, type Point } from './track.ts';
import { cornersOf } from './scenery.ts';

/** Колея — между серединами левого и правого колеса, px (машина 24 px в ширину) */
export const GAUGE = 18;
/** Ширина следа одного колеса, px */
export const TYRE = 4;
const STEP = 6;   // шаг точек следа вдоль дороги, px
const KEEP = 8;   // столько асфальта оставить до края дороги: след не заходит на разметку края и бордюр

/**
 * След одной машины: две полосы (левые и правые колёса), точки парами поперёк дороги.
 * wear — насколько виден каждый кусочек между точками: 1 — свежий, 0 — стёрся совсем.
 * brake — тормозили перед поворотом или заносило в нём, spin — газовали со старта или на выходе из поворота
 */
export type Skid = { kind: 'brake' | 'spin'; wheels: [Point[], Point[]]; wear: number[] };

const cache = new WeakMap<Track, Skid[]>();

/** Следы трассы: считаются один раз и запоминаются. Чистая функция трассы */
export function skidsOf(track: Track): Skid[] {
  let skids = cache.get(track);
  if (!skids) cache.set(track, (skids = place(track)));
  return skids;
}

function place(track: Track): Skid[] {
  const rand = mulberry32(hashString(`${track.id}|skids`));
  const ring = track.roads[0];
  const lane = (): number => -track.width / 2 + (track.width * (Math.floor(rand() * track.lanes) + 0.5)) / track.lanes;
  const between = (a: number, b: number): number => a + rand() * (b - a);
  const skids: Skid[] = [];
  const add = (kind: Skid['kind'], s0: number, len: number, side: (t: number) => number, fresh: (t: number) => number): void => {
    skids.push(trail(track, rand, kind, s0, len, side, fresh));
  };
  // тормоз: темнеет, пока колёса блокируются, к концу чуть бледнее — отпустили педаль
  const brake = (t: number): number => Math.min(1, t / 0.25) * (1 - 0.3 * t);
  // газ: резина горит сразу, дальше колёса цепляются — след тает
  const spin = (t: number): number => Math.min(1, t / 0.06) * (1 - t) ** 1.2;

  // у старта газуют с места — по одной-две полосы
  const lanes = Array.from({ length: track.lanes }, (_, k) => k).filter(() => rand() < 0.6);
  for (const k of lanes.length ? lanes : [0]) {
    const at = -track.width / 2 + (track.width * (k + 0.5)) / track.lanes;
    add('spin', track.startS + between(0, 6), between(34, 70), (t) => at + 2 * Math.sin(t * Math.PI * 2.5) * (1 - t), spin);
  }

  for (const { apex, outer } of cornersOf(ring)) {
    // перед поворотом тормозят прямо, у самого поворота машину уже ведёт наружу
    if (rand() < 0.85) {
      const at = lane(), len = between(60, 150), end = apex - between(10, 40);
      add('brake', end - len, len, (t) => at + outer * 7 * t * t, brake);
    }
    // в повороте заносит: след уходит к внешнему краю
    if (rand() < 0.5) {
      const at = lane(), drift = between(10, 18);
      add('brake', apex - between(10, 30), between(50, 110), (t) => at + outer * drift * t, (t) => Math.sin(Math.PI * t) ** 0.5);
    }
    // на выходе дают газ — и зад виляет
    if (rand() < 0.35) {
      const at = lane();
      add('spin', apex + between(30, 60), between(40, 80), (t) => at + 3 * Math.sin(t * Math.PI * 3) * (1 - t), spin);
    }
  }
  return skids;
}

/**
 * Один след вдоль кольца: от s0 длиной len, side(t) — где середина машины поперёк дороги (t от 0 до 1),
 * fresh(t) — насколько след тёмный на этом месте. Сверху — потёртость: где светлее, где стёрт совсем
 */
function trail(track: Track, rand: Random, kind: Skid['kind'], s0: number, len: number, side: (t: number) => number, fresh: (t: number) => number): Skid {
  const n = Math.max(2, Math.round(len / STEP));
  const reach = track.width / 2 - KEEP - GAUGE / 2 - TYRE / 2;
  const left: Point[] = [], right: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, at = pointAt(track, s0 + len * t);
    const nx = -Math.sin(at.angle), ny = Math.cos(at.angle); // вправо по ходу
    const d = clamp(side(t), -reach, reach);
    left.push(round({ x: at.x + nx * (d - GAUGE / 2), y: at.y + ny * (d - GAUGE / 2) }));
    right.push(round({ x: at.x + nx * (d + GAUGE / 2), y: at.y + ny * (d + GAUGE / 2) }));
  }
  const age = 0.45 + rand() * 0.55; // одни следы свежие, другие почти стёрлись
  let noise = 0.8;
  let gap = 0;
  const wear = Array.from({ length: n }, (_, i) => {
    noise = 0.6 * noise + 0.4 * (0.5 + rand() * 0.5); // соседние кусочки похожи: пятнами, а не рябью
    if (gap > 0 || rand() < 0.08) { gap = gap > 0 ? gap - 1 : Math.floor(rand() * 2); return 0; }
    return Math.round(age * fresh((i + 0.5) / n) * noise * 100) / 100;
  });
  if (len >= 60 && !wear.includes(0)) wear[1 + Math.floor(rand() * (n - 2))] = 0; // длинный след где-то да стёрт
  return { kind, wheels: [left, right], wear };
}

const round = (q: Point): Point => ({ x: Math.round(q.x * 10) / 10, y: Math.round(q.y * 10) / 10 });
