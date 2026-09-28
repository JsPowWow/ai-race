// Опыт для «Лабиринта» (#1, #16): нужен ли мозгу знак и чем он его помнит.
// Запуск: node tools/maze-experiment.mjs   (несколько минут)
//
// Рой как на вкладке «Учится само»: мутация и фитнес из student/, фитнес — пройденное расстояние.
// У каждой развилки знак стоит за SIGN_GAP px до неё: у самой развилки его уже не видно.
// Сравниваем три мозга одной формы, но с разным «зрением»:
//   • знак + заметки — всё как на сайте;
//   • знак, без заметок — заметки на входе всегда нули: помнить можно только «телом» (где едешь, как быстро);
//   • без знака — вход «зн» всегда 0.
import { getTrainingTrack } from '../engine/track.js';
import { SIGN_GAP } from '../engine/maze.js';
import { Evolution } from '../engine/evolution.js';
import { layerSizes, NOTES } from '../engine/brain.js';
import { DEFAULT_SENSORS } from '../engine/car.js';
import { mulberry32 } from '../engine/utils.js';
import { thinkVariants } from '../student/think.js';
import { mutate } from '../student/mutate.js';
import { fitness } from '../student/fitness.js';

const GENERATIONS = 150, POPULATION = 100, SEEDS = [1, 2, 3];
const track = getTrainingTrack('maze');
const n = DEFAULT_SENSORS.count, sizes = layerSizes(n, [6]);
const SIGN = 2 * n + 1;
const think = thinkVariants.step.think;

const KINDS = {
  'знак + заметки': (x) => x,
  'знак, без заметок': (x) => { x.fill(0, x.length - NOTES); return x; },
  'без знака': (x) => { x[SIGN] = 0; return x; },
};

/** Детерминированный Math.random на время опыта: все варианты получают одинаковую «удачу» */
function withSeed(seed, fn) {
  const saved = Math.random;
  Math.random = mulberry32(seed);
  try { return fn(); } finally { Math.random = saved; }
}

/** Сколько развилок прошёл лидер поколения: цифра, или F — доехал до финиша */
function forksPassed(car) {
  if (car.status === 'finished') return 'F';
  return String(track.roads.slice(1).filter((r) => car.bestS > r.fromS + 600).length);
}

function swarm(see, seed) {
  return withSeed(seed, () => {
    const evo = new Evolution({ sizes, sensors: DEFAULT_SENSORS, think: (x, brain) => think(see(x), brain), mutate, fitness, population: POPULATION, rate: 0.1 });
    let line = '', finishedAt = null;
    for (let g = 0; g < GENERATIONS; g++) {
      evo.spawn(track);
      while (evo.step() > 0 && evo.tick < evo.maxTicks);
      const { parentCar } = evo.evaluate();
      line += forksPassed(parentCar);
      if (parentCar.status === 'finished') finishedAt ??= g + 1;
    }
    return { line, finishedAt };
  });
}

console.log(`«${track.name}»: ${track.signs.length} развилки, знак за ${SIGN_GAP} px до каждой. Рой ${GENERATIONS} поколений × ${POPULATION} машин.`);
console.log('Строка — лидер каждого поколения: сколько развилок прошёл, F — доехал до финиша.\n');
for (const [name, see] of Object.entries(KINDS)) {
  for (const seed of SEEDS) {
    const { line, finishedAt } = swarm(see, seed);
    console.log(`${name.padEnd(18)} опыт ${seed}: ${finishedAt ? `финиш с ${finishedAt}-го поколения` : 'не доехал'}`);
    console.log(`  ${line}`);
  }
}
