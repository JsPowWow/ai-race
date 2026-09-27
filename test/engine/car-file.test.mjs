// Файл машины приходит от студента — проверяем всё, что в нём может быть не так.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCarFile, checkAvatar } from '../../engine/car-file.js';
import { bot } from '../helpers.mjs';

const good = () => structuredClone(bot('Сквозняк'));

test('файл бота читается', () => {
  const car = parseCarFile(good());
  assert.equal(car.name, 'Сквозняк');
  assert.equal(car.sizes.at(-1), 4, 'четыре выхода: газ, тормоз, влево, вправо');
});

test('не файл машины — понятная ошибка', () => {
  assert.throws(() => parseCarFile({ hello: 1 }), /не файл машины/);
});

test('слишком много лучей или сеть больше разрешённой — ошибка с именем машины', () => {
  const file = good();
  file.sensors.count = 99;
  assert.throws(() => parseCarFile(file), /Сквозняк: лучей должно быть/);
});

test('вариант «Мой» без своего кода — ошибка', () => {
  const file = { ...good(), think: 'mine' };
  assert.throws(() => parseCarFile(file), /нет thinkSource/);
});

test('аватар: скрипты и внешние ссылки не проходят', () => {
  assert.throws(() => checkAvatar('<svg><script>alert(1)</script></svg>'));
  assert.throws(() => checkAvatar('<svg onload="alert(1)"></svg>'));
});
