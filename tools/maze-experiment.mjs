// Опыт для развилок (#1, #16): читает ли рой знак, когда свободный путь меняется по ходу заезда.
// Запуск: node tools/maze-experiment.mjs   (несколько минут)
//
// Рой как на вкладке «Учится само»: мутация из student/, фитнес — расстояние и бонус за время (как в уроке 3):
// иначе рою всё равно, ползти через медленную зону или нет.
// На «Развилке» один остров; на одном пути медленная зона, какой — судьи меняют раз в 10 с. Знак стоит за SIGN_GAP px
// до развилки: у самой развилки его уже не видно. Каждое поколение судьи бросают монетку по-новому (withCoins),
// а проверка — ещё на одной, незнакомой серии: заучить «когда куда» нельзя, выручит только знак.
// Сравниваем три мозга одной формы, но с разным «зрением»:
//   • знак + заметки — всё как на сайте;
//   • знак, без заметок — заметки на входе всегда нули: помнить можно только «телом» (где едешь, как быстро);
//   • без знака — вход «зн» всегда 0.
// Лучший мозг каждого опыта потом едет по пяти незнакомым трассам из seed.
import { getTrainingTrack, generateTrack, withCoins } from '../engine/world/track.ts';
import { SIGN_GAP } from '../engine/world/turtle.ts';
import { Evolution } from '../engine/learn/evolution.ts';
import { Car, maxTicksFor } from '../engine/world/car.ts';
import { layerSizes, NOTES } from '../engine/net/brain.ts';
import { DEFAULT_SENSORS } from '../engine/world/car.ts';
import { mulberry32 } from '../engine/core/utils.ts';
import { thinkVariants } from '../student/think.js';
import { mutate } from '../student/mutate.js';

const GENERATIONS = 80, POPULATION = 100, SEEDS = [1, 2, 3];
const track = getTrainingTrack('maze');
const strangers = ['опыт-1', 'опыт-2', 'опыт-3', 'опыт-4', 'опыт-5'].map(generateTrack);
const n = DEFAULT_SENSORS.count, sizes = layerSizes(n, [6]);
const SIGN = 2 * n + 1;
const think = thinkVariants.step.think;
const fitness = (car) => car.progress + (car.finished ? 3 * (12000 - car.ticks) : 0);

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

/** Проехать трассу мозгом: сколько раз заехал в медленную зону из скольких развилок и финишировал ли */
function drive(t, brain, see) {
  const car = new Car(t, { brain, think: (x, b) => think(see(x), b), sensors: DEFAULT_SENSORS });
  const limit = maxTicksFor(t);
  let forks = 0, inZone = false;
  while (!car.done) {
    car.step(t, limit);
    if (car.zone && !inZone) forks++;
    inZone = !!car.zone;
  }
  return { finished: car.status === 'finished', ticks: car.ticks, slowdowns: car.slowdowns, forks };
}

function swarm(see, seed) {
  return withSeed(seed, () => {
    const evo = new Evolution({ sizes, sensors: DEFAULT_SENSORS, think: (x, brain) => think(see(x), brain), mutate, fitness, population: POPULATION, rate: 0.1 });
    let finishedAt = null;
    for (let g = 0; g < GENERATIONS; g++) {
      evo.spawn(withCoins(track, g + 1)); // как на сайте: у каждого поколения своя серия бросков
      while (evo.step() > 0 && evo.tick < evo.maxTicks);
      const { parentCar } = evo.evaluate();
      if (parentCar.status === 'finished') finishedAt ??= g + 1;
    }
    return { finishedAt, brain: evo.parent };
  });
}

const share = (runs) => {
  const forks = runs.reduce((s, r) => s + r.forks, 0), slow = runs.reduce((s, r) => s + r.slowdowns, 0);
  return forks ? `${slow} из ${forks} развилок` : 'до развилок не доехал';
};

console.log(`«${track.name}»: круг ${Math.round(track.lap)} px, ${track.laps} круга, знак за ${SIGN_GAP} px до развилки. Рой ${GENERATIONS} поколений × ${POPULATION} машин.`);
console.log('«в медленную зону» — сколько раз мозг свернул не туда. Наугад — примерно половина.\n');
for (const [name, see] of Object.entries(KINDS)) {
  for (const seed of SEEDS) {
    const { finishedAt, brain } = swarm(see, seed);
    const home = drive(track, brain, see);
    const away = strangers.map((t) => drive(t, brain, see));
    const done = away.filter((r) => r.finished).length;
    console.log(`${name.padEnd(18)} опыт ${seed}: ${finishedAt ? `финиш с ${finishedAt}-го поколения` : 'не доехал'}`);
    console.log(`  «Развилка»: ${home.finished ? `${(home.ticks / 60).toFixed(1)} с` : 'не доехал'}, в медленную зону ${share([home])}`);
    console.log(`  незнакомые: доехал ${done} из ${away.length}, в медленную зону ${share(away)}`);
  }
}
