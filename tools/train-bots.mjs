// Обучить ботов-соперников для вкладки «Гонка» и сохранить в tools/bots.json.
// Запуск: node tools/train-bots.mjs   (несколько минут), потом npm run build
import { writeFileSync } from 'node:fs';
import { getTrainingTrack, generateTrack } from '../engine/track.js';
import { layerSizes } from '../engine/brain.js';
import { FORMAT } from '../engine/car-file.js';
import { withTraffic } from '../engine/traffic.js';
import { thinkVariants } from '../student/think.js';
import { drive, evolveOnTracks, resultText } from './sim.mjs';

const training = (id, traffic = 'all') => withTraffic(getTrainingTrack(id), traffic);
const random = (seed, traffic = 'all') => withTraffic(generateTrack(seed), traffic);

const byDistance = (r) => r.progress;
const bySpeed = (r) => r.progress + (r.finished ? 3 * (3000 - r.ticks) : 0);

const RECIPES = [
  {
    // учился на одной трассе и без машин — пример переобучения
    name: 'Ржавое ведро', color: '#b5651d', think: 'step',
    sensors: { count: 5, spread: 90, length: 160 }, hidden: [6],
    generations: 8, population: 80, rate: 0.1, fitness: byDistance,
    tracksFor: () => [training('warmup', 'none')],
  },
  {
    name: 'Торетто', color: '#1c7ed6', think: 'smooth',
    sensors: { count: 7, spread: 120, length: 180 }, hidden: [8],
    generations: 60, population: 60, rate: 0.1, fitness: byDistance,
    tracksFor: (g) => [training('snake', 'same'), training('hairpin', 'same'), random(`bot-t-${g}`, 'same'), random(`bot-t2-${g}`)],
  },
  {
    name: 'Бабушка', color: '#2f9e44', think: 'smooth',
    sensors: { count: 7, spread: 120, length: 200 }, hidden: [8, 6],
    generations: 110, population: 60, rate: 0.08, fitness: bySpeed,
    tracksFor: (g) => [training('snake'), training('hairpin'), random(`bot-s-${g}`), random(`bot-s2-${g}`), random(`bot-s3-${g}`)],
  },
];

const bots = RECIPES.map(({ name, color, think, sensors, hidden, ...plan }) => {
  const sizes = layerSizes(sensors.count, hidden);
  const brain = evolveOnTracks({
    ...plan, sizes, sensors, think: thinkVariants[think].think,
    log: (gen, score) => gen % 10 === 0 && console.log(`${name}: поколение ${gen}, фитнес ${Math.round(score)}`),
  });
  return { format: FORMAT, name, color, think, sensors, layers: sizes, brain, trainedGenerations: plan.generations };
});

writeFileSync(new URL('./bots.json', import.meta.url), JSON.stringify(bots));

console.log('\nКонтрольные гонки со встречными:');
for (const seed of ['урок-1', 'финал', '42']) {
  const track = random(seed);
  const results = bots.map((b) => `${b.name}: ${resultText(drive(track, { brain: b.brain, think: thinkVariants[b.think].think, sensors: b.sensors }))}`);
  console.log(`  ${seed.padEnd(8)} ${results.join(' | ')}`);
}
