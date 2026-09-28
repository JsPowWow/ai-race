// Общие помощники для скриптов в tools/: прогнать машину и обучить мозг без браузера.
import { Car, carReport, maxTicksFor } from '../engine/car.js';
import { createBrain, cloneBrain } from '../engine/brain.js';
import { MUTATIONS, crossover } from '../engine/recipes.js';

const { mutate } = MUTATIONS.spot;

/** Проехать трассу до конца; вернуть отчёт как для fitness() */
export function drive(track, driver) {
  const car = new Car(track, driver);
  const maxTicks = maxTicksFor(track);
  while (!car.done) car.step(track, maxTicks);
  return { ...carReport(car, track), status: car.status, crashedInto: car.crashedInto };
}

/**
 * Эволюция, где каждый кандидат едет по нескольким трассам сразу (фитнес — сумма).
 * Так учатся боты: мозг, хороший сразу на многих трассах, меньше переобучается.
 * Рецепт как у роя на сайте: лучший едет дальше без изменений, остальные — дети двух случайных из лучших 10%.
 */
export function evolveOnTracks({ sizes, sensors, think, fitness, tracksFor, generations, population, rate, log = () => {} }) {
  let brains = Array.from({ length: population }, () => createBrain(sizes));
  let best = null;
  for (let gen = 0; gen < generations; gen++) {
    const tracks = tracksFor(gen);
    const ranked = brains
      .map((brain) => ({ brain, score: tracks.reduce((sum, track) => sum + fitness(drive(track, { brain, think, sensors })), 0) }))
      .sort((a, b) => b.score - a.score);
    best = ranked[0].brain;
    log(gen, ranked[0].score);
    const pool = ranked.slice(0, Math.max(2, Math.round(population * 0.1))).map((r) => r.brain);
    const any = () => pool[Math.floor(Math.random() * pool.length)];
    brains = [cloneBrain(best)];
    while (brains.length < population) {
      const child = crossover(any(), any());
      mutate(child, rate);
      brains.push(child);
    }
  }
  return best;
}

/** «12,4 с» или «сошёл на 63%» */
export const resultText = (r) => (r.status === 'finished' ? `${(r.ticks / 60).toFixed(1)} с` : `${r.crashedInto === 'car' ? 'авария' : 'сошёл'} на ${Math.round(r.progressPct)}%`);
