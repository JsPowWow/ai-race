// Очки сборки: у всех один бюджет, «всё на максимум» не купить (#19).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUDGET, cost } from '../../engine/build.js';
import { DEFAULT_SENSORS } from '../../engine/car.js';
import { parseCarFile } from '../../engine/car-file.js';
import { bot } from '../helpers.mjs';

const basic = { sensors: DEFAULT_SENSORS, hidden: [6] };

test('сборка по умолчанию стоит половину бюджета: есть что докупить', () => {
  assert.equal(BUDGET, 100);
  assert.equal(cost(basic), 50);
});

test('каждая покупка стоит очков, угол обзора — бесплатно', () => {
  const more = (patch) => cost({ ...basic, ...patch });
  assert.ok(more({ sensors: { ...DEFAULT_SENSORS, count: 6 } }) > 50, 'сенсор');
  assert.ok(more({ sensors: { ...DEFAULT_SENSORS, length: 200 } }) > 50, 'дальность');
  assert.ok(more({ sensors: { ...DEFAULT_SENSORS, back: 1, backLength: 80 } }) > 50, 'сенсор назад');
  assert.ok(more({ hidden: [7] }) > 50, 'нейрон');
  assert.ok(more({ hidden: [6, 2] }) > 50, 'слой');
  assert.equal(more({ sensors: { ...DEFAULT_SENSORS, spread: 150 } }), 50, 'широкий веер видит бока, узкий — центр: это выбор, а не покупка');
});

test('всё на максимум не влезает в бюджет', () => {
  assert.ok(cost({ sensors: { count: 15, spread: 90, length: 260, back: 4, backLength: 200 }, hidden: [16, 16, 16] }) > BUDGET);
});

test('боты собраны по правилам', () => {
  for (const name of ['Дедушка', 'Торетто', 'Бабушка']) {
    const b = bot(name);
    assert.ok(cost({ sensors: b.sensors, hidden: b.layers.slice(1, -1) }) <= BUDGET, name);
  }
});

test('файл машины дороже бюджета не принимается', () => {
  const file = structuredClone(bot('Торетто'));
  file.sensors.length = 260;
  file.sensors.count = 15;
  assert.throws(() => parseCarFile(file), /Торетто: сборка стоит \d+ очков/);
});

test('угол обзора сзади — тоже выбор, а не покупка', () => {
  const back = { ...DEFAULT_SENSORS, back: 2, backLength: 80 };
  assert.equal(cost({ ...basic, sensors: { ...back, backSpread: 120 } }), cost({ ...basic, sensors: back }));
});
