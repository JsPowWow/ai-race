// Машина: физика, сенсоры, столкновения, прогресс.
import { clamp, lerp, segmentT } from './utils.ts';
import { castSegment, projectProgress, pointAt, signAt, zoneAt, freeSide, SLOW_SPEED, type Track, type Side } from './track.ts';
import { trafficAt, type TrafficSpot } from './traffic.ts';
import { BUTTONS, NOTES, type Brain } from './brain.ts';

/** Сенсоры: сколько лучей вперёд, угол веера (°), дальность (px); по желанию — лучи назад */
export type Sensors = { count: number; spread: number; length: number; back?: number; backLength?: number; backSpread?: number };
/** Луч сенсора: угол от носа машины (рад) и длина (px) */
export type Ray = { angle: number; length: number };
/** Как мозг думает: входы сети → нажатия (4 кнопки от 0 до 1, дальше — заметки). Варианты — student/think.js */
export type Think = (inputs: number[], brain: Brain) => number[];
/** Пульт: насколько нажата каждая кнопка, от 0 до 1 */
export type Controls = { gas: number; brake: number; left: number; right: number };
/** driving — едет; дальше — почему остановилась */
export type CarStatus = 'driving' | 'crashed' | 'stalled' | 'timeout' | 'finished';
/** Кто ведёт машину: мозг с вариантом «думания» или никто — тогда руками (controls) */
export type Driver = { brain?: Brain | null; think?: Think | null; sensors?: Sensors };
/** Точка в виде пары [x, y] — углы корпуса */
type Corner = [number, number];

export const CAR = {
  width: 24,
  length: 44,
  accel: 0.075,   // газ: с места до максимума ≈ 1,9 с — успеваешь почувствовать, как меняется руль
  brake: 0.1,     // тормоз сильнее газа: с максимума до нуля ≈ 0,6 с
  maxSpeed: 5,
  reverseMax: 1.5,
  friction: 0.03,
  coast: 0.055,   // торможение двигателем: отпустил газ — машина заметно сбавляет, тормоз нужен только в опасности
  // Руль как у настоящей машины: он задаёт дугу, а не скорость поворота. Стоишь — не поворачиваешь,
  // едешь медленно — поворачиваешь медленно. Самая крутая дуга — minRadius; на скорости v дуга не круче v²/grip,
  // иначе колёса сорвутся: на максимальной скорости радиус 250 px, в поворот надо тормозить
  minRadius: 70,
  grip: 0.1,
  steerRate: 0.55,     // руль отзывчивый: от середины до упора — за 2 тика, но дуга всё равно ограничена скоростью
  pivot: 1,            // вокруг чего поворачивает корпус: 0 — центр машины, 1 — задняя ось (как у настоящей: нос ведёт, хвост идёт следом)
  centerRate: 0.31,    // отпустил стрелку — руль возвращается к середине за 3–4 тика
  stallTicks: 180, // столько тиков не продвигается по своей дороге — «заглох»
  slowDown: 0.3,   // так быстро тормозит, заехав в медленную зону
};

/** Кривизна дуги при руле до упора на скорости speed: на сколько радиан поворачиваем за пиксель пути */
export const maxCurve = (speed: number): number => Math.min(1 / CAR.minRadius, CAR.grip / (speed * speed || 1e-9));

/** Расстояние между передней и задней осью — так колёса и нарисованы */
export const WHEELBASE = CAR.length * 0.6;
const WHEEL_SLOW = (25 * Math.PI) / 180; // полный руль на месте
const WHEEL_FAST = (15 * Math.PI) / 180; // полный руль на полной скорости

/**
 * Угол передних колёс на картинке: показывает руль (steer от −1 до 1), как у настоящей машины.
 * На скорости чуть меньше — видно, что газ «съедает» поворот, — но полный руль заметен всегда.
 * Только для картинки: на физику не влияет.
 */
export function wheelAngle(steer: number, speed: number): number {
  const fast = Math.min(1, Math.abs(speed) / CAR.maxSpeed);
  return steer * (WHEEL_SLOW + (WHEEL_FAST - WHEEL_SLOW) * fast);
}

export const DEFAULT_SENSORS: Sensors = { count: 5, spread: 90, length: 160 };

export const BACK_SPREAD = 30; // сенсоры назад по умолчанию — узким веером прямо за машиной: там догоняющие

/**
 * Лучи сенсоров: угол от носа машины и длина. Сначала веер вперёд слева направо (крайние лучи — по краям угла обзора),
 * потом (если есть) сенсоры назад: back лучей длиной backLength в веере backSpread° — видят тех, кто догоняет.
 * Задний веер делим на равные сектора и смотрим в середину каждого: и при двух лучах машина прямо сзади видна.
 */
export function rays({ count, spread, length, back = 0, backLength = 0, backSpread = BACK_SPREAD }: Sensors): Ray[] {
  const front = Array.from({ length: count }, (_, i) => {
    const half = (spread * Math.PI) / 360;
    return { angle: count === 1 ? 0 : lerp(-half, half, i / (count - 1)), length };
  });
  const sector = (backSpread * Math.PI) / 180 / Math.max(1, back);
  const rear = Array.from({ length: back }, (_, i) => ({ angle: Math.PI + (i - (back - 1) / 2) * sector, length: backLength }));
  return [...front, ...rear];
}

/** Сколько всего сенсоров — от этого зависит, сколько у мозга входов */
export const rayCount = (sensors: Sensors): number => sensors.count + (sensors.back ?? 0);

/** Нажатие от 0 до 1; всё, что не число (NaN, undefined из кривого think), — «не нажато» */
const safe = (v: number | undefined): number => (v !== undefined && Number.isFinite(v) ? clamp(v, 0, 1) : 0);

export class Car {
  x: number; y: number; angle: number; speed: number;
  brain: Brain | null; think: Think | null;
  sensors: Sensors; rays: Ray[];
  readings: number[]; rayT: Float32Array;
  sign: Side | 0; before: number[] | null; notes: number[];
  controls: Controls; steer: number;
  lastInputs: number[] | null; lastOutputs: number[] | null;
  status: CarStatus; ticks: number;
  road: number; bestAlong: number;
  zone: { island: number; side: Side } | null; slow: boolean; slowdowns: number;
  segIdx: number; s: number; bestS: number; lastImprove: number;
  distance: number; wiggle: number; prevSteer: number;
  crashSpeed: number; crashedInto: 'car' | 'wall' | null; topSpeed: number; finishTick: number | null;

  /** Без brain машиной управляют руками (controls) */
  constructor(track: Track, { brain = null, think = null, sensors = DEFAULT_SENSORS }: Driver = {}) {
    const start = pointAt(track, track.startS);
    this.x = start.x;
    this.y = start.y;
    this.angle = start.angle;
    this.speed = 0;
    this.brain = brain;
    this.think = think;
    this.sensors = { ...sensors };
    this.rays = rays(sensors);
    this.readings = new Array(this.rays.length).fill(0);
    this.sign = 0; // дорожный знак рядом: -1 налево, 1 направо, 0 — нет
    this.before = null; // что сенсоры видели тиком раньше (на первом тике — то же, что сейчас)
    this.notes = new Array(NOTES).fill(0); // заметки мозга самому себе: на старте пустые
    this.rayT = new Float32Array(this.rays.length).fill(-1);
    this.controls = { gas: 0, brake: 0, left: 0, right: 0 };
    this.steer = 0; // где сейчас руль: -1 до упора влево, 1 вправо. Догоняет кнопки плавно
    this.lastInputs = null;
    this.lastOutputs = null;

    this.status = 'driving'; // driving | crashed | stalled | timeout | finished
    this.ticks = 0;
    this.road = 0; // 0 — само кольцо, дальше — вторые пути островов
    this.bestAlong = track.startS; // докуда доехал по своей дороге
    this.zone = null; // в медленной зоне какого острова сейчас (см. zoneAt)
    this.slow = false; // зона включилась, когда машина в неё въехала: ползём
    this.slowdowns = 0; // сколько раз свернул не туда — на путь с медленной зоной
    this.segIdx = start.idx;
    this.s = track.startS;
    this.bestS = track.startS;
    this.lastImprove = 0;
    this.distance = 0;
    this.wiggle = 0;
    this.prevSteer = 0;
    this.crashSpeed = 0;
    this.crashedInto = null;
    this.topSpeed = 0;
    this.finishTick = null;
  }

  get done(): boolean {
    return this.status !== 'driving';
  }

  /** traffic — положение машин трафика на этом тике (если не передано — посчитаем сами) */
  step(track: Track, maxTicks = Infinity, traffic?: TrafficSpot[] | null): void {
    if (this.done) return;
    const tick = this.ticks; // тик мира: по нему едет трафик и переключаются медленные зоны
    if (traffic === undefined) traffic = track.traffic ? trafficAt(track, track.traffic, tick) : null;
    this.ticks++;
    this.sense(track, traffic);
    this.sign = signAt(track, this.road, this.s, tick);

    // что «видит» машина на этом тике: сенсоры, скорость, сенсоры тиком раньше, знак, заметки (так же записывает пример «Учитель»)
    const inputs = this.inputs();
    this.lastInputs = inputs;
    this.before = this.readings.slice();
    if (this.brain && this.think) {
      const out = this.think(inputs, this.brain) || [];
      this.lastOutputs = out;
      const c = this.controls;
      c.gas = safe(out[0]);
      c.brake = safe(out[1]);
      c.left = safe(out[2]);
      c.right = safe(out[3]);
      for (let i = 0; i < NOTES; i++) this.notes[i] = safe(out[BUTTONS.length + i]);
    }

    this.move();

    const hitWall = this.hitsWall(track);
    const hitCar = !hitWall && this.hitsTraffic(traffic);
    if (hitWall || hitCar) {
      this.status = 'crashed';
      this.crashedInto = hitCar ? 'car' : 'wall';
      this.crashSpeed = Math.abs(this.speed);
      return;
    }

    const p = projectProgress(track, this.x, this.y, this.segIdx, this.road, this.s);
    if (p.road !== this.road) this.bestAlong = p.along; // свернул на второй путь острова или вернулся с него: считаем по новой дороге. Само по себе это не «едет» — иначе можно вечно вилять у развилки
    this.road = p.road;
    this.segIdx = p.idx;
    this.s = p.s;
    if (this.s > this.bestS + 1) this.bestS = this.s;
    // Медленная зона действует на тех, кто въехал в неё, пока она включена: кто уже внутри, того не трогают
    const zone = zoneAt(track, this.road, this.s);
    if (zone && !this.zone) {
      this.slow = freeSide(track, zone.island, tick) !== zone.side;
      if (this.slow) this.slowdowns++;
    }
    this.zone = zone;
    if (!zone) this.slow = false;
    // «Едет» — значит, продвигается по своей дороге
    if (p.along > this.bestAlong + 1) {
      this.bestAlong = p.along;
      this.lastImprove = this.ticks;
    }
    if (this.s >= track.finishS) {
      this.bestS = Math.max(this.bestS, track.finishS);
      this.status = 'finished';
      this.finishTick = this.ticks;
    } else if (this.ticks - this.lastImprove > CAR.stallTicks) {
      this.status = 'stalled';
    } else if (this.ticks >= maxTicks) {
      this.status = 'timeout';
    }
  }

  move(): void {
    const c = this.controls;
    this.speed += CAR.accel * safe(c.gas);
    this.speed -= CAR.brake * safe(c.brake);
    this.speed = clamp(this.speed, -CAR.reverseMax, CAR.maxSpeed);
    if (this.slow) this.speed = clamp(this.speed, -SLOW_SPEED, Math.max(SLOW_SPEED, this.speed - CAR.slowDown));
    if (this.speed > 0) this.speed = Math.max(0, this.speed - CAR.friction - CAR.coast * (1 - safe(c.gas)));
    else if (this.speed < 0) this.speed = Math.min(0, this.speed + CAR.friction);

    const steer = safe(c.right) - safe(c.left); // куда крутят руль кнопки
    // крутишь от середины — руль идёт со скоростью steerRate, к середине — со скоростью centerRate
    const outward = Math.abs(steer) > Math.abs(this.steer) && steer * this.steer >= 0;
    const rate = outward ? CAR.steerRate : CAR.centerRate;
    this.steer += clamp(steer - this.steer, -rate, rate);
    const before = this.angle;
    this.angle += this.speed * this.steer * maxCurve(this.speed); // задним ходом дуга та же, но поворот в другую сторону — как у машины
    this.wiggle += Math.abs(steer - this.prevSteer);
    this.prevSteer = steer;

    // по дуге идёт точка поворота (при pivot = 1 — задняя ось), а центр машины поворачивается вокруг неё
    const arm = (CAR.pivot * WHEELBASE) / 2;
    this.x += Math.cos(this.angle) * this.speed + arm * (Math.cos(this.angle) - Math.cos(before));
    this.y += Math.sin(this.angle) * this.speed + arm * (Math.sin(this.angle) - Math.sin(before));
    this.distance += Math.abs(this.speed);
    this.topSpeed = Math.max(this.topSpeed, this.speed);
  }

  /** Входы сети сейчас: [s1…sn, v, s1′…sn′, зн, m1…m3] */
  inputs(): number[] {
    return [...this.readings, this.speed / CAR.maxSpeed, ...(this.before ?? this.readings), this.sign, ...this.notes];
  }

  /** Сенсоры: 0 — стены не видно, 1 — стена вплотную. Вперёд слева направо, потом назад (см. rays). */
  sense(track: Track, traffic: TrafficSpot[] | null = null): void {
    const reach = Math.max(...this.rays.map((r) => r.length));
    // машины трафика, до которых сенсор вообще может достать
    const near: number[][] = [];
    if (traffic) for (const o of traffic) if (Math.abs(o.x - this.x) < reach + 30 && Math.abs(o.y - this.y) < reach + 30) near.push(o.poly);
    for (let i = 0; i < this.rays.length; i++) {
      const a = this.angle + this.rays[i].angle, length = this.rays[i].length;
      const x2 = this.x + Math.cos(a) * length, y2 = this.y + Math.sin(a) * length;
      let t = castSegment(track, this.x, this.y, x2, y2);
      for (const p of near) {
        for (let e = 0; e < 8; e += 2) {
          const tc = segmentT(this.x, this.y, x2, y2, p[e], p[e + 1], p[(e + 2) % 8], p[(e + 3) % 8]);
          if (tc >= 0 && (t < 0 || tc < t)) t = tc;
        }
      }
      this.rayT[i] = t;
      this.readings[i] = t < 0 ? 0 : 1 - t;
    }
  }

  hitsTraffic(traffic: TrafficSpot[] | null): boolean {
    if (!traffic) return false;
    const c = this.corners();
    for (const o of traffic) {
      if (Math.abs(o.x - this.x) > 60 || Math.abs(o.y - this.y) > 60) continue;
      if (!o.oncoming && !this.fasterThan(o)) continue; // попутная быстрее нас — объедет сама: сенсоры назад не смотрят, удар сзади не выучишь
      const p = o.poly;
      for (let i = 0; i < 4; i++) {
        const a = c[i], b = c[(i + 1) % 4];
        for (let e = 0; e < 8; e += 2) {
          if (segmentT(a[0], a[1], b[0], b[1], p[e], p[e + 1], p[(e + 2) % 8], p[(e + 3) % 8]) >= 0) return true;
        }
      }
    }
    return false;
  }

  /** Едем по ходу попутной машины o быстрее её: тогда столкновение с ней — наша вина, хоть сзади, хоть сбоку */
  fasterThan(o: TrafficSpot): boolean {
    return this.speed * Math.cos(this.angle - o.angle) > o.speed;
  }

  corners(): Corner[] {
    const cos = Math.cos(this.angle), sin = Math.sin(this.angle);
    const hl = CAR.length / 2, hw = CAR.width / 2;
    return [
      [this.x + cos * hl - sin * hw, this.y + sin * hl + cos * hw],
      [this.x + cos * hl + sin * hw, this.y + sin * hl - cos * hw],
      [this.x - cos * hl + sin * hw, this.y - sin * hl - cos * hw],
      [this.x - cos * hl - sin * hw, this.y - sin * hl + cos * hw],
    ];
  }

  hitsWall(track: Track): boolean {
    const c = this.corners();
    for (let i = 0; i < 4; i++) {
      const a = c[i], b = c[(i + 1) % 4];
      if (castSegment(track, a[0], a[1], b[0], b[1]) >= 0) return true;
    }
    return false;
  }
}

/** Всё, что видит функция fitness() студента */
export type CarReport = {
  progress: number; trackLength: number; progressPct: number;
  finished: boolean; crashed: boolean; hitCar: boolean; stalled: boolean;
  ticks: number; avgSpeed: number; topSpeed: number; wiggle: number;
};

export function carReport(car: Car, track: Track): CarReport {
  const trackLength = track.finishS - track.startS;
  const progress = Math.max(0, Math.min(trackLength, car.bestS - track.startS));
  return {
    progress,
    trackLength,
    progressPct: (progress / trackLength) * 100,
    finished: car.status === 'finished',
    crashed: car.status === 'crashed',
    hitCar: car.crashedInto === 'car',
    stalled: car.status === 'stalled' || car.status === 'timeout',
    ticks: car.ticks,
    avgSpeed: car.ticks ? car.distance / car.ticks : 0,
    topSpeed: car.topSpeed,
    wiggle: car.wiggle,
  };
}

export function maxTicksFor(track: Track): number {
  return Math.ceil((track.finishS - track.startS) / 1.2) + 300;
}
