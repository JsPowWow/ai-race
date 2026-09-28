// «Гонка», итоги: кто за кем, что писать в таблице и кому какая номинация.
// Только расчёт — без страницы: его легко читать и проверять отдельно.
import { carReport } from '../../engine/car.ts';
import type { Car, CarReport } from '../../engine/car.ts';
import type { Track } from '../../engine/track.ts';
import { secs, pct } from '../ui.ts';

/** Машина в заезде и тот, кто её привёз */
export type Racer<Who extends { name: string } = { name: string }> = { entrant: Who; car: Car };

/** Номинация под таблицей */
export type Award = { title: string; text: string };

const finished = (car: Car) => car.status === 'finished';

/** Места: сначала доехавшие (кто быстрее), потом остальные (кто дальше уехал) */
export function standings<R extends Racer>(racers: readonly R[]): R[] {
  return [...racers].sort((a, b) => {
    if (finished(a.car) !== finished(b.car)) return finished(a.car) ? -1 : 1;
    return finished(a.car) ? (a.car.finishTick ?? 0) - (b.car.finishTick ?? 0) : b.car.bestS - a.car.bestS;
  });
}

/** Что писать в таблице: время финиша, сколько проехал или почему сошёл */
export function resultText(car: Car, track: Track): string {
  const done = pct(carReport(car, track).progressPct);
  if (car.status === 'finished') return secs(car.finishTick ?? car.ticks);
  if (car.status === 'driving') return done;
  const why = car.status === 'crashed' ? (car.crashedInto === 'car' ? 'авария' : 'бордюр') : 'сошёл';
  return `${why} · ${done}`;
}

/** Тот, у кого score больше всех (или null, если список пуст) */
function best<T>(list: T[], score: (x: T) => number): T | null {
  let top: T | null = null;
  for (const x of list) if (top === null || score(x) > score(top)) top = x;
  return top;
}

/** Номинации после финиша: победитель, самая эпичная авария, почти доехал, самый плавный ход */
export function nominations(racers: readonly Racer[], track: Track): Award[] {
  type Result = { name: string; car: Car; report: CarReport };
  const all: Result[] = racers.map(({ entrant, car }) => ({ name: entrant.name, car, report: carReport(car, track) }));
  const done = all.filter((x) => finished(x.car));
  const awards: Award[] = [];

  const winner = best(done, (x) => -(x.car.finishTick ?? Infinity));
  if (winner) awards.push({ title: 'Победитель', text: `${winner.name} — ${secs(winner.car.finishTick ?? winner.car.ticks)}` });

  const crash = best(all.filter((x) => x.car.status === 'crashed'), (x) => x.car.crashSpeed);
  if (crash) {
    const into = crash.car.crashedInto === 'car' ? 'в машину' : 'в бордюр';
    awards.push({ title: 'Самая эпичная авария', text: `${crash.name}: ${into} на скорости ${crash.car.crashSpeed.toFixed(1)}` });
  }

  const almost = best(all.filter((x) => !finished(x.car)), (x) => x.report.progressPct);
  if (almost && almost.report.progressPct > 50) awards.push({ title: 'Почти доехал', text: `${almost.name}: ${pct(almost.report.progressPct)} трассы` });

  // плавность — по тому, сколько дёргал руль за тик: сравнивать есть смысл, только если доехали двое и больше
  const smooth = best(done, (x) => -x.report.wiggle / x.report.ticks);
  if (smooth && done.length > 1) awards.push({ title: 'Самый плавный ход', text: `${smooth.name}: меньше всех дёргал руль` });
  return awards;
}
