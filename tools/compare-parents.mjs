// Честный эксперимент: помогает ли кроссовер? Один родитель против двух, много запусков.
// Запуск: node tools/compare-parents.mjs [трасса=hairpin] [запусков=20] [поколений=30]
import { getTrainingTrack } from '../engine/world/track.ts';
import { withTraffic } from '../engine/world/traffic.ts';
import { layerSizes } from '../engine/net/brain.ts';
import { Evolution } from '../engine/learn/evolution.ts';
import { thinkVariants } from '../student/think.js';
import { fitnessOf, MUTATIONS, crossover, DEFAULT_PARTS } from '../engine/learn/recipes.ts';

const fitness = fitnessOf(DEFAULT_PARTS), { mutate } = MUTATIONS.spot;

const [trackId = 'hairpin', runs = 20, generations = 30] = process.argv.slice(2);
const track = withTraffic(getTrainingTrack(trackId), 'all');
const sensors = { count: 5, spread: 90, length: 160 };

/** Сколько поколений понадобилось до финиша (или null, если не доехал) */
function generationsToFinish(parents) {
  const evo = new Evolution({
    sizes: layerSizes(sensors.count, [6]), sensors, think: thinkVariants.smooth.think,
    mutate, fitness, crossover, parents, population: 100, rate: 0.1,
  });
  for (let gen = 1; gen <= +generations; gen++) {
    evo.spawn(track);
    while (evo.step() > 0);
    if (evo.evaluate().entry.finished) return gen;
  }
  return null;
}

console.log(`Трасса «${track.name}» со встречными, ${runs} запусков по ${generations} поколений\n`);
for (const parents of [1, 2]) {
  const results = Array.from({ length: +runs }, () => generationsToFinish(parents));
  const solved = results.filter((g) => g !== null);
  const average = solved.length ? (solved.reduce((a, b) => a + b, 0) / solved.length).toFixed(1) : '—';
  console.log(`${parents} ${parents === 1 ? 'родитель ' : 'родителя'}: доехали ${solved.length}/${runs}, в среднем за ${average} поколений`);
}
