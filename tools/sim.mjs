// Общие помощники для скриптов в tools/: прогнать машину и обучить мозг без браузера.
import { Car, carReport, maxTicksFor } from '../engine/car.js';
import { createBrain, cloneBrain } from '../engine/brain.js';
import { mutate } from '../student/mutate.js';

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
 */
export function evolveOnTracks({ sizes, sensors, think, fitness, tracksFor, generations, population, rate, log = () => {} }) {
  let parent = null;
  for (let gen = 0; gen < generations; gen++) {
    const tracks = tracksFor(gen);
    let best = null;
    let bestScore = -Infinity;
    for (let i = 0; i < population; i++) {
      const brain = parent ? cloneBrain(parent) : createBrain(sizes);
      if (parent && i > 0) mutate(brain, rate);
      const score = tracks.reduce((sum, track) => sum + fitness(drive(track, { brain, think, sensors })), 0);
      if (score > bestScore) [best, bestScore] = [brain, score];
    }
    parent = best;
    log(gen, bestScore);
  }
  return parent;
}

/** «12,4 с» или «сошёл на 63%» */
export const resultText = (r) => (r.status === 'finished' ? `${(r.ticks / 60).toFixed(1)} с` : `${r.crashedInto === 'car' ? 'авария' : 'сошёл'} на ${Math.round(r.progressPct)}%`);
