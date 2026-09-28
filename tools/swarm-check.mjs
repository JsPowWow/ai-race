// Проверка: учится ли рой «из коробки» — с файлами student/ как есть и настройками вкладки «Учится само» по умолчанию.
// Запуск: node tools/swarm-check.mjs [поколений=60] [опытов=3]   (несколько минут)
//
// Для каждой учебной трассы и каждого уровня трафика — несколько опытов с разной «удачей» (Math.random от seed).
// Печатает, с какого поколения лучший впервые доехал, и где лучший последнего поколения.
// Меняешь физику, трафик, трассы или student/ — прогони: студент не должен застрять там, где рой не учится вовсе.
import { TRAINING_TRACKS, getTrainingTrack, withCoins } from '../engine/track.js';
import { withTraffic } from '../engine/traffic.js';
import { Evolution } from '../engine/evolution.js';
import { DEFAULT_SENSORS } from '../engine/car.js';
import { layerSizes } from '../engine/brain.js';
import { mulberry32 } from '../engine/utils.js';
import { thinkVariants, DEFAULT_THINK } from '../student/think.js';
import { mutate } from '../student/mutate.js';
import { fitness } from '../student/fitness.js';

const GENERATIONS = Number(process.argv[2] ?? 60), RUNS = Number(process.argv[3] ?? 3);
const POPULATION = 100, RATE = 0.1; // как на вкладке по умолчанию
const sizes = layerSizes(DEFAULT_SENSORS.count, [6]);

/** Один опыт: рой на трассе; как на сайте — у каждого поколения своя серия бросков */
function run(base, traffic, seed) {
  const saved = Math.random;
  Math.random = mulberry32(seed);
  try {
    const evo = new Evolution({ sizes, sensors: DEFAULT_SENSORS, think: thinkVariants[DEFAULT_THINK].think, mutate, fitness, population: POPULATION, rate: RATE });
    let firstFinish = null, last = null;
    for (let g = 0; g < GENERATIONS; g++) {
      evo.spawn(withCoins(withTraffic(base, traffic), g));
      while (evo.step() > 0 && evo.tick < evo.maxTicks);
      const { entry, parentCar } = evo.evaluate();
      if (entry.finished) firstFinish ??= g + 1;
      last = { pct: entry.progressPct, finished: entry.finished, seconds: parentCar.ticks / 60, finishers: entry.finishers };
    }
    return { firstFinish, last };
  } finally {
    Math.random = saved;
  }
}

console.log(`Рой ${POPULATION} машин × ${GENERATIONS} поколений, мозг [${sizes.join(', ')}], think «${DEFAULT_THINK}», фитнес из student/.\n`);
for (const { id, name } of TRAINING_TRACKS) {
  for (const traffic of ['none', 'same', 'all']) {
    const results = Array.from({ length: RUNS }, (_, k) => run(getTrainingTrack(id), traffic, k + 1));
    const text = results.map(({ firstFinish, last }) =>
      `${firstFinish ? `финиш с ${String(firstFinish).padStart(2)}` : 'не доехал'} → ${last.finished ? `${last.seconds.toFixed(0)} с, доехало ${last.finishers}` : `${Math.round(last.pct)}%`}`);
    console.log(`${name.padEnd(10)} ${traffic.padEnd(4)}  ${text.join('  |  ')}`);
  }
}
