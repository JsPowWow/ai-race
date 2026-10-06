// Файл машины приходит от студента — проверяем всё, что в нём может быть не так.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCarFile } from '../../engine/car-file.ts';
import { bot } from '../helpers.mjs';

const good = () => structuredClone(bot('Торетто'));

test('файл бота читается', () => {
  const car = parseCarFile(good());
  assert.equal(car.name, 'Торетто');
  assert.equal(car.sizes.at(-1), 7, 'семь выходов: газ, тормоз, влево, вправо и три заметки');
  assert.equal(car.sizes[0], 2 * car.sensors.count + 2 + 3, 'входы: сенсоры, скорость, сенсоры мгновение назад, знак, заметки');
});

test('файл старого формата (мозг без знака или без памяти) — понятная ошибка', () => {
  for (const format of ['ai-race/car@1', 'ai-race/car@2']) assert.throws(() => parseCarFile({ ...good(), format }), /старого формата/);
});

test('не файл машины — понятная ошибка', () => {
  assert.throws(() => parseCarFile({ hello: 1 }), /не файл машины/);
});

test('слишком много сенсоров или сеть больше разрешённой — ошибка с именем машины', () => {
  const file = good();
  file.sensors.count = 99;
  assert.throws(() => parseCarFile(file), /Торетто: сенсоров должно быть/);
});

test('вариант «Мой» без своего кода — ошибка', () => {
  const file = { ...good(), think: 'mine' };
  assert.throws(() => parseCarFile(file), /нет thinkSource/);
});

test('старый файл с SVG-аватаром читается: картинку просто не берём', () => {
  const car = parseCarFile({ ...good(), avatar: '<svg><script>alert(1)</script></svg>' });
  assert.equal(car.name, 'Торетто');
  assert.ok(!('avatar' in car), 'аватара в машине нет: облик — цвет');
});

test('угол обзора сзади читается из файла; нет его — узкий веер по умолчанию', async () => {
  const { createBrain, layerSizes } = await import('../../engine/brain.ts');
  const withBack = (extra) => {
    const file = good();
    Object.assign(file.sensors, { back: 2, backLength: 80, ...extra });
    file.layers = layerSizes(file.sensors.count + 2, file.layers.slice(1, -1));
    file.brain = createBrain(file.layers);
    return file;
  };
  assert.equal(parseCarFile(withBack({ backSpread: 90 })).sensors.backSpread, 90);
  assert.equal(parseCarFile(withBack({})).sensors.backSpread, 30);
  assert.throws(() => parseCarFile(withBack({ backSpread: 300 })), /угол обзора сзади/);
});
