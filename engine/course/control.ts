// Контрольный заезд — честная мерка «стал мозг лучше или хуже».
// Прежний мозг и новый вариант едут один и тот же заезд: те же трассы, тот же трафик, та же серия знаков.
// Мир детерминирован, поэтому разница во времени — только от мозга, а не от везения.
import { Car, maxTicksFor, type CarStatus, type Driver } from '../world/car.ts';
import { lapOf, type Track } from '../world/track.ts';
import { trafficSnapshot } from '../world/rally.ts';

const TICKS_PER_SECOND = 60;
/** Разница меньше — «так же»: доли секунды на глаз не видны, а вердикт должен быть понятен */
export const SAME_SECONDS = 0.1;

/** Как проехал одну трассу контрольного */
export type ControlLeg = {
  track: string;
  status: CarStatus | 'error';
  /** Время финиша в секундах (не доехал — null) */
  seconds: number | null;
  /** Какую долю трассы проехал, 0…1 */
  progress: number;
  /** На каком круге сошёл (доехал — null) */
  lap: number | null;
};

export type ControlResult = {
  legs: ControlLeg[];
  /** Итог в секундах, чем меньше, тем лучше. Не доехал — штраф, как в финале: любой финиш лучше любого схода */
  score: number;
};

/** Проехать все трассы контрольного. Ошибка в think() не роняет страницу: машина просто сходит */
export function controlRun(tracks: readonly Track[], driver: Driver): ControlResult {
  const legs = tracks.map((track) => drive(track, driver));
  const score = legs.reduce((sum, leg, i) => sum + legScore(leg, tracks[i]), 0);
  return { legs, score };
}

function drive(track: Track, driver: Driver): ControlLeg {
  const car = new Car(track, driver);
  const limit = maxTicksFor(track);
  let failed = false;
  try {
    while (!car.done) car.step(track, limit, trafficSnapshot(track, car.ticks));
  } catch {
    failed = true;
  }
  const progress = Math.min(1, Math.max(0, (car.bestS - track.startS) / (track.finishS - track.startS)));
  const finished = !failed && car.status === 'finished';
  return {
    track: track.name,
    status: failed ? 'error' : car.status,
    seconds: finished ? (car.finishTick ?? car.ticks) / TICKS_PER_SECOND : null,
    progress,
    lap: finished ? null : lapOf(track, car.bestS),
  };
}

const legScore = (leg: ControlLeg, track: Track): number =>
  leg.seconds ?? (maxTicksFor(track) / TICKS_PER_SECOND) * (2 - leg.progress);

/** ▲ лучше, ▼ хуже, = так же */
export type Mark = 'better' | 'worse' | 'same';
export type Verdict = { mark: Mark; text: string };

const sec = (s: number): string => `${s.toFixed(1).replace('.', ',')} с`;
const why = (leg: ControlLeg): string =>
  leg.status === 'crashed' ? `разбился на ${leg.lap}-м круге` : leg.status === 'error' ? 'ошибка в think()' : 'не успел доехать';

/**
 * Сравнить вариант с прежним мозгом. Текст — самое заметное отличие, коротко:
 * «быстрее на 2,1 с», «трасса «Змейка»: разбился на 2-м круге», «трасса «Змейка»: доехал, а прежний разбивался».
 */
export function verdict(now: ControlResult, before: ControlResult): Verdict {
  const diff = before.score - now.score;
  const mark: Mark = Math.abs(diff) < SAME_SECONDS ? 'same' : diff > 0 ? 'better' : 'worse';
  // сначала — трасса, где один доехал, а другой нет: это важнее секунд
  const i = now.legs.findIndex((leg, k) => (leg.seconds === null) !== (before.legs[k]?.seconds === null));
  if (i !== -1 && mark !== 'same') {
    const leg = now.legs[i];
    return leg.seconds === null
      ? { mark, text: `трасса «${leg.track}»: ${why(leg)}` }
      : { mark, text: `трасса «${leg.track}»: доехал, а прежний ${before.legs[i].status === 'crashed' ? 'разбивался' : 'не доезжал'}` };
  }
  if (mark === 'same') return { mark, text: `разница меньше ${sec(SAME_SECONDS)}` };
  const allFinish = now.legs.every((leg) => leg.seconds !== null);
  if (allFinish) return { mark, text: `${mark === 'better' ? 'быстрее' : 'медленнее'} на ${sec(Math.abs(diff))}` };
  // не доезжают оба — сравниваем, кто дальше
  const far = (r: ControlResult) => r.legs.reduce((sum, leg) => sum + leg.progress, 0) / r.legs.length;
  const pct = Math.round(Math.abs(far(now) - far(before)) * 100);
  const more = mark === 'better' ? 'дальше' : 'меньше';
  return { mark, text: pct ? `проехал ${more} на ${pct}% трассы` : `проехал чуть ${more}` };
}

/** Итог контрольного одной строкой: «42,3 с», «финиш на 1 трассе из 2» или «проехал 60%» */
export function controlText(result: ControlResult): string {
  if (result.legs.every((leg) => leg.seconds !== null)) return sec(result.legs.reduce((sum, leg) => sum + (leg.seconds ?? 0), 0));
  const done = result.legs.filter((leg) => leg.seconds !== null).length;
  const far = Math.round((result.legs.reduce((sum, leg) => sum + leg.progress, 0) / result.legs.length) * 100);
  return done ? `финиш на ${done} ${done === 1 ? 'трассе' : 'трассах'} из ${result.legs.length}` : `проехал ${far}%`;
}
