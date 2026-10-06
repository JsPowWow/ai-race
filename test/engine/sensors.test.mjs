// Сенсоры: веер вперёд и (по желанию) сенсоры назад — они видят тех, кто догоняет.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Car, rays, rayCount } from '../../engine/world/car.ts';
import { inputCount, layerSizes } from '../../engine/net/brain.ts';
import { getTrainingTrack, pointAt } from '../../engine/world/track.ts';
import { rectPoly } from '../../engine/world/traffic.ts';

const track = getTrainingTrack('warmup');
const FRONT = { count: 5, spread: 90, length: 160 };
const BOTH = { ...FRONT, back: 2, backLength: 120 };

/** Машина трафика на расстоянии d по ходу движения от точки старта (d < 0 — сзади) */
function carAt(d) {
  const start = pointAt(track, track.startS);
  const x = start.x + Math.cos(start.angle) * d, y = start.y + Math.sin(start.angle) * d;
  return { x, y, angle: start.angle, speed: 0, oncoming: false, poly: rectPoly(x, y, start.angle) };
}

test('без сенсоров назад — как раньше: веер вперёд', () => {
  assert.equal(rayCount(FRONT), 5);
  assert.ok(rays(FRONT).every((r) => Math.abs(r.angle) <= Math.PI / 4 + 1e-9 && r.length === 160));
});

test('сенсоры назад добавляются после переднего веера и смотрят назад', () => {
  assert.equal(rayCount(BOTH), 7);
  const back = rays(BOTH).slice(5);
  assert.ok(back.every((r) => Math.abs(Math.abs(r.angle) - Math.PI) < Math.PI / 4 && r.length === 120));
  assert.deepEqual(layerSizes(rayCount(BOTH), [6])[0], inputCount(7), 'каждый сенсор назад — ещё два входа: сейчас и мгновение назад');
});

test('машина сзади видна только сенсорами назад', () => {
  const look = (sensors, traffic) => {
    const car = new Car(track, { sensors });
    car.sense(track, traffic);
    return car.readings;
  };
  const alone = look(BOTH, []), chased = look(BOTH, [carAt(-80)]);
  assert.deepEqual(chased.slice(0, 5), alone.slice(0, 5), 'вперёд — то же, что без неё');
  assert.deepEqual(alone.slice(5), [0, 0], 'сзади пусто, пока никого нет');
  assert.ok(chased.slice(5).some((v) => v > 0), 'сзади видно догоняющего');
  assert.deepEqual(look(FRONT, [carAt(-80)]), look(FRONT, []), 'без сенсоров назад его не видно');
});

test('угол обзора сзади настраивается, по умолчанию — узкий веер 30°', () => {
  const spanOf = (sensors) => { const back = rays(sensors).slice(5).map((r) => r.angle); return Math.max(...back) - Math.min(...back); };
  const narrow = spanOf({ ...BOTH, back: 3 });
  const wide = spanOf({ ...BOTH, back: 3, backSpread: 90 });
  assert.ok(Math.abs(narrow - (20 * Math.PI) / 180) < 1e-9, 'три луча в 30° — через 10°: по серединам секторов');
  assert.ok(Math.abs(wide - (60 * Math.PI) / 180) < 1e-9, 'в 90° — через 30°');
});
