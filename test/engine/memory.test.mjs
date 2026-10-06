// Память мозга: сенсоры мгновение назад (s′) и заметки (m1…m3), которые мозг пишет сам себе. И дорожный знак (зн).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrain, layerSizes, inputCount, inputLabels, NOTES, BUTTONS, OUTPUTS } from '../../engine/net/brain.ts';
import { Car } from '../../engine/world/car.ts';
import { getTrainingTrack } from '../../engine/world/track.ts';
import { trainEpoch, sampleOf } from '../../engine/learn/imitation.ts';
import { mulberry32 } from '../../engine/core/utils.ts';
import { thinkVariants } from '../../student/think.js';

const SENSORS = { count: 5, spread: 90, length: 160 };
const sizes = layerSizes(SENSORS.count, [6]);
const smooth = thinkVariants.smooth.think;

test('форма одна: сенсоры, скорость, сенсоры мгновение назад, знак, заметки → 4 кнопки и заметки', () => {
  assert.equal(inputCount(5), 5 + 1 + 5 + 1 + NOTES);
  assert.deepEqual(inputLabels(2), ['s1', 's2', 'v', 's1′', 's2′', 'зн', 'm1', 'm2', 'm3']);
  assert.equal(OUTPUTS, BUTTONS.length + NOTES);
  assert.deepEqual(sizes, [inputCount(5), 6, OUTPUTS]);
});

test('в новом мозге заметки молчат: их веса — нули', () => {
  const brain = createBrain(sizes, mulberry32(1));
  const rows = brain.layers[0].weights;
  rows.slice(-NOTES).forEach((row) => assert.ok(row.every((w) => w === 0)));
  assert.ok(rows.slice(0, -NOTES).some((row) => row.some((w) => w !== 0)));
});

test('на первом тике «мгновение назад» — то же, что сейчас, а заметки пустые', () => {
  const track = getTrainingTrack('warmup');
  const car = new Car(track, { brain: createBrain(sizes, mulberry32(2)), think: smooth, sensors: SENSORS });
  car.step(track);
  const x = car.lastInputs, n = SENSORS.count;
  assert.equal(x.length, inputCount(n));
  assert.deepEqual(x.slice(n + 1, 2 * n + 1), x.slice(0, n));
  assert.deepEqual(x.slice(-NOTES), [0, 0, 0]);
  assert.equal(x[2 * n + 1], 0, 'на обычной трассе знака нет');
});

test('на следующем тике мозг видит свои заметки и прошлые сенсоры', () => {
  const track = getTrainingTrack('warmup');
  const car = new Car(track, { brain: {}, think: () => [1, 0, 0, 0, 0.2, 0.7, 1], sensors: SENSORS });
  car.step(track);
  const was = car.readings.slice();
  car.step(track);
  const n = SENSORS.count;
  assert.deepEqual(car.lastInputs.slice(n + 1, 2 * n + 1), was);
  assert.deepEqual(car.lastInputs.slice(-NOTES), [0.2, 0.7, 1]);
});

test('без мозга (едет человек) заметки остаются пустыми', () => {
  const track = getTrainingTrack('warmup');
  const car = new Car(track, { sensors: SENSORS });
  car.controls.gas = 1;
  for (let i = 0; i < 30; i++) car.step(track);
  assert.deepEqual(sampleOf(car).x.slice(-NOTES), [0, 0, 0]);
});

test('обучение на примерах не трогает заметки: учитель их не пишет', () => {
  const rnd = mulberry32(3);
  const n = inputCount(SENSORS.count);
  const samples = Array.from({ length: 100 }, () => {
    const x = Array.from({ length: n }, (_, i) => (i >= n - NOTES ? 0 : rnd()));
    return { x, y: [x[2] > 0.5 ? 0 : 1, x[2] > 0.5 ? 1 : 0, 0, 0] };
  });
  const brain = createBrain(sizes, mulberry32(4));
  const last = brain.layers.length - 1;
  const noteBiases = brain.layers[last].biases.slice(BUTTONS.length);
  for (let e = 0; e < 10; e++) trainEpoch(brain, samples, 0.1, mulberry32(e));
  brain.layers[0].weights.slice(-NOTES).forEach((row) => assert.ok(row.every((w) => w === 0), 'веса от заметок остались нулями'));
  assert.deepEqual(brain.layers[last].biases.slice(BUTTONS.length), noteBiases, 'пороги заметок не сдвинулись');
});
