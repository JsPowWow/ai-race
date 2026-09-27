// Финал курса: ралли из нескольких этапов и суперфинал.
//
// Машины участников друг друга не видят (мешают только бордюры и трафик), поэтому каждый заезд
// считается отдельно — хоть 500 участников, хоть 1000. Считаем заранее, а на стриме показываем запись.
// Всё детерминировано: одна секретная фраза + один файл = один и тот же результат на любом компьютере.
import { Car, maxTicksFor } from './car.js';
import { generateTrack } from './track.js';
import { withTraffic, trafficAt } from './traffic.js';
import { clamp } from './utils.js';

export const STAGES = 3;
export const SUPERFINAL_SIZE = 10;
export const FINAL_TRAFFIC = 'all';
/** Записываем положение каждой машины раз в REC_EVERY тиков (между ними — плавно дорисовываем) */
export const REC_EVERY = 2;
/** Сколько чисел в одной записи: x, y, угол, доля пройденной трассы */
export const REC_FIELDS = 4;

const TICKS_PER_SECOND = 60;
const SUPERFINAL = STAGES;

/** Этапы 0…STAGES-1, потом суперфинал */
export const stageLabel = (i) => (i === SUPERFINAL ? 'Суперфинал' : `Этап ${i + 1}`);
export const stageSeed = (secret, i) => `${secret} · ${i === SUPERFINAL ? 'суперфинал' : `этап ${i + 1}`}`;
export const stageTrack = (seed) => withTraffic(generateTrack(seed), FINAL_TRAFFIC);
export const isSuperfinal = (i) => i === SUPERFINAL;

/** Трафик на тике tick. Он одинаковый для всех участников, поэтому считаем один раз и запоминаем. */
export function trafficSnapshot(track, tick) {
  if (!track.traffic) return null;
  const timeline = (track.timeline ??= []);
  return (timeline[tick] ??= trafficAt(track, track.traffic, tick));
}

/**
 * Проехать трассу и записать заезд.
 * Ошибка в think() не роняет расчёт: машина останавливается со статусом 'error'.
 */
export function driveRecorded(track, driver) {
  const car = new Car(track, driver);
  const limit = maxTicksFor(track);
  const length = track.finishS - track.startS;
  const progress = () => clamp((car.bestS - track.startS) / length, 0, 1);
  const samples = [];
  const record = () => samples.push(car.x, car.y, car.angle, progress());

  record();
  let message = null;
  try {
    while (!car.done) {
      car.step(track, limit, trafficSnapshot(track, car.ticks));
      if (car.ticks % REC_EVERY === 0 || car.done) record();
    }
  } catch (e) {
    message = String(e?.message ?? e).slice(0, 200);
  }
  return {
    status: message ? 'error' : car.status,
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

/** Запись, которую нельзя было посчитать (код завис или не собрался) */
export const failedResult = (status, message, limit = 0) => ({
  status, ticks: 0, finishTick: null, progress: 0, limit, crashedInto: null,
  crashSpeed: 0, wiggle: 0, topSpeed: 0, message, traj: new Float32Array(0),
});

/**
 * Время этапа в секундах — чем меньше, тем лучше.
 * Не доехал — штраф: лимит времени × (2 − доля трассы). Любой финиш лучше любого схода,
 * а из сошедших выше тот, кто проехал дальше.
 */
export function stageTime(result) {
  if (!result || result.status === 'hung' || !result.limit) return Infinity; // посчитать не удалось — в самый конец
  if (result.status === 'finished') return result.finishTick / TICKS_PER_SECOND;
  return (result.limit / TICKS_PER_SECOND) * (2 - result.progress);
}

/** Сравнение чисел, в котором Infinity тоже работает */
const cmp = (a, b) => (a === b ? 0 : a < b ? -1 : 1);
const round = (x) => (Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : x);

/** Места с ничьими: одинаковый результат — одно место (1, 2, 2, 4) */
function assignPlaces(rows, key) {
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
export function standings(entries, results, upTo) {
  const rows = entries.filter((e) => !e.dq).map((entry) => {
    const stages = [];
    for (let s = 0; s < upTo; s++) stages.push(results[s].get(entry.id));
    const times = stages.map(stageTime);
    return {
      entry,
      times,
      total: round(times.reduce((a, b) => a + b, 0)),
      finished: stages.filter((r) => r.status === 'finished').length,
    };
  });
  rows.sort((a, b) => cmp(a.total, b.total) || a.entry.name.localeCompare(b.entry.name, 'ru'));
  return assignPlaces(rows, (r) => r.total);
}

/** Кто едет в суперфинал: первые SUPERFINAL_SIZE строк общего зачёта */
export const superfinalists = (rows) => rows.slice(0, SUPERFINAL_SIZE).map((r) => r.entry);

/**
 * Итог: суперфиналисты — по времени суперфинала (при равенстве — по общему зачёту),
 * остальные — по общему зачёту, места продолжаются после суперфиналистов.
 */
export function finalStandings(rows, superResults) {
  const top = rows.filter((r) => superResults.has(r.entry.id))
    .map((r) => ({ ...r, superTime: round(stageTime(superResults.get(r.entry.id))) }))
    .sort((a, b) => cmp(a.superTime, b.superTime) || cmp(a.total, b.total));
  assignPlaces(top, (r) => `${r.superTime}|${r.total}`);
  const rest = rows.filter((r) => !superResults.has(r.entry.id)).map((r) => ({ ...r }));
  assignPlaces(rest, (r) => r.total).forEach((r) => (r.place += top.length));
  return [...top, ...rest];
}

/** Номинации: победитель, лучшее время каждого этапа, самая эпичная авария и другие */
export function nominations(entries, results, finalRows) {
  const awards = [];
  const alive = entries.filter((e) => !e.dq);
  const secs = (ticks) => `${(ticks / TICKS_PER_SECOND).toFixed(2)} с`;

  const winner = finalRows[0];
  if (winner) awards.push({ title: 'Победитель', entry: winner.entry, text: winner.superTime !== undefined ? `суперфинал за ${winner.superTime.toFixed(2)} с` : 'лучшая сумма этапов' });

  for (let s = 0; s < STAGES; s++) {
    let best = null;
    for (const e of alive) {
      const r = results[s].get(e.id);
      if (r.status === 'finished' && (!best || r.finishTick < best.r.finishTick)) best = { e, r };
    }
    if (best) awards.push({ title: `Быстрее всех: ${stageLabel(s).toLowerCase()}`, entry: best.e, text: secs(best.r.finishTick) });
  }

  let crash = null;
  for (const e of alive) {
    for (let s = 0; s < STAGES; s++) {
      const r = results[s].get(e.id);
      if (r.status === 'crashed' && (!crash || r.crashSpeed > crash.r.crashSpeed)) crash = { e, r, s };
    }
  }
  if (crash) awards.push({ title: 'Самая эпичная авария', entry: crash.e, text: `${stageLabel(crash.s)}: ${crash.r.crashedInto === 'car' ? 'в машину' : 'в бордюр'} на скорости ${crash.r.crashSpeed.toFixed(1)}` });

  const iron = alive.filter((e) => Array.from({ length: STAGES }, (_, s) => results[s].get(e.id)).every((r) => r.status === 'finished'));
  if (iron.length) {
    const smooth = iron.reduce((best, e) => {
      const rs = Array.from({ length: STAGES }, (_, s) => results[s].get(e.id));
      const score = rs.reduce((a, r) => a + r.wiggle, 0) / rs.reduce((a, r) => a + r.ticks, 0);
      return !best || score < best.score ? { e, score } : best;
    }, null);
    awards.push({ title: 'Самый плавный ход', entry: smooth.e, text: 'меньше всех дёргал руль на всех этапах' });
    awards.push({ title: 'Железные', entry: null, text: `доехали все ${STAGES} этапа: ${iron.length} из ${alive.length}` });
  }

  let almost = null;
  for (const e of alive) {
    for (let s = 0; s < STAGES; s++) {
      const r = results[s].get(e.id);
      if (r.status !== 'finished' && r.progress >= 0.9 && (!almost || r.progress > almost.r.progress)) almost = { e, r, s };
    }
  }
  if (almost) awards.push({ title: 'Чуть-чуть не хватило', entry: almost.e, text: `${stageLabel(almost.s)}: ${Math.floor(almost.r.progress * 100)}% трассы` });
  return awards;
}
