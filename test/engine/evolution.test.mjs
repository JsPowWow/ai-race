// Отбор в рое: кто станет родителем следующего поколения.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Evolution } from '../../engine/evolution.js';
import { createBrain, layerSizes } from '../../engine/brain.js';
import { getTrainingTrack } from '../../engine/track.js';
import { mulberry32 } from '../../engine/utils.js';

const SENSORS = { count: 5, spread: 90, length: 160 };
const sizes = layerSizes(SENSORS.count, [6]);
const swarm = (fitness) => new Evolution({
  sizes, sensors: SENSORS, population: 5, rate: 0.1, parent: createBrain(sizes, mulberry32(1)),
  think: () => [1, 0, 0, 0, 0, 0, 0], mutate: (brain) => { brain.layers[0].biases[0] = 0.5; }, fitness,
});

// Поэтому рой с фитнесом «только расстояние» после первого финиша не ускоряется: все доехавшие для него равны.
// Ускорить может только фитнес, который хвалит за время (урок 3, шаг 1).
test('ничья — в пользу родителя: рой не меняет то, что уже работает, на «не хуже»', () => {
  const evo = swarm(() => 100);
  evo.spawn(getTrainingTrack('warmup'));
  assert.equal(evo.evaluate().parentCar, evo.cars[0], 'первая машина — родитель без изменений');
});

test('кто лучше по фитнесу, тот и родитель', () => {
  let n = 0;
  const evo = swarm(() => (n++ === 3 ? 200 : 100));
  evo.spawn(getTrainingTrack('warmup'));
  assert.equal(evo.evaluate().parentCar, evo.cars[3]);
  assert.equal(evo.parent.layers[0].biases[0], 0.5, 'новый родитель — мутировавший ребёнок');
});
