// «Экзамен», сам расчёт: чемпион проезжает знакомые трассы и незнакомые (по seed) — сразу до конца, без показа.
import { TRAINING_TRACKS, getTrainingTrack } from '../../engine/world/track.ts';
import type { Track } from '../../engine/world/track.ts';
import { Car, carReport, maxTicksFor } from '../../engine/world/car.ts';
import type { CarStatus } from '../../engine/world/car.ts';
import { withTraffic } from '../../engine/world/traffic.ts';
import { state, thinkFn } from '../state.ts';
import { seedTrack } from '../tracks.ts';

const UNKNOWN_SEEDS = ['экзамен-1', 'экзамен-2', 'экзамен-3'];
export const KNOWN_COUNT = TRAINING_TRACKS.length;
export const UNKNOWN_COUNT = UNKNOWN_SEEDS.length;

/** Итог на одной трассе. into — во что врезался (у аварий) */
export type ExamResult = {
  title: string; track: Track; known: boolean;
  status: CarStatus; into: 'car' | 'wall' | null; pct: number; ticks: number;
};

/** Как на гонке: всегда с попутными и встречными машинами */
const examTracks = () => [
  ...TRAINING_TRACKS.map(({ id }) => ({ track: withTraffic(getTrainingTrack(id), 'all'), known: true })),
  ...UNKNOWN_SEEDS.map((seed) => ({ track: withTraffic(seedTrack(seed), 'all'), known: false })),
];

/** Машина с текущим мозгом (его формой, сенсорами и вариантом think) */
export const championCar = (track: Track): Car =>
  new Car(track, { brain: state.champion, think: thinkFn(), sensors: state.config.sensors });

/** Проехать все трассы экзамена. Мозг должен быть обучен */
export function runExam(): ExamResult[] {
  let unknown = 0;
  return examTracks().map(({ track, known }) => {
    const car = championCar(track);
    const maxTicks = maxTicksFor(track);
    while (!car.done) car.step(track, maxTicks);
    return {
      title: known ? track.name : `Незнакомая ${++unknown}`,
      track, known, status: car.status, into: car.crashedInto, pct: carReport(car, track).progressPct, ticks: car.ticks,
    };
  });
}

/** Что сказать ученику по итогам */
export function verdict(results: readonly ExamResult[]): string {
  const known = results.filter((r) => r.known && r.status === 'finished').length;
  const unknown = results.filter((r) => !r.known && r.status === 'finished').length;
  if (known + unknown === results.length) return 'Доехал везде. Можно на гонку. Теперь выжимай скорость через фитнес.';
  if (known + unknown === 0) return 'Пока не доехал ни разу. Учи дальше или поменяй настройки.';
  const score = `Знакомые трассы: ${known} из ${KNOWN_COUNT}, незнакомые: ${unknown} из ${UNKNOWN_COUNT}.`;
  if (unknown === 0) return `${score} Похоже на переобучение: мозг выучил трассу, а не умение ездить. Попробуй режим «Микс».`;
  return `${score} На гонке будет незнакомая трасса.`;
}
