// Физика ручной езды: разгон заметный, тормоз сильнее газа, колёса показывают руль.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Car, CAR, wheelAngle } from '../../engine/car.js';
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

test('колёса показывают руль: полный руль видно и на полной скорости', () => {
  const deg = (steer, speed) => (wheelAngle(steer, speed) * 180) / Math.PI;
  assert.equal(deg(0, CAR.maxSpeed), 0, 'руль прямо — колёса прямо');
  assert.ok(deg(1, 0) >= 20, `на месте полный руль — ${deg(1, 0).toFixed(1)}°`);
  assert.ok(deg(1, CAR.maxSpeed) >= 10, `на полной скорости полный руль всё равно заметен — ${deg(1, CAR.maxSpeed).toFixed(1)}°`);
  assert.ok(deg(1, CAR.maxSpeed) < deg(1, 0), 'но на скорости меньше: газ «съедает» поворот');
  assert.equal(deg(-1, 2), -deg(1, 2), 'влево — так же, только в другую сторону');
  assert.equal(deg(1, -2), deg(1, 2), 'задним ходом колёса крутятся так же');
});

test('колёса догоняют руль плавно, вместе с ним', () => {
  const car = new Car(track);
  car.speed = CAR.maxSpeed;
  let n = 0;
  ticksUntil(car, { right: 1, gas: 1 }, () => n++ >= 2); // руль крутили всего 2 тика
  const half = wheelAngle(car.steer, car.speed);
  ticksUntil(car, { right: 1, gas: 1 }, (c) => c.steer >= 1);
  assert.ok(half > 0 && half < wheelAngle(car.steer, car.speed), 'короткое нажатие — колёса повёрнуты меньше, чем до упора');
});
