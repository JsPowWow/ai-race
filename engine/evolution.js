// Эволюция: поколение машин, отбор лучшей, мутации.
import { Car, carReport, maxTicksFor } from './car.js';
import { createBrain, cloneBrain, checkBrain } from './brain.js';
import { trafficAt } from './traffic.js';

/**
 * Настройки роя. think/mutate/fitness/crossover — функции студента: их можно подменять между поколениями.
 * @typedef {object} EvolutionOptions
 * @property {number[]} sizes размеры слоёв сети
 * @property {{ count: number, spread: number, length: number }} sensors лучи
 * @property {Function} think как сеть превращает входы в нажатия
 * @property {(brain: object, rate: number) => void} mutate встряхнуть веса
 * @property {(report: object) => number} fitness оценка заезда
 * @property {Function} [crossover] ребёнок от двух родителей
 * @property {1 | 2} [parents] сколько родителей
 * @property {number} population машин в поколении
 * @property {number} rate сила мутации
 * @property {object} [parent] лучший мозг прошлого поколения
 * @property {object} [parent2] второй родитель
 */

export class Evolution {
  /** @param {EvolutionOptions} opts */
  constructor({ sizes, sensors, think, mutate, fitness, crossover = null, parents = 1, population, rate, parent = null, parent2 = null }) {
    // форма сети и «глаза»
    this.sizes = sizes;
    this.sensors = sensors;
    // функции студента
    this.think = think;
    this.mutate = mutate;
    this.fitness = fitness;
    this.crossover = crossover;
    // настройки поколения
    this.parents = parents;
    this.population = population;
    this.rate = rate;
    // с кого начинаем
    this.parent = parent;
    this.parent2 = parent2;
    this.generation = 0;
    this.history = [];
    this.cars = [];
    this.errors = [];
  }

  spawn(track) {
    this.track = track;
    this.maxTicks = maxTicksFor(track);
    this.tick = 0;
    this.cars = [];
    this.errors = [];
    this.lastError = null;
    const two = this.parents === 2 && this.parent && this.parent2 && this.crossover;
    for (let i = 0; i < this.population; i++) {
      let brain;
      if (!this.parent) brain = createBrain(this.sizes);
      else if (i === 0) brain = cloneBrain(this.parent); // лучший едет без изменений
      else if (i === 1 && two) brain = cloneBrain(this.parent2); // и второй родитель тоже
      else {
        brain = two ? this.makeChild() : cloneBrain(this.parent);
        try {
          this.mutate(brain, this.rate);
        } catch (e) {
          this.report(`mutate(): ${e.message}`, e);
        }
      }
      this.cars.push(new Car(track, { brain, think: this.safeThink(), sensors: this.sensors }));
    }
  }

  /** Ребёнок двух родителей через crossover() студента, с проверкой формы */
  makeChild() {
    try {
      const child = this.crossover(cloneBrain(this.parent), cloneBrain(this.parent2));
      const err = checkBrain(child, this.sizes);
      if (!err) return child;
      this.report(`crossover() вернула мозг не той формы: ${err}`);
    } catch (e) {
      this.report(`crossover(): ${e.message}`, e);
    }
    return cloneBrain(this.parent);
  }

  report(msg, error = null) {
    if (this.errors.length) return;
    this.errors.push(msg);
    this.lastError = error;
  }

  safeThink() {
    const think = this.think;
    return (inputs, brain) => {
      try {
        return think(inputs, brain);
      } catch (e) {
        this.report(`think(): ${e.message}`, e);
        return [0, 0, 0, 0];
      }
    };
  }

  /** Один тик для всех машин. Возвращает, сколько ещё едут. */
  step() {
    let alive = 0;
    // трафик один на всех — считаем один раз за тик
    const traffic = this.track.traffic ? trafficAt(this.track, this.track.traffic, this.tick) : null;
    this.traffic = traffic;
    for (const car of this.cars) {
      car.step(this.track, this.maxTicks, traffic);
      if (!car.done) alive++;
    }
    this.tick++;
    return alive;
  }

  score(car) {
    try {
      const v = this.fitness(carReport(car, this.track));
      if (!Number.isFinite(v)) {
        this.report('fitness() вернула не число');
        return -Infinity;
      }
      return v;
    } catch (e) {
      this.report(`fitness(): ${e.message}`, e);
      return -Infinity;
    }
  }

  /**
   * Поколение закончилось: выбрать родителей.
   * picked — машины, выбранные вручную кликом (0, 1 или 2). Остальных родителей добираем лучшими по фитнесу.
   */
  evaluate(picked = []) {
    if (!Array.isArray(picked)) picked = picked ? [picked] : [];
    const scored = this.cars.map((car) => ({ car, score: this.score(car) }));
    scored.sort((a, b) => b.score - a.score);
    const best = scored[0];
    const chosen = [...picked];
    for (const { car } of scored) {
      if (chosen.length >= 2) break;
      if (!chosen.includes(car)) chosen.push(car);
    }
    const parentCar = chosen[0];
    this.parent = cloneBrain(parentCar.brain);
    this.parent2 = chosen[1] ? cloneBrain(chosen[1].brain) : null;
    const report = carReport(parentCar, this.track);
    const scores = scored.map((s) => s.score).filter(Number.isFinite);
    const entry = {
      gen: this.generation + 1,
      best: best.score,
      median: scores.length ? scores[Math.floor(scores.length / 2)] : 0,
      progressPct: report.progressPct,
      finished: report.finished,
      finishers: this.cars.filter((c) => c.status === 'finished').length,
      ticks: parentCar.ticks,
      trackId: this.track.id,
      picked: picked.length > 0,
      parents: this.parents === 2 ? 2 : 1,
    };
    this.history.push(entry);
    this.generation++;
    return { entry, parentCar, report };
  }
}
