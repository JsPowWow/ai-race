// Физика ручной езды: разгон заметный, тормоз сильнее газа, колёса показывают ту дугу, по которой машина едет.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Car, CAR, WHEELBASE, wheelAngle } from '../../engine/car.js';
import { getTrainingTrack } from '../../engine/track.js';

const track = getTrainingTrack('warmup');

/** Сколько тиков жать кнопки, пока speed не дойдёт до цели */
function ticksUntil(car, controls, done) {
  Object.assign(car.controls, controls);
  let ticks = 0;
  while (!done(car) && ticks < 1000) { car.move(); ticks++; }
  return ticks;
}

test('с места до максимума — не мгновенно: около полутора секунд', () => {
  const ticks = ticksUntil(new Car(track), { gas: 1 }, (c) => c.speed >= CAR.maxSpeed - 2 * CAR.friction); // трение не даёт упереться в максимум ровно
  assert.ok(ticks >= 75 && ticks <= 120, `разгон за ${ticks} тиков`);
});

test('тормоз сильнее газа: с максимума до нуля быстрее, чем разгон', () => {
  const car = new Car(track);
  car.speed = CAR.maxSpeed;
  const ticks = ticksUntil(car, { brake: 1 }, (c) => c.speed <= 0);
  assert.ok(ticks >= 20 && ticks <= 45, `торможение за ${ticks} тиков`);
});

test('колёса повёрнуты ровно на дугу, по которой машина едет', () => {
  const car = new Car(track);
  car.speed = 2;
  ticksUntil(car, { right: 1, gas: 0.5 }, (c) => c.steer >= 1);
  const before = car.angle;
  car.move();
  const curve = (car.angle - before) / car.speed; // сколько радиан на пиксель пути на самом деле
  assert.ok(Math.abs(car.curve - curve) < 1e-9);
  assert.ok(Math.abs(Math.tan(wheelAngle(car.curve)) - WHEELBASE * curve) < 1e-9, 'велосипедная модель: tg угла = база × кривизна');
});

test('на месте колёса можно повернуть, а на скорости они повёрнуты меньше', () => {
  const at = (speed) => { const car = new Car(track); car.speed = speed; ticksUntil(car, { right: 1 }, (c) => c.steer >= 1); return wheelAngle(car.curve); };
  assert.ok(at(0) > 0.3, 'на месте — заметный угол');
  assert.ok(at(3) < at(0) && at(CAR.maxSpeed) < at(3) && at(CAR.maxSpeed) > 0);
});
