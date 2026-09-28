// Файл машины приходит от студента — проверяем всё, что в нём может быть не так.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCarFile, checkAvatar } from '../../engine/car-file.js';
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

test('аватар: скрипты и внешние ссылки не проходят', () => {
  assert.throws(() => checkAvatar('<svg><script>alert(1)</script></svg>'));
  assert.throws(() => checkAvatar('<svg onload="alert(1)"></svg>'));
});
