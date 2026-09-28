// ПРОТОТИП (ветка wip/tune): подбор физики руля «человеком за клавиатурой».
// Модель водителя: видит дорогу с задержкой реакции, стрелки жмёт «вкл/выкл», перед поворотом отпускает газ,
// тормозит, только если не успевает. Для каждого набора чисел меряем: вылеты, время круга, виляние, тормоз.
// Запуск: node tools/tune-search.mjs [сколько наборов] — печатает лучшие.
import { Car, CAR } from '../engine/car.js';
import { getTrainingTrack, pointAt } from '../engine/track.js';

const BASE = { ...CAR };
const TRACKS = ['warmup', 'snake', 'hairpin'].map((id) => getTrainingTrack(id));
const DELAYS = [9, 15]; // реакция 0,15 и 0,25 с
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Детерминированный «случайный» генератор, чтобы перебор повторялся */
function rng(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

/** Самый крутой изгиб дороги на отрезке [from, to] (кривизна, 1/px) */
function sharpest(track, from, to) {
  let k = 0;
  for (let d = from; d < to; d += 8) k = Math.max(k, Math.abs(wrap(pointAt(track, d + 8).angle - pointAt(track, d).angle)) / 8);
  return k;
}

/** Один круг водителем с задержкой delay тиков */
function drive(track, delay) {
  const car = new Car(track);
  const seen = [];
  let brakeTicks = 0, toggles = 0, offsetSum = 0, lastKey = 0;
  const lap = track.total;
  while (!car.done && car.s - track.startS < lap && car.ticks < 60 * 120) {
    seen.push({ x: car.x, y: car.y, angle: car.angle, speed: car.speed, s: car.s });
    // что водитель видит — с опозданием; но человек предугадывает: «доезжает» машину в уме по прямой
    const old = seen[Math.max(0, seen.length - 1 - delay)];
    const ahead = old.speed * Math.min(delay, seen.length - 1);
    const me = { ...old, x: old.x + Math.cos(old.angle) * ahead, y: old.y + Math.sin(old.angle) * ahead, s: old.s + ahead };
    // руль: держим середину полосы, смотрим вперёд на полсекунды пути
    const aim = pointAt(track, me.s + 30 + me.speed * 12);
    const err = wrap(Math.atan2(aim.y - me.y, aim.x - me.x) - me.angle);
    const key = err > 0.05 ? 1 : err < -0.05 ? -1 : 0;
    if (key !== lastKey) toggles++;
    lastKey = key;
    // газ: видим поворот впереди — сколько можно в нём ехать и успеваем ли сбросить, просто отпустив газ
    let gas = 1, brake = 0;
    for (const dist of [60, 120, 200, 300]) {
      const k = sharpest(track, me.s + dist - 60, me.s + dist);
      if (!k) continue;
      const safe = Math.min(CAR.maxSpeed, Math.sqrt(CAR.grip / k) * 0.92, Math.sqrt(1 / (k * CAR.minRadius)) * CAR.maxSpeed);
      if (me.speed <= safe) continue;
      gas = 0;
      const need = (me.speed ** 2 - safe ** 2) / (2 * Math.max(dist - 40, 10)); // какое замедление нужно
      if (need > (CAR.friction + CAR.coast) * 0.9) brake = 1;
    }
    Object.assign(car.controls, { gas, brake, left: key < 0 ? 1 : 0, right: key > 0 ? 1 : 0 });
    if (brake) brakeTicks++;
    car.step(track, Infinity, []);
    const c = pointAt(track, car.s);
    offsetSum += Math.abs(-Math.sin(c.angle) * (car.x - c.x) + Math.cos(c.angle) * (car.y - c.y));
  }
  const ticks = car.ticks || 1;
  return { crashed: car.done && car.status !== 'finished', where: `${track.id}/${delay}`, ticks, brake: brakeTicks / ticks, weave: (toggles / ticks) * 60, offset: offsetSum / ticks };
}

/** Оценка набора: все трассы, обе реакции */
export function judge(values) {
  Object.assign(CAR, BASE, values);
  const runs = TRACKS.flatMap((t) => DELAYS.map((d) => drive(t, d)));
  const avg = (key) => runs.reduce((sum, r) => sum + r[key], 0) / runs.length;
  const crashes = runs.filter((r) => r.crashed).length;
  const ok = runs.filter((r) => !r.crashed);
  const lap = ok.length ? ok.reduce((sum, r) => sum + r.ticks, 0) / ok.length / 60 : 99;
  return { crashes, where: runs.filter((r) => r.crashed).map((r) => r.where).join(' '), lap, brake: avg('brake'), weave: avg('weave'), offset: avg('offset') };
}

/** Общая оценка: вылет — худшее; дальше быстрый круг, мало тормоза, не вилять, держать полосу */
const score = (j) => j.crashes * 1000 + j.lap + j.brake * 60 + j.weave * 2 + j.offset * 0.3;

const YOURS = { accel: 0.075, brake: 0.1, friction: 0.03, coast: 0.055, maxSpeed: 5, grip: 0.1, minRadius: 50, steerRate: 0.18, centerRate: 0.18, pivot: 0 };

if (import.meta.url === `file://${process.argv[1]}`) {
  const count = +(process.argv[2] ?? 300);
  const rand = rng(42);
  const pick = (lo, hi, step) => Math.round((lo + rand() * (hi - lo)) / step) * step;
  const tried = [{ name: 'Твой', values: YOURS }, { name: 'Твой + задняя ось', values: { ...YOURS, pivot: 1 } }];
  for (let i = 0; i < count; i++) {
    tried.push({ name: `#${i}`, values: {
      accel: pick(0.05, 0.11, 0.005), brake: pick(0.1, 0.22, 0.01), friction: pick(0.01, 0.03, 0.005), coast: pick(0.02, 0.08, 0.005),
      maxSpeed: pick(4, 6, 0.25), grip: pick(0.06, 0.22, 0.01), minRadius: pick(35, 60, 5),
      steerRate: pick(0.05, 0.25, 0.01), centerRate: pick(0.1, 0.4, 0.02), pivot: rand() < 0.75 ? 1 : 0,
    } });
  }
  const rows = tried.map((t) => ({ ...t, j: judge(t.values) }));
  rows.sort((a, b) => score(a.j) - score(b.j));
  const show = (r) => `${r.name.padEnd(18)} вылетов ${r.j.crashes}/6  круг ${r.j.lap.toFixed(1)} с  тормоз ${(r.j.brake * 100).toFixed(0)}%  виляние ${r.j.weave.toFixed(1)}/с  от середины ${r.j.offset.toFixed(0)} px  ${r.j.where}  ${JSON.stringify(r.values)}`;
  console.log(rows.slice(0, 12).map(show).join('\n'));
  console.log('---');
  console.log(rows.filter((r) => r.name.startsWith('Твой')).map(show).join('\n'));
}
