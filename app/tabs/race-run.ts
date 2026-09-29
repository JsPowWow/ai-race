// «Гонка», сам заезд: все участники на одной секретной трассе, тик за тиком, после отсчёта «3 — 2 — 1».
// Машины двигает кадровый цикл (tickRace); страница узнаёт итоги через сигналы: таблица, номинации, кнопка старта.
import { effect, signal, untracked } from '@reely/dommy';
import { Car, maxTicksFor } from '../../engine/car.ts';
import { withTraffic } from '../../engine/traffic.ts';
import type { TrafficLevel } from '../../engine/traffic.ts';
import type { Track } from '../../engine/track.ts';
import { state, emit } from '../state.ts';
import { seedTrack } from '../tracks.ts';
import { startCountdown, stopCountdown, updateCountdown } from '../countdown.ts';
import { trafficOn, showBanner } from '../stage.ts';
import { entrants } from './race-entrants.tsx';
import type { Entrant } from './race-entrants.tsx';
import { standings, resultText, nominations } from './race-results.ts';
import type { Racer, Award } from './race-results.ts';

export const DEFAULT_SEED = 'урок-1';
/** Как часто обновлять таблицу во время заезда: раз в столько кадров (чаще глаз не успевает) */
const BOARD_EVERY_FRAMES = 6;

/** Строка таблицы. podium — 'p1'…'p3' у доехавших на пьедестал */
export type BoardRow = { entrant: Entrant; result: string; podium: string | null };

/** Заезд. Меняется каждый тик, поэтому это обычный объект, а не сигнал: кадры рисуются из него */
export const race = {
  track: null as Track | null, // трассу строим, когда вкладку открыли в первый раз
  cars: [] as Racer<Entrant>[],
  tick: 0,
  maxTicks: 0,
  running: false,
  finished: false,
};

/** Сколько тиков за кадр: ×1, ×2, ×4, ×8 */
export const speed = signal(1);
/** Нажали «Старт гонки»: кнопка теперь — «Заново» */
export const started = signal(false);
/** Таблица и номинации — для страницы */
export const board = signal<readonly BoardRow[]>([]);
export const awards = signal<readonly Award[]>([]);

/** Поставить всех на старт: трасса по seed, у каждого участника с работающим мозгом — своя машина */
export function prepare(): void {
  // уровень трафика берём из списка на странице; чужое значение из хранилища makeTraffic просто не узнает
  const track = withTraffic(seedTrack(state.race.seed || DEFAULT_SEED), state.race.traffic as TrafficLevel);
  race.track = track;
  race.cars = entrants.peek().filter((e) => e.think).map((entrant) => ({ entrant, car: new Car(track, entrant) }));
  Object.assign(race, { tick: 0, maxTicks: maxTicksFor(track), running: false, finished: false });
  stopCountdown();
  started.value = false;
  awards.value = [];
  publishBoard();
}

// Участники поменялись — заезд заново. Пока вкладку не открывали, трассу не строим: это сделает первый prepare()
effect(() => {
  void entrants.value; // читаем список — значит, подписаны на его перемены
  if (untracked(() => race.track)) untracked(prepare);
});

export function start(): void {
  prepare();
  if (!race.cars.length) return showBanner('Добавь участников');
  startCountdown();
  started.value = true;
  emit('did', 'race:start');
}

/** Кадр гонки: отсчёт, потом speed тиков */
export function tickRace(frameNo: number): void {
  if (updateCountdown() && !race.finished) race.running = true;
  if (!race.running) return;
  advance();
  if (frameNo % BOARD_EVERY_FRAMES === 0) publishBoard();
}

/** Несколько тиков за кадр: все машины видят один и тот же трафик */
function advance(): void {
  const { track } = race;
  if (!track) return;
  for (let k = 0; k < speed.peek(); k++) {
    const traffic = trafficOn(track, race.tick);
    let driving = 0;
    for (const { car } of race.cars) {
      car.step(track, race.maxTicks, traffic);
      if (!car.done) driving++;
    }
    race.tick++;
    if (!driving) return finish();
  }
}

function finish(): void {
  race.running = false;
  race.finished = true;
  publishBoard();
  if (!race.track) return;
  awards.value = nominations(race.cars, race.track);
  const [winner] = standings(race.cars);
  showBanner(winner?.car.status === 'finished' ? `Победил ${winner.entrant.name}!` : 'Никто не доехал', 3000);
}

/** Таблица сейчас — каждый раз новые строки: так строки на странице узнают, что результат поменялся */
function publishBoard(): void {
  const { track } = race;
  if (!track) return;
  board.value = standings(race.cars).map(({ entrant, car }, i) => ({
    entrant,
    result: resultText(car, track),
    podium: car.status === 'finished' && i < 3 ? `p${i + 1}` : null,
  }));
}
