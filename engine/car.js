// Машина: физика, сенсоры, столкновения, прогресс.
import { clamp, lerp, segmentT } from './utils.js';
import { castSegment, projectProgress, pointAt, signAt, zoneAt, freeSide, SLOW_SPEED } from './track.js';
import { trafficAt } from './traffic.js';
import { BUTTONS, NOTES } from './brain.js';

export const CAR = {
  width: 24,
  length: 44,
  accel: 0.075,   // газ: с места до максимума ≈ 1,5 с — успеваешь почувствовать, как меняется руль
  brake: 0.1,     // тормоз сильнее газа: с максимума до нуля ≈ 0,5 с
  maxSpeed: 4,
  reverseMax: 1.5,
  friction: 0.03,
  // Руль как у настоящей машины: он задаёт дугу, а не скорость поворота. Стоишь — не поворачиваешь,
  // едешь медленно — поворачиваешь медленно. Самая крутая дуга — minRadius; на скорости v дуга не круче v²/grip,
  // иначе колёса сорвутся: на максимальной скорости радиус ≈ 320 px, в поворот надо тормозить
  minRadius: 60,
  grip: 0.05,
  steerRate: 0.12,     // руль не щёлкает: от середины до упора — за 8 тиков
  stallTicks: 180, // столько тиков не продвигается по своей дороге — «заглох»
  slowDown: 0.3,   // так быстро тормозит, заехав в медленную зону
};

/** Кривизна дуги при руле до упора на скорости speed: на сколько радиан поворачиваем за пиксель пути */
export const maxCurve = (speed) => Math.min(1 / CAR.minRadius, CAR.grip / (speed * speed || 1e-9));

/** Расстояние между передней и задней осью — так колёса и нарисованы */
export const WHEELBASE = CAR.length * 0.6;
export const MAX_WHEEL = (35 * Math.PI) / 180;

/**
 * Угол передних колёс для дуги curve (радиан на пиксель пути): как у велосипеда, tg угла = база × кривизна.
 * На скорости дуга шире — колёса повёрнуты меньше. Только для картинки: на физику не влияет.
 */
export function wheelAngle(curve) {
  return clamp(Math.atan(WHEELBASE * curve), -MAX_WHEEL, MAX_WHEEL);
}

export const DEFAULT_SENSORS = { count: 5, spread: 90, length: 160 };

export const BACK_SPREAD = 30; // сенсоры назад по умолчанию — узким веером прямо за машиной: там догоняющие

/**
 * Лучи сенсоров: угол от носа машины и длина. Сначала веер вперёд слева направо (крайние лучи — по краям угла обзора),
 * потом (если есть) сенсоры назад: back лучей длиной backLength в веере backSpread° — видят тех, кто догоняет.
 * Задний веер делим на равные сектора и смотрим в середину каждого: и при двух лучах машина прямо сзади видна.
 * @param {{ count: number, spread: number, length: number, back?: number, backLength?: number, backSpread?: number }} sensors
 */
export function rays({ count, spread, length, back = 0, backLength = 0, backSpread = BACK_SPREAD }) {
  const front = Array.from({ length: count }, (_, i) => {
    const half = (spread * Math.PI) / 360;
    return { angle: count === 1 ? 0 : lerp(-half, half, i / (count - 1)), length };
  });
  const sector = (backSpread * Math.PI) / 180 / Math.max(1, back);
  const rear = Array.from({ length: back }, (_, i) => ({ angle: Math.PI + (i - (back - 1) / 2) * sector, length: backLength }));
  return [...front, ...rear];
}

/** Сколько всего сенсоров — от этого зависит, сколько у мозга входов */
export const rayCount = (sensors) => sensors.count + (sensors.back ?? 0);

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
    this.rays = rays(sensors);
    this.readings = new Array(this.rays.length).fill(0);
    this.sign = 0; // дорожный знак рядом: -1 налево, 1 направо, 0 — нет
    this.before = null; // что сенсоры видели тиком раньше (на первом тике — то же, что сейчас)
    this.notes = new Array(NOTES).fill(0); // заметки мозга самому себе: на старте пустые
    this.rayT = new Float32Array(this.rays.length).fill(-1);
    this.controls = { gas: 0, brake: 0, left: 0, right: 0 };
    this.steer = 0; // где сейчас руль: -1 до упора влево, 1 вправо. Догоняет кнопки плавно
    this.curve = 0; // по какой дуге едем: радиан на пиксель пути (колёса на картинке)
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

  get done() {
    return this.status !== 'driving';
  }

  /** traffic — положение машин трафика на этом тике (если не передано — посчитаем сами) */
  step(track, maxTicks = Infinity, traffic) {
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

  move() {
    const c = this.controls;
    this.speed += CAR.accel * safe(c.gas);
    this.speed -= CAR.brake * safe(c.brake);
    this.speed = clamp(this.speed, -CAR.reverseMax, CAR.maxSpeed);
    if (this.slow) this.speed = clamp(this.speed, -SLOW_SPEED, Math.max(SLOW_SPEED, this.speed - CAR.slowDown));
    if (this.speed > 0) this.speed = Math.max(0, this.speed - CAR.friction);
    else if (this.speed < 0) this.speed = Math.min(0, this.speed + CAR.friction);

    const steer = safe(c.right) - safe(c.left); // куда крутят руль кнопки
    this.steer += clamp(steer - this.steer, -CAR.steerRate, CAR.steerRate);
    this.curve = this.steer * maxCurve(this.speed);
    this.angle += this.speed * this.curve; // задним ходом дуга та же, но поворот в другую сторону — как у машины
    this.wiggle += Math.abs(steer - this.prevSteer);
    this.prevSteer = steer;

    this.x += Math.cos(this.angle) * this.speed;
    this.y += Math.sin(this.angle) * this.speed;
    this.distance += Math.abs(this.speed);
    this.topSpeed = Math.max(this.topSpeed, this.speed);
  }

  /** Входы сети сейчас: [s1…sn, v, s1′…sn′, зн, m1…m3] */
  inputs() {
    return [...this.readings, this.speed / CAR.maxSpeed, ...(this.before ?? this.readings), this.sign, ...this.notes];
  }

  /** Сенсоры: 0 — стены не видно, 1 — стена вплотную. Вперёд слева направо, потом назад (см. rays). */
  sense(track, traffic = null) {
    const reach = Math.max(...this.rays.map((r) => r.length));
    // машины трафика, до которых сенсор вообще может достать
    const near = [];
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

  hitsTraffic(traffic) {
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
  fasterThan(o) {
    return this.speed * Math.cos(this.angle - o.angle) > o.speed;
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
