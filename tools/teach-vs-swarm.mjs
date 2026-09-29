// Опыт (#24): «Я учу» и рой помогают друг другу или мешают?
// Запуск: node tools/teach-vs-swarm.mjs [поколений=40] [опытов=4]   (пара минут)
//
// Учителя вместо человека: «осторожный» — простые правила (рули туда, где стена дальше; газуй до умеренной скорости,
// тормози, если стена впереди близко) — так ездит аккуратный ученик; «быстрый» — бот «Дедушка» (5 сенсоров, как у новой машины).
// Три пути, как на уроках 1–2:
//   А. рой с нуля;
//   Б. «Я учу» (заезд учителя по «Разминке», 20 эпох, шаг 0,05), потом рой от этого мозга;
//   В. рой с нуля, потом «Я учу» поверх него.
// Мерка — контрольный заезд урока 2 (engine/control.ts): «Змейка» и «Разминка» с попутными и встречными.
import { getTrainingTrack, withCoins } from '../engine/track.ts';
import { withTraffic } from '../engine/traffic.ts';
import { Evolution } from '../engine/evolution.ts';
import { Car, DEFAULT_SENSORS, maxTicksFor } from '../engine/car.ts';
import { layerSizes, createBrain, cloneBrain } from '../engine/brain.ts';
import { mulberry32 } from '../engine/utils.ts';
import { sampleOf, worthLearning, trainEpoch, TEACH_THINK } from '../engine/imitation.ts';
import { controlRun, controlText, verdict } from '../engine/control.ts';
import { parseCarFile } from '../engine/car-file.ts';
import { thinkVariants, DEFAULT_THINK } from '../student/think.js';
import { fitnessOf, MUTATIONS, DEFAULT_RECIPE, crossover } from '../engine/recipes.ts';
import { readFileSync } from 'fs';

const GENERATIONS = Number(process.argv[2] ?? 40), RUNS = Number(process.argv[3] ?? 4);
const sensors = DEFAULT_SENSORS, sizes = layerSizes(sensors.count, [6]);
const SNAKE = withTraffic(getTrainingTrack('snake'), 'all');
const CONTROL = [SNAKE, withTraffic(getTrainingTrack('warmup'), 'all')];
const think = (id) => thinkVariants[id].think;

/** Всё случайное в опыте — от seed: опыт повторяется один в один */
function seeded(seed, fn) {
  const saved = Math.random;
  Math.random = mulberry32(seed);
  try {
    return fn();
  } finally {
    Math.random = saved;
  }
}

// ── учителя ──

const BOTS = JSON.parse(readFileSync(new URL('./bots.json', import.meta.url), 'utf8'));
const grandpa = parseCarFile(BOTS.find((b) => b.name === 'Дедушка'));
if (grandpa.sensors.count !== sensors.count) throw new Error('у «Дедушки» другое число сенсоров — учить им новую машину нельзя');

/** Аккуратный ученик: сенсор 0 — стены не видно, 1 — вплотную; вход сразу после сенсоров — скорость */
const careful = (x) => {
  const [l2, l1, front, r1, r2] = x, speed = x[sensors.count];
  const left = l2 + l1 * 1.5, right = r2 + r1 * 1.5;
  const target = 0.6 * (1 - 0.8 * front);
  return [speed < target ? 1 : 0, speed > target + 0.2 ? 1 : 0, right > left + 0.05 ? 1 : 0, left > right + 0.05 ? 1 : 0];
};
const TEACHERS = { 'осторожный': careful, 'быстрый': think(grandpa.thinkId) };

/** Заезд учителя по «Разминке» без машин — как ученик на уроке 1. Возвращает примеры и время */
function teacherRun(teacherThink) {
  const track = getTrainingTrack('warmup');
  const car = new Car(track, { brain: grandpa.brain, think: teacherThink, sensors });
  const samples = [];
  while (!car.done) {
    car.step(track, maxTicksFor(track), null);
    const s = sampleOf(car);
    s.x = [...s.x.slice(0, -3), 0, 0, 0]; // заметки m1…m3: у человека их нет, во входах нули
    if (worthLearning(s)) samples.push(s);
  }
  return { samples, status: car.status, seconds: car.ticks / 60 };
}

/** «Учить на заездах»: 20 эпох, шаг 0,05 — настройки вкладки по умолчанию */
const teach = (brain, samples, seed) => {
  const rnd = mulberry32(seed);
  for (let e = 0; e < 20; e++) trainEpoch(brain, samples, 0.05, rnd);
  return brain;
};

// ── рой ──

/** Рой на «Змейке» со встречными, как на уроке 2. Возвращает лучший мозг и с какого поколения доехал */
function swarm({ parent = null, thinkId, seed }) {
  return seeded(seed, () => {
    const evo = new Evolution({
      sizes, sensors, think: think(thinkId), mutate: MUTATIONS[DEFAULT_RECIPE.mutation].mutate, crossover,
      fitness: fitnessOf(DEFAULT_RECIPE.parts), population: 100, rate: 0.1, parent: parent && cloneBrain(parent),
    });
    let firstFinish = null;
    for (let g = 0; g < GENERATIONS; g++) {
      evo.spawn(withCoins(SNAKE, g));
      while (evo.step() > 0 && evo.tick < evo.maxTicks);
      if (evo.evaluate().entry.finished) firstFinish ??= g + 1;
    }
    return { brain: evo.parent, firstFinish };
  });
}

const drive = (brain, thinkId) => controlRun(CONTROL, { brain: cloneBrain(brain), think: think(thinkId), sensors });
const line = (label, r) => `${label.padEnd(30)} ${controlText(r).padEnd(22)} (итог ${r.score.toFixed(1)})`;

// ── опыт ──

if (DEFAULT_THINK !== TEACH_THINK) throw new Error('опыт считает, что рой и «Я учу» думают одинаково («Плавный»)');

console.log(`Рой 100 машин × ${GENERATIONS} поколений на «Змейке» со встречными, мозг [${sizes.join(', ')}], опытов: ${RUNS}.`);
console.log('Мерка — контрольный заезд: «Змейка» + «Разминка» со встречными. Итог в секундах, меньше — лучше.\n');

for (const [name, teacherThink] of Object.entries(TEACHERS)) {
  const run = teacherRun(teacherThink);
  console.log(`Учитель «${name}»: «Разминка» — ${run.status === 'finished' ? `${run.seconds.toFixed(1)} с` : run.status}, примеров ${run.samples.length}`);
  const taught = teach(createBrain(sizes, mulberry32(1)), run.samples, 1);
  console.log(`  ${line('только «Я учу»', drive(taught, TEACH_THINK))}`);
}
console.log();

const tally = { taughtFirst: 0, teachHelps: 0, teachHurts: 0 };
for (let k = 1; k <= RUNS; k++) {
  console.log(`— опыт ${k} —`);
  // вариант «думания» по умолчанию — «Плавный», тот же, что и после «Я учу»: сравнение честное
  const a = swarm({ thinkId: DEFAULT_THINK, seed: k });
  const aResult = drive(a.brain, DEFAULT_THINK);
  console.log(`  ${line(`А. рой с нуля (финиш с ${a.firstFinish ?? '—'})`, aResult)}`);
  for (const [name, teacherThink] of Object.entries(TEACHERS)) {
    const { samples } = teacherRun(teacherThink);
    const taught = teach(createBrain(sizes, mulberry32(k)), samples, k);
    const b = swarm({ parent: taught, thinkId: TEACH_THINK, seed: k });
    const bResult = drive(b.brain, TEACH_THINK);
    console.log(`  ${line(`Б. «Я учу» (${name}) → рой (финиш с ${b.firstFinish ?? '—'})`, bResult)}`);
    if (bResult.score < aResult.score) tally.taughtFirst++;
    const c = teach(cloneBrain(a.brain), samples, k);
    const cResult = drive(c, TEACH_THINK);
    const v = verdict(cResult, aResult);
    console.log(`  ${line(`В. рой → «Я учу» (${name})`, cResult)}  ${v.mark === 'better' ? '▲' : v.mark === 'worse' ? '▼' : '='} ${v.text}`);
    if (v.mark === 'better') tally.teachHelps++;
    if (v.mark === 'worse') tally.teachHurts++;
  }
}
const pairs = RUNS * Object.keys(TEACHERS).length;
console.log(`\nИтого из ${pairs}: «Я учу» перед роем лучше роя с нуля — ${tally.taughtFirst}; «Я учу» поверх роя: лучше — ${tally.teachHelps}, хуже — ${tally.teachHurts}.`);
