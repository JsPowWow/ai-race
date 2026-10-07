// Призрак на «Я учу» (#10): рядом с машиной едет полупрозрачная вторая — сразу видно, догнал ли ученик учителя.
// Рулишь ты — рядом едет твой мозг. Едет мозг — рядом твой лучший заезд по этой трассе: запись нажатий,
// повторяем её тик в тик (мир детерминирован — машина проедет ровно там же). Призрак ни с кем не сталкивается.
import { Car, maxTicksFor, type Think } from '../../engine/world/car.ts';
import type { Track } from '../../engine/world/track.ts';
import type { TrafficSpot } from '../../engine/world/traffic.ts';
import { unpackSample } from '../../engine/learn/imitation.ts';
import { state, thinkFn } from '../state.ts';
import { bestRun } from '../runs.ts';
import { num } from '../format.ts';
import { field } from '../ui.ts';
import { cssColor } from '../../engine/draw/render.ts';

/**
 * Призрак: его машина, подпись и цвет. trail — сколько проехал к каждому тику он и твоя машина:
 * по ним видно, на сколько секунд один впереди другого (как отсечки в гонках)
 */
export type Ghost = { car: Car; label: string; color: () => string; traffic: boolean; trail: { ghost: number[]; car: number[] } };

/** Нажатия записанного заезда по порядку — как будто это думает мозг. Кончились — ничего не жмём */
function replay(packed: readonly string[]): Think {
  const presses = packed.map((p) => unpackSample(p).y);
  let tick = 0;
  return () => presses[tick++] ?? [0, 0, 0, 0];
}

/** Кто едет рядом: byBrain — рулит мозг (тогда призрак — твой лучший заезд), иначе — ты (призрак — мозг) */
export function makeGhost(track: Track, byBrain: boolean): Ghost | null {
  const sensors = state.config.sensors;
  if (byBrain) {
    const run = bestRun(track.name, state.drive.traffic);
    if (!run) return null;
    // мозг-заглушка: машина зовёт think, только если мозг есть; сами нажатия — из записи
    const car = new Car(track, { brain: { layers: [] }, think: replay(run.packed), sensors });
    return { car, label: 'ты', color: () => state.profile.color, traffic: false, trail: { ghost: [], car: [] } };
  }
  if (!state.champion) return null;
  // мозг едет по-настоящему, с теми же машинами на дороге, — как поехал бы вместо тебя
  const car = new Car(track, { brain: state.champion, think: thinkFn(), sensors });
  return { car, label: 'мозг', color: () => cssColor('--brain'), traffic: true, trail: { ghost: [], car: [] } };
}

/** Шаг призрака — вместе с твоей машиной (её шаг уже сделан) */
export function stepGhost(ghost: Ghost | null, track: Track, traffic: TrafficSpot[] | null, car: Car): void {
  if (!ghost) return;
  if (!ghost.car.done) ghost.car.step(track, maxTicksFor(track), ghost.traffic ? traffic : null);
  ghost.trail.ghost.push(ghost.car.bestS);
  ghost.trail.car.push(car.bestS);
}

/** Первый тик, когда пройдено не меньше s (путь только растёт — ищем делением пополам) */
function tickAt(trail: readonly number[], s: number): number {
  let lo = 0, hi = trail.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (trail[mid] >= s) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Для табло: «ты впереди на 1,2 с» — отстающий был там, где сейчас лидер, столько секунд назад */
export function ghostGap(ghost: Ghost | null): string {
  if (!ghost || !ghost.trail.car.length) return '';
  const { ghost: g, car: c } = ghost.trail;
  const now = c.length - 1, ahead = g[now] >= c[now];
  const behind = ahead ? tickAt(g, c[now]) : tickAt(c, g[now]);
  const secs = num((now - behind) / 60);
  return secs === '0,0' ? field(ghost.label, 'рядом') : field(`${ghost.label} ${ahead ? 'впереди' : 'сзади'} на`, `${secs} с`);
}
