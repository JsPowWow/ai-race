// «Машина времени» роя (#11): лучшие разных поколений едут вместе по одной трассе — видно, как рой учился.
// Снимки — в машине гаража (state.timeline): мозг и форма машины тогда, по одному на поколения 1, 5, 10, 25…
// Заезд — на трассе урока с той же серией машин, что у контрольного заезда: всё детерминировано, как в гонке.
import { signal } from '@reely/dommy';
import { Car, maxTicksFor } from '../../engine/world/car.ts';
import { cloneBrain, type Brain } from '../../engine/net/brain.ts';
import { trafficAt, type TrafficSpot } from '../../engine/world/traffic.ts';
import type { Track } from '../../engine/world/track.ts';
import { state, thinkFn, on, type Moment } from '../state.ts';

/** Какие поколения запоминаем: сначала часто (там рой меняется быстрее всего), потом всё реже */
export const MILESTONES = [1, 5, 10, 25, 50, 100, 250, 500, 1000];

/** Конец поколения gen: если это веха — запомнить его лучшего. Вех немного: место в браузере дорогое */
export function rememberMoment(gen: number, brain: Brain): void {
  if (!MILESTONES.includes(gen) || state.timeline.some((m) => m.gen === gen)) return;
  state.timeline = [...state.timeline, { gen, brain: cloneBrain(brain), config: structuredClone(state.config) }];
}

/** Машина в заезде: чей это снимок. now — лучший роя прямо сейчас, его ещё нет среди вех */
export type Rider = { gen: number; now: boolean; car: Car };

export type Replay = {
  track: Track;
  riders: Rider[];
  tick: number;
  maxTicks: number;
  traffic: TrafficSpot[] | null;
};

const replay = signal<Replay | null>(null);
export const currentReplay = (): Replay | null => replay.value;

/** Лучший роя прямо сейчас: поколение и его мозг */
export type Latest = { gen: number; brain: Brain } | null;

/** Снимки для заезда: вехи по порядку и лучший роя сейчас, если он новее последней вехи */
export function moments(timeline: readonly Moment[], latest: Latest): (Moment & { now: boolean })[] {
  const list = [...timeline].sort((a, b) => a.gen - b.gen).map((m) => ({ ...m, now: false }));
  const last = list.at(-1)?.gen ?? 0;
  if (latest && latest.gen > last) list.push({ ...latest, config: state.config, now: true });
  return list;
}

/** «Машина времени»: все снимки — на старт, на трассе урока */
export function startReplay(track: Track, latest: Latest): void {
  const riders = moments(state.timeline, latest).map(({ gen, brain, config, now }) => ({
    gen, now, car: new Car(track, { brain: cloneBrain(brain), think: thinkFn(config.think), sensors: config.sensors }),
  }));
  replay.value = { track, riders, tick: 0, maxTicks: maxTicksFor(track), traffic: null };
}

export const stopReplay = (): void => {
  replay.value = null;
};

/** Проехать ticks тиков (зовёт кадр вкладки). Возвращает, едет ли ещё кто-нибудь */
export function stepReplay(ticks: number): boolean {
  const now = replay.peek();
  if (!now) return false;
  let driving = now.riders.some((r) => !r.car.done);
  for (let n = 0; n < ticks && driving; n++) {
    // встречные и попутные — функция тика, как у роя и в гонке: у всех снимков одна и та же дорога
    now.traffic = now.track.traffic ? trafficAt(now.track, now.track.traffic, now.tick) : null;
    for (const { car } of now.riders) car.step(now.track, now.maxTicks, now.traffic);
    now.tick++;
    driving = now.riders.some((r) => !r.car.done);
  }
  return driving;
}

// Другая машина гаража или «Сбросить мозг» — снимков тех уже нет
on('car', stopReplay);
on('reset', stopReplay);
