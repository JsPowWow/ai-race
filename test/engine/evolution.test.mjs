// Отбор в рое: кто станет родителем следующего поколения.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Evolution } from '../../engine/evolution.ts';
import { createBrain, layerSizes } from '../../engine/brain.ts';
import { getTrainingTrack } from '../../engine/track.ts';
import { mulberry32 } from '../../engine/utils.ts';

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

// Баг #24: «Я учу» (или «Вернуть» из «Истории») выдаёт новый мозг, пока рой идёт. Раньше рой ставил его только родителем,
// а дети рождались из старого пула — лучших прошлого поколения: обученный мозг ехал одной машиной из ста и пропадал.
test('мозг, пришедший снаружи, — основа следующего поколения: все дети от него', () => {
  const evo = swarm(() => 100);
  evo.spawn(getTrainingTrack('warmup'));
  evo.evaluate(); // пул — лучшие этого поколения
  const taught = createBrain(sizes, mulberry32(7));
  evo.startFrom(taught);
  evo.spawn(getTrainingTrack('warmup'));
  assert.deepEqual(evo.cars[0].brain, taught, 'первым едет сам мозг, без изменений');
  assert.notEqual(evo.cars[0].brain, taught, 'рой едет на копии: чужой мозг он не меняет');
  for (const car of evo.cars.slice(1)) {
    // mutate() в этом рое меняет только первый порог — всё остальное у ребёнка от родителя
    assert.deepEqual(car.brain.layers[1], taught.layers[1], 'ребёнок — от пришедшего мозга, а не из старого пула');
  }
});

// Рецепт «из коробки» (think «Плавный», точечная мутация, кроссовер нейронами, фитнес «Дальше и быстрее») учится надёжно:
// в опыте (tools/swarm-check.mjs) — 15 финишей из 15 на «Змейке», «Шпильке» и «Развилке» со встречными.
test('рой по умолчанию учится: на «Змейке» со встречными лучший доезжает за 30 поколений', async () => {
  const { thinkVariants, DEFAULT_THINK } = await import('../../student/think.js');
  const { fitnessOf, MUTATIONS, DEFAULT_RECIPE, crossover } = await import('../../engine/recipes.ts');
  const fitness = fitnessOf(DEFAULT_RECIPE.parts), { mutate } = MUTATIONS[DEFAULT_RECIPE.mutation];
  const { withTraffic } = await import('../../engine/traffic.ts');
  const { withCoins } = await import('../../engine/track.ts');
  const { DEFAULT_SENSORS } = await import('../../engine/car.ts');
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

// «Учится само» (#8): рядом с роем можно пустить соперников — ботов и чужие машины. Они только едут рядом.
test('соперники едут в том же мире, но родителями не становятся, даже если они лучше всех', () => {
  const rivalBrain = createBrain(sizes, mulberry32(9));
  const evo = swarm((report) => report.progressPct); // фитнес — кто дальше уехал
  evo.rivals = [{ brain: rivalBrain, think: () => [1, 0, 0, 0, 0, 0, 0], sensors: SENSORS }];
  const track = getTrainingTrack('warmup');
  evo.spawn(track);
  assert.equal(evo.cars.length, 5, 'в рое столько машин, сколько задано');
  assert.equal(evo.rivalCars.length, 1);
  for (let t = 0; t < 120 && evo.step() > 0; t++);
  assert.equal(evo.rivalCars[0].ticks, evo.cars[0].ticks, 'соперник едет тик в тик с роем');
  evo.rivalCars[0].bestS = track.finishS; // соперник уехал дальше всех…
  const { parentCar } = evo.evaluate();
  assert.ok(evo.cars.includes(parentCar), '…но родитель — из роя');
  const rival = JSON.stringify(rivalBrain);
  assert.ok(![evo.parent, evo.parent2, ...evo.pool].some((b) => JSON.stringify(b) === rival), 'мозга соперника нет среди родителей');
  assert.equal(JSON.stringify(evo.rivals[0].brain), rival, 'мозг соперника не тронут');
});
