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

// Рецепт «из коробки» (think «Плавный», точечная мутация, кроссовер нейронами, фитнес «Дальше и быстрее») учится надёжно:
// в опыте (tools/swarm-check.mjs) — 15 финишей из 15 на «Змейке», «Шпильке» и «Развилке» со встречными.
test('рой по умолчанию учится: на «Змейке» со встречными лучший доезжает за 30 поколений', async () => {
  const { thinkVariants, DEFAULT_THINK } = await import('../../student/think.js');
  const { FITNESS, MUTATIONS, DEFAULT_RECIPE, crossover } = await import('../../engine/recipes.js');
  const { fitness } = FITNESS[DEFAULT_RECIPE.fitness], { mutate } = MUTATIONS[DEFAULT_RECIPE.mutation];
  const { withTraffic } = await import('../../engine/traffic.js');
  const { withCoins } = await import('../../engine/track.js');
  const { DEFAULT_SENSORS } = await import('../../engine/car.js');
  const track = withTraffic(getTrainingTrack('snake'), 'all');
  const saved = Math.random;
  try {
    for (const seed of [1, 2]) {
      Math.random = mulberry32(seed);
      const evo = new Evolution({
        sizes: layerSizes(DEFAULT_SENSORS.count, [6]), sensors: DEFAULT_SENSORS, population: 100, rate: 0.1,
        think: thinkVariants[DEFAULT_THINK].think, mutate, crossover, fitness,
      });
      let finishedAt = null;
      for (let g = 0; g < 30 && !finishedAt; g++) {
        evo.spawn(withCoins(track, g));
        while (evo.step() > 0 && evo.tick < evo.maxTicks);
        if (evo.evaluate().entry.finished) finishedAt = g + 1;
      }
      assert.ok(finishedAt, `опыт ${seed}: за 30 поколений никто не доехал`);
    }
  } finally {
    Math.random = saved;
  }
});
