// Финал курса: ралли из нескольких этапов и суперфинал.
//
// Машины участников друг друга не видят (мешают только бордюры и трафик), поэтому каждый заезд
// считается отдельно — хоть 500 участников, хоть 1000. Считаем заранее, а на стриме показываем запись.
// Всё детерминировано: одна секретная фраза + один файл = один и тот же результат на любом компьютере.
import { Car, maxTicksFor, type CarStatus, type Driver } from './car.ts';
import { generateTrack, type Track } from './track.ts';
import { withTraffic, trafficAt, type TrafficSpot } from './traffic.ts';
import { clamp } from './utils.ts';
import { messageOf } from './errors.ts';

export const STAGES = 3;
export const SUPERFINAL_SIZE = 10;
export const FINAL_TRAFFIC = 'all';

/**
 * Результат одного заезда. status: как у машины, или 'error' — упал код think, 'hung' — код завис.
 * traj — запись: по REC_FIELDS чисел раз в REC_EVERY тиков
 */
export type StageResult = {
  status: CarStatus | 'error' | 'hung'; ticks: number; finishTick: number | null; progress: number; limit: number;
  crashedInto: 'car' | 'wall' | null; crashSpeed: number; wiggle: number; topSpeed: number;
  message: string | null; traj: Float32Array;
};
/** Участник: у него может быть больше полей, зачёту нужны эти. dq — почему снят */
export type Entry = { id: string; name: string; dq?: string | null };
/** Результаты этапа: id участника → заезд */
export type StageResults = Map<string, StageResult>;
/** Строка общего зачёта */
export type StandingRow<E extends Entry> = { entry: E; times: number[]; total: number; finished: number; place: number; superTime?: number };
/** Номинация: entry — кому (null — всем, как «Железные») */
export type Award<E extends Entry> = { title: string; entry: E | null; text: string };
/** Записываем положение каждой машины раз в REC_EVERY тиков (между ними — плавно дорисовываем) */
export const REC_EVERY = 2;
/** Сколько чисел в одной записи: x, y, угол, доля пройденной трассы */
export const REC_FIELDS = 4;

const TICKS_PER_SECOND = 60;
const SUPERFINAL = STAGES;

/** Этапы 0…STAGES-1, потом суперфинал */
export const stageLabel = (i: number): string => (i === SUPERFINAL ? 'Суперфинал' : `Этап ${i + 1}`);
export const stageSeed = (secret: string, i: number): string => `${secret} · ${i === SUPERFINAL ? 'суперфинал' : `этап ${i + 1}`}`;
export const stageTrack = (seed: string): Track => withTraffic(generateTrack(seed), FINAL_TRAFFIC);
export const isSuperfinal = (i: number): boolean => i === SUPERFINAL;

/** Трафик на тике tick. Он одинаковый для всех участников, поэтому считаем один раз и запоминаем. */
export function trafficSnapshot(track: Track, tick: number): TrafficSpot[] | null {
  if (!track.traffic) return null;
  const timeline = (track.timeline ??= []);
  return (timeline[tick] ??= trafficAt(track, track.traffic, tick));
}

/**
 * Проехать трассу и записать заезд.
 * Ошибка в think() не роняет расчёт: машина останавливается со статусом 'error'.
 */
export function driveRecorded(track: Track, driver: Driver): StageResult {
  const car = new Car(track, driver);
  const limit = maxTicksFor(track);
  const length = track.finishS - track.startS;
  const progress = (): number => clamp((car.bestS - track.startS) / length, 0, 1);
  const samples: number[] = [];
  const record = (): void => { samples.push(car.x, car.y, car.angle, progress()); };

  record();
  let message: string | null = null;
  try {
    while (!car.done) {
      car.step(track, limit, trafficSnapshot(track, car.ticks));
      if (car.ticks % REC_EVERY === 0 || car.done) record();
    }
  } catch (e) {
    message = messageOf(e).slice(0, 200);
  }
  return {
    status: message !== null ? 'error' : car.status,
    ticks: car.ticks,
    finishTick: car.finishTick,
    progress: progress(),
    limit,
    crashedInto: car.crashedInto,
    crashSpeed: car.crashSpeed,
    wiggle: car.wiggle,
    topSpeed: car.topSpeed,
    message,
    traj: new Float32Array(samples),
  };
}

/**
 * Страховка куратора: на каких этапах не доехал ни один из drivers (обычно боты с «Гонки»).
 * Такой этап, скорее всего, слишком трудный — лучше взять другую фразу.
 */
export function hardStages(tracks: Track[], drivers: Driver[]): number[] {
  const finishes = (track: Track, driver: Driver): boolean => {
    const car = new Car(track, driver);
    const limit = maxTicksFor(track);
    while (!car.done) car.step(track, limit, trafficSnapshot(track, car.ticks));
    return car.status === 'finished';
  };
  return tracks.flatMap((track, i) => (drivers.some((d) => finishes(track, d)) ? [] : [i]));
}

/** Запись, которую нельзя было посчитать (код завис или не собрался) */
export const failedResult = (status: StageResult['status'], message: string, limit = 0): StageResult => ({
  status, ticks: 0, finishTick: null, progress: 0, limit, crashedInto: null,
  crashSpeed: 0, wiggle: 0, topSpeed: 0, message, traj: new Float32Array(0),
});

/**
 * Время этапа в секундах — чем меньше, тем лучше.
 * Не доехал — штраф: лимит времени × (2 − доля трассы). Любой финиш лучше любого схода,
 * а из сошедших выше тот, кто проехал дальше.
 */
export function stageTime(result: StageResult | undefined): number {
  if (!result || result.status === 'hung' || !result.limit) return Infinity; // посчитать не удалось — в самый конец
  if (result.status === 'finished') return (result.finishTick ?? result.ticks) / TICKS_PER_SECOND;
  return (result.limit / TICKS_PER_SECOND) * (2 - result.progress);
}

/** Сравнение чисел, в котором Infinity тоже работает */
const cmp = (a: number, b: number): number => (a === b ? 0 : a < b ? -1 : 1);
const round = (x: number): number => (Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : x);

/** Места с ничьими: одинаковый результат — одно место (1, 2, 2, 4) */
function assignPlaces<R extends { place: number }>(rows: R[], key: (row: R) => unknown): R[] {
  rows.forEach((row, i) => {
    const prev = rows[i - 1];
    row.place = prev && key(prev) === key(row) ? prev.place : i + 1;
  });
  return rows;
}

/**
 * Общий зачёт после первых `upTo` этапов.
 * results[stage] — Map: id участника → результат. Снятые участники (entry.dq) в зачёт не идут.
 */
export function standings<E extends Entry>(entries: E[], results: StageResults[], upTo: number): StandingRow<E>[] {
  const rows = entries.filter((e) => !e.dq).map((entry): StandingRow<E> => {
    const stages: (StageResult | undefined)[] = [];
    for (let s = 0; s < upTo; s++) stages.push(results[s].get(entry.id));
    const times = stages.map(stageTime);
    return {
      entry,
      times,
      total: round(times.reduce((a, b) => a + b, 0)),
      finished: stages.filter((r) => r?.status === 'finished').length,
      place: 0, // расставит assignPlaces
    };
  });
  rows.sort((a, b) => cmp(a.total, b.total) || a.entry.name.localeCompare(b.entry.name, 'ru'));
  return assignPlaces(rows, (r) => r.total);
}

/** Кто едет в суперфинал: первые SUPERFINAL_SIZE строк общего зачёта */
export const superfinalists = <E extends Entry>(rows: StandingRow<E>[]): E[] => rows.slice(0, SUPERFINAL_SIZE).map((r) => r.entry);

/**
 * Итог: суперфиналисты — по времени суперфинала (при равенстве — по общему зачёту),
 * остальные — по общему зачёту, места продолжаются после суперфиналистов.
 */
export function finalStandings<E extends Entry>(rows: StandingRow<E>[], superResults: StageResults): StandingRow<E>[] {
  const top = rows.filter((r) => superResults.has(r.entry.id))
    .map((r) => ({ ...r, superTime: round(stageTime(superResults.get(r.entry.id))) }))
    .sort((a, b) => cmp(a.superTime, b.superTime) || cmp(a.total, b.total));
  assignPlaces(top, (r) => `${r.superTime ?? ''}|${r.total}`);
  const rest = rows.filter((r) => !superResults.has(r.entry.id)).map((r) => ({ ...r }));
  assignPlaces(rest, (r) => r.total).forEach((r) => (r.place += top.length));
  return [...top, ...rest];
}

/** Номинации: победитель, лучшее время каждого этапа, самая эпичная авария и другие */
export function nominations<E extends Entry>(entries: E[], results: StageResults[], finalRows: StandingRow<E>[]): Award<E>[] {
  const awards: Award<E>[] = [];
  const alive = entries.filter((e) => !e.dq);
  /** Результат участника на этапе: после расчёта он есть у каждого, кто не снят */
  const resultOf = (s: number, e: E): StageResult => results[s].get(e.id) ?? failedResult('error', 'нет результата');
  const secs = (ticks: number): string => `${(ticks / TICKS_PER_SECOND).toFixed(2)} с`;

  const winner = finalRows[0];
  if (winner) awards.push({ title: 'Победитель', entry: winner.entry, text: winner.superTime !== undefined ? `суперфинал за ${winner.superTime.toFixed(2)} с` : 'лучшая сумма этапов' });

  for (let s = 0; s < STAGES; s++) {
    let best: { e: E; tick: number } | null = null;
    for (const e of alive) {
      const r = resultOf(s, e);
      if (r.status === 'finished' && r.finishTick !== null && (!best || r.finishTick < best.tick)) best = { e, tick: r.finishTick };
    }
    if (best) awards.push({ title: `Быстрее всех: ${stageLabel(s).toLowerCase()}`, entry: best.e, text: secs(best.tick) });
  }

  let crash: { e: E; r: StageResult; s: number } | null = null;
  for (const e of alive) {
    for (let s = 0; s < STAGES; s++) {
      const r = resultOf(s, e);
      if (r.status === 'crashed' && (!crash || r.crashSpeed > crash.r.crashSpeed)) crash = { e, r, s };
    }
  }
  if (crash) awards.push({ title: 'Самая эпичная авария', entry: crash.e, text: `${stageLabel(crash.s)}: ${crash.r.crashedInto === 'car' ? 'в машину' : 'в бордюр'} на скорости ${crash.r.crashSpeed.toFixed(1)}` });

  const iron = alive.filter((e) => Array.from({ length: STAGES }, (_, s) => resultOf(s, e)).every((r) => r.status === 'finished'));
  if (iron.length) {
    let smooth: { e: E; score: number } | null = null;
    for (const e of iron) {
      const rs = Array.from({ length: STAGES }, (_, s) => resultOf(s, e));
      const score = rs.reduce((a, r) => a + r.wiggle, 0) / rs.reduce((a, r) => a + r.ticks, 0);
      if (!smooth || score < smooth.score) smooth = { e, score };
    }
    if (smooth) awards.push({ title: 'Самый плавный ход', entry: smooth.e, text: 'меньше всех дёргал руль на всех этапах' });
    awards.push({ title: 'Железные', entry: null, text: `доехали все ${STAGES} этапа: ${iron.length} из ${alive.length}` });
  }

  let almost: { e: E; r: StageResult; s: number } | null = null;
  for (const e of alive) {
    for (let s = 0; s < STAGES; s++) {
      const r = resultOf(s, e);
      if (r.status !== 'finished' && r.progress >= 0.9 && (!almost || r.progress > almost.r.progress)) almost = { e, r, s };
    }
  }
  if (almost) awards.push({ title: 'Чуть-чуть не хватило', entry: almost.e, text: `${stageLabel(almost.s)}: ${Math.floor(almost.r.progress * 100)}% трассы` });
  return awards;
}
