// Эволюция: поколение машин, отбор лучшей, мутации.
import { Car, carReport, maxTicksFor, type Sensors, type Think, type CarReport } from './car.ts';
import { createBrain, cloneBrain, checkBrain, type Brain } from './brain.ts';
import { trafficAt, type TrafficSpot } from './traffic.ts';
import type { Track } from './track.ts';
import type { Mutate } from './recipes.ts';

/** Ребёнок от двух родителей (функция студента: что вернёт — проверяем) */
export type Crossover = (mom: Brain, dad: Brain) => unknown;
/** Оценка заезда (функция студента): чем больше, тем лучше */
export type Fitness = (report: CarReport) => number;

/** Соперник: чужая машина со своим мозгом, «глазами» и think. Едет рядом с роем, но в отборе не участвует */
export type Rival = { brain: Brain; think: Think; sensors: Sensors };

/** Настройки роя. think/mutate/fitness/crossover — функции студента: их можно подменять между поколениями */
export type EvolutionOptions = {
  /** размеры слоёв сети */
  sizes: number[];
  sensors: Sensors;
  /** как сеть превращает входы в нажатия */
  think: Think;
  /** встряхнуть веса */
  mutate: Mutate;
  /** оценка заезда */
  fitness: Fitness;
  crossover?: Crossover | null;
  /** 1 — дети копируют одного родителя, 2 — скрещивают двух (crossover) */
  parents?: 1 | 2;
  /** машин в поколении */
  population: number;
  /** сила мутации */
  rate: number;
  /** лучший мозг прошлого поколения и второй родитель */
  parent?: Brain | null;
  parent2?: Brain | null;
  /** соперники: едут в том же мире (тот же тик, тот же трафик), но родителями не становятся */
  rivals?: readonly Rival[];
};

/** Строка графика: как прошло поколение */
export type GenerationEntry = {
  gen: number; best: number; median: number; progressPct: number;
  finished: boolean; finishers: number; ticks: number; trackId: string;
  picked: boolean; parents: 1 | 2;
};

const POOL_SHARE = 0.1; // сколько лучших машин поколения становятся родителями

/** Мозг машины роя: он есть у каждой — рой сам раздал их в spawn */
function brainOf(car: Car): Brain {
  if (!car.brain) throw new Error('у машины роя нет мозга');
  return car.brain;
}

/** Текст ошибки из чего угодно, что бросил код студента */
const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export class Evolution {
  sizes: number[]; sensors: Sensors;
  think: Think; mutate: Mutate; fitness: Fitness; crossover: Crossover | null;
  parents: 1 | 2; population: number; rate: number;
  parent: Brain | null; parent2: Brain | null;
  /** из кого берём родителей для детей: лучшие прошлого поколения */
  pool: Brain[] | null;
  generation: number; history: GenerationEntry[];
  cars: Car[]; errors: string[]; lastError: unknown = null;
  rivals: readonly Rival[];
  /** машины соперников этого поколения — отдельно от cars: отбор смотрит только на рой */
  rivalCars: Car[] = [];
  // заезд поколения — появляется в spawn
  track!: Track; maxTicks = 0; tick = 0; traffic: TrafficSpot[] | null = null;

  constructor({ sizes, sensors, think, mutate, fitness, crossover = null, parents = 2, population, rate, parent = null, parent2 = null, rivals = [] }: EvolutionOptions) {
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
    this.rivals = rivals;
    this.pool = null; // из кого берём родителей для детей: лучшие прошлого поколения
    this.generation = 0;
    this.history = [];
    this.cars = [];
    this.errors = [];
  }

  /**
   * Продолжить с мозга, который пришёл снаружи (научили на примерах, вернули из «Истории», поправили руками).
   * Он — единственный родитель следующего поколения: старый пул забываем, иначе дети рождаются от лучших
   * прошлого роя, а новый мозг едет одной машиной из ста и через поколение пропадает.
   */
  startFrom(brain: Brain): void {
    this.parent = cloneBrain(brain);
    this.parent2 = null;
    this.pool = null;
  }

  spawn(track: Track): void {
    this.track = track;
    this.maxTicks = maxTicksFor(track);
    this.tick = 0;
    this.cars = [];
    this.errors = [];
    this.lastError = null;
    const pool = this.pool ?? [this.parent, this.parent2].filter((b) => b !== null);
    const two = this.parents === 2 && this.crossover && pool.length > 1;
    const any = (): Brain => pool[Math.floor(Math.random() * pool.length)];
    for (let i = 0; i < this.population; i++) {
      let brain: Brain;
      if (!this.parent) brain = createBrain(this.sizes);
      else if (i === 0) brain = cloneBrain(this.parent); // лучший едет без изменений
      else if (i === 1 && two && this.parent2) brain = cloneBrain(this.parent2); // и второй тоже
      else {
        brain = two ? this.makeChild(any(), any()) : cloneBrain(any());
        try {
          this.mutate(brain, this.rate);
        } catch (e) {
          this.report(`mutate(): ${messageOf(e)}`, e);
        }
      }
      this.cars.push(new Car(track, { brain, think: this.safeThink(), sensors: this.sensors }));
    }
    // копия мозга: соперник едет каждое поколение одинаково, что бы ни делал с мозгом его think
    this.rivalCars = this.rivals.map((r) => new Car(track, { brain: cloneBrain(r.brain), think: r.think, sensors: r.sensors }));
  }

  /** Ребёнок двух родителей через crossover() студента, с проверкой формы */
  makeChild(mom: Brain, dad: Brain): Brain {
    try {
      const child = this.crossover?.(cloneBrain(mom), cloneBrain(dad));
      const err = checkBrain(child, this.sizes);
      if (!err) return child as Brain; // checkBrain проверил: это мозг нужной формы
      this.report(`crossover() вернула мозг не той формы: ${err}`);
    } catch (e) {
      this.report(`crossover(): ${messageOf(e)}`, e);
    }
    return cloneBrain(mom);
  }

  report(msg: string, error: unknown = null): void {
    if (this.errors.length) return;
    this.errors.push(msg);
    this.lastError = error;
  }

  safeThink(): Think {
    const think = this.think;
    return (inputs, brain) => {
      try {
        return think(inputs, brain);
      } catch (e) {
        this.report(`think(): ${messageOf(e)}`, e);
        return [0, 0, 0, 0];
      }
    };
  }

  /** Один тик для всех машин. Возвращает, сколько машин роя ещё едут: поколение кончается, когда доехал рой */
  step(): number {
    let alive = 0;
    // трафик один на всех — считаем один раз за тик
    const traffic = this.track.traffic ? trafficAt(this.track, this.track.traffic, this.tick) : null;
    this.traffic = traffic;
    for (const car of this.cars) {
      car.step(this.track, this.maxTicks, traffic);
      if (!car.done) alive++;
    }
    for (const car of this.rivalCars) car.step(this.track, this.maxTicks, traffic);
    this.tick++;
    return alive;
  }

  score(car: Car): number {
    try {
      const v = this.fitness(carReport(car, this.track));
      if (!Number.isFinite(v)) {
        this.report('fitness() вернула не число');
        return -Infinity;
      }
      return v;
    } catch (e) {
      this.report(`fitness(): ${messageOf(e)}`, e);
      return -Infinity;
    }
  }

  /**
   * Поколение закончилось: выбрать родителей.
   * Родители детей — лучшие POOL_SHARE поколения: с одним родителем рой легко застревает там, где лучший разбился.
   * picked — машины, выбранные вручную кликом (0, 1 или 2): тогда родители только они (если выбрана одна — добираем лучшего).
   */
  evaluate(picked: Car | Car[] | null = []): { entry: GenerationEntry; parentCar: Car; report: CarReport } {
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
    this.parent = cloneBrain(brainOf(parentCar));
    this.parent2 = chosen[1] ? cloneBrain(brainOf(chosen[1])) : null;
    const top = picked.length ? chosen : scored.slice(0, Math.max(2, Math.round(this.population * POOL_SHARE))).map((s) => s.car);
    this.pool = top.map((car) => cloneBrain(brainOf(car)));
    const report = carReport(parentCar, this.track);
    const scores = scored.map((s) => s.score).filter(Number.isFinite);
    const entry: GenerationEntry = {
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
