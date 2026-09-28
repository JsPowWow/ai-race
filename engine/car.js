// Машина: физика, сенсоры, столкновения, прогресс.
import { clamp, lerp, segmentT } from './utils.js';
import { castSegment, projectProgress, pointAt } from './track.js';
import { trafficAt } from './traffic.js';
import { BUTTONS, NOTES } from './brain.js';

export const CAR = {
  width: 24,
  length: 44,
  accel: 0.2,
  maxSpeed: 4,
  reverseMax: 1.5,
  friction: 0.03,
  turn: 0.05,          // поворот за тик на малой скорости
  gripLoss: 0.7,       // на максимальной скорости руль слабее на 70%
  stallTicks: 180, // столько тиков без продвижения — «заглох»
};

/**
 * Угол передних колёс, как у настоящей машины: он такой, чтобы описать ту дугу, по которой машина едет на самом деле.
 * На скорости руль слабее (gripLoss) и дуга шире — колёса повёрнуты меньше; на месте — сколько повернули руль.
 * Только для картинки: на физику не влияет.
 */
export const MAX_WHEEL = (32 * Math.PI) / 180;
const WHEELBASE = CAR.length * 0.9; // база с запасом: у настоящей (0,6 длины) на скорости колёса повёрнуты на 5°, а это не разглядеть
export function wheelAngle(steer, speed) {
  const grip = 1 - (CAR.gripLoss * Math.abs(speed)) / CAR.maxSpeed;
  const turnPerPx = (CAR.turn * grip * steer) / Math.max(Math.abs(speed), 0.8); // кривизна дуги: на сколько поворачиваем за пиксель пути
  return clamp(Math.atan(WHEELBASE * turnPerPx), -MAX_WHEEL, MAX_WHEEL) * (speed < 0 ? -1 : 1);
}

export const DEFAULT_SENSORS = { count: 5, spread: 90, length: 160 };

const safe = (v) => (Number.isFinite(v) ? clamp(v, 0, 1) : 0);

export class Car {
  /**
   * @param {object} track трасса
   * @param {{ brain?: object | null, think?: Function | null, sensors?: typeof DEFAULT_SENSORS }} [opts]
   *   без brain машиной управляют руками (controls)
   */
  constructor(track, { brain = null, think = null, sensors = DEFAULT_SENSORS } = {}) {
    const start = pointAt(track, track.startS);
    this.x = start.x;
    this.y = start.y;
    this.angle = start.angle;
    this.speed = 0;
    this.brain = brain;
    this.think = think;
    this.sensors = { ...sensors };
    this.readings = new Array(sensors.count).fill(0);
    this.before = null; // что сенсоры видели тиком раньше (на первом тике — то же, что сейчас)
    this.notes = new Array(NOTES).fill(0); // заметки мозга самому себе: на старте пустые
    this.rayT = new Float32Array(sensors.count).fill(-1);
    this.controls = { gas: 0, brake: 0, left: 0, right: 0 };
    this.lastInputs = null;
    this.lastOutputs = null;

    this.status = 'driving'; // driving | crashed | stalled | timeout | finished
    this.ticks = 0;
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

  get done() {
    return this.status !== 'driving';
  }

  /** traffic — положение машин трафика на этом тике (если не передано — посчитаем сами) */
  step(track, maxTicks = Infinity, traffic) {
    if (this.done) return;
    if (traffic === undefined) traffic = track.traffic ? trafficAt(track, track.traffic, this.ticks) : null;
    this.ticks++;
    this.sense(track, traffic);

    // что «видит» машина на этом тике: сенсоры, скорость, сенсоры тиком раньше, заметки (так же записывает пример «Учитель»)
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

    const p = projectProgress(track, this.x, this.y, this.segIdx);
    this.segIdx = p.idx;
    this.s = p.s;
    if (this.s > this.bestS + 1) {
      this.bestS = this.s;
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

  move() {
    const c = this.controls;
    this.speed += CAR.accel * safe(c.gas);
    this.speed -= CAR.accel * safe(c.brake);
    this.speed = clamp(this.speed, -CAR.reverseMax, CAR.maxSpeed);
    if (this.speed > 0) this.speed = Math.max(0, this.speed - CAR.friction);
    else if (this.speed < 0) this.speed = Math.min(0, this.speed + CAR.friction);

    const steer = safe(c.right) - safe(c.left);
    if (this.speed !== 0) {
      const flip = this.speed > 0 ? 1 : -1;
      const grip = 1 - (CAR.gripLoss * Math.abs(this.speed)) / CAR.maxSpeed;
      this.angle += CAR.turn * grip * steer * flip;
    }
    this.wiggle += Math.abs(steer - this.prevSteer);
    this.prevSteer = steer;

    this.x += Math.cos(this.angle) * this.speed;
    this.y += Math.sin(this.angle) * this.speed;
    this.distance += Math.abs(this.speed);
    this.topSpeed = Math.max(this.topSpeed, this.speed);
  }

  /** Входы сети сейчас: [s1…sn, v, s1′…sn′, m1…m3] */
  inputs() {
    return [...this.readings, this.speed / CAR.maxSpeed, ...(this.before ?? this.readings), ...this.notes];
  }

  /** Сенсоры: 0 — стены не видно, 1 — стена вплотную. Слева направо. */
  sense(track, traffic = null) {
    const { count, spread, length } = this.sensors;
    const half = (spread * Math.PI) / 360;
    // машины трафика, до которых сенсор вообще может достать
    const near = [];
    if (traffic) for (const o of traffic) if (Math.abs(o.x - this.x) < length + 30 && Math.abs(o.y - this.y) < length + 30) near.push(o.poly);
    for (let i = 0; i < count; i++) {
      const a = this.angle + (count === 1 ? 0 : lerp(-half, half, i / (count - 1)));
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

  hitsTraffic(traffic) {
    if (!traffic) return false;
    const c = this.corners();
    for (const o of traffic) {
      if (Math.abs(o.x - this.x) > 60 || Math.abs(o.y - this.y) > 60) continue;
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

  corners() {
    const cos = Math.cos(this.angle), sin = Math.sin(this.angle);
    const hl = CAR.length / 2, hw = CAR.width / 2;
    return [
      [this.x + cos * hl - sin * hw, this.y + sin * hl + cos * hw],
      [this.x + cos * hl + sin * hw, this.y + sin * hl - cos * hw],
      [this.x - cos * hl + sin * hw, this.y - sin * hl - cos * hw],
      [this.x - cos * hl - sin * hw, this.y - sin * hl + cos * hw],
    ];
  }

  hitsWall(track) {
    const c = this.corners();
    for (let i = 0; i < 4; i++) {
      const a = c[i], b = c[(i + 1) % 4];
      if (castSegment(track, a[0], a[1], b[0], b[1]) >= 0) return true;
    }
    return false;
  }
}

/** Всё, что видит функция fitness() студента */
export function carReport(car, track) {
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

export function maxTicksFor(track) {
  return Math.ceil((track.finishS - track.startS) / 1.2) + 300;
}
