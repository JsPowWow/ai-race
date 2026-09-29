// «Гонка», сам заезд: все участники на одной секретной трассе, тик за тиком, после отсчёта «3 — 2 — 1».
// Машины двигает кадровый цикл (tickRace); страница узнаёт итоги через сигналы: таблица, номинации, кнопка старта.
import { effect, signal, untracked } from '@reely/dommy';
import { Car, maxTicksFor } from '../../engine/car.ts';
import { withTraffic } from '../../engine/traffic.ts';
import type { TrafficLevel } from '../../engine/traffic.ts';
import { lapOf, type Track } from '../../engine/track.ts';
import { state, emit } from '../state.ts';
import { seedTrack } from '../tracks.ts';
import { startCountdown, stopCountdown, updateCountdown } from '../countdown.ts';
import { trafficOn, showBanner } from '../stage.ts';
import { entrants } from './race-entrants.tsx';
import type { Entrant } from './race-entrants.tsx';
import { standings, resultText, nominations } from './race-results.ts';
import type { Racer, Award } from './race-results.ts';
import type { FlapRow } from '../components/flap-board.tsx';

export const DEFAULT_SEED = 'урок-1';
/** Как часто обновлять таблицу во время заезда: раз в столько кадров (чаще глаз не успевает) */
const BOARD_EVERY_FRAMES = 6;
/** Табло-флапы листаются медленнее: раз в полсекунды, иначе цифры отставания мелькают */
const FLAPS_EVERY_FRAMES = 30;

/** Строка таблицы. podium — 'p1'…'p3' у доехавших на пьедестал */
export type BoardRow = { entrant: Entrant; result: string; podium: string | null };

/** Заезд. Меняется каждый тик, поэтому это обычный объект, а не сигнал: кадры рисуются из него */
export const race = {
  track: null as Track | null, // трассу строим, когда вкладку открыли в первый раз
  cars: [] as Racer<Entrant>[],
  tick: 0,
  maxTicks: 0,
  /** Докуда доехал лидер к каждому тику: по нему отставание — «лидер был здесь столько-то секунд назад» */
  leaderAt: [] as number[],
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
/** Колонки табло-флапов над трассой */
export type FlapKey = 'place' | 'name' | 'lap' | 'gap';
/** Табло-флапы: все по местам (сколько показать, решает табло) */
export const flaps = signal<readonly FlapRow<FlapKey>[]>([]);

/** Поставить всех на старт: трасса по seed, у каждого участника с работающим мозгом — своя машина */
export function prepare(): void {
  // уровень трафика берём из списка на странице; чужое значение из хранилища makeTraffic просто не узнает
  const track = withTraffic(seedTrack(state.race.seed || DEFAULT_SEED), state.race.traffic as TrafficLevel);
  race.track = track;
  race.cars = entrants.peek().filter((e) => e.think).map((entrant) => ({ entrant, car: new Car(track, entrant) }));
  Object.assign(race, { tick: 0, maxTicks: maxTicksFor(track), running: false, finished: false, leaderAt: [track.startS] });
  stopCountdown();
  started.value = false;
  awards.value = [];
  publishBoard();
  publishFlaps();
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
  if (frameNo % FLAPS_EVERY_FRAMES === 0) publishFlaps();
}

/** Несколько тиков за кадр: все машины видят один и тот же трафик */
function advance(): void {
  const { track } = race;
  if (!track) return;
  for (let k = 0; k < speed.peek(); k++) {
    const traffic = trafficOn(track, race.tick);
    let driving = 0;
    let lead = race.leaderAt[race.tick] ?? track.startS;
    for (const { car } of race.cars) {
      car.step(track, race.maxTicks, traffic);
      if (!car.done) driving++;
      lead = Math.max(lead, car.bestS);
    }
    race.tick++;
    race.leaderAt[race.tick] = lead;
    if (!driving) return finish();
  }
}

function finish(): void {
  race.running = false;
  race.finished = true;
  publishBoard();
  publishFlaps();
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

// ── табло-флапы ──

/** Тики → «12,4» (без «с»: на табло каждая плитка на счету) */
const short = (ticks: number) => (ticks / 60).toFixed(1).replace('.', ',');

/** Когда лидер впервые доехал до s: первый тик, где leaderAt ≥ s (leaderAt только растёт — ищем делением пополам) */
function tickLeaderPassed(s: number): number {
  const at = race.leaderAt;
  let lo = 0;
  let hi = at.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((at[mid] ?? Infinity) >= s) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Правая колонка: у лидера — его время, у остальных — «+отставание», у сошедших — почему */
function gapText({ car }: Racer<Entrant>, place: number, winnerTicks: number | null): string {
  if (car.status === 'finished') {
    const ticks = car.finishTick ?? car.ticks;
    return place === 0 || winnerTicks === null ? short(ticks) : `+${short(ticks - winnerTicks)}`;
  }
  if (car.status === 'crashed') return car.crashedInto === 'car' ? 'АВАРИЯ' : 'БОРДЮР';
  if (car.status !== 'driving') return 'СОШЁЛ';
  if (!race.tick) return '';
  return place === 0 ? short(race.tick) : `+${short(race.tick - tickLeaderPassed(car.bestS))}`;
}

function publishFlaps(): void {
  const { track } = race;
  if (!track) return;
  const order = standings(race.cars);
  const [first] = order;
  const winnerTicks = first?.car.status === 'finished' ? (first.car.finishTick ?? first.car.ticks) : null;
  flaps.value = order.map((racer, i) => ({
    id: racer.entrant.id,
    color: racer.entrant.color,
    rank: i + 1,
    you: racer.entrant.source === 'mine',
    cells: {
      place: String(i + 1),
      name: racer.entrant.name,
      lap: racer.car.status === 'finished' ? 'ФИН' : `${lapOf(track, racer.car.bestS)}/${track.laps}`,
      gap: gapText(racer, i, winnerTicks),
    },
  }));
}
